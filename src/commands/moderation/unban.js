const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { createLogger } = require('../../utils/logger');
const { sendPunishmentNotification } = require('../../utils/punishmentNotifier');
const { markBotAction } = require('../../events/nativeModeration');
const { replyError } = require('../../utils/moderationHelpers');
const db = require('../../database/database');

const logger = createLogger('UnbanCommand');

const USER_ID_REGEX = /^\d{17,19}$/;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Pardons (unbans) the specified user')
    .addStringOption(option =>
      option.setName('user_id')
        .setDescription('The user ID to unban')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    const userId = interaction.options.getString('user_id').trim();

    if (!USER_ID_REGEX.test(userId)) {
      return replyError(interaction, '❌ Invalid user ID format. Please provide a valid Discord user ID.');
    }

    try {
      const bans = await interaction.guild.bans.fetch();
      const bannedUser = bans.get(userId);

      if (!bannedUser) {
        return replyError(interaction, '❌ This user is not banned from this server.');
      }

      markBotAction(interaction.guildId, userId, 'unban');
      await interaction.guild.members.unban(userId, `Unbanned by ${interaction.user.tag}`);
      db.logModAction(interaction.guildId, userId, interaction.user.id, 'unban', 'User pardoned');

      await sendPunishmentNotification({
        guild: interaction.guild,
        user: bannedUser.user,
        moderator: interaction.user,
        type: 'unban',
        reason: 'User pardoned'
      });

      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('✅ User Unbanned')
        .addFields(
          { name: 'User', value: `${bannedUser.user.tag} (${userId})`, inline: true },
          { name: 'Moderator', value: interaction.user.tag, inline: true }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      logger.error(`Error unbanning user: ${err.message}`);
      return replyError(interaction, '❌ An error occurred while trying to unban the user.');
    }
  }
};
