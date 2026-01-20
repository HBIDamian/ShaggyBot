const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { createLogger } = require('../../utils/logger');
const { sendPunishmentNotification } = require('../../utils/punishmentNotifier');
const { markBotAction } = require('../../events/nativeModeration');
const { runModerationChecks, replyError, parseTime, formatDuration } = require('../../utils/moderationHelpers');
const db = require('../../database/database');

const logger = createLogger('TempbanCommand');

const MAX_TEMPBAN_MS = 28 * 24 * 60 * 60 * 1000; // 28 days

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tempban')
    .setDescription('Temporarily ban a user for the specified duration')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to tempban')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('time')
        .setDescription('Duration (e.g., 1d, 12h, 30m, 1w)')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for the tempban')
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName('silent')
        .setDescription('Don\'t announce the ban in the channel')
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const timeStr = interaction.options.getString('time');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const isSilent = interaction.options.getBoolean('silent') || false;

    const duration = parseTime(timeStr);
    if (!duration) {
      return replyError(interaction, '❌ Invalid time format. Use formats like: 30m, 1h, 1d, 1w');
    }

    if (duration > MAX_TEMPBAN_MS) {
      return replyError(interaction, '❌ Maximum tempban duration is 28 days.');
    }

    const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
    
    const error = runModerationChecks({
      targetUser: user,
      executor: interaction.user,
      client: interaction.client,
      targetMember,
      executorMember: interaction.member,
      action: 'tempban',
      requireBannable: true
    });
    
    if (error) return replyError(interaction, error);

    try {
      const unbanAt = Date.now() + duration;
      const fullReason = `[TEMPBAN: Expires <t:${Math.floor(unbanAt / 1000)}:R>] ${reason} | By ${interaction.user.tag}`;
      
      markBotAction(interaction.guildId, user.id, 'ban');
      
      await sendPunishmentNotification({
        guild: interaction.guild,
        user,
        moderator: interaction.user,
        type: 'ban',
        reason: `[TEMPBAN] ${reason}`,
        extra: { duration: formatDuration(duration), expiresAt: Math.floor(unbanAt / 1000) }
      });

      await interaction.guild.members.ban(user.id, { reason: fullReason });
      db.scheduleTempban(interaction.guildId, user.id, unbanAt);
      db.logModAction(interaction.guildId, user.id, interaction.user.id, 'tempban', `${reason} (Duration: ${formatDuration(duration)})`);

      setTimeout(async () => {
        try {
          markBotAction(interaction.guildId, user.id, 'unban');
          await interaction.guild.members.unban(user.id, 'Tempban expired');
          db.removeTempban(interaction.guildId, user.id);
        } catch (e) {
          // User may have been manually unbanned
        }
      }, duration);

      const embed = new EmbedBuilder()
        .setColor(0xFFA500)
        .setTitle('⏱️ User Temporarily Banned')
        .addFields(
          { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
          { name: 'Moderator', value: interaction.user.tag, inline: true },
          { name: 'Duration', value: formatDuration(duration), inline: true },
          { name: 'Expires', value: `<t:${Math.floor(unbanAt / 1000)}:F>`, inline: true },
          { name: 'Reason', value: reason }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed], flags: isSilent ? MessageFlags.Ephemeral : 0 });
    } catch (err) {
      logger.error(`Error tempbanning user: ${err.message}`);
      return replyError(interaction, '❌ An error occurred while trying to tempban the user.');
    }
  }
};
