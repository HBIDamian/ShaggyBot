const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check the bot\'s latency'),
  
  async execute(interaction) {
    const latency = Math.round(interaction.client.ws.ping);
    
    const embed = new EmbedBuilder()
      .setTitle('🏓 Pong!')
      .setDescription(`**Latency:** ${latency}ms`)
      .setColor(latency < 100 ? '#00FF00' : latency < 200 ? '#FFFF00' : '#FF0000')
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
  },
};
