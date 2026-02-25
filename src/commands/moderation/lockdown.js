const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const db = require('../../database/database');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('Lockdown');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Lock or unlock configured channels during emergencies')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand(subcommand =>
      subcommand
        .setName('start')
        .setDescription('Start a lockdown on configured channels')
        .addStringOption(option =>
          option
            .setName('message')
            .setDescription('Optional message to display in locked channels')
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('end')
        .setDescription('End the current lockdown')),
  
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === 'start') {
      await handleLockdownStart(interaction);
    } else if (subcommand === 'end') {
      await handleLockdownEnd(interaction);
    }
  },
};

/**
 * Start a lockdown
 */
async function handleLockdownStart(interaction) {
  await interaction.deferReply();
  
  const guild = interaction.guild;
  const message = interaction.options.getString('message');
  
  // Get moderation settings
  const settings = db.getModerationSettings(guild.id);
  
  // Parse lockdown channels
  let lockdownChannels = [];
  try {
    lockdownChannels = JSON.parse(settings.lockdown_channels || '[]');
  } catch {
    lockdownChannels = [];
  }
  
  if (lockdownChannels.length === 0) {
    return interaction.editReply({
      content: '❌ No lockdown channels configured. Please set up lockdown channels in the dashboard first.',
    });
  }
  
  // Check if already in lockdown
  if (settings.lockdown_active) {
    return interaction.editReply({
      content: '⚠️ A lockdown is already active. Use `/lockdown end` to end it first.',
    });
  }
  
  const lockedChannels = [];
  const failedChannels = [];
  
  for (const channelId of lockdownChannels) {
    try {
      const channel = await guild.channels.fetch(channelId);
      if (!channel || channel.type !== ChannelType.GuildText) {
        failedChannels.push({ id: channelId, reason: 'Not found or not a text channel' });
        continue;
      }
      
      // Get the @everyone role
      const everyoneRole = guild.roles.everyone;
      
      // Deny SendMessages permission for @everyone
      await channel.permissionOverwrites.edit(everyoneRole, {
        SendMessages: false
      }, { reason: `Lockdown initiated by ${interaction.user.tag}` });
      
      // Send lockdown message if provided
      if (message) {
        const lockEmbed = new EmbedBuilder()
          .setTitle('🔒 Channel Locked')
          .setDescription(message)
          .setColor('#ED4245')
          .setFooter({ text: `Lockdown initiated by ${interaction.user.tag}` })
          .setTimestamp();
        
        await channel.send({ embeds: [lockEmbed] }).catch(() => {});
      }
      
      lockedChannels.push(channel.name);
    } catch (error) {
      logger.error(`Failed to lock channel ${channelId}: ${error.message}`);
      failedChannels.push({ id: channelId, reason: error.message });
    }
  }
  
  // Update lockdown status in database
  db.updateModerationSettings(guild.id, {
    lockdown_active: 1,
    lockdown_message: message || null
  });
  
  // Build response
  const embed = new EmbedBuilder()
    .setTitle('🔒 Lockdown Started')
    .setColor('#ED4245')
    .setTimestamp();
  
  if (lockedChannels.length > 0) {
    embed.addFields({
      name: '✅ Locked Channels',
      value: lockedChannels.map(c => `#${c}`).join(', ') || 'None'
    });
  }
  
  if (failedChannels.length > 0) {
    embed.addFields({
      name: '❌ Failed to Lock',
      value: failedChannels.map(f => `<#${f.id}>: ${f.reason}`).join('\n').substring(0, 1024)
    });
  }
  
  if (message) {
    embed.addFields({
      name: '📝 Message',
      value: message.substring(0, 1024)
    });
  }
  
  embed.setFooter({ text: `Use /lockdown end to restore channel access` });
  
  logger.info(`Lockdown started in ${guild.name} by ${interaction.user.tag} - ${lockedChannels.length} channels locked`);
  
  await interaction.editReply({ embeds: [embed] });
}

/**
 * End a lockdown
 */
async function handleLockdownEnd(interaction) {
  await interaction.deferReply();
  
  const guild = interaction.guild;
  
  // Get moderation settings
  const settings = db.getModerationSettings(guild.id);
  
  // Parse lockdown channels
  let lockdownChannels = [];
  try {
    lockdownChannels = JSON.parse(settings.lockdown_channels || '[]');
  } catch {
    lockdownChannels = [];
  }
  
  if (lockdownChannels.length === 0) {
    return interaction.editReply({
      content: '❌ No lockdown channels configured.',
    });
  }
  
  // Check if lockdown is active
  if (!settings.lockdown_active) {
    return interaction.editReply({
      content: '⚠️ No lockdown is currently active.',
    });
  }
  
  const unlockedChannels = [];
  const failedChannels = [];
  
  for (const channelId of lockdownChannels) {
    try {
      const channel = await guild.channels.fetch(channelId);
      if (!channel || channel.type !== ChannelType.GuildText) {
        failedChannels.push({ id: channelId, reason: 'Not found or not a text channel' });
        continue;
      }
      
      // Get the @everyone role
      const everyoneRole = guild.roles.everyone;
      
      // Reset SendMessages permission for @everyone (set to null to inherit)
      await channel.permissionOverwrites.edit(everyoneRole, {
        SendMessages: null
      }, { reason: `Lockdown ended by ${interaction.user.tag}` });
      
      // Send unlock message
      const unlockEmbed = new EmbedBuilder()
        .setTitle('🔓 Channel Unlocked')
        .setDescription('This channel is now open again.')
        .setColor('#57F287')
        .setFooter({ text: `Lockdown ended by ${interaction.user.tag}` })
        .setTimestamp();
      
      await channel.send({ embeds: [unlockEmbed] }).catch(() => {});
      
      unlockedChannels.push(channel.name);
    } catch (error) {
      logger.error(`Failed to unlock channel ${channelId}: ${error.message}`);
      failedChannels.push({ id: channelId, reason: error.message });
    }
  }
  
  // Update lockdown status in database
  db.updateModerationSettings(guild.id, {
    lockdown_active: 0,
    lockdown_message: null
  });
  
  // Build response
  const embed = new EmbedBuilder()
    .setTitle('🔓 Lockdown Ended')
    .setColor('#57F287')
    .setTimestamp();
  
  if (unlockedChannels.length > 0) {
    embed.addFields({
      name: '✅ Unlocked Channels',
      value: unlockedChannels.map(c => `#${c}`).join(', ') || 'None'
    });
  }
  
  if (failedChannels.length > 0) {
    embed.addFields({
      name: '❌ Failed to Unlock',
      value: failedChannels.map(f => `<#${f.id}>: ${f.reason}`).join('\n').substring(0, 1024)
    });
  }
  
  logger.info(`Lockdown ended in ${guild.name} by ${interaction.user.tag} - ${unlockedChannels.length} channels unlocked`);
  
  await interaction.editReply({ embeds: [embed] });
}
