// Main entry point for ShaggyBot
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Events, REST, Routes, ActivityType, EmbedBuilder } = require('discord.js');
const { createLogger, closeLogger } = require('./utils/logger');
const { startDashboard } = require('./dashboard/server');
const { installGlobalErrorHandlers, registerShutdownHook, scheduleGracefulShutdown } = require('./utils/errorHandler');
const db = require('./database/database');
const { cleanupOldModActions, cleanupOldWarnings, getDueReminders, deleteReminderById, getDueAnnouncements, updateAnnouncement, computeNextRun } = db;
const { loadDynamicCommands, buildSlashCommand } = require('./utils/dynamicCommands');
require('dotenv').config();

// Install global error handlers (BP 2.10, 2.13)
installGlobalErrorHandlers();

// Setup logging
const logger = createLogger('ShaggyBot');
logger.info('Starting new session');

// Parse custom commands configuration
const CUSTOM_COMMANDS_MODE = (process.env.CUSTOM_COMMANDS_MODE || 'whitelist').toLowerCase();
const CUSTOM_COMMANDS_ALLOWED = (process.env.CUSTOM_COMMANDS_ALLOWED_GUILDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(id => /^\d{17,20}$/.test(id));

/**
 * Check if a guild is allowed to use custom commands
 * @param {string} guildId - The guild ID
 * @returns {boolean}
 */
function isCustomCommandsAllowed(guildId) {
  if (CUSTOM_COMMANDS_MODE === 'off') {return false;}
  if (CUSTOM_COMMANDS_MODE === 'global') {return true;}
  if (CUSTOM_COMMANDS_MODE === 'whitelist') {return CUSTOM_COMMANDS_ALLOWED.includes(guildId);}
  return false;
}

// Get environment variables
const TOKEN = process.env.DISCORD_TOKEN;

// Create a new client instance with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.MessageContent
  ]
});

// Initialize collections to store commands
client.commands = new Collection();
client.cooldowns = new Collection();

// Store custom commands config for dashboard access
client.customCommandsConfig = {
  mode: CUSTOM_COMMANDS_MODE,
  allowedGuilds: CUSTOM_COMMANDS_ALLOWED,
  isAllowed: isCustomCommandsAllowed
};

// Store client launch time for uptime calculation
client.launchTime = Date.now();

/**
 * Load command files from a directory
 * @param {string} dirPath - Path to commands directory
 * @param {string} type - Type for logging (e.g., 'command', 'context menu')
 * @param {string} rootPath - Root path for relative logging
 */
function loadCommands(dirPath, type = 'command', rootPath = dirPath) {
  if (!fs.existsSync(dirPath)) {return;}

  const items = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const item of items) {
    const itemPath = path.join(dirPath, item.name);

    if (item.isDirectory()) {
      // Recursively load from subdirectory
      loadCommands(itemPath, type, rootPath);
    } else if (item.name.endsWith('.js')) {
      try {
        const command = require(itemPath);
        if ('data' in command && 'execute' in command) {
          client.commands.set(command.data.name, command);
          const category = path.relative(rootPath, path.dirname(itemPath));
          logger.info(`Loaded ${type}: ${category ? category + '/' : ''}${command.data.name}`);
        } else {
          logger.warn(`Missing "data" or "execute" in: ${itemPath}`);
        }
      } catch (err) {
        logger.error(`Failed to load ${itemPath}: ${err.message}`);
      }
    }
  }
}

/**
 * Load event handlers from the events directory
 */
function loadEvents() {
  const eventsPath = path.join(__dirname, 'events');
  const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));

  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);

    try {
      const event = require(filePath);
      const events = normalizeEventExport(event, file);

      for (const evt of events) {
        if (!evt.name || !evt.execute) {continue;}

        const handler = (...args) => evt.execute(...args, client);

        if (evt.once) {
          client.once(evt.name, handler);
        } else {
          client.on(evt.name, handler);
        }
        logger.info(`Loaded event: ${evt.name} (${file})`);
      }
    } catch (err) {
      logger.error(`Failed to load event ${file}: ${err.message}`);
    }
  }
}

/**
 * Normalize different event export formats to an array
 */
