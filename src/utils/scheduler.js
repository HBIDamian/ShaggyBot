const cron = require('cron-parser');
const db = require('../database/database');
const { createLogger } = require('./logger');

const logger = createLogger('Scheduler');

function startScheduler(client) {
  logger.info('Starting announcement scheduler...');

  setInterval(async () => {
    try {
      const dueAnnouncements = db.getDueAnnouncements();
      
      for (const announcement of dueAnnouncements) {
        const guild = client.guilds.cache.get(announcement.guild_id);
        if (!guild) continue;

        const channel = guild.channels.cache.get(announcement.channel_id);
        if (!channel) continue;

        try {
          await channel.send(announcement.message);
          logger.info(`Sent scheduled announcement to ${channel.name} in ${guild.name}`);
        } catch (err) {
          logger.error(`Failed to send announcement to ${channel.name}: ${err.message}`);
        }

        if (announcement.is_recurring && announcement.cron_expression) {
          try {
            const interval = cron.parseExpression(announcement.cron_expression);
            const nextRun = interval.next().toISOString();
            db.updateAnnouncementNextRun(announcement.id, nextRun);
          } catch (err) {
            logger.error(`Invalid cron expression for announcement ${announcement.id}: ${err.message}`);
            db.deleteScheduledAnnouncement(announcement.id, announcement.guild_id);
          }
        } else {
          db.deleteScheduledAnnouncement(announcement.id, announcement.guild_id);
        }
      }
    } catch (err) {
      logger.error(`Scheduler error: ${err.message}`);
    }
  }, 60000); // Check every minute
}

module.exports = { startScheduler };
