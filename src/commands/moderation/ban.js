const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { createLogger } = require('../../utils/logger');
const { sendPunishmentNotification } = require('../../utils/punishmentNotifier');
const { markBotAction } = require('../../events/nativeModeration');
const { runModerationChecks, replyError } = require('../../utils/moderationHelpers');
const db = require('../../database/database');

const logger = createLogger('BanCommand');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban the specified user with optional reason')
    .setDMPermission(false)
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to ban')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for the ban')
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName('silent')
        .setDescription('Don\'t announce the ban in the channel')
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName('softban')
        .setDescription('Ban and immediately unban to delete messages')
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const isSilent = interaction.options.getBoolean('silent') || false;
    const isSoftBan = interaction.options.getBoolean('softban') || false;

    const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);

    const error = runModerationChecks({
      targetUser: user,
      executor: interaction.user,
      client: interaction.client,
      targetMember,
      executorMember: interaction.member,
      action: 'ban'
    });

    if (error) {return replyError(interaction, error);}

    try {
      markBotAction(interaction.guildId, user.id, 'ban');
      if (isSoftBan) {markBotAction(interaction.guildId, user.id, 'unban');}

      if (!isSoftBan) {
        await sendPunishmentNotification({
          guild: interaction.guild,
          user,
          moderator: interaction.user,
          type: 'ban',
          reason
        });
      }

      await interaction.guild.members.ban(user.id, {
        reason: `${reason} | Banned by ${interaction.user.tag}`,
        deleteMessageSeconds: isSoftBan ? 604800 : 0
      });

      if (isSoftBan) {
        await interaction.guild.members.unban(user.id, 'Softban - messages deleted');
      }

      db.logModAction(interaction.guildId, user.id, interaction.user.id, isSoftBan ? 'softban' : 'ban', reason);

      const embed = new EmbedBuilder()
        .setColor(isSoftBan ? 0xFFA500 : 0xFF0000)
        .setTitle(isSoftBan ? '🧹 User Softbanned' : '🔨 User Banned')
        .addFields(
          { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
          { name: 'Moderator', value: interaction.user.tag, inline: true },
          { name: 'Reason', value: reason }
        )
        .setTimestamp();

      if (isSoftBan) {
        embed.setFooter({ text: 'User was unbanned - only their messages were deleted' });
      }

      return interaction.reply({ embeds: [embed], flags: isSilent ? MessageFlags.Ephemeral : 0 });
    } catch (err) {
      logger.error(`Error banning user: ${err.message}`);
      return replyError(interaction, '❌ An error occurred while trying to ban the user.');
    }
  }
};