function normalizeEventExport(event, _filename) {
  // Array format (e.g., starboard.js)
  if (Array.isArray(event)) {return event;}

  // Object with multiple named events (e.g., auditLog.js)
  if (event && typeof event === 'object' && !event.name) {
    return Object.values(event).filter(e => e && e.name && e.execute);
  }

  // Single event object
  if (event && event.name && event.execute) {
    return [event];
  }

  return [];
}

// Load commands and context menus
loadCommands(path.join(__dirname, 'commands'), 'command');
loadCommands(path.join(__dirname, 'contextMenus'), 'context menu');

// Load dynamic DB-based custom guild commands (only if not globally off)
if (CUSTOM_COMMANDS_MODE !== 'off') {
  loadDynamicCommands(client);
} else {
  logger.info('Custom commands are globally disabled (CUSTOM_COMMANDS_MODE=off) — skipping dynamic command load');
}

// Load events
loadEvents();

// Status messages for rotating presence
const STATUS_MESSAGES = ['Zoinks!', 'Groovy!', 'Scooby Snacks!', 'G-G-G-Ghosts!'];
const STATUS_INTERVAL = 15000; // 15 seconds
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
const REMINDER_CHECK_INTERVAL = 30000; // 30 seconds
const ANNOUNCEMENT_CHECK_INTERVAL = 60000; // 1 minute

let statusIndex = 0;

/**
 * Update bot status with rotating messages
 */
function updateStatus() {
  const status = STATUS_MESSAGES[statusIndex];
  client.user.setActivity(`/help | ${status}`, { type: ActivityType.Playing });
  statusIndex = (statusIndex + 1) % STATUS_MESSAGES.length;
}

/**
 * Run periodic cleanup tasks
 */
function runCleanup() {
  const deletedActions = cleanupOldModActions();
  const deletedWarnings = cleanupOldWarnings();

  if (deletedActions > 0) {
    logger.info(`Cleanup: Removed ${deletedActions} old mod action logs`);
  }
  if (deletedWarnings > 0) {
    logger.info(`Cleanup: Removed ${deletedWarnings} old warnings`);
  }
}

/**
 * Process and send due reminders
 */
async function processReminders() {
  try {
    const dueReminders = getDueReminders();

    for (const reminder of dueReminders) {
      try {
        const user = await client.users.fetch(reminder.user_id);

        const embed = new EmbedBuilder()
          .setTitle('⏰ Reminder!')
          .setDescription(reminder.message)
          .addFields({
            name: '📅 Set on',
            value: `<t:${Math.floor(new Date(reminder.created_at).getTime() / 1000)}:F>`,
            inline: true
          })
          .setColor('#FFD700')
          .setTimestamp();

        await user.send({ embeds: [embed] });
        logger.info(`Sent reminder #${reminder.id} to user ${user.tag}`);
      } catch (dmError) {
        logger.warn(`Failed to send reminder #${reminder.id}: ${dmError.message}`);
      }

      // Delete the reminder regardless of DM success
      deleteReminderById(reminder.id);
    }
  } catch (error) {
    logger.error(`Error processing reminders: ${error.message}`);
  }
}

/**
 * Process and send due scheduled announcements
 */
async function processAnnouncements() {
  try {
    const due = getDueAnnouncements();
    for (const announcement of due) {
      try {
        await sendSingleAnnouncement(announcement);
        // Update state after sending (or failing to find channel)
        const now = new Date().toISOString();
        if (announcement.schedule_type === 'once') {
          updateAnnouncement(announcement.id, announcement.guild_id, { enabled: 0, last_run_at: now });
        } else {
          const nextRunAt = computeNextRun(announcement);
          updateAnnouncement(announcement.id, announcement.guild_id, { next_run_at: nextRunAt, last_run_at: now });
        }
      } catch (err) {
        logger.error(`Failed to send announcement #${announcement.id}: ${err.message}`);
      }
    }
  } catch (error) {
    logger.error(`Error processing announcements: ${error.message}`);
  }
}

