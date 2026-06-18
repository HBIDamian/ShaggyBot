const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const { createLogger } = require('../../utils/logger');
const { replyError } = require('../../utils/moderationHelpers');

const logger = createLogger('SlowmodeCommand');

const MAX_SLOWMODE_SECONDS = 21600; // 6 hours

// Parse time string like "1m", "30s", "2h" into seconds
function parseTime(timeStr) {
  // Handle "off" or "0"
  if (timeStr.toLowerCase() === 'off' || timeStr === '0') {return 0;}

  const match = timeStr.match(/^(\d+)([smh]?)$/i);
  if (!match) {return null;}

  const value = parseInt(match[1]);
  const unit = (match[2] || 's').toLowerCase();

  const multipliers = {
    's': 1,
    'm': 60,
    'h': 3600
  };

  return value * multipliers[unit];
}

function formatDuration(seconds) {
  if (seconds === 0) {return 'Off';}
  if (seconds < 60) {return `${seconds} second${seconds > 1 ? 's' : ''}`;}
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    return `${mins} minute${mins > 1 ? 's' : ''}`;
  }
  const hours = Math.floor(seconds / 3600);
  return `${hours} hour${hours > 1 ? 's' : ''}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Set the slowmode for a channel')
    .setDMPermission(false)
    .addStringOption(option =>
      option.setName('time')
        .setDescription('Slowmode duration (e.g., 5s, 1m, 2h) or "off" to disable')
        .setRequired(true))
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel to set slowmode in (defaults to current channel)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildForum, ChannelType.PublicThread, ChannelType.PrivateThread)
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    const timeStr = interaction.options.getString('time');
    const channel = interaction.options.getChannel('channel') || interaction.channel;

    const seconds = parseTime(timeStr);
    if (seconds === null) {
      return replyError(interaction, '❌ Invalid time format. Use formats like: 5s, 1m, 2h, or "off"');
    }

    if (seconds > MAX_SLOWMODE_SECONDS) {
      return replyError(interaction, '❌ Maximum slowmode is 6 hours (21600 seconds).');
    }

    if (!channel.permissionsFor(interaction.client.user).has(PermissionFlagsBits.ManageChannels)) {
      return replyError(interaction, '❌ I don\'t have permission to manage this channel.');
    }

    try {
      await channel.setRateLimitPerUser(seconds, `Set by ${interaction.user.tag}`);

      const embed = new EmbedBuilder()
        .setColor(seconds === 0 ? 0x2ECC71 : 0x3498DB)
        .setTitle(seconds === 0 ? '🏃 Slowmode Disabled' : '🐌 Slowmode Updated')
        .addFields(
          { name: 'Channel', value: `${channel}`, inline: true },
          { name: 'Slowmode', value: formatDuration(seconds), inline: true },
          { name: 'Set By', value: interaction.user.tag, inline: true }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      logger.error(`Error setting slowmode: ${err.message}`);
      return replyError(interaction, '❌ An error occurred while setting slowmode.');
    }
  }
};
