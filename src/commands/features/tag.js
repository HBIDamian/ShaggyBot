const { SlashCommandBuilder, EmbedBuilder , MessageFlags } = require('discord.js');
const db = require('../../database/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tag')
    .setDescription('Display a tag')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('The name of the tag to display')
        .setRequired(true)
        .setAutocomplete(true)
    ),
  
  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const tags = db.getTags(interaction.guildId);
    
    const filtered = tags
      .filter(tag => tag.name.includes(focusedValue))
      .slice(0, 25)
      .map(tag => ({ name: tag.name, value: tag.name }));
    
    await interaction.respond(filtered);
  },
  
  async execute(interaction) {
    const name = interaction.options.getString('name').toLowerCase();
    const tag = db.getTag(interaction.guildId, name);
    
    if (!tag) {
      return interaction.reply({
        content: `❌ Tag \`${name}\` not found. Use \`/tags list\` to see available tags.`,
        flags: MessageFlags.Ephemeral
      });
    }
    
    // Increment uses
    db.incrementTagUses(tag.id);
    
    // Send the tag response
    await interaction.reply(tag.response);
  }
};