// When the client is ready, run this code once
client.once(Events.ClientReady, () => {
  logger.info(`Bot logged in as ${client.user.tag} (ID: ${client.user.id})`);
  logger.info(`Connected to ${client.guilds.cache.size} guilds`);

  // Start status rotation
  updateStatus();
  setInterval(updateStatus, STATUS_INTERVAL);

  // Deploy slash commands
  deployCommands();

  // Start the web dashboard
  const dashboardPort = process.env.DASHBOARD_PORT || 3000;
  startDashboard(client, dashboardPort);

  // Run initial cleanup
  runCleanup();

  // Schedule periodic cleanup
  setInterval(runCleanup, CLEANUP_INTERVAL);

  // Start reminder processing
  setInterval(processReminders, REMINDER_CHECK_INTERVAL);

  // Start announcement processing
  setInterval(processAnnouncements, ANNOUNCEMENT_CHECK_INTERVAL);
  processAnnouncements(); // Run immediately on startup
});

/**
 * Build an embed from announcement JSON, applying default color if unset.
 */
function buildAnnouncementEmbed(embedJson) {
  const embed = new EmbedBuilder(embedJson);
  if (!embed.data.color) { embed.setColor('#5865F2'); }
  return embed;
}

/**
 * Send a single announcement to its configured guild channel.
 * Disables the announcement if the guild or channel is missing.
 */
async function sendSingleAnnouncement(announcement) {
  const guild = client.guilds.cache.get(announcement.guild_id);
  if (!guild) {
    updateAnnouncement(announcement.id, announcement.guild_id, { enabled: 0 });
    return;
  }

  const channel = guild.channels.cache.get(announcement.channel_id)
    || await guild.channels.fetch(announcement.channel_id).catch(() => null);

  if (!channel) {
    logger.warn(`Announcement #${announcement.id}: channel ${announcement.channel_id} not found in ${guild.name}`);
    return;
  }

  const payload = {};
  if (announcement.message) { payload.content = announcement.message; }
  if (announcement.embed_json) {
    payload.embeds = [buildAnnouncementEmbed(announcement.embed_json)];
  }
  await channel.send(payload);
  logger.info(`Sent scheduled announcement #${announcement.id} in ${guild.name} #${channel.name}`);
}

/**
 * Recursively collect command JSON from a directory
 */
function collectCommandJsonFromDir(dirPath, commands = []) {
  if (!fs.existsSync(dirPath)) {return commands;}

  const items = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const item of items) {
    const itemPath = path.join(dirPath, item.name);

    if (item.isDirectory()) {
      collectCommandJsonFromDir(itemPath, commands);
    } else if (item.name.endsWith('.js')) {
      try {
        const command = require(itemPath);
        if ('data' in command) {
          commands.push(command.data.toJSON());
        }
      } catch { /* skip files that fail to load */ }
    }
  }

  return commands;
}

/**
 * Collect globally available command data
 */
function collectGlobalCommandData() {
  const commands = [];
  collectCommandJsonFromDir(path.join(__dirname, 'commands'), commands);
  collectCommandJsonFromDir(path.join(__dirname, 'contextMenus'), commands);
  return commands;
}

/**
 * Deploy slash commands to Discord
 */
async function deployCommands() {
  const globalCommands = collectGlobalCommandData();
  const guildCommandMap = new Map();

  // Merge DB-based dynamic guild commands into the map (only if mode allows)
  if (CUSTOM_COMMANDS_MODE !== 'off') {
    const dbCommandMap = db.getAllCustomGuildCommands();

    for (const [guildId, dbCommands] of dbCommandMap) {
      if (!isCustomCommandsAllowed(guildId)) {continue;}

      const dynamicCommandsJson = dbCommands
        .filter(cmd => cmd.enabled)
        .map(cmd => buildSlashCommand(cmd).toJSON());

      if (dynamicCommandsJson.length === 0) {continue;}
      guildCommandMap.set(guildId, dynamicCommandsJson);
    }
  }

  // Collect guilds that need their commands CLEARED (mode is off)
  const guildsToClear = new Set();
  if (CUSTOM_COMMANDS_MODE === 'off') {
    const dbCommandMap = db.getAllCustomGuildCommands();
    for (const [guildId] of dbCommandMap) {
      guildsToClear.add(guildId);
    }
  }

  const rest = new REST().setToken(TOKEN);

  try {
    logger.info(`Refreshing ${globalCommands.length} global application (/) commands...`);

    const globalData = await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: globalCommands }
    );

    logger.info(`Successfully reloaded ${globalData.length} global application (/) commands`);

    // Clear guild commands for guilds that lost access
    for (const guildId of guildsToClear) {
      try {
        logger.info(`Clearing guild commands for ${guildId} (custom commands disabled/not whitelisted)...`);
        await rest.put(
          Routes.applicationGuildCommands(client.user.id, guildId),
          { body: [] }
        );
        logger.info(`Cleared guild commands for ${guildId}`);
      } catch (guildError) {
        logger.error(`Failed to clear guild commands for ${guildId}: ${guildError.message}`);
      }
    }

    // Deploy guild commands for allowed guilds
    for (const [guildId, guildCommands] of guildCommandMap.entries()) {
      try {
        logger.info(`Refreshing ${guildCommands.length} guild command(s) for ${guildId}...`);
        const guildData = await rest.put(
          Routes.applicationGuildCommands(client.user.id, guildId),
          { body: guildCommands }
        );
        logger.info(`Successfully reloaded ${guildData.length} guild command(s) for ${guildId}`);
      } catch (guildError) {
        logger.error(`Failed to deploy guild commands for ${guildId}: ${guildError.message}`);
      }
    }
  } catch (error) {
    logger.error(`Error refreshing commands: ${error.message}`, error);
  }
}

