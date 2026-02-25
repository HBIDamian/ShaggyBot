// Main entry point for ShaggyBot
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, Events, REST, Routes, ActivityType, EmbedBuilder } = require('discord.js');
const { createLogger, closeLogger } = require('./utils/logger');
const { startDashboard } = require('./dashboard/server');
const { cleanupOldModActions, cleanupOldWarnings, getDueReminders, deleteReminderById, getDueAnnouncements, updateAnnouncement, deleteAnnouncement, computeNextRun } = require('./database/database');
require('dotenv').config();

// Setup logging
const logger = createLogger('ShaggyBot');
logger.info('Starting new session');

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

// Store client launch time for uptime calculation
client.launchTime = Date.now();

/**
 * Load command files from a directory
 * @param {string} dirPath - Path to commands directory
 * @param {string} type - Type for logging (e.g., 'command', 'context menu')
 */
function loadCommands(dirPath, type = 'command') {
  if (!fs.existsSync(dirPath)) return;
  
  const items = fs.readdirSync(dirPath, { withFileTypes: true });
  
  for (const item of items) {
    const itemPath = path.join(dirPath, item.name);
    
    if (item.isDirectory()) {
      // Recursively load from subdirectory
      loadCommands(itemPath, type);
    } else if (item.name.endsWith('.js')) {
      try {
        const command = require(itemPath);
        if ('data' in command && 'execute' in command) {
          client.commands.set(command.data.name, command);
          const category = path.relative(path.join(__dirname, 'commands'), path.dirname(itemPath));
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
        if (!evt.name || !evt.execute) continue;
        
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
function normalizeEventExport(event, filename) {
  // Array format (e.g., starboard.js)
  if (Array.isArray(event)) return event;
  
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
        const guild = client.guilds.cache.get(announcement.guild_id);
        if (!guild) {
          // Bot left guild — disable announcement
          updateAnnouncement(announcement.id, announcement.guild_id, { enabled: 0 });
          continue;
        }

        const channel = guild.channels.cache.get(announcement.channel_id)
          || await guild.channels.fetch(announcement.channel_id).catch(() => null);

        if (!channel) {
          logger.warn(`Announcement #${announcement.id}: channel ${announcement.channel_id} not found in ${guild.name}`);
        } else {
          const payload = {};
          if (announcement.message) payload.content = announcement.message;
          if (announcement.embed_json) {
            const { EmbedBuilder } = require('discord.js');
            const e = announcement.embed_json;
            const embed = new EmbedBuilder();
            if (e.title)       embed.setTitle(e.title);
            if (e.description) embed.setDescription(e.description);
            if (e.color)       embed.setColor(e.color);
            if (e.footer)      embed.setFooter(e.footer);
            if (e.image)       embed.setImage(e.image);
            if (e.thumbnail)   embed.setThumbnail(e.thumbnail);
            payload.embeds = [embed];
          }
          await channel.send(payload);
          logger.info(`Sent scheduled announcement #${announcement.id} in ${guild.name} #${channel.name}`);
        }
        // Update state after sending (or failing to find channel)
        const now = new Date().toISOString();
        if (announcement.schedule_type === 'once') {
          // One-shot — disable after firing
          updateAnnouncement(announcement.id, announcement.guild_id, { enabled: 0, last_run_at: now });
        } else {
          // Recurring — compute next run
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

// Global error handling
client.on('error', error => {
  logger.error(`Client error: ${error.message}`);
});

process.on('unhandledRejection', error => {
  logger.error(`Unhandled promise rejection: ${error?.message || error}`, error);
});

/**
 * Collect all command data for deployment
 * @returns {Array} Array of command JSON data
 */
function collectCommandData() {
  const commands = [];
  
  const loadFromDir = (dirPath) => {
    if (!fs.existsSync(dirPath)) return;
    
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const item of items) {
      const itemPath = path.join(dirPath, item.name);
      
      if (item.isDirectory()) {
        loadFromDir(itemPath);
      } else if (item.name.endsWith('.js')) {
        try {
          const command = require(itemPath);
          if ('data' in command) {
            commands.push(command.data.toJSON());
          }
        } catch {}
      }
    }
  };
  
  loadFromDir(path.join(__dirname, 'commands'));
  loadFromDir(path.join(__dirname, 'contextMenus'));
  
  return commands;
}

/**
 * Deploy slash commands to Discord
 */
async function deployCommands() {
  const commands = collectCommandData();
  const rest = new REST().setToken(TOKEN);
  
  try {
    logger.info(`Refreshing ${commands.length} application (/) commands...`);
    
    const data = await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    
    logger.info(`Successfully reloaded ${data.length} application (/) commands`);
  } catch (error) {
    logger.error(`Error refreshing commands: ${error.message}`, error);
  }
}

/**
 * Handle graceful shutdown
 */
function gracefulShutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  closeLogger();
  client.destroy();
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Validate required environment variables
if (!TOKEN) {
  logger.error('DISCORD_TOKEN not found in environment variables');
  process.exit(1);
}

if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
  logger.warn('Dashboard OAuth2 credentials not set. Dashboard login will not work.');
}

// Login to Discord
client.login(TOKEN);
