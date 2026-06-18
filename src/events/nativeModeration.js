const { Events, AuditLogEvent } = require('discord.js');
const { createLogger } = require('../utils/logger');
const { sendPunishmentNotification } = require('../utils/punishmentNotifier');
const db = require('../database/database');

const logger = createLogger('NativeModeration');

// Track recent bot actions to avoid duplicate logging
const recentBotActions = new Map();

/**
 * Add a recent bot action to prevent duplicate logging
 * @param {string} guildId
 * @param {string} oderId
 * @param {string} action
 */
function markBotAction(guildId, userId, action) {
  const key = `${guildId}-${userId}-${action}`;
  recentBotActions.set(key, Date.now());
  // Clean up after 10 seconds
  setTimeout(() => recentBotActions.delete(key), 10000);
}

/**
 * Check if this was a recent bot action (to avoid duplicate logging)
 */
function wasBotAction(guildId, userId, action) {
  const key = `${guildId}-${userId}-${action}`;
  const timestamp = recentBotActions.get(key);
  if (timestamp && Date.now() - timestamp < 10000) {
    return true;
  }
  return false;
}

/**
 * Fetch recent audit log entry for a specific action
 */
async function fetchAuditLogEntry(guild, actionType, targetId, withinMs = 5000) {
  try {
    const auditLogs = await guild.fetchAuditLogs({
      type: actionType,
      limit: 5
    });

    const entry = auditLogs.entries.find(e =>
      e.target?.id === targetId &&
      Date.now() - e.createdTimestamp < withinMs
    );

    return entry || null;
  } catch (error) {
    logger.debug(`Could not fetch audit logs: ${error.message}`);
    return null;
  }
}

// ==================== NATIVE BAN DETECTION ====================

const guildBanAddHandler = {
  name: Events.GuildBanAdd,
  once: false,
  async execute(ban) {
    // Wait a moment for audit log to be created
    await new Promise(resolve => { setTimeout(resolve, 1000); });

    // Check if this was done by our bot's command
    if (wasBotAction(ban.guild.id, ban.user.id, 'ban')) {
      return; // Already logged by our command
    }

    // Fetch audit log to get moderator info
    const auditEntry = await fetchAuditLogEntry(
      ban.guild,
      AuditLogEvent.MemberBanAdd,
      ban.user.id
    );

    if (!auditEntry) {
      logger.debug(`No audit entry found for ban of ${ban.user.tag}`);
      return;
    }

    // Skip if the executor is our bot (already handled)
    if (auditEntry.executor.id === ban.guild.members.me?.id) {
      return;
    }

    const moderator = auditEntry.executor;
    const reason = auditEntry.reason || 'No reason provided';

    // Log to mod_actions database
    db.logModAction(ban.guild.id, ban.user.id, moderator.id, 'ban', `[Native] ${reason}`);

    // Send punishment notification
    await sendPunishmentNotification({
      guild: ban.guild,
      user: ban.user,
      moderator: moderator,
      type: 'ban',
      reason: reason
    });

    logger.info(`Native ban logged: ${ban.user.tag} by ${moderator.tag} in ${ban.guild.name}`);
  }
};

// ==================== NATIVE UNBAN DETECTION ====================

const guildBanRemoveHandler = {
  name: Events.GuildBanRemove,
  once: false,
  async execute(ban) {
    // Wait a moment for audit log to be created
    await new Promise(resolve => { setTimeout(resolve, 1000); });

    // Check if this was done by our bot's command
    if (wasBotAction(ban.guild.id, ban.user.id, 'unban')) {
      return; // Already logged by our command
    }

    // Fetch audit log to get moderator info
    const auditEntry = await fetchAuditLogEntry(
      ban.guild,
      AuditLogEvent.MemberBanRemove,
      ban.user.id
    );

    if (!auditEntry) {
      logger.debug(`No audit entry found for unban of ${ban.user.tag}`);
      return;
    }

    // Skip if the executor is our bot (already handled)
    if (auditEntry.executor.id === ban.guild.members.me?.id) {
      return;
    }

    const moderator = auditEntry.executor;

    // Log to mod_actions database
    db.logModAction(ban.guild.id, ban.user.id, moderator.id, 'unban', '[Native] User pardoned');

    // Send punishment notification
    await sendPunishmentNotification({
      guild: ban.guild,
      user: ban.user,
      moderator: moderator,
      type: 'unban',
      reason: 'User pardoned'
    });

    logger.info(`Native unban logged: ${ban.user.tag} by ${moderator.tag} in ${ban.guild.name}`);
  }
};

