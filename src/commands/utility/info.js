const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('Display information about the bot')
    .setDMPermission(true),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('Bot Information')
      .setDescription('A Discord bot made with Discord.js')
      .setColor(0x0099FF)
      .addFields(
        { name: 'Node.js Version', value: process.version },
        { name: 'Discord.js Version', value: require('discord.js').version },
        { name: 'Latency', value: `${Math.round(interaction.client.ws.ping)}ms` },
        { name: 'Server Count', value: `${interaction.client.guilds.cache.size}` }
      )
      .setFooter({ text: `Requested by ${interaction.user.tag}` });

    await interaction.reply({ embeds: [embed] });
  },
};
