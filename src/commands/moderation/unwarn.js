const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { createLogger } = require('../../utils/logger');
const { replyError } = require('../../utils/moderationHelpers');
const db = require('../../database/database');

const logger = createLogger('UnwarnCommand');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unwarn')
    .setDescription('Remove a warning from a user')
    .setDMPermission(false)
    .addIntegerOption(option =>
      option.setName('id')
        .setDescription('The warning ID to remove')
        .setRequired(true))
    .addBooleanOption(option =>
      option.setName('silent')
        .setDescription('Don\'t announce the unwarn in the channel')
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const warningId = interaction.options.getInteger('id');
    const isSilent = interaction.options.getBoolean('silent') || false;

    try {
      const deleted = db.deleteWarning(warningId, interaction.guildId);

      if (!deleted) {
        return replyError(interaction, `❌ Warning #${warningId} not found or doesn't belong to this server.`);
      }

      const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ Warning Removed')
        .addFields(
          { name: 'Warning ID', value: `#${warningId}`, inline: true },
          { name: 'Removed By', value: interaction.user.tag, inline: true }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed], flags: isSilent ? MessageFlags.Ephemeral : 0 });
    } catch (err) {
      logger.error(`Error removing warning: ${err.message}`);
      return replyError(interaction, '❌ An error occurred while trying to remove the warning.');
    }
  }
};
