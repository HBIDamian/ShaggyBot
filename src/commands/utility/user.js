const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('user')
    .setDescription('Display information about a user')
    .setDMPermission(true)
    .addUserOption(option =>
      option.setName('target')
        .setDescription('The user to display information about')
        .setRequired(false)),

  async execute(interaction) {
    // Get the target user (or the command user if no target specified)
    const targetUser = interaction.options.getUser('target') || interaction.user;
    const member = interaction.guild?.members.cache.get(targetUser.id);

    // Calculate join dates
    const discordJoined = targetUser.createdAt;
    const discordJoinDate = `<t:${Math.floor(discordJoined.getTime() / 1000)}:R>`;

    // Get user badges
    const flags = targetUser.flags?.toArray() || [];
    const badges = flags.length ? flags.map(flag => {
      const badgeMap = {
        'StaffMember': '👨‍💼 Discord Staff',
        'Partner': '🤝 Discord Partner',
        'BugHunterLevel1': '🐛 Bug Hunter',
        'BugHunterLevel2': '🐛 Bug Hunter Level 2',
        'HypeSquadOnlineHouse1': '🏠 HypeSquad Bravery',
        'HypeSquadOnlineHouse2': '🏠 HypeSquad Brilliance',
        'HypeSquadOnlineHouse3': '🏠 HypeSquad Balance',
        'PremiumEarlySupporter': '❤️ Early Supporter',
        'VerifiedDeveloper': '👨‍💻 Verified Bot Developer'
      };
      return badgeMap[flag] || flag;
    }).join('\n') : 'None';

    // Build the embed
    const embed = new EmbedBuilder()
      .setTitle(`User Information: ${targetUser.tag}`)
      .setColor(member?.displayHexColor || '#2F3136')
      .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: '🆔 User ID', value: targetUser.id, inline: true },
        { name: '📅 Account Created', value: discordJoinDate, inline: true },
        { name: '🏅 Badges', value: badges, inline: false }
      )
      .setFooter({ text: `Requested by ${interaction.user.tag}` })
      .setTimestamp();

    // Add guild-specific information if in a guild
    if (member) {
      const guildJoined = member.joinedAt;
      const guildJoinDate = `<t:${Math.floor(guildJoined.getTime() / 1000)}:R>`;
      const roles = member.roles.cache
        .filter(role => role.id !== interaction.guild.id)
        .sort((a, b) => b.position - a.position)
        .map(role => `<@&${role.id}>`)
        .join(', ') || 'None';

      embed.addFields(
        { name: '📥 Server Joined', value: guildJoinDate, inline: true },
        { name: '📛 Nickname', value: member.nickname || 'None', inline: true },
        { name: `🏷️ Roles [${member.roles.cache.size - 1}]`, value: roles.slice(0, 1024) || 'None', inline: false }
      );
    }

    await interaction.reply({ embeds: [embed] });
  },
};
