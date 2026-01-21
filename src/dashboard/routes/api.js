const express = require('express');
const router = express.Router();
const { createLogger } = require('../../utils/logger');
const db = require('../../database/database');

const logger = createLogger('APIRoutes');

// Permission bits
const ADMIN_PERMISSION = 0x8;
const MANAGE_GUILD_PERMISSION = 0x20;

/**
 * Fetch usernames for a set of user IDs in parallel
 * @param {Client} client - Discord client
 * @param {Set<string>} userIds - Set of user IDs
 * @returns {Promise<Object>} Map of userId -> username (null if not found)
 */
async function fetchUsernames(client, userIds) {
  const usernames = {};
  await Promise.all(
    Array.from(userIds).map(async (userId) => {
      try {
        const user = await client.users.fetch(userId);
        usernames[userId] = user.username;
      } catch {
        usernames[userId] = null;
      }
    })
  );
  return usernames;
}

/**
 * Check if user has guild management permissions
 */
function hasManagePermission(guild) {
  const permissions = parseInt(guild.permissions);
  return (permissions & ADMIN_PERMISSION) === ADMIN_PERMISSION ||
         (permissions & MANAGE_GUILD_PERMISSION) === MANAGE_GUILD_PERMISSION ||
         guild.owner;
}

/**
 * Create standard settings GET/PATCH routes
 * @param {string} path - Route path (e.g., '/automod')
 * @param {Function} getSettings - Function to get settings from db
 * @param {Function} updateSettings - Function to update settings in db
 * @param {string} logName - Name for logging (e.g., 'automod')
 * @param {boolean} hasSkippedFields - Whether update returns skippedFields
 */
function createSettingsRoutes(path, getSettings, updateSettings, logName, hasSkippedFields = false) {
  // GET settings
  router.get(`/guilds/:guildId${path}`, requireAuth, requireGuildPermission, (req, res) => {
    const settings = getSettings(req.params.guildId);
    res.json(settings);
  });

  // PATCH settings
  router.patch(`/guilds/:guildId${path}`, requireAuth, requireGuildPermission, (req, res) => {
    const { guildId } = req.params;
    try {
      const result = updateSettings(guildId, req.body);
      const settings = getSettings(guildId);
      logger.info(`Updated ${logName} settings for ${req.guild.name} (${guildId})`);
      
      if (hasSkippedFields && result?.skippedFields?.length > 0) {
        logger.warn(`Skipped unknown ${logName} fields for ${req.guild.name}: ${result.skippedFields.join(', ')}`);
        res.json({ ...settings, _warning: `Some fields were not saved (unknown): ${result.skippedFields.join(', ')}` });
      } else {
        res.json(settings);
      }
    } catch (err) {
      logger.error(`Error updating ${logName} settings: ${err.message}`);
      res.status(500).json({ error: 'Failed to update settings' });
    }
  });
}

/**
 * Middleware to check authentication
 */
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

/**
 * Middleware to check guild permissions
 */
function requireGuildPermission(req, res, next) {
  const { guildId } = req.params;
  const userGuilds = req.session.guilds || [];
  const client = req.app.get('client');

  const userGuild = userGuilds.find(g => g.id === guildId);
  if (!userGuild) {
    return res.status(403).json({ error: 'You are not a member of this guild' });
  }

  if (!hasManagePermission(userGuild)) {
    return res.status(403).json({ error: 'You must be a Server Owner, Administrator, or have Manage Server permission' });
  }

  const botGuild = client.guilds.cache.get(guildId);
  if (!botGuild) {
    return res.status(404).json({ error: 'Bot is not in this guild' });
  }

  req.guild = botGuild;
  req.userGuild = userGuild;
  next();
}

/**
 * Get all guilds the user can manage
 */
router.get('/guilds', requireAuth, (req, res) => {
  const client = req.app.get('client');
  const userGuilds = req.session.guilds || [];

  const manageableGuilds = userGuilds
    .filter(guild => hasManagePermission(guild) && client.guilds.cache.has(guild.id))
    .map(({ id, name, icon, owner }) => ({ id, name, icon, owner }));

  res.json(manageableGuilds);
});

/**
 * Get guild info
 */
