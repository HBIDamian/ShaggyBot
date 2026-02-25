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
createSettingsRoutes('/commandtoggles', db.getCommandToggleSettings.bind(db), db.updateCommandToggleSettings.bind(db), 'command toggles');
createSettingsRoutes('/honeypot', db.getHoneypotSettings.bind(db), db.updateHoneypotSettings.bind(db), 'honeypot');

/**
 * Post or refresh the warning embed in the honeypot channel
 */
router.post('/guilds/:guildId/honeypot/send-warning', requireAuth, requireGuildPermission, async (req, res) => {
  const { guildId } = req.params;
  const client = req.app.get('client');
  const { EmbedBuilder } = require('discord.js');

  try {
    const settings = db.getHoneypotSettings(guildId);

    if (!settings.honeypot_channel_id) {
      return res.status(400).json({ error: 'No honeypot channel configured' });
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const channel = await guild.channels.fetch(settings.honeypot_channel_id).catch(() => null);
    if (!channel) return res.status(404).json({ error: 'Honeypot channel not found' });

    const title = settings.embed_title || 'DO NOT SEND MESSAGES IN THIS CHANNEL';
    const description = settings.embed_description || 'This channel is used to catch spam bots. Any messages sent here will result in automatic moderation action.';

    const embed = new EmbedBuilder()
      .setColor(0xFF6B6B)
      .setTitle(title)
      .setDescription(description);

    if (settings.embed_image) {
      embed.setImage(settings.embed_image);
    }

    // Try to edit the existing message first
    if (settings.embed_message_id) {
      try {
        const existing = await channel.messages.fetch(settings.embed_message_id);
        if (existing && existing.editable) {
          await existing.edit({ embeds: [embed] });
          logger.info(`Updated honeypot warning embed in ${guild.name}`);
          return res.json({ success: true, action: 'edited', message_id: existing.id });
        }
      } catch {
        // Message was deleted or not found - fall through to send a new one
      }
    }

    // Send a fresh message
    const sent = await channel.send({ embeds: [embed] });
    db.updateHoneypotSettings(guildId, { embed_message_id: sent.id });
    logger.info(`Sent honeypot warning embed in ${guild.name} (${sent.id})`);
    return res.json({ success: true, action: 'sent', message_id: sent.id });

  } catch (err) {
    logger.error(`Error sending honeypot warning: ${err.message}`);
    res.status(500).json({ error: 'Failed to send warning message' });
  }
});

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

// ============================================================
// SERVER BACKUP & RESTORE
// ============================================================

// All known exportable section keys
const ALL_BACKUP_SECTIONS = [
  'guild', 'automod', 'moderation', 'audit_log', 'starboard',
  'anti_raid', 'troll_discourager', 'honeypot', 'command_toggles',
  'tags', 'warnings',
  'discord_guild_info', 'discord_roles', 'discord_channels',
];

/**
 * Export bot-managed settings AND Discord server structure for a guild as a JSON backup.
 * Optional query param: ?sections=guild,automod,discord_roles  (comma-separated)
 * If omitted, all sections except warnings are included.
 *
 * v2 JSON structure:
 *   { version, exported_at, guild_id, guild_name,
 *     bot:     { settings: {…}, tags, announcements, warnings },
 *     discord: { guild_info, roles, channels }           }
 */
router.get('/guilds/:guildId/backup', requireAuth, requireGuildPermission, async (req, res) => {
  const { guildId } = req.params;
  const guild = req.guild; // Discord.js Guild object

  const requested = req.query.sections
    ? req.query.sections.split(',').map(s => s.trim()).filter(s => ALL_BACKUP_SECTIONS.includes(s))
    : ALL_BACKUP_SECTIONS.filter(s => s !== 'warnings');

  const want = (key) => requested.includes(key);

  try {
    // ── Bot settings ────────────────────────────────────────────────────────
    const settings = {};
    if (want('guild'))             settings.guild             = db.getGuildSettings(guildId);
    if (want('automod'))           settings.automod           = db.getAutomodSettings(guildId);
    if (want('moderation'))        settings.moderation        = db.getModerationSettings(guildId);
    if (want('audit_log'))         settings.audit_log         = db.getAuditLogSettings(guildId);
    if (want('starboard'))         settings.starboard         = db.getStarboardSettings(guildId);
    if (want('anti_raid'))         settings.anti_raid         = db.getAntiRaidSettings(guildId);
    if (want('troll_discourager')) settings.troll_discourager = db.getTrollDiscouragerSettings(guildId);
    if (want('honeypot'))          settings.honeypot          = db.getHoneypotSettings(guildId);
    if (want('command_toggles'))   settings.command_toggles   = db.getCommandToggleSettings(guildId);

    const bot = {
      settings,
      ...(want('tags')     && { tags:     db.getTags(guildId) }),
      ...(want('warnings') && { warnings: db.getAllWarnings(guildId) }),
    };

    // ── Discord server structure ─────────────────────────────────────────────
    const discord = {};

    if (want('discord_guild_info')) {
      discord.guild_info = {
        name:                        guild.name,
        description:                 guild.description,
        verificationLevel:           guild.verificationLevel,
        explicitContentFilter:       guild.explicitContentFilter,
        defaultMessageNotifications: guild.defaultMessageNotifications,
        preferredLocale:             guild.preferredLocale,
        afkTimeout:                  guild.afkTimeout,
        systemChannelId:             guild.systemChannelId,
        afkChannelId:                guild.afkChannelId,
        rulesChannelId:              guild.rulesChannelId,
        publicUpdatesChannelId:      guild.publicUpdatesChannelId,
        iconURL:                     guild.iconURL({ dynamic: true }) ?? null,
      };
    }

    if (want('discord_roles')) {
      discord.roles = [...guild.roles.cache.values()]
        .filter(r => r.id !== guild.id && !r.managed) // exclude @everyone and bot-managed roles
        .sort((a, b) => b.position - a.position)
        .map(r => ({
          id:          r.id,
          name:        r.name,
          // Store the primary color integer (0 = no color)
          primaryColor: r.colors?.primaryColor ?? r.color ?? 0,
          hoist:       r.hoist,
          mentionable: r.mentionable,
          permissions: r.permissions?.bitfield?.toString() ?? '0',
          position:    r.position,
        }));
    }

    if (want('discord_channels')) {
      const { ChannelType } = require('discord.js');
      discord.channels = [...guild.channels.cache.values()]
        .sort((a, b) => {
          // Categories first, then by position
          if (a.type === ChannelType.GuildCategory && b.type !== ChannelType.GuildCategory) return -1;
          if (a.type !== ChannelType.GuildCategory && b.type === ChannelType.GuildCategory) return 1;
          return (a.rawPosition ?? 0) - (b.rawPosition ?? 0);
        })
        .map(ch => ({
          id:               ch.id,
          name:             ch.name,
          type:             ch.type,
          position:         ch.rawPosition ?? 0,
          parentId:         ch.parentId ?? null,
          topic:            ch.topic     ?? null,
          nsfw:             ch.nsfw      ?? false,
          bitrate:          ch.bitrate   ?? null,
          userLimit:        ch.userLimit ?? null,
          rateLimitPerUser: ch.rateLimitPerUser ?? null,
          permissionOverwrites: ch.permissionOverwrites?.cache
            ? [...ch.permissionOverwrites.cache.values()].map(ow => ({
                id:    ow.id,
                type:  ow.type, // 0 = role, 1 = member
                allow: ow.allow.bitfield.toString(),
                deny:  ow.deny.bitfield.toString(),
              }))
            : [],
        }));
    }

    const backup = {
      version: 2,
      exported_at: new Date().toISOString(),
      guild_id: guildId,
      guild_name: guild.name,
      bot,
      ...(Object.keys(discord).length > 0 && { discord }),
    };

    const filename = `shaggybot-backup-${guildId}-${Date.now()}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(backup);
    logger.info(`Backup exported for ${guild.name} (${guildId}): [${requested.join(', ')}]`);
  } catch (err) {
    logger.error(`Error exporting backup for ${guildId}: ${err.message}`);
    res.status(500).json({ error: 'Failed to export backup' });
  }
});

/**
 * Import a JSON backup and restore settings — streams progress via Server-Sent Events.
 * Body format: { backup: <backupObject>, restore_sections: ['guild', 'automod', ...] }
 * - Supports v1 (legacy flat format) and v2 (bot/discord split).
 * - Only sections both present in the backup AND listed in restore_sections are applied.
 * - restore_sections is optional; if omitted all sections found in the backup are restored.
 */
router.post('/guilds/:guildId/restore', requireAuth, requireGuildPermission, async (req, res) => {
  const { guildId } = req.params;
  const guild = req.guild;

  const isNewFormat = req.body && req.body.backup && typeof req.body.backup === 'object';
  const backup = isNewFormat ? req.body.backup : req.body;
  const restoreSections = isNewFormat && Array.isArray(req.body.restore_sections)
    ? req.body.restore_sections
    : null;

  const version = backup?.version;
  if (!backup || (version !== 1 && version !== 2)) {
    return res.status(400).json({ error: 'Invalid backup file format' });
  }
  if (version === 1 && !backup.settings) {
    return res.status(400).json({ error: 'Invalid backup file format (v1 missing settings)' });
  }
  if (version === 2 && !backup.bot) {
    return res.status(400).json({ error: 'Invalid backup file format (v2 missing bot data)' });
  }
  if (backup.guild_id && backup.guild_id !== guildId) {
    return res.status(400).json({ error: 'This backup belongs to a different server' });
  }

  // ── SSE setup ────────────────────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const shouldRestore = (key) => restoreSections === null || restoreSections.includes(key);

  const restored = [];
  const failed   = [];

  // Count total sections to restore so the client can show accurate progress
  const s       = version === 2 ? (backup.bot?.settings || {}) : (backup.settings || {});
  const botData = version === 2 ? (backup.bot || {})           : backup;
  const disc    = backup.discord;

  const willRestore = [
    (s.guild             && shouldRestore('guild'))             ? 'guild'             : null,
    (s.automod           && shouldRestore('automod'))           ? 'automod'           : null,
    (s.moderation        && shouldRestore('moderation'))        ? 'moderation'        : null,
    (s.audit_log         && shouldRestore('audit_log'))         ? 'audit_log'         : null,
    (s.starboard         && shouldRestore('starboard'))         ? 'starboard'         : null,
    (s.anti_raid         && shouldRestore('anti_raid'))         ? 'anti_raid'         : null,
    (s.troll_discourager && shouldRestore('troll_discourager')) ? 'troll_discourager' : null,
    (s.honeypot          && shouldRestore('honeypot'))          ? 'honeypot'          : null,
    (s.command_toggles   && shouldRestore('command_toggles'))   ? 'command_toggles'   : null,
    (Array.isArray(botData.tags)     && botData.tags.length > 0 && shouldRestore('tags'))     ? 'tags'     : null,
    (Array.isArray(botData.warnings)   && shouldRestore('warnings'))                          ? 'warnings' : null,
    (disc?.guild_info && shouldRestore('discord_guild_info')) ? 'discord_guild_info' : null,
    (Array.isArray(disc?.roles)     && disc.roles.length > 0     && shouldRestore('discord_roles'))    ? 'discord_roles'    : null,
    (Array.isArray(disc?.channels)  && disc.channels.length > 0  && shouldRestore('discord_channels')) ? 'discord_channels' : null,
  ].filter(Boolean);

  send('start', { total: willRestore.length, sections: willRestore });

  const attempt = (name, fn) => {
    try {
      fn();
      restored.push(name);
      send('progress', { section: name, status: 'ok', restored: restored.length, total: willRestore.length });
    } catch (e) {
      failed.push(name);
      logger.error(`Restore [${name}] for ${guildId}: ${e.message}`);
      send('progress', { section: name, status: 'error', message: e.message, restored: restored.length, total: willRestore.length });
    }
  };
  const attemptAsync = async (name, fn) => {
    try {
      await fn();
      restored.push(name);
      send('progress', { section: name, status: 'ok', restored: restored.length, total: willRestore.length });
    } catch (e) {
      failed.push(name);
      logger.error(`Restore [${name}] for ${guildId}: ${e.message}`);
      send('progress', { section: name, status: 'error', message: e.message, restored: restored.length, total: willRestore.length });
    }
  };

  // ── Bot settings ─────────────────────────────────────────────────────────
  if (s.guild             && shouldRestore('guild'))             attempt('guild',             () => db.updateGuildSettings(guildId, s.guild));
  if (s.automod           && shouldRestore('automod'))           attempt('automod',           () => db.updateAutomodSettings(guildId, s.automod));
  if (s.moderation        && shouldRestore('moderation'))        attempt('moderation',        () => db.updateModerationSettings(guildId, s.moderation));
  if (s.audit_log         && shouldRestore('audit_log'))         attempt('audit_log',         () => db.updateAuditLogSettings(guildId, s.audit_log));
  if (s.starboard         && shouldRestore('starboard'))         attempt('starboard',         () => db.updateStarboardSettings(guildId, s.starboard));
  if (s.anti_raid         && shouldRestore('anti_raid'))         attempt('anti_raid',         () => db.updateAntiRaidSettings(guildId, s.anti_raid));
  if (s.troll_discourager && shouldRestore('troll_discourager')) attempt('troll_discourager', () => db.updateTrollDiscouragerSettings(guildId, s.troll_discourager));
  if (s.honeypot          && shouldRestore('honeypot'))          attempt('honeypot',          () => db.updateHoneypotSettings(guildId, s.honeypot));
  if (s.command_toggles   && shouldRestore('command_toggles'))   attempt('command_toggles',   () => db.updateCommandToggleSettings(guildId, s.command_toggles));

  if (Array.isArray(botData.tags) && botData.tags.length > 0 && shouldRestore('tags')) {
    attempt('tags', () => {
      for (const tag of botData.tags) {
        if (!tag.name || !tag.response) continue;
        const existing = db.getTag(guildId, tag.name);
        if (!existing) db.createTag(guildId, tag.name, tag.response, tag.owner_id || '0', tag.owner_name || 'Unknown');
      }
    });
  }
  if (Array.isArray(botData.warnings) && shouldRestore('warnings')) {
    attempt('warnings', () => db.bulkInsertWarnings(guildId, botData.warnings));
  }

  // ── Discord server structure ─────────────────────────────────────────────
  if (disc?.guild_info && shouldRestore('discord_guild_info')) {
    await attemptAsync('discord_guild_info', async () => {
      const info = disc.guild_info;
      const payload = {};
      if (info.name                        != null) payload.name                        = info.name;
      if (info.description                 != null) payload.description                 = info.description;
      if (info.verificationLevel           != null) payload.verificationLevel           = info.verificationLevel;
      if (info.explicitContentFilter       != null) payload.explicitContentFilter       = info.explicitContentFilter;
      if (info.defaultMessageNotifications != null) payload.defaultMessageNotifications = info.defaultMessageNotifications;
      if (info.preferredLocale             != null) payload.preferredLocale             = info.preferredLocale;
      if (info.afkTimeout                  != null) payload.afkTimeout                  = info.afkTimeout;
      if (Object.keys(payload).length > 0) await guild.edit(payload);
    });
  }

  // Safe BigInt conversion — tolerates JS undefined, null, and strings like "undefined"
  const safeBigInt = (val) => { try { return BigInt(val ?? '0'); } catch { return 0n; } };

  // role id map: original backup id -> restored/existing role id
  const roleIdMap = {};

  if (Array.isArray(disc?.roles) && disc.roles.length > 0 && shouldRestore('discord_roles')) {
    await attemptAsync('discord_roles', async () => {
      // Bot cannot manage roles at or above its own highest role
      const botMember  = guild.members.me ?? await guild.members.fetchMe();
      const botHighest = botMember.roles.highest.position;

      for (const roleData of disc.roles) {
        try {
          const existing = guild.roles.cache.find(r => r.name === roleData.name && !r.managed);

          // Skip roles at or above the bot's highest role
          if (existing && existing.position >= botHighest) {
            logger.warn(`Restore [discord_roles]: skipping "${roleData.name}" (position ${existing.position} >= bot highest ${botHighest})`);
            roleIdMap[roleData.id] = existing.id;
            continue;
          }

          const payload = {
            name:        roleData.name,
            hoist:       roleData.hoist        ?? false,
            mentionable: roleData.mentionable  ?? false,
            permissions: safeBigInt(roleData.permissions),
          };

          // colors is an object { primaryColor } in discord.js 14.16+
          // Only include when non-zero (0 = default/no color)
          const primaryColor = roleData.primaryColor ?? roleData.color ?? 0;
          const colorsObj = primaryColor !== 0 ? { primaryColor } : undefined;

          if (existing) {
            const editData = { ...payload, reason: 'ShaggyBot backup restore' };
            if (colorsObj) editData.colors = colorsObj;
            const updated = await existing.edit(editData);
            roleIdMap[roleData.id] = updated.id;
          } else {
            const createData = { ...payload, reason: 'ShaggyBot backup restore' };
            if (colorsObj) createData.colors = colorsObj;
            const created = await guild.roles.create(createData);
            roleIdMap[roleData.id] = created.id;
          }
        } catch (roleErr) {
          logger.warn(`Restore [discord_roles]: failed to restore role "${roleData.name}": ${roleErr.message}`);
          // Map the id anyway if an existing role was found, so channel overwrites still resolve
          const fallback = guild.roles.cache.find(r => r.name === roleData.name);
          if (fallback) roleIdMap[roleData.id] = fallback.id;
        }
      }
    });
  }

  if (Array.isArray(disc?.channels) && disc.channels.length > 0 && shouldRestore('discord_channels')) {
    await attemptAsync('discord_channels', async () => {
      const { ChannelType } = require('discord.js');

      const buildOverwrites = (overwrites) =>
        (overwrites || []).map(ow => ({
          id:    ow.type === 0 ? (roleIdMap[ow.id] ?? ow.id) : ow.id,
          type:  ow.type,
          allow: safeBigInt(ow.allow),
          deny:  safeBigInt(ow.deny),
        }));

      const categories    = disc.channels.filter(c => c.type === ChannelType.GuildCategory);
      const nonCategories = disc.channels.filter(c => c.type !== ChannelType.GuildCategory);
      const categoryIdMap = {};

      // Restore categories first so children can reference them
      for (const cat of categories) {
        try {
          const existing = guild.channels.cache.find(
            c => c.name === cat.name && c.type === ChannelType.GuildCategory,
          );
          const payload = {
            name:                 cat.name,
            position:             cat.position,
            permissionOverwrites: buildOverwrites(cat.permissionOverwrites),
            reason:               'ShaggyBot backup restore',
          };
          if (existing) {
            await existing.edit(payload);
            categoryIdMap[cat.id] = existing.id;
          } else {
            const created = await guild.channels.create({ ...payload, type: ChannelType.GuildCategory });
            categoryIdMap[cat.id] = created.id;
          }
        } catch (catErr) {
          logger.warn(`Restore [discord_channels]: failed to restore category "${cat.name}": ${catErr.message}`);
          const fallback = guild.channels.cache.find(c => c.name === cat.name && c.type === ChannelType.GuildCategory);
          if (fallback) categoryIdMap[cat.id] = fallback.id;
        }
      }

      // Restore non-category channels
      for (const ch of nonCategories) {
        try {
          const existing = guild.channels.cache.find(c => c.name === ch.name && c.type === ch.type);
          const parentId = ch.parentId ? (categoryIdMap[ch.parentId] ?? ch.parentId) : null;
          const payload = {
            name:                 ch.name,
            type:                 ch.type,
            position:             ch.position,
            parent:               parentId,
            permissionOverwrites: buildOverwrites(ch.permissionOverwrites),
            reason:               'ShaggyBot backup restore',
            ...(ch.topic            != null && { topic:            ch.topic            }),
            ...(ch.nsfw             != null && { nsfw:             ch.nsfw             }),
            ...(ch.bitrate          != null && { bitrate:          ch.bitrate          }),
            ...(ch.userLimit        != null && { userLimit:        ch.userLimit        }),
            ...(ch.rateLimitPerUser != null && { rateLimitPerUser: ch.rateLimitPerUser }),
          };
          if (existing) {
            await existing.edit(payload);
          } else {
            await guild.channels.create(payload);
          }
        } catch (chErr) {
          logger.warn(`Restore [discord_channels]: failed to restore channel "${ch.name}": ${chErr.message}`);
        }
      }
    });
  }

  logger.info(`Backup restored for ${guild.name} (${guildId}): [${restored.join(', ')}]`);
  send('done', { success: true, restored, failed });
  res.end();
});

// ============================================================
// SCHEDULED ANNOUNCEMENTS
// ============================================================

/**
 * List all announcements for a guild
 */
router.get('/guilds/:guildId/announcements', requireAuth, requireGuildPermission, (req, res) => {
  res.json(db.getAnnouncements(req.params.guildId));
});

/**
 * Create a new announcement
 */
router.post('/guilds/:guildId/announcements', requireAuth, requireGuildPermission, (req, res) => {
  const { guildId } = req.params;
  const data = { ...req.body, created_by: req.session.user.id };
  try {
    const announcement = db.createAnnouncement(guildId, data);
    logger.info(`Created announcement #${announcement.id} for ${req.guild.name}`);
    res.status(201).json(announcement);
  } catch (err) {
    logger.error(`Error creating announcement: ${err.message}`);
    res.status(500).json({ error: 'Failed to create announcement' });
  }
});

/**
 * Update an existing announcement
 */
router.patch('/guilds/:guildId/announcements/:id', requireAuth, requireGuildPermission, (req, res) => {
  const { guildId, id } = req.params;
  const updates = req.body;

  // If schedule fields are changing, recompute next_run_at
  const scheduleFields = ['schedule_type', 'run_at', 'interval_minutes', 'day_of_week'];
  if (scheduleFields.some(f => f in updates)) {
    const existing = db.getAnnouncementById(Number(id), guildId);
    if (existing) {
      const merged = { ...existing, ...updates };
      updates.next_run_at = db.computeNextRun(merged);
    }
  }

  const result = db.updateAnnouncement(Number(id), guildId, updates);
  if (!result) return res.status(404).json({ error: 'Announcement not found' });
  logger.info(`Updated announcement #${id} for ${req.guild.name}`);
  res.json(result);
});

/**
 * Delete an announcement
 */
router.delete('/guilds/:guildId/announcements/:id', requireAuth, requireGuildPermission, (req, res) => {
  const { guildId, id } = req.params;
  const deleted = db.deleteAnnouncement(Number(id), guildId);
  if (!deleted) return res.status(404).json({ error: 'Announcement not found' });
  logger.info(`Deleted announcement #${id} for ${req.guild.name}`);
  res.json({ success: true });
});

module.exports = router;
