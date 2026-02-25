const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { createLogger } = require('../../utils/logger');
const { sendPunishmentNotification } = require('../../utils/punishmentNotifier');
const { markBotAction } = require('../../events/nativeModeration');
const { runModerationChecks, replyError, parseTime, formatDuration } = require('../../utils/moderationHelpers');
const db = require('../../database/database');

const logger = createLogger('TimeoutCommand');
const MAX_TIMEOUT = 28 * 24 * 60 * 60 * 1000; // 28 days

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout (mute) a user for the specified duration')
    .setDMPermission(false)
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to timeout')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('time')
        .setDescription('Duration (e.g., 10m, 1h, 1d, 1w)')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for the timeout')
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName('silent')
        .setDescription('Don\'t announce the timeout in the channel')
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const timeStr = interaction.options.getString('time');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const isSilent = interaction.options.getBoolean('silent') || false;

    const duration = parseTime(timeStr);
    if (!duration) {
      return replyError(interaction, '❌ Invalid time format. Use formats like: 10m, 1h, 1d, 1w');
    }

    if (duration > MAX_TIMEOUT) {
      return replyError(interaction, '❌ Maximum timeout duration is 28 days.');
    }

    const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);

    const error = runModerationChecks({
      targetUser: user,
      executor: interaction.user,
      client: interaction.client,
      targetMember,
      executorMember: interaction.member,
      action: 'timeout',
      requireInGuild: true
    });
    
    if (error) return replyError(interaction, error);

    try {
      markBotAction(interaction.guildId, user.id, 'timeout');
      
      await targetMember.timeout(duration, `${reason} | By ${interaction.user.tag}`);
      db.logModAction(interaction.guildId, user.id, interaction.user.id, 'timeout', `${reason} (Duration: ${formatDuration(duration)})`);

      const expiresAt = Math.floor((Date.now() + duration) / 1000);
      
      await sendPunishmentNotification({
        guild: interaction.guild,
        user,
        moderator: interaction.user,
        type: 'timeout',
        reason,
        extra: { duration: formatDuration(duration), expiresAt }
      });

      const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('⏰ User Timed Out')
        .addFields(
          { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
          { name: 'Moderator', value: interaction.user.tag, inline: true },
          { name: 'Duration', value: formatDuration(duration), inline: true },
          { name: 'Expires', value: `<t:${expiresAt}:R>`, inline: true },
          { name: 'Reason', value: reason }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed], flags: isSilent ? MessageFlags.Ephemeral : 0 });
    } catch (err) {
      logger.error(`Error timing out user: ${err.message}`);
      return replyError(interaction, '❌ An error occurred while trying to timeout the user.');
    }
  }
};
