const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { createLogger } = require('../../utils/logger');
const { sendPunishmentNotification } = require('../../utils/punishmentNotifier');
const { runModerationChecks, replyError } = require('../../utils/moderationHelpers');
const db = require('../../database/database');

const logger = createLogger('WarnCommand');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn the specified user')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to warn')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for the warning')
        .setRequired(true))
    .addBooleanOption(option =>
      option.setName('silent')
        .setDescription('Don\'t announce the warning in the channel')
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName('anonymous')
        .setDescription('Hide your name from the warned user')
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');
    const isSilent = interaction.options.getBoolean('silent') || false;
    const isAnonymous = interaction.options.getBoolean('anonymous') || false;

    const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
    
    const error = runModerationChecks({
      targetUser: user,
      executor: interaction.user,
      client: interaction.client,
      targetMember,
      executorMember: interaction.member,
      action: 'warn'
    });
    
    if (error) return replyError(interaction, error);

    try {
      const warningId = db.addWarning(
        interaction.guildId,
        user.id,
        isAnonymous ? null : interaction.user.id,
        reason
      );

      const totalWarnings = db.getWarningCount(interaction.guildId, user.id);
      db.logModAction(interaction.guildId, user.id, interaction.user.id, 'warn', reason);

      const { dmSent, channelSent } = await sendPunishmentNotification({
        guild: interaction.guild,
        user,
        moderator: interaction.user,
        type: 'warn',
        reason,
        anonymous: isAnonymous,
        extra: { warningCount: totalWarnings, warningId }
      });

      const notifyStatus = !dmSent && !channelSent ? '\n⚠️ Could not notify user (DMs disabled)' : '';
      const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setDescription(`✅ <@${user.id}> / ${user.username} (${user.id}) has been successfully warned for: \`${reason}\`.\n\n**Total Warnings:** ${totalWarnings} - **Warn ID:** ${warningId} - **Moderator:** ${isAnonymous ? 'Anonymous' : interaction.user.username}${notifyStatus}`);

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`view_warnings_${user.id}`)
            .setLabel('View Warnings')
            .setStyle(ButtonStyle.Primary)
        );

      return interaction.reply({ embeds: [embed], components: [row], flags: isSilent ? MessageFlags.Ephemeral : 0 });
    } catch (err) {
      logger.error(`Error warning user: ${err.message}`);
      return replyError(interaction, '❌ An error occurred while trying to warn the user.');
    }
  }
};
