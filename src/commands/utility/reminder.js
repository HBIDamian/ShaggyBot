const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../../database/database');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('Reminder');

/**
 * Parse a human-readable time string into milliseconds
 * Supports formats like: 1d5h30m, 2w3d, 1h30m, 30s, etc.
 * @param {string} timeStr - The time string to parse
 * @returns {number|null} Milliseconds or null if invalid
 */
function parseTimeString(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') {return null;}

  const regex = /(\d+)\s*(w|weeks?|d|days?|h|hours?|hrs?|m|mins?|minutes?|s|secs?|seconds?)/gi;
  let totalMs = 0;
  let match;
  let foundAny = false;

  while ((match = regex.exec(timeStr)) !== null) {
    foundAny = true;
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    if (unit.startsWith('w')) {
      totalMs += value * 7 * 24 * 60 * 60 * 1000; // weeks
    } else if (unit.startsWith('d')) {
      totalMs += value * 24 * 60 * 60 * 1000; // days
    } else if (unit.startsWith('h')) {
      totalMs += value * 60 * 60 * 1000; // hours
    } else if (unit.startsWith('m')) {
      totalMs += value * 60 * 1000; // minutes
    } else if (unit.startsWith('s')) {
      totalMs += value * 1000; // seconds
    }
  }

  return foundAny ? totalMs : null;
}

/**
 * Format a duration in milliseconds to human-readable string
 * @param {number} ms - Milliseconds
 * @returns {string} Formatted string
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);

  const parts = [];

  if (weeks > 0) {parts.push(`${weeks} week${weeks !== 1 ? 's' : ''}`);}
  if (days % 7 > 0) {parts.push(`${days % 7} day${days % 7 !== 1 ? 's' : ''}`);}
  if (hours % 24 > 0) {parts.push(`${hours % 24} hour${hours % 24 !== 1 ? 's' : ''}`);}
  if (minutes % 60 > 0) {parts.push(`${minutes % 60} minute${minutes % 60 !== 1 ? 's' : ''}`);}
  if (seconds % 60 > 0 && parts.length === 0) {parts.push(`${seconds % 60} second${seconds % 60 !== 1 ? 's' : ''}`);}

  return parts.length > 0 ? parts.join(', ') : 'less than a second';
}

/**
 * Format a date to Discord timestamp
 * @param {Date} date - The date to format
 * @returns {string} Discord timestamp
 */
function formatTimestamp(date) {
  const unix = Math.floor(date.getTime() / 1000);
  return `<t:${unix}:F> (<t:${unix}:R>)`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reminder')
    .setDescription('Set personal reminders that will be sent to you via DM')
    .setDMPermission(true)
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Create a new reminder')
        .addStringOption(option =>
          option
            .setName('time')
            .setDescription('When to remind you (e.g., 1d5h30m, 2w3d, 1h30m)')
            .setRequired(true))
        .addStringOption(option =>
          option
            .setName('message')
            .setDescription('What to remind you about (max 200 characters)')
            .setRequired(true)
            .setMaxLength(200)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List all your current reminders'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('delete')
        .setDescription('Delete a reminder')
        .addIntegerOption(option =>
          option
            .setName('id')
            .setDescription('The reminder ID to delete')
            .setRequired(true))),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'create':
        await handleCreate(interaction);
        break;
      case 'list':
        await handleList(interaction);
        break;
      case 'delete':
        await handleDelete(interaction);
        break;
    }
  },
};

/**
 * Handle the create subcommand
 */