router.get('/guilds/:guildId', requireAuth, requireGuildPermission, (req, res) => {
  const guild = req.guild;
  
  res.json({
    id: guild.id,
    name: guild.name,
    icon: guild.iconURL(),
    memberCount: guild.memberCount,
    channels: guild.channels.cache
      .filter(c => c.type === 0) // Text channels only
      .map(c => ({ id: c.id, name: c.name })),
    roles: guild.roles.cache
      .filter(r => r.id !== guild.id) // Exclude @everyone
      .sort((a, b) => b.position - a.position)
      .map(r => ({ id: r.id, name: r.name, color: r.hexColor }))
  });
});

// Guild settings (special case - needs guild.name for get)
router.get('/guilds/:guildId/settings', requireAuth, requireGuildPermission, (req, res) => {
  res.json(db.getGuildSettings(req.params.guildId, req.guild.name));
});

router.patch('/guilds/:guildId/settings', requireAuth, requireGuildPermission, (req, res) => {
  const { guildId } = req.params;
  try {
    db.updateGuildSettings(guildId, req.body);
    logger.info(`Updated guild settings for ${req.guild.name} (${guildId})`);
    res.json(db.getGuildSettings(guildId));
  } catch (err) {
    logger.error(`Error updating guild settings: ${err.message}`);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Standard settings routes using helper
createSettingsRoutes('/automod', db.getAutomodSettings.bind(db), db.updateAutomodSettings.bind(db), 'automod', true);
createSettingsRoutes('/trolldiscourager', db.getTrollDiscouragerSettings.bind(db), db.updateTrollDiscouragerSettings.bind(db), 'troll discourager');
createSettingsRoutes('/moderation', db.getModerationSettings.bind(db), db.updateModerationSettings.bind(db), 'moderation', true);
createSettingsRoutes('/auditlog', db.getAuditLogSettings.bind(db), db.updateAuditLogSettings.bind(db), 'audit log');
createSettingsRoutes('/starboard', db.getStarboardSettings.bind(db), db.updateStarboardSettings.bind(db), 'starboard');
createSettingsRoutes('/antiraid', db.getAntiRaidSettings.bind(db), db.updateAntiRaidSettings.bind(db), 'anti-raid');

/**
 * Get mod actions for a guild
 */
router.get('/guilds/:guildId/modactions', requireAuth, requireGuildPermission, async (req, res) => {
  const { guildId } = req.params;
  const limit = parseInt(req.query.limit) || 50;
  const actions = db.getModActions(guildId, Math.min(limit, 100));
  
  // Collect unique user IDs and fetch usernames in parallel
  const userIds = new Set();
  actions.forEach(a => {
    if (a.user_id) userIds.add(a.user_id);
    if (a.moderator_id) userIds.add(a.moderator_id);
  });
  
  const client = req.app.get('client');
  const usernames = await fetchUsernames(client, userIds);
  
  // Attach usernames to actions
  const actionsWithNames = actions.map(a => ({
    ...a,
    user_name: usernames[a.user_id] || null,
    moderator_name: usernames[a.moderator_id] || null
  }));
  
  res.json(actionsWithNames);
});

/**
 * Get mod log retention settings
 */
router.get('/guilds/:guildId/modactions/retention', requireAuth, requireGuildPermission, (req, res) => {
  const { guildId } = req.params;
  const days = db.getModLogRetentionDays(guildId);
  res.json({ retention_days: days });
});

/**
 * Update mod log retention settings
 */
router.post('/guilds/:guildId/modactions/retention', requireAuth, requireGuildPermission, (req, res) => {
  const { guildId } = req.params;
  const { retention_days } = req.body;
  
  if (retention_days === undefined || retention_days < 1 || retention_days > 31) {
    return res.status(400).json({ error: 'Retention days must be between 1 and 31' });
  }
  
  try {
    db.setModLogRetentionDays(guildId, retention_days);
    // Immediately clean up logs older than new retention
    const deleted = db.cleanupOldModActions(guildId);
    res.json({ success: true, retention_days: retention_days, deleted_count: deleted });
  } catch (error) {
    logger.error(`Error updating retention: ${error.message}`);
    res.status(500).json({ error: 'Failed to update retention settings' });
  }
});

/**
 * Get warning retention settings
 */
router.get('/guilds/:guildId/warnings/retention', requireAuth, requireGuildPermission, (req, res) => {
  const { guildId } = req.params;
  const days = db.getWarningRetentionDays(guildId);
  res.json({ retention_days: days });
});

/**
 * Update warning retention settings
 */
router.post('/guilds/:guildId/warnings/retention', requireAuth, requireGuildPermission, (req, res) => {
  const { guildId } = req.params;
  const { retention_days } = req.body;
  
  if (retention_days === undefined || retention_days < 0 || retention_days > 365) {
    return res.status(400).json({ error: 'Retention days must be between 0 and 365 (0 = keep forever)' });
  }
  
  try {
    db.setWarningRetentionDays(guildId, retention_days);
    // Immediately clean up warnings older than new retention (unless 0)
    const deleted = retention_days > 0 ? db.cleanupOldWarnings(guildId) : 0;
    res.json({ success: true, retention_days: retention_days, deleted_count: deleted });
  } catch (error) {
    logger.error(`Error updating warning retention: ${error.message}`);
    res.status(500).json({ error: 'Failed to update warning retention settings' });
  }
});

/**
 * Get warnings for a guild
 */
router.get('/guilds/:guildId/warnings', requireAuth, requireGuildPermission, async (req, res) => {
  const { guildId } = req.params;
  const { userId } = req.query;

  try {
    if (userId) {
      const warnings = db.getUserWarnings(guildId, userId);
      return res.json(warnings);
    }

    // Get all unique users with warnings in this guild
    const allWarnings = db.db.prepare(`
      SELECT user_id, COUNT(*) as count FROM warnings WHERE guild_id = ? GROUP BY user_id
    `).all(guildId);

    res.json(allWarnings);
  } catch (error) {
    logger.error(`Error fetching warnings: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch warnings' });
  }
});

/**
 * Delete a warning
 */
router.delete('/guilds/:guildId/warnings/:warningId', requireAuth, requireGuildPermission, (req, res) => {
  const { guildId, warningId } = req.params;

  try {
    const success = db.deleteWarning(parseInt(warningId), guildId);
    if (success) {
      logger.info(`Deleted warning ${warningId} from guild ${guildId}`);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Warning not found' });
    }
  } catch (error) {
    logger.error(`Error deleting warning: ${error.message}`);
    res.status(500).json({ error: 'Failed to delete warning' });
  }
});

/**
 * Get all warnings for a guild (full list with search)
 */
router.get('/guilds/:guildId/warnings/all', requireAuth, requireGuildPermission, async (req, res) => {
  const { guildId } = req.params;

  try {
    const allWarnings = db.db.prepare(`
      SELECT * FROM warnings WHERE guild_id = ? ORDER BY created_at DESC
    `).all(guildId);

    // Collect unique user IDs and fetch usernames in parallel
    const userIds = new Set();
    allWarnings.forEach(w => {
      if (w.user_id) userIds.add(w.user_id);
      if (w.moderator_id) userIds.add(w.moderator_id);
    });
    
    const client = req.app.get('client');
    const usernames = await fetchUsernames(client, userIds);
    
    // Attach usernames to warnings
    const warningsWithNames = allWarnings.map(w => ({
      ...w,
      user_name: usernames[w.user_id] || null,
      moderator_name: usernames[w.moderator_id] || null
    }));

    const now = new Date();
    const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    
    const stats = {
      total: allWarnings.length,
      active: allWarnings.length, // Could be filtered by expiration later
      users: new Set(allWarnings.map(w => w.user_id)).size,
      thisMonth: allWarnings.filter(w => new Date(w.created_at) >= monthAgo).length
    };

    res.json({ warnings: warningsWithNames, stats });
  } catch (error) {
    logger.error(`Error fetching all warnings: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch warnings' });
  }
});

/**
 * Get bot stats
 */
router.get('/stats', requireAuth, (req, res) => {
  const client = req.app.get('client');
  
  res.json({
    guilds: client.guilds.cache.size,
    users: client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0),
    uptime: client.uptime,
    ping: client.ws.ping
  });
});

// ============================================
// Tags Routes
// ============================================

/**
 * Get all tags for a guild
 */
router.get('/guilds/:guildId/tags', requireAuth, requireGuildPermission, (req, res) => {
  const { guildId } = req.params;
  const tags = db.getTags(guildId);
  res.json(tags);
});

/**
 * Get a single tag
 */
router.get('/guilds/:guildId/tags/:tagId', requireAuth, requireGuildPermission, (req, res) => {
  const { tagId } = req.params;
  const tag = db.getTagById(parseInt(tagId));
  
  if (!tag) {
    return res.status(404).json({ error: 'Tag not found' });
  }
  
  res.json(tag);
});

/**
 * Create a new tag
 */
router.post('/guilds/:guildId/tags', requireAuth, requireGuildPermission, (req, res) => {
  const { guildId } = req.params;
  const { name, response } = req.body;
  
  if (!name || !response) {
    return res.status(400).json({ error: 'Name and response are required' });
  }
  
  if (name.length > 32) {
    return res.status(400).json({ error: 'Tag name must be 32 characters or less' });
  }
  
  if (response.length > 2000) {
    return res.status(400).json({ error: 'Tag response must be 2000 characters or less' });
  }
  
  // Check if tag already exists
  const existing = db.getTag(guildId, name);
  if (existing) {
    return res.status(409).json({ error: 'A tag with that name already exists' });
  }
  
  try {
    const user = req.session.user;
    const tagId = db.createTag(guildId, name, response, user.id, user.username);
    const tag = db.getTagById(tagId);
    logger.info(`Tag "${name}" created in ${req.guild.name} by ${user.username}`);
    res.status(201).json(tag);
  } catch (error) {
    logger.error(`Error creating tag: ${error.message}`);
    res.status(500).json({ error: 'Failed to create tag' });
  }
});

/**
 * Update a tag
 */
router.patch('/guilds/:guildId/tags/:tagId', requireAuth, requireGuildPermission, (req, res) => {
  const { guildId, tagId } = req.params;
  const { name, response } = req.body;
  
  const tag = db.getTagById(parseInt(tagId));
  if (!tag || tag.guild_id !== guildId) {
    return res.status(404).json({ error: 'Tag not found' });
  }
  
  // Check for duplicate name if name is being changed
  if (name && name.toLowerCase() !== tag.name) {
    const existing = db.getTag(guildId, name);
    if (existing) {
      return res.status(409).json({ error: 'A tag with that name already exists' });
    }
  }
  
  if (name && name.length > 32) {
    return res.status(400).json({ error: 'Tag name must be 32 characters or less' });
  }
  
  if (response && response.length > 2000) {
    return res.status(400).json({ error: 'Tag response must be 2000 characters or less' });
  }
  
  try {
    const updates = {};
    if (name) updates.name = name;
    if (response) updates.response = response;
    
    db.updateTag(parseInt(tagId), updates);
    const updated = db.getTagById(parseInt(tagId));
    logger.info(`Tag "${tag.name}" updated in ${req.guild.name}`);
    res.json(updated);
  } catch (error) {
    logger.error(`Error updating tag: ${error.message}`);
    res.status(500).json({ error: 'Failed to update tag' });
  }
});

/**
 * Delete a tag
 */
router.delete('/guilds/:guildId/tags/:tagId', requireAuth, requireGuildPermission, (req, res) => {
  const { guildId, tagId } = req.params;
  
  const tag = db.getTagById(parseInt(tagId));
  if (!tag || tag.guild_id !== guildId) {
    return res.status(404).json({ error: 'Tag not found' });
  }
  
  try {
    db.deleteTag(parseInt(tagId));
    logger.info(`Tag "${tag.name}" deleted from ${req.guild.name}`);
    res.json({ success: true });
  } catch (error) {
    logger.error(`Error deleting tag: ${error.message}`);
    res.status(500).json({ error: 'Failed to delete tag' });
  }
});

// ==================== LOCKDOWN ====================

/**
 * Get lockdown settings
 */
router.get('/guilds/:guildId/lockdown', requireAuth, requireGuildPermission, (req, res) => {
  const { guildId } = req.params;
  const settings = db.getModerationSettings(guildId);
  
  let channels = [];
  try {
    channels = JSON.parse(settings.lockdown_channels || '[]');
  } catch {
    channels = [];
  }
  
  res.json({
    channels,
    active: !!settings.lockdown_active,
    message: settings.lockdown_message || null
  });
});

/**
 * Update lockdown channels
 */
router.patch('/guilds/:guildId/lockdown', requireAuth, requireGuildPermission, (req, res) => {
  const { guildId } = req.params;
  const { channels } = req.body;

  try {
    db.updateModerationSettings(guildId, {
      lockdown_channels: JSON.stringify(channels || [])
    });
    logger.info(`Updated lockdown channels for ${req.guild.name} (${guildId})`);
    res.json({ success: true, channels });
  } catch (error) {
    logger.error(`Error updating lockdown channels: ${error.message}`);
    res.status(500).json({ error: 'Failed to update lockdown channels' });
  }
});

/**
 * Start lockdown
 */
router.post('/guilds/:guildId/lockdown/start', requireAuth, requireGuildPermission, async (req, res) => {
  const { guildId } = req.params;
  const { message } = req.body;
  const client = req.app.get('client');
  
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ error: 'Guild not found' });
    }
    
    const settings = db.getModerationSettings(guildId);
    
    let lockdownChannels = [];
    try {
      lockdownChannels = JSON.parse(settings.lockdown_channels || '[]');
    } catch {
      lockdownChannels = [];
    }
    
    if (lockdownChannels.length === 0) {
      return res.status(400).json({ error: 'No lockdown channels configured' });
    }
    
    if (settings.lockdown_active) {
      return res.status(400).json({ error: 'Lockdown already active' });
    }
    
    const { EmbedBuilder, ChannelType } = require('discord.js');
    const lockedChannels = [];
    const failedChannels = [];
    
    for (const channelId of lockdownChannels) {
      try {
        const channel = await guild.channels.fetch(channelId);
        if (!channel || channel.type !== ChannelType.GuildText) {
          failedChannels.push(channelId);
          continue;
        }
        
        const everyoneRole = guild.roles.everyone;
        await channel.permissionOverwrites.edit(everyoneRole, {
          SendMessages: false
        }, { reason: `Lockdown initiated from dashboard by ${req.session.user.username}` });
        
        if (message) {
          const lockEmbed = new EmbedBuilder()
            .setTitle('🔒 Channel Locked')
            .setDescription(message)
            .setColor('#ED4245')
            .setFooter({ text: `Lockdown initiated from dashboard` })
            .setTimestamp();
          
          await channel.send({ embeds: [lockEmbed] }).catch(() => {});
        }
        
        lockedChannels.push(channelId);
      } catch (error) {
        logger.error(`Failed to lock channel ${channelId}: ${error.message}`);
        failedChannels.push(channelId);
      }
    }
    
    db.updateModerationSettings(guildId, {
      lockdown_active: 1,
      lockdown_message: message || null
    });
    
    logger.info(`Lockdown started from dashboard in ${guild.name} - ${lockedChannels.length} channels locked`);
    
    res.json({
      success: true,
      lockedChannels,
      failedChannels
    });
  } catch (error) {
    logger.error(`Error starting lockdown: ${error.message}`);
    res.status(500).json({ error: 'Failed to start lockdown' });
  }
});

