const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { createLogger } = require('../../utils/logger');
const { replyError } = require('../../utils/moderationHelpers');
const db = require('../../database/database');

const logger = createLogger('ClearWarningsCommand');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clearwarnings')
    .setDescription('Remove all warnings from the specified user')
    .setDMPermission(false)
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to clear warnings for')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const user = interaction.options.getUser('user');

    try {
      const warningCount = db.getWarningCount(interaction.guildId, user.id);

      if (warningCount === 0) {
        return interaction.reply({ content: `✅ ${user.tag} has no warnings to clear.`, flags: MessageFlags.Ephemeral });
      }

      const cleared = db.clearUserWarnings(interaction.guildId, user.id);

      const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('🗑️ Warnings Cleared')
        .addFields(
          { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
          { name: 'Warnings Cleared', value: `${cleared}`, inline: true },
          { name: 'Cleared By', value: interaction.user.tag, inline: true }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      logger.error(`Error clearing warnings: ${err.message}`);
      return replyError(interaction, '❌ An error occurred while clearing warnings.');
    }
  }
};
