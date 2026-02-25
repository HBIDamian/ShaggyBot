const { SlashCommandBuilder , MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll a die')
    .setDMPermission(true)
    .addIntegerOption(option => 
      option
        .setName('sides')
        .setDescription('Number of sides on the die (default: 6)')
        .setRequired(false)),
  
  async execute(interaction) {
    const sides = interaction.options.getInteger('sides') || 6;
    
    if (sides <= 1) {
      await interaction.reply({ content: "Please specify a valid number of sides (>1).", flags: MessageFlags.Ephemeral });
      return;
    }
    
    const result = Math.floor(Math.random() * sides) + 1;
    await interaction.reply(`🎲 You rolled a ${result} (1-${sides})!`);
  },
};
