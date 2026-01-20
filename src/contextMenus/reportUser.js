const { ContextMenuCommandBuilder, ApplicationCommandType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
const db = require('../database/database');
const { createLogger } = require('../utils/logger');

const logger = createLogger('ReportUser');

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Report User')
    .setType(ApplicationCommandType.User),
  
  async execute(interaction) {
    const targetUser = interaction.targetUser;
    const guild = interaction.guild;
    const reporter = interaction.user;
    
    // Get moderation settings
    const modSettings = db.getModerationSettings(guild.id);
    
    // Check if report feature is enabled
    if (!modSettings?.report_enabled) {
      return interaction.reply({
        content: '❌ User reporting is not enabled on this server.',
        flags: MessageFlags.Ephemeral
      });
    }
    
    // Check if report channel is configured
    if (!modSettings?.report_channel) {
      return interaction.reply({
        content: '❌ No report channel has been configured. Please ask an administrator to set one up.',
        flags: MessageFlags.Ephemeral
      });
    }
    
    // Don't allow reporting yourself
    if (targetUser.id === reporter.id) {
      return interaction.reply({
        content: '❌ You cannot report yourself.',
        flags: MessageFlags.Ephemeral
      });
    }
    
    // Don't allow reporting bots
    if (targetUser.bot) {
      return interaction.reply({
        content: '❌ You cannot report bots.',
        flags: MessageFlags.Ephemeral
      });
    }
    
    // Create the modal for reason input
    const modal = new ModalBuilder()
      .setCustomId(`report_user_modal_${targetUser.id}`)
      .setTitle('Reason');
    
    const reasonInput = new TextInputBuilder()
      .setCustomId('report_reason')
      .setLabel('Reason')
      .setPlaceholder('The reason.')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1000);
    
    const actionRow = new ActionRowBuilder().addComponents(reasonInput);
    modal.addComponents(actionRow);
    
    await interaction.showModal(modal);
  },
  
  /**
   * Handle the modal submission
   */
  async handleModalSubmit(interaction, targetUserId) {
    const guild = interaction.guild;
    const reporter = interaction.user;
    const reason = interaction.fields.getTextInputValue('report_reason');
    
    // Get moderation settings again
    const modSettings = db.getModerationSettings(guild.id);
    
    // Get the report channel
    const reportChannel = guild.channels.cache.get(modSettings.report_channel);
    if (!reportChannel) {
      return interaction.reply({
        content: '❌ The configured report channel no longer exists.',
        flags: MessageFlags.Ephemeral
      });
    }
    
    // Fetch the target user
    let targetUser;
    try {
      targetUser = await interaction.client.users.fetch(targetUserId);
    } catch (error) {
      return interaction.reply({
        content: '❌ Could not find the reported user.',
        flags: MessageFlags.Ephemeral
      });
    }
    
    // Create the report ID
    const reportId = `user_report_${Date.now()}_${targetUserId}`;
    
    // Create the report embed
    const reportEmbed = new EmbedBuilder()
      .setColor(0xFF6B6B)
      .setAuthor({
        name: targetUser.username,
        iconURL: targetUser.displayAvatarURL({ dynamic: true })
      })
      .setTitle('User Report')
      .setDescription(
        `<@${reporter.id}> (${reporter.id}) is reporting <@${targetUser.id}> (${targetUser.id}).`
      )
      .addFields({
        name: 'Reason:',
        value: reason.length > 1024 ? reason.substring(0, 1021) + '...' : reason
      })
      .setFooter({
        text: `Report submitted by ${reporter.username}`,
        iconURL: reporter.displayAvatarURL({ dynamic: true })
      })
      .setTimestamp();
    
    // Create action buttons
    const actionRow1 = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`user_report_warn_${targetUser.id}_${reportId}`)
          .setLabel('Warn User')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`user_report_timeout_${targetUser.id}_${reportId}`)
          .setLabel('Timeout User 24h')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`user_report_dismiss_${reportId}`)
          .setLabel('Delete Report')
          .setStyle(ButtonStyle.Secondary)
      );
    
    const actionRow2 = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`user_report_claim_${reportId}`)
          .setLabel('Claim')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`user_report_finish_${reportId}`)
          .setLabel('Mark Finished')
          .setStyle(ButtonStyle.Success)
      );
    
    try {
      // Send the report to the report channel
      await reportChannel.send({
        embeds: [reportEmbed],
        components: [actionRow1, actionRow2]
      });
      
      logger.info(`User reported in ${guild.name}: ${targetUser.tag} by ${reporter.tag}`);
      
      return interaction.reply({
        content: '✅ Your report has been submitted. Thank you for helping keep this server safe!',
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      logger.error(`Error sending user report: ${error.message}`);
      return interaction.reply({
        content: '❌ Failed to submit the report. Please try again later.',
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
