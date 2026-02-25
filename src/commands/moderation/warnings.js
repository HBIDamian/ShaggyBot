const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { createLogger } = require('../../utils/logger');
const { replyError } = require('../../utils/moderationHelpers');
const db = require('../../database/database');

const logger = createLogger('WarningsCommand');

const WARNINGS_PER_PAGE = 5;

function getDiscordTimestamp(dateStr) {
  const date = new Date(dateStr);
  return Math.floor(date.getTime() / 1000);
}

async function buildWarningsEmbed(warnings, user, page, client) {
  const totalPages = Math.ceil(warnings.length / WARNINGS_PER_PAGE) || 1;
  const start = (page - 1) * WARNINGS_PER_PAGE;
  const pageWarnings = warnings.slice(start, start + WARNINGS_PER_PAGE);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setAuthor({ 
      name: user.username, 
      iconURL: user.displayAvatarURL({ dynamic: true }) 
    })
    .setTitle(`Moderation | Warnings | Total: ${warnings.length}`)
    .setFooter({ text: `Page ${page} of ${totalPages}` });

  let description = '';
  
  for (const warning of pageWarnings) {
    const moderator = warning.moderator_id 
      ? await client.users.fetch(warning.moderator_id).catch(() => null)
      : null;
    
    const modName = moderator ? moderator.username : 'Anonymous';
    const timestamp = getDiscordTimestamp(warning.created_at);
    const reason = warning.reason || 'No reason provided';
    
    // All warnings are "active" in our system (no expiry)
    description += `🟢 **ID:** ${warning.id} - **Moderator:** ${modName} - **Time:** <t:${timestamp}:f> - **Reason:** ${reason}\n\n`;
  }

  embed.setDescription(description || 'No warnings found.');
  
  return { embed, totalPages };
}

function buildPaginationButtons(userId, currentPage, totalPages, disabled = false) {
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`warnings_first_${userId}_${currentPage}`)
        .setEmoji('⏪')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled || currentPage === 1),
      new ButtonBuilder()
        .setCustomId(`warnings_prev_${userId}_${currentPage}`)
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled || currentPage === 1),
      new ButtonBuilder()
        .setCustomId(`warnings_close_${userId}`)
        .setEmoji('⏹️')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`warnings_next_${userId}_${currentPage}`)
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled || currentPage === totalPages),
      new ButtonBuilder()
        .setCustomId(`warnings_last_${userId}_${currentPage}`)
        .setEmoji('⏩')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled || currentPage === totalPages)
    );
  
  return row;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('List all warnings for the specified user')
    .setDMPermission(false)
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to check warnings for')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const user = interaction.options.getUser('user');

    try {
      const warnings = db.getUserWarnings(interaction.guildId, user.id);

      if (warnings.length === 0) {
        return interaction.reply({
          content: `✅ ${user.username} has no warnings.`,
          flags: MessageFlags.Ephemeral
        });
      }

      const { embed, totalPages } = await buildWarningsEmbed(warnings, user, 1, interaction.client);
      const row = buildPaginationButtons(user.id, 1, totalPages);

      return interaction.reply({ embeds: [embed], components: [row] });
    } catch (err) {
      logger.error(`Error fetching warnings: ${err.message}`);
      return replyError(interaction, '❌ An error occurred while fetching warnings.');
    }
  },

  // Export helpers for button handler
  buildWarningsEmbed,
  buildPaginationButtons,
  WARNINGS_PER_PAGE
};
