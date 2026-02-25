const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('uptime')
    .setDescription('Shows the bot\'s uptime')
    .setDMPermission(true),
  
  async execute(interaction) {
    // Calculate uptime
    const uptime = Date.now() - interaction.client.launchTime;
    const days = Math.floor(uptime / 86400000); // Days
    const hours = Math.floor((uptime % 86400000) / 3600000); // Hours
    const minutes = Math.floor(((uptime % 86400000) % 3600000) / 60000); // Minutes
    const seconds = Math.floor((((uptime % 86400000) % 3600000) % 60000) / 1000); // Seconds
    
    // Format uptime string
    let uptimeString = '';
    if (days > 0) uptimeString += `${days} day${days > 1 ? 's' : ''} `;
    if (hours > 0) uptimeString += `${hours} hour${hours > 1 ? 's' : ''} `;
    if (minutes > 0) uptimeString += `${minutes} minute${minutes > 1 ? 's' : ''} `;
    uptimeString += `${seconds} second${seconds > 1 ? 's' : ''}`;
    
    // Create embed
    const embed = new EmbedBuilder()
      .setTitle('Bot Uptime')
      .setDescription(`I've been online for ${uptimeString}.`)
      .setColor('#00AAFF')
      .setFooter({ text: 'Bot started at' })
      .setTimestamp(interaction.client.launchTime);
    
    await interaction.reply({ embeds: [embed] });
  },
};
