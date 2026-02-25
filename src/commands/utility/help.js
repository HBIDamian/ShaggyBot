const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Cache command metadata (loaded on first use to avoid circular dependencies)
let commandCache = null;

function getCommandCache() {
  if (commandCache) return commandCache;
  
  commandCache = new Map();
  const commandsPath = path.join(__dirname, '..');
  const categories = fs.readdirSync(commandsPath, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  
  for (const category of categories) {
    const commands = [];
    const categoryPath = path.join(commandsPath, category);
    const files = fs.readdirSync(categoryPath).filter(f => f.endsWith('.js'));
    
    for (const file of files) {
      try {
        const command = require(path.join(categoryPath, file));
        if (command.data) {
          commands.push({
            name: command.data.name,
            description: command.data.description
          });
        }
      } catch {}
    }
    
    if (commands.length > 0) {
      commandCache.set(category, commands);
    }
  }
  
  return commandCache;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Shows all available commands')
    .setDMPermission(true)
    .addStringOption(option => 
      option.setName('category')
        .setDescription('Get help for a specific category')
        .setRequired(false)
        .addChoices(
          { name: 'Fun', value: 'fun' },
          { name: 'Utility', value: 'utility' },
          { name: 'Moderation', value: 'moderation' },
          { name: 'Features', value: 'features' }
        )),
  
  async execute(interaction) {
    const category = interaction.options.getString('category');
    const cache = getCommandCache();
    
    if (!category) {
      // Show all categories
      const embed = new EmbedBuilder()
        .setTitle('📚 Command Help')
        .setDescription('Use `/help <category>` for detailed information.')
        .setColor('#9B59B6')
        .setFooter({ text: `Requested by ${interaction.user.tag}` })
        .setTimestamp();
      
      for (const [cat, commands] of cache) {
        embed.addFields({
          name: `${cat.charAt(0).toUpperCase() + cat.slice(1)} [${commands.length}]`,
          value: commands.map(c => `\`${c.name}\``).join(', ') || 'No commands',
          inline: false
        });
      }
      
      return interaction.reply({ embeds: [embed] });
    }
    
    // Show specific category
    const commands = cache.get(category);
    
    if (!commands || commands.length === 0) {
      return interaction.reply({
        content: `No commands found in the ${category} category.`,
        flags: MessageFlags.Ephemeral
      });
    }
    
    const embed = new EmbedBuilder()
      .setTitle(`${category.charAt(0).toUpperCase() + category.slice(1)} Commands`)
      .setDescription(`All commands in the ${category} category:`)
      .setColor('#9B59B6')
      .setFooter({ text: `Requested by ${interaction.user.tag}` })
      .setTimestamp();
    
    for (const cmd of commands) {
      embed.addFields({
        name: `/${cmd.name}`,
        value: cmd.description,
        inline: false
      });
    }
    
    await interaction.reply({ embeds: [embed] });
  },
};