/**
 * Refresh dynamic commands and re-deploy for a single guild.
 * Called by the dashboard when custom commands are modified.
 * @param {string} guildId - The guild ID to refresh
 */
async function refreshGuildCommands(guildId) {
  if (!isCustomCommandsAllowed(guildId)) {
    throw new Error('Custom commands are not enabled for this guild');
  }

  // 1. Remove old dynamic commands for this guild from in-memory collection
  const oldDynamicNames = new Set();
  for (const [name] of client.commands) {
    const currentCmd = db.getCustomGuildCommandByName(guildId, name);
    if (currentCmd) {
      oldDynamicNames.add(name);
    }
  }
  for (const name of oldDynamicNames) {
    client.commands.delete(name);
    logger.info(`Removed dynamic command from memory: /${name} (guild ${guildId})`);
  }

  // 2. Reload dynamic commands from DB
  loadDynamicCommands(client);

  // 3. Re-deploy to Discord
  const dbCommands = db.getCustomGuildCommands(guildId)
    .filter(cmd => cmd.enabled);

  const merged = dbCommands.map(cmd => {
    const json = buildSlashCommand(cmd).toJSON();
    logger.info(`Deploying /${json.name} with ${json.options?.length || 0} option(s) (subcommands: ${(cmd.subcommands || []).map(s => s.name).join(', ') || 'none'})`);
    return json;
  });

  if (merged.length > 0) {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
      const guildData = await rest.put(
        Routes.applicationGuildCommands(client.user.id, guildId),
        { body: merged }
      );
      logger.info(`Refreshed ${guildData.length} guild command(s) for ${guildId}`);
      return guildData.length;
    } catch (err) {
      logger.error(`Failed to refresh guild commands for ${guildId}: ${err.message}`);
      throw err;
    }
  }

  // No commands — clear guild
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const _guildData = await rest.put(
    Routes.applicationGuildCommands(client.user.id, guildId),
    { body: [] }
  );
  logger.info(`Cleared all guild commands for ${guildId} (no commands to deploy)`);
  return 0;
}

client.refreshGuildCommands = refreshGuildCommands;

// ── Graceful shutdown (BP 2.6, 8.6) ───────────────────────────────────────

registerShutdownHook('logger', () => closeLogger());
registerShutdownHook('discord', () => client.destroy());

function gracefulShutdown(signal) {
  logger.info(`Received ${signal}, initiating graceful shutdown...`);
  scheduleGracefulShutdown();
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ── Discord client error handling (BP 2.13) ───────────────────────────────

client.on('error', (error) => {
  logger.error('Discord client error', error);
});

// ── Environment validation (BP 1.4) ───────────────────────────────────────

if (!TOKEN) {
  logger.fatal('DISCORD_TOKEN not found in environment variables');
  process.exit(1);
}

if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
  logger.warn('Dashboard OAuth2 credentials not set. Dashboard login will not work.');
}

// Login to Discord
client.login(TOKEN);
