const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database/database');
const { createLogger } = require('./logger');

const logger = createLogger('PunishmentNotifier');

/**
 * Punishment types and their configurations
 */
const PUNISHMENT_CONFIG = {
  warn: {
    color: 0xFFCC00,
    emoji: '⚠️',
    title: 'User Warned',
    dmTitle: (guildName) => `You were warned in ${guildName}`,
    revokeButton: 'Revoke Warning',
    revokeId: 'revoke_warning',
    settingKey: 'notify_warn'
  },
  kick: {
    color: 0xFFA500,
    emoji: '👢',
    title: 'User Kicked',
    dmTitle: (guildName) => `You were kicked from ${guildName}`,
    revokeButton: null,
    revokeId: null,
    settingKey: 'notify_kick'
  },
  ban: {
    color: 0xFF0000,
    emoji: '🔨',
    title: 'User Banned',
    dmTitle: (guildName) => `You were banned from ${guildName}`,
    revokeButton: 'Revoke Ban',
    revokeId: 'revoke_ban',
    settingKey: 'notify_ban'
  },
  unban: {
    color: 0x2ECC71,
    emoji: '🔓',
    title: 'Member Unbanned',
    dmTitle: (guildName) => `You were unbanned from ${guildName}`,
    revokeButton: null,
    revokeId: null,
    settingKey: 'notify_unban'
  },
  timeout: {
    color: 0x3498DB,
    emoji: '⏰',
    title: 'User Timed Out',
    dmTitle: (guildName) => `You were timed out in ${guildName}`,
    revokeButton: 'Remove Timeout',
    revokeId: 'revoke_timeout',
    settingKey: 'notify_timeout'
  },
  mute: {
    color: 0x9B59B6,
    emoji: '🔇',
    title: 'User Muted',
    dmTitle: (guildName) => `You were muted in ${guildName}`,
    revokeButton: 'Unmute',
    revokeId: 'revoke_mute',
    settingKey: 'notify_mute'
  }
};

/**
 * Send a punishment notification based on guild settings
 * @param {Object} options - Notification options
 * @param {Guild} options.guild - The Discord guild
 * @param {User} options.user - The user being punished
 * @param {User} options.moderator - The moderator issuing the punishment
 * @param {string} options.type - Type of punishment (warn, kick, ban, unban, timeout, mute)
 * @param {string} options.reason - Reason for the punishment
 * @param {boolean} options.anonymous - Whether the moderator should be anonymous
 * @param {Object} options.extra - Extra fields (warningCount, duration, warningId, etc.)
 * @returns {Object} Result with dmSent and channelSent booleans
 */
async function sendPunishmentNotification(options) {
  const { guild, user, moderator, type, reason, anonymous = false, extra = {} } = options;
  
  const config = PUNISHMENT_CONFIG[type];
  if (!config) {
    logger.error(`Unknown punishment type: ${type}`);
    return { dmSent: false, channelSent: false };
  }

  // Get guild's notification settings
  const settings = db.getModerationSettings(guild.id);
  
  // Check if this notification type is enabled
  const isEnabled = settings[config.settingKey] !== 0;
  if (!isEnabled) {
    logger.debug(`Notification for ${type} is disabled for guild ${guild.id}`);
    return { dmSent: false, channelSent: false, disabled: true };
  }
  
  const mode = settings.punishment_notify_mode || 'dm_only';
  const channelId = settings.punishment_channel;

  let dmSent = false;
  let channelSent = false;

  // Determine what to send based on mode
  const shouldSendDm = ['dm_only', 'dm_and_channel', 'dm_first_then_channel'].includes(mode);
  const shouldSendChannel = ['channel_only', 'dm_and_channel'].includes(mode);
  const fallbackToChannel = mode === 'dm_first_then_channel';

  // Try to send DM if needed
  if (shouldSendDm) {
    dmSent = await sendDmNotification(user, guild, moderator, config, reason, anonymous, extra);
  }

  // Send to channel if needed
  if (shouldSendChannel || (fallbackToChannel && !dmSent)) {
    if (channelId) {
      channelSent = await sendChannelNotification(guild, channelId, user, moderator, config, reason, extra);
    }
  }

  return { dmSent, channelSent };
}

/**
 * Send DM notification to the user
 */
async function sendDmNotification(user, guild, moderator, config, reason, anonymous, extra) {
  try {
    const moderatorText = anonymous ? 'a moderator' : moderator.tag;
    let dmContent = `**${config.emoji} ${config.dmTitle(guild.name)}**\n`;
    dmContent += `**Reason:** ${reason}\n`;
    dmContent += `**Moderator:** ${moderatorText}`;
    
    if (extra.duration) {
      dmContent += `\n**Duration:** ${extra.duration}`;
    }
    if (extra.warningCount) {
      dmContent += `\n**Total Warnings:** ${extra.warningCount}`;
    }

    await user.send(dmContent);
    return true;
  } catch (error) {
    logger.debug(`Could not send DM to ${user.tag}: ${error.message}`);
    return false;
  }
}

/**
 * Send notification to the punishment channel
 */
async function sendChannelNotification(guild, channelId, user, moderator, config, reason, extra) {
  try {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      logger.warn(`Invalid punishment channel ${channelId} for guild ${guild.id}`);
      return false;
    }

    const embed = new EmbedBuilder()
      .setColor(config.color)
      .setAuthor({ 
        name: `${config.emoji} ${config.title}`, 
        iconURL: user.displayAvatarURL({ dynamic: true, size: 64 }) 
      })
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 128 }))
      .setDescription(`<@${user.id}> (${user.tag})`)
      .setTimestamp();

    // Add IDs footer
    embed.setFooter({ text: `User ID: ${user.id} • Guild ID: ${guild.id}` });

    // Add extra fields based on punishment type
    if (extra.warningCount !== undefined) {
      embed.addFields({ name: 'Total Warnings', value: `${extra.warningCount}`, inline: true });
    }
    if (extra.duration) {
      embed.addFields({ name: 'Duration', value: extra.duration, inline: true });
    }
    if (extra.expiresAt) {
      embed.addFields({ name: 'Expires', value: `<t:${extra.expiresAt}:R>`, inline: true });
    }
    if (reason && reason !== 'No reason provided') {
      embed.addFields({ name: 'Reason', value: reason });
    }

    // Build message components
    const components = [];
    
    // Add revoke button if applicable
    if (config.revokeButton && config.revokeId) {
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`${config.revokeId}_${user.id}${extra.warningId ? `_${extra.warningId}` : ''}`)
            .setLabel(config.revokeButton)
            .setStyle(ButtonStyle.Danger)
        );
      components.push(row);
    }

    await channel.send({ embeds: [embed], components });
    return true;
  } catch (error) {
    logger.error(`Error sending channel notification: ${error.message}`);
    return false;
  }
}

/**
 * Get the notification mode display name
 */
function getNotificationModeLabel(mode) {
  const labels = {
    'dm_only': 'DMs Only',
    'channel_only': 'Channel Only',
    'dm_and_channel': 'DMs and Channel',
    'dm_first_then_channel': 'DMs First, Channel Fallback'
  };
  return labels[mode] || mode;
}

module.exports = {
  sendPunishmentNotification,
  PUNISHMENT_CONFIG,
  getNotificationModeLabel
};
