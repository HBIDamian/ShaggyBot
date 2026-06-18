const { EmbedBuilder } = require('discord.js');
const db = require('../database/database');
const { createLogger } = require('./logger');

const logger = createLogger('Scheduler');

// How often we check for due announcements (ms)
const CHECK_INTERVAL = 60000; // 1 minute

// How often we clean up old disabled announcements (ms)
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

// Announcements disabled for this long get auto-deleted
const INACTIVITY_THRESHOLD_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

function startScheduler(client) {
  logger.info('Starting announcement scheduler...');

  // Main loop: check for due announcements
  setInterval(async () => {
    try {
      const dueAnnouncements = db.getDueAnnouncements();

      for (const announcement of dueAnnouncements) {
        const guild = client.guilds.cache.get(announcement.guild_id);
        if (!guild) {continue;}

        const channel = guild.channels.cache.get(announcement.channel_id);
        if (!channel) {continue;}

        try {
        const payload = buildScheduledPayload(announcement);
        if (payload.content || payload.embeds) {
          await channel.send(payload);
          logger.info(`Sent scheduled announcement #${announcement.id} to #${channel.name} in ${guild.name}`);
        }
        } catch (err) {
          logger.error(`Failed to send announcement #${announcement.id} to #${channel.name}: ${err.message}`);
          // Disable the announcement if sending fails (e.g., channel deleted)
          db.updateAnnouncement(announcement.id, announcement.guild_id, {
            enabled: 0,
            last_run_at: new Date().toISOString()
          });
          continue;
        }

        const now = new Date().toISOString();

        if (announcement.schedule_type === 'once') {
          // One-time: disable after sending, don't delete
          db.updateAnnouncement(announcement.id, announcement.guild_id, {
            enabled: 0,
            last_run_at: now
          });
          logger.info(`Disabled one-time announcement #${announcement.id} after sending`);
        } else {
          // Recurring: compute next run and update
          const nextRunAt = db.computeNextRun(announcement);
          db.updateAnnouncement(announcement.id, announcement.guild_id, {
            next_run_at: nextRunAt,
            last_run_at: now
          });
          logger.info(`Rescheduled recurring announcement #${announcement.id} for ${nextRunAt}`);
        }
      }
    } catch (err) {
      logger.error(`Scheduler error: ${err.message}`);
    }
  }, CHECK_INTERVAL);

  // Periodic cleanup: delete announcements disabled for over a year
  setInterval(() => {
    try {
      const deleted = db.cleanupOldAnnouncements(INACTIVITY_THRESHOLD_MS);
      if (deleted > 0) {
        logger.info(`Cleaned up ${deleted} old disabled announcement(s)`);
      }
    } catch (err) {
      logger.error(`Announcement cleanup error: ${err.message}`);
    }
  }, CLEANUP_INTERVAL);

  logger.info('Announcement scheduler started');
}

/**
 * Build a sendable payload from a scheduled announcement record.
 */
function buildScheduledPayload(announcement) {
  const payload = {};
  if (announcement.message) { payload.content = announcement.message; }
  if (announcement.embed_json) {
    const embedData = announcement.embed_json;
    const embed = new EmbedBuilder(embedData);
    if (embedData.title && !embed.data.title) { embed.setTitle(embedData.title); }
    if (embedData.description && !embed.data.description) { embed.setDescription(embedData.description); }
    if (embedData.color && !embed.data.color) { embed.setColor(embedData.color); }
    if (embedData.image) { embed.setImage(embedData.image); }
    payload.embeds = [embed];
  }
  return payload;
}

module.exports = { startScheduler };
