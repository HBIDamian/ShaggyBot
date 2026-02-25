const { SlashCommandBuilder, EmbedBuilder , MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('server')
    .setDescription('Display information about the current server')
    .setDMPermission(false),
  
  async execute(interaction) {
    const guild = interaction.guild;
    
    // Exit if command was used in DMs
    if (!guild) {
      return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    }
    
    // Get server creation date
    const createdAt = guild.createdAt;
    const createdDate = `${createdAt.getDate()}/${createdAt.getMonth() + 1}/${createdAt.getFullYear()}`;
    
    // Get member counts
    const totalMembers = guild.memberCount;
    const botCount = guild.members.cache.filter(member => member.user.bot).size;
    const humanCount = totalMembers - botCount;
    
    // Get boost status
    const boostLevel = guild.premiumTier;
    const boostCount = guild.premiumSubscriptionCount;
    
    const embed = new EmbedBuilder()
      .setTitle(guild.name)
      .setDescription(`Information about this Discord server`)
      .setColor('#5865F2')
      .setThumbnail(guild.iconURL({ dynamic: true }) || null)
      .addFields(
        { name: '🆔 Server ID', value: guild.id, inline: true },
        { name: '👑 Owner', value: `<@${guild.ownerId}>`, inline: true },
        { name: '📅 Created On', value: createdDate, inline: true },
        { name: '👥 Total Members', value: `${totalMembers}`, inline: true },
        { name: '👤 Humans', value: `${humanCount}`, inline: true },
        { name: '🤖 Bots', value: `${botCount}`, inline: true },
        { name: '💬 Channels', value: `${guild.channels.cache.size}`, inline: true },
        { name: '🏷️ Roles', value: `${guild.roles.cache.size}`, inline: true },
        { name: '😀 Emojis', value: `${guild.emojis.cache.size}`, inline: true },
        { name: '🚀 Boost Level', value: `Level ${boostLevel} (${boostCount} boosts)`, inline: true }
      )
      .setFooter({ text: `Requested by ${interaction.user.tag}` })
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
  },
};
