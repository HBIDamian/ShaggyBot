const { MessageFlags } = require('discord.js');

/**
 * Common validation checks for moderation commands
 * Returns an error message string if validation fails, null if passes
 */

/**
 * Check if user is trying to target themselves
 * @param {User} targetUser - Target user
 * @param {User} executor - Command executor
 * @param {string} action - Action name (ban, kick, mute, etc.)
 * @returns {string|null} Error message or null
 */
function checkSelfTarget(targetUser, executor, action) {
  if (targetUser.id === executor.id) {
    return `❌ You cannot ${action} yourself.`;
  }
  return null;
}

/**
 * Check if user is trying to target the bot
 * @param {User} targetUser - Target user
 * @param {Client} client - Discord client
 * @param {string} action - Action name
 * @returns {string|null} Error message or null
 */
function checkBotTarget(targetUser, client, action) {
  if (targetUser.id === client.user.id) {
    return `❌ You cannot ${action} me.`;
  }
  return null;
}

/**
 * Check role hierarchy between executor and target
 * @param {GuildMember} targetMember - Target member
 * @param {GuildMember} executorMember - Executor member
 * @param {string} action - Action name
 * @returns {string|null} Error message or null
 */
function checkHierarchy(targetMember, executorMember, action) {
  if (!targetMember) return null;
  
  const guild = executorMember.guild;
  
  if (targetMember.roles.highest.position >= executorMember.roles.highest.position &&
      guild.ownerId !== executorMember.id) {
    return `❌ You cannot ${action} someone with a higher or equal role.`;
  }
  return null;
}

/**
 * Check if bot can perform action on target
 * @param {GuildMember} targetMember - Target member
 * @param {string} action - Action name (kick, ban, moderate)
 * @returns {string|null} Error message or null
 */
function checkBotPermission(targetMember, action) {
  if (!targetMember) return null;
  
  const checks = {
    kick: () => !targetMember.kickable,
    ban: () => !targetMember.bannable,
    moderate: () => !targetMember.moderatable,
    timeout: () => !targetMember.moderatable
  };
  
  const check = checks[action] || checks.moderate;
  
  if (check()) {
    return `❌ I cannot ${action} this user. They may have a higher role than me or be the server owner.`;
  }
  return null;
}

/**
 * Run all standard moderation checks
 * @param {Object} options - Check options
 * @param {User} options.targetUser - Target user
 * @param {User} options.executor - Command executor
 * @param {Client} options.client - Discord client
 * @param {GuildMember} options.targetMember - Target member (optional)
 * @param {GuildMember} options.executorMember - Executor member
 * @param {string} options.action - Action name
 * @param {boolean} options.requireInGuild - Whether target must be in guild
 * @param {boolean} options.requireBannable - Check bannable permission
 * @param {boolean} options.requireKickable - Check kickable permission
 * @returns {string|null} First error message or null if all pass
 */
function runModerationChecks({ 
  targetUser, 
  executor, 
  client, 
  targetMember, 
  executorMember, 
  action,
  requireInGuild = false,
  requireBannable = false,
  requireKickable = false
}) {
  // Check self-target
  const selfError = checkSelfTarget(targetUser, executor, action);
  if (selfError) return selfError;
  
  // Check bot target
  const botError = checkBotTarget(targetUser, client, action);
  if (botError) return botError;
  
  // Check if target must be in guild
  if (requireInGuild && !targetMember) {
    return '❌ This user is not in the server.';
  }
  
  // Check bot can perform action
  if (targetMember) {
    // Determine which permission check to use
    let permAction = action;
    if (requireBannable) permAction = 'ban';
    else if (requireKickable) permAction = 'kick';
    
    const botPermError = checkBotPermission(targetMember, permAction);
    if (botPermError) return botPermError;
    
    // Check hierarchy
    const hierarchyError = checkHierarchy(targetMember, executorMember, action);
    if (hierarchyError) return hierarchyError;
  }
  
  return null;
}

/**
 * Parse time string to milliseconds
 * @param {string} timeStr - Time string (e.g., "1d", "2h", "30m")
 * @returns {number|null} Milliseconds or null if invalid
 */
function parseTime(timeStr) {
  const match = timeStr.match(/^(\d+)([smhdw])$/i);
  if (!match) return null;
  
  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  
  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000
  };
  
  return value * multipliers[unit];
}

/**
 * Format milliseconds to human-readable duration
 * @param {number} ms - Milliseconds
 * @returns {string} Formatted duration
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days} day${days !== 1 ? 's' : ''}`;
  if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''}`;
  if (minutes > 0) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  return `${seconds} second${seconds !== 1 ? 's' : ''}`;
}

/**
 * Reply with an ephemeral error message
 * @param {Interaction} interaction - Discord interaction
 * @param {string} message - Error message
 */
async function replyError(interaction, message) {
  return interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
}

module.exports = {
  checkSelfTarget,
  checkBotTarget,
  checkHierarchy,
  checkBotPermission,
  runModerationChecks,
  parseTime,
  formatDuration,
  replyError
};