// ==================== NATIVE KICK DETECTION ====================

const guildMemberRemoveKickHandler = {
  name: Events.GuildMemberRemove,
  once: false,
  async execute(member) {
    // Wait a moment for audit log to be created
    await new Promise(resolve => { setTimeout(resolve, 1000); });

    // Check if this was done by our bot's command
    if (wasBotAction(member.guild.id, member.user.id, 'kick')) {
      return; // Already logged by our command
    }

    // Fetch audit log to check if this was a kick
    const auditEntry = await fetchAuditLogEntry(
      member.guild,
      AuditLogEvent.MemberKick,
      member.user.id
    );

    if (!auditEntry) {
      // Not a kick, user left on their own or was banned
      return;
    }

    // Skip if the executor is our bot (already handled)
    if (auditEntry.executor.id === member.guild.members.me?.id) {
      return;
    }

    const moderator = auditEntry.executor;
    const reason = auditEntry.reason || 'No reason provided';

    // Log to mod_actions database
    db.logModAction(member.guild.id, member.user.id, moderator.id, 'kick', `[Native] ${reason}`);

    // Send punishment notification (note: DM won't work since user left)
    await sendPunishmentNotification({
      guild: member.guild,
      user: member.user,
      moderator: moderator,
      type: 'kick',
      reason: reason
    });

    logger.info(`Native kick logged: ${member.user.tag} by ${moderator.tag} in ${member.guild.name}`);
  }
};

// ==================== NATIVE TIMEOUT DETECTION ====================

const guildMemberUpdateTimeoutHandler = {
  name: Events.GuildMemberUpdate,
  once: false,
  async execute(oldMember, newMember) {
    // Check if timeout status changed
    const wasTimedOut = oldMember.communicationDisabledUntil;
    const isTimedOut = newMember.communicationDisabledUntil;

    // Only handle new timeouts (not removals or unchanged)
    if (!isTimedOut || (wasTimedOut && isTimedOut)) {
      return;
    }

    // Wait a moment for audit log to be created
    await new Promise(resolve => { setTimeout(resolve, 1000); });

    // Check if this was done by our bot's command
    if (wasBotAction(newMember.guild.id, newMember.user.id, 'timeout')) {
      return; // Already logged by our command
    }

    // Fetch audit log to get moderator info
    const auditEntry = await fetchAuditLogEntry(
      newMember.guild,
      AuditLogEvent.MemberUpdate,
      newMember.user.id
    );

    if (!auditEntry) {
      logger.debug(`No audit entry found for timeout of ${newMember.user.tag}`);
      return;
    }

    // Check if this audit entry is for a timeout (communication_disabled_until change)
    const timeoutChange = auditEntry.changes?.find(c => c.key === 'communication_disabled_until');
    if (!timeoutChange) {
      return;
    }

    // Skip if the executor is our bot (already handled)
    if (auditEntry.executor.id === newMember.guild.members.me?.id) {
      return;
    }

    const moderator = auditEntry.executor;
    const reason = auditEntry.reason || 'No reason provided';

    // Calculate duration
    const expiresAt = Math.floor(newMember.communicationDisabledUntilTimestamp / 1000);
    const duration = formatDuration(newMember.communicationDisabledUntilTimestamp - Date.now());

    // Log to mod_actions database
    db.logModAction(newMember.guild.id, newMember.user.id, moderator.id, 'timeout', `[Native] ${reason} (Duration: ${duration})`);

    // Send punishment notification
    await sendPunishmentNotification({
      guild: newMember.guild,
      user: newMember.user,
      moderator: moderator,
      type: 'timeout',
      reason: reason,
      extra: {
        duration: duration,
        expiresAt: expiresAt
      }
    });

    logger.info(`Native timeout logged: ${newMember.user.tag} by ${moderator.tag} in ${newMember.guild.name}`);
  }
};

/**
 * Format milliseconds to human readable duration
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {return `${days} day${days > 1 ? 's' : ''}`;}
  if (hours > 0) {return `${hours} hour${hours > 1 ? 's' : ''}`;}
  if (minutes > 0) {return `${minutes} minute${minutes > 1 ? 's' : ''}`;}
  return `${seconds} second${seconds > 1 ? 's' : ''}`;
}

// Export function to mark bot actions from commands
module.exports = {
  guildBanAdd: guildBanAddHandler,
  guildBanRemove: guildBanRemoveHandler,
  guildMemberRemoveKick: guildMemberRemoveKickHandler,
  guildMemberUpdateTimeout: guildMemberUpdateTimeoutHandler,
  markBotAction
};