/**
 * End lockdown
 */
router.post('/guilds/:guildId/lockdown/end', requireAuth, requireGuildPermission, async (req, res) => {
  const { guildId } = req.params;
  const client = req.app.get('client');
  
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ error: 'Guild not found' });
    }
    
    const settings = db.getModerationSettings(guildId);
    
    let lockdownChannels = [];
    try {
      lockdownChannels = JSON.parse(settings.lockdown_channels || '[]');
    } catch {
      lockdownChannels = [];
    }
    
    if (!settings.lockdown_active) {
      return res.status(400).json({ error: 'No lockdown is currently active' });
    }
    
    const { EmbedBuilder, ChannelType } = require('discord.js');
    const unlockedChannels = [];
    const failedChannels = [];
    
    for (const channelId of lockdownChannels) {
      try {
        const channel = await guild.channels.fetch(channelId);
        if (!channel || channel.type !== ChannelType.GuildText) {
          failedChannels.push(channelId);
          continue;
        }
        
        const everyoneRole = guild.roles.everyone;
        await channel.permissionOverwrites.edit(everyoneRole, {
          SendMessages: null
        }, { reason: `Lockdown ended from dashboard by ${req.session.user.username}` });
        
        const unlockEmbed = new EmbedBuilder()
          .setTitle('🔓 Channel Unlocked')
          .setDescription('This channel is now open again.')
          .setColor('#57F287')
          .setFooter({ text: `Lockdown ended from dashboard` })
          .setTimestamp();
        
        await channel.send({ embeds: [unlockEmbed] }).catch(() => {});
        
        unlockedChannels.push(channelId);
      } catch (error) {
        logger.error(`Failed to unlock channel ${channelId}: ${error.message}`);
        failedChannels.push(channelId);
      }
    }
    
    db.updateModerationSettings(guildId, {
      lockdown_active: 0,
      lockdown_message: null
    });
    
    logger.info(`Lockdown ended from dashboard in ${guild.name} - ${unlockedChannels.length} channels unlocked`);
    
    res.json({
      success: true,
      unlockedChannels,
      failedChannels
    });
  } catch (error) {
    logger.error(`Error ending lockdown: ${error.message}`);
    res.status(500).json({ error: 'Failed to end lockdown' });
  }
});

