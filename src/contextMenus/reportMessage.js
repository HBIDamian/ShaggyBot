const { ContextMenuCommandBuilder, ApplicationCommandType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits , MessageFlags } = require('discord.js');
const db = require('../database/database');
const { createLogger } = require('../utils/logger');

const logger = createLogger('ReportMessage');

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Report Message')
    .setType(ApplicationCommandType.Message),
  
  async execute(interaction) {
    const message = interaction.targetMessage;
    const guild = interaction.guild;
    const reporter = interaction.user;
    
    // Get moderation settings
    const modSettings = db.getModerationSettings(guild.id);
    
    // Check if report feature is enabled
    if (!modSettings?.report_enabled) {
      return interaction.reply({
        content: '❌ Message reporting is not enabled on this server.',
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
    
    // Get the report channel
    const reportChannel = guild.channels.cache.get(modSettings.report_channel);
    if (!reportChannel) {
      return interaction.reply({
        content: '❌ The configured report channel no longer exists.',
        flags: MessageFlags.Ephemeral
      });
    }
    
    // Don't allow reporting own messages
    if (message.author.id === reporter.id) {
      return interaction.reply({
        content: '❌ You cannot report your own messages.',
        flags: MessageFlags.Ephemeral
      });
    }
    
    // Don't allow reporting bot messages
    if (message.author.bot) {
      return interaction.reply({
        content: '❌ You cannot report bot messages.',
        flags: MessageFlags.Ephemeral
      });
    }
    
    // Create the report ID
    const reportId = `report_${Date.now()}_${message.id}`;
    
    // Calculate relative time for message sent
    const messageTimestamp = Math.floor(message.createdTimestamp / 1000);
    
    // Create the report embed
    const reportEmbed = new EmbedBuilder()
      .setColor(0xFF6B6B)
      .setAuthor({
        name: message.author.username,
        iconURL: message.author.displayAvatarURL({ dynamic: true })
      })
      .setTitle('Message Report')
      .setDescription(
        `<@${reporter.id}> (${reporter.id}) is reporting a message from ` +
        `<@${message.author.id}> (${message.author.id}) in <#${message.channel.id}>.`
      )
      .addFields(
        { 
          name: 'Message ID:', 
          value: message.id, 
          inline: true 
        },
        { 
          name: 'Message Sent:', 
          value: `<t:${messageTimestamp}:R>`, 
          inline: true 
        },
        { 
          name: 'Jump To:', 
          value: `[#${message.channel.name}](${message.url})`, 
          inline: true 
        },
        { 
          name: 'Message:', 
          value: message.content?.substring(0, 1024) || '*No text content*'
        }
      )
      .setFooter({
        text: `Report submitted by ${reporter.username}`,
        iconURL: reporter.displayAvatarURL({ dynamic: true })
      })
      .setTimestamp();
    
    // Add attachments info if any
    if (message.attachments.size > 0) {
      const attachmentList = message.attachments.map(a => `[${a.name}](${a.url})`).join('\n');
      reportEmbed.addFields({
        name: 'Attachments:',
        value: attachmentList.substring(0, 1024)
      });
    }
    
    // Create action buttons
    const actionRow1 = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`report_delete_${message.channel.id}_${message.id}`)
          .setLabel('Delete Message')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`report_warn_${message.author.id}_${message.id}`)
          .setLabel('Warn User')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`report_timeout_${message.author.id}_${message.id}`)
          .setLabel('Timeout User 24h')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`report_dismiss_${reportId}`)
          .setLabel('Delete Report')
          .setStyle(ButtonStyle.Secondary)
      );
    
    const actionRow2 = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`report_claim_${reportId}`)
          .setLabel('Claim')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`report_finish_${reportId}`)
          .setLabel('Mark Finished')
          .setStyle(ButtonStyle.Success)
      );
    
    try {
      // Send the report to the report channel
      await reportChannel.send({
        embeds: [reportEmbed],
        components: [actionRow1, actionRow2]
      });
      
      logger.info(`Message reported in ${guild.name}: ${message.id} by ${reporter.tag}`);
      
      // Store the report in database
      db.createMessageReport(guild.id, message.id, message.author.id, reporter.id, message.channel.id, message.content);
      
      return interaction.reply({
        content: '✅ Your report has been submitted. Thank you for helping keep this server safe!',
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      logger.error(`Error sending report: ${error.message}`);
      return interaction.reply({
        content: '❌ Failed to submit the report. Please try again later.',
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