async function handleCreate(interaction) {
  const timeStr = interaction.options.getString('time');
  const message = interaction.options.getString('message');
  const userId = interaction.user.id;

  // Parse the time string
  const durationMs = parseTimeString(timeStr);

  if (!durationMs || durationMs < 1000) {
    return interaction.reply({
      content: '❌ Invalid time format. Use formats like: `1d5h30m`, `2w3d`, `1h30m`, `30s`\n\nExamples:\n• `1w` = 1 week\n• `2d12h` = 2 days and 12 hours\n• `30m` = 30 minutes',
      flags: MessageFlags.Ephemeral
    });
  }

  // Check if duration is too long (max 2 years)
  const maxDuration = 2 * 365 * 24 * 60 * 60 * 1000;
  if (durationMs > maxDuration) {
    return interaction.reply({
      content: '❌ Reminder time cannot be more than 2 years in the future.',
      flags: MessageFlags.Ephemeral
    });
  }

  // Calculate remind time
  const remindAt = new Date(Date.now() + durationMs);

  try {
    // Create the reminder
    const reminder = db.createReminder(userId, message, remindAt);

    const embed = new EmbedBuilder()
      .setTitle('⏰ Reminder Set!')
      .setDescription(`I'll remind you about this via DM.`)
      .addFields(
        { name: '📝 Message', value: message },
        { name: '⏱️ Remind At', value: formatTimestamp(remindAt) },
        { name: '🆔 Reminder ID', value: `${reminder.id}`, inline: true }
      )
      .setColor('#00D166')
      .setFooter({ text: 'Make sure your DMs are open to receive the reminder!' })
      .setTimestamp();

    logger.info(`User ${interaction.user.tag} created reminder #${reminder.id} for ${formatDuration(durationMs)}`);

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    logger.error(`Error creating reminder: ${error.message}`);
    await interaction.reply({
      content: '❌ Failed to create reminder. Please try again.',
      flags: MessageFlags.Ephemeral
    });
  }
}

/**
 * Handle the list subcommand
 */
async function handleList(interaction) {
  const userId = interaction.user.id;

  try {
    const reminders = db.getUserReminders(userId);

    if (reminders.length === 0) {
      return interaction.reply({
        content: '📭 You don\'t have any reminders set. Use `/reminder create` to create one!',
        flags: MessageFlags.Ephemeral
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('⏰ Your Reminders')
      .setDescription(`You have **${reminders.length}** reminder${reminders.length !== 1 ? 's' : ''} set.`)
      .setColor('#5865F2')
      .setFooter({ text: `Use /reminder delete <id> to remove a reminder` })
      .setTimestamp();

    // Add each reminder (max 10 to avoid embed limits)
    const displayReminders = reminders.slice(0, 10);
    for (const reminder of displayReminders) {
      const remindAt = new Date(reminder.remind_at);
      const unix = Math.floor(remindAt.getTime() / 1000);
      const truncatedMessage = reminder.message.length > 100
        ? reminder.message.substring(0, 100) + '...'
        : reminder.message;

      embed.addFields({
        name: `#${reminder.id} - <t:${unix}:R>`,
        value: truncatedMessage,
        inline: false
      });
    }

    if (reminders.length > 10) {
      embed.addFields({
        name: '...',
        value: `And ${reminders.length - 10} more reminder${reminders.length - 10 !== 1 ? 's' : ''}.`,
        inline: false
      });
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } catch (error) {
    logger.error(`Error listing reminders: ${error.message}`);
    await interaction.reply({
      content: '❌ Failed to fetch your reminders. Please try again.',
      flags: MessageFlags.Ephemeral
    });
  }
}

/**
 * Handle the delete subcommand
 */
async function handleDelete(interaction) {
  const reminderId = interaction.options.getInteger('id');
  const userId = interaction.user.id;

  try {
    // Check if reminder exists and belongs to user
    const reminder = db.getReminder(reminderId, userId);

    if (!reminder) {
      return interaction.reply({
        content: `❌ Reminder #${reminderId} not found or doesn't belong to you.`,
        flags: MessageFlags.Ephemeral
      });
    }

    // Delete the reminder
    const success = db.deleteReminder(reminderId, userId);

    if (success) {
      const embed = new EmbedBuilder()
        .setTitle('🗑️ Reminder Deleted')
        .setDescription(`Successfully deleted reminder #${reminderId}.`)
        .addFields({ name: '📝 Message was', value: reminder.message })
        .setColor('#ED4245')
        .setTimestamp();

      logger.info(`User ${interaction.user.tag} deleted reminder #${reminderId}`);

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({
        content: '❌ Failed to delete reminder. Please try again.',
        flags: MessageFlags.Ephemeral
      });
    }
  } catch (error) {
    logger.error(`Error deleting reminder: ${error.message}`);
    await interaction.reply({
      content: '❌ Failed to delete reminder. Please try again.',
      flags: MessageFlags.Ephemeral
    });
  }
}
