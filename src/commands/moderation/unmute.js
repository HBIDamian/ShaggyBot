const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { createLogger } = require('../../utils/logger');
const { replyError } = require('../../utils/moderationHelpers');
const db = require('../../database/database');

const logger = createLogger('UnmuteCommand');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Unmute the specified user (removes timeout)')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to unmute')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const user = interaction.options.getUser('user');

    const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!targetMember) {
      return replyError(interaction, '❌ This user is not in the server.');
    }

    if (!targetMember.isCommunicationDisabled()) {
      return replyError(interaction, '❌ This user is not muted/timed out.');
    }

    if (!targetMember.moderatable) {
      return replyError(interaction, '❌ I cannot unmute this user. They may have a higher role than me.');
    }

    try {
      await targetMember.timeout(null, `Unmuted by ${interaction.user.tag}`);
      db.logModAction(interaction.guildId, user.id, interaction.user.id, 'unmute', 'User unmuted');

      const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('🔊 User Unmuted')
        .addFields(
          { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
          { name: 'Moderator', value: interaction.user.tag, inline: true }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      logger.error(`Error unmuting user: ${err.message}`);
      return replyError(interaction, '❌ An error occurred while trying to unmute the user.');
    }
  }
};
