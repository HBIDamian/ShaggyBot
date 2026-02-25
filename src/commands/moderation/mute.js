const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { createLogger } = require('../../utils/logger');
const { sendPunishmentNotification } = require('../../utils/punishmentNotifier');
const { markBotAction } = require('../../events/nativeModeration');
const { runModerationChecks, replyError } = require('../../utils/moderationHelpers');
const db = require('../../database/database');

const logger = createLogger('MuteCommand');
const MAX_TIMEOUT = 28 * 24 * 60 * 60 * 1000; // 28 days

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Mute the specified user (applies a 28-day timeout)')
    .setDMPermission(false)
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to mute')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for the mute')
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName('silent')
        .setDescription('Don\'t announce the mute in the channel')
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const isSilent = interaction.options.getBoolean('silent') || false;

    const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);

    const error = runModerationChecks({
      targetUser: user,
      executor: interaction.user,
      client: interaction.client,
      targetMember,
      executorMember: interaction.member,
      action: 'mute',
      requireInGuild: true
    });
    
    if (error) return replyError(interaction, error);

    try {
      markBotAction(interaction.guildId, user.id, 'timeout');
      
      await targetMember.timeout(MAX_TIMEOUT, `${reason} | By ${interaction.user.tag}`);
      db.logModAction(interaction.guildId, user.id, interaction.user.id, 'mute', reason);

      await sendPunishmentNotification({
        guild: interaction.guild,
        user,
        moderator: interaction.user,
        type: 'mute',
        reason,
        extra: { duration: '28 days' }
      });

      const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('🔇 User Muted')
        .addFields(
          { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
          { name: 'Moderator', value: interaction.user.tag, inline: true },
          { name: 'Reason', value: reason }
        )
        .setFooter({ text: 'User has been timed out for 28 days' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], flags: isSilent ? MessageFlags.Ephemeral : 0 });
    } catch (err) {
      logger.error(`Error muting user: ${err.message}`);
      return replyError(interaction, '❌ An error occurred while trying to mute the user.');
    }
  }
};
