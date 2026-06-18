const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { createLogger } = require('../../utils/logger');
const { sendPunishmentNotification } = require('../../utils/punishmentNotifier');
const { markBotAction } = require('../../events/nativeModeration');
const { runModerationChecks, replyError } = require('../../utils/moderationHelpers');
const db = require('../../database/database');

const logger = createLogger('KickCommand');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server')
    .setDMPermission(false)
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The member to kick')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for kicking')
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName('silent')
        .setDescription('Don\'t announce the kick in the channel')
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const isSilent = interaction.options.getBoolean('silent') || false;

    const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);

    // Run all validation checks
    const error = runModerationChecks({
      targetUser: user,
      executor: interaction.user,
      client: interaction.client,
      targetMember,
      executorMember: interaction.member,
      action: 'kick',
      requireInGuild: true
    });

    if (error) {return replyError(interaction, error);}

    try {
      markBotAction(interaction.guildId, user.id, 'kick');

      await sendPunishmentNotification({
        guild: interaction.guild,
        user,
        moderator: interaction.user,
        type: 'kick',
        reason
      });

      await targetMember.kick(`${reason} | By ${interaction.user.tag}`);
      db.logModAction(interaction.guildId, user.id, interaction.user.id, 'kick', reason);

      const embed = new EmbedBuilder()
        .setColor(0xFFA500)
        .setTitle('👢 User Kicked')
        .addFields(
          { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
          { name: 'Moderator', value: interaction.user.tag, inline: true },
          { name: 'Reason', value: reason }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed], flags: isSilent ? MessageFlags.Ephemeral : 0 });
    } catch (error) {
      logger.error(`Error kicking member: ${error.message}`);
      return replyError(interaction, '❌ An error occurred while trying to kick the member.');
    }
  },
};