/**
 * Get all bot commands with metadata
 */
router.get('/commands', (req, res) => {
  const client = req.app.get('client');
  const fs = require('fs');
  const path = require('path');
  const { PermissionFlagsBits } = require('discord.js');
  
  // Permission flag names for display
  const permissionNames = {
    [String(PermissionFlagsBits.Administrator)]: 'Administrator',
    [String(PermissionFlagsBits.ManageGuild)]: 'Manage Server',
    [String(PermissionFlagsBits.ManageRoles)]: 'Manage Roles',
    [String(PermissionFlagsBits.ManageChannels)]: 'Manage Channels',
    [String(PermissionFlagsBits.KickMembers)]: 'Kick Members',
    [String(PermissionFlagsBits.BanMembers)]: 'Ban Members',
    [String(PermissionFlagsBits.ManageMessages)]: 'Manage Messages',
    [String(PermissionFlagsBits.ModerateMembers)]: 'Timeout Members',
    [String(PermissionFlagsBits.ManageNicknames)]: 'Manage Nicknames',
    [String(PermissionFlagsBits.ManageWebhooks)]: 'Manage Webhooks',
    [String(PermissionFlagsBits.ManageEmojisAndStickers)]: 'Manage Emojis',
    [String(PermissionFlagsBits.ViewAuditLog)]: 'View Audit Log',
    [String(PermissionFlagsBits.MuteMembers)]: 'Mute Members',
    [String(PermissionFlagsBits.DeafenMembers)]: 'Deafen Members',
    [String(PermissionFlagsBits.MoveMembers)]: 'Move Members',
    [String(PermissionFlagsBits.SendMessages)]: 'Send Messages',
  };
  
  /**
   * Get permission names from permission bitfield
   */
  function getPermissionNames(permissionBitfield) {
    if (!permissionBitfield) return [];
    const permissions = [];
    const permBigInt = BigInt(permissionBitfield);
    
    for (const [bit, name] of Object.entries(permissionNames)) {
      if ((permBigInt & BigInt(bit)) === BigInt(bit)) {
        permissions.push(name);
      }
    }
    return permissions;
  }
  
  /**
   * Extract option info from SlashCommandBuilder option
   */
  function extractOptionInfo(option) {
    const optionTypeMap = {
      3: 'string',
      4: 'integer',
      5: 'boolean',
      6: 'user',
      7: 'channel',
      8: 'role',
      9: 'mentionable',
      10: 'number',
      11: 'attachment'
    };
    
    return {
      name: option.name,
      description: option.description,
      type: optionTypeMap[option.type] || 'unknown',
      required: option.required || false,
      choices: option.choices?.map(c => c.name) || null
    };
  }
  
  /**
   * Extract subcommand info
   */
  function extractSubcommandInfo(subcommand) {
    return {
      name: subcommand.name,
      description: subcommand.description,
      options: subcommand.options?.map(extractOptionInfo) || []
    };
  }
  
  const commandsPath = path.join(__dirname, '../../commands');
  const categories = fs.readdirSync(commandsPath, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  
  const commandsByCategory = {};
  
  for (const category of categories) {
    const commands = [];
    const categoryPath = path.join(commandsPath, category);
    const files = fs.readdirSync(categoryPath).filter(f => f.endsWith('.js'));
    
    for (const file of files) {
      try {
        // Clear require cache to get fresh data
        const filePath = path.join(categoryPath, file);
        delete require.cache[require.resolve(filePath)];
        const command = require(filePath);
        
        if (command.data) {
          const data = command.data;
          const json = data.toJSON ? data.toJSON() : data;
          
          // Extract subcommands if any
          const subcommands = json.options?.filter(opt => opt.type === 1).map(extractSubcommandInfo) || [];
          const subcommandGroups = json.options?.filter(opt => opt.type === 2).map(group => ({
            name: group.name,
            description: group.description,
            subcommands: group.options?.map(extractSubcommandInfo) || []
          })) || [];
          
          // Extract regular options (not subcommands)
          const options = json.options?.filter(opt => opt.type > 2).map(extractOptionInfo) || [];
          
          commands.push({
            name: json.name,
            description: json.description,
            permissions: getPermissionNames(json.default_member_permissions),
            options,
            subcommands,
            subcommandGroups
          });
        }
      } catch (err) {
        logger.error(`Error loading command ${file} for API: ${err.message}`);
      }
    }
    
    if (commands.length > 0) {
      // Sort commands alphabetically
      commands.sort((a, b) => a.name.localeCompare(b.name));
      commandsByCategory[category] = commands;
    }
  }
  
  res.json(commandsByCategory);
});

module.exports = router;
