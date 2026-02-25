const { Events, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { createLogger } = require('../utils/logger');
const { markBotAction } = require('./nativeModeration');
const db = require('../database/database');

const logger = createLogger('Honeypot');

module.exports = {
  name: Events.MessageCreate,
  once: false,
  
  async execute(message, client) {
    // Skip bot messages and DMs
    if (message.author.bot || !message.guild) return;

    // Get honeypot settings for this guild
    const settings = db.getHoneypotSettings(message.guild.id);
    
    // Skip if honeypot is disabled or no channel set
    if (!settings.enabled || !settings.honeypot_channel_id) return;

    // Check if this message is in the honeypot channel
    if (message.channel.id !== settings.honeypot_channel_id) return;

    logger.info(`Honeypot triggered by ${message.author.tag} (${message.author.id}) in ${message.guild.name}`);

    const user = message.author;
    const member = message.member;
    const action = settings.action || 'softban';

    // Check if bot can action this user
    const botMember = message.guild.members.me;
    
    // Can't action bots (shouldn't happen as we skip bots earlier)
    if (user.bot) return;

    // Can't action the server owner
    if (message.guild.ownerId === user.id) {
      logger.warn(`Cannot action server owner ${user.tag} who triggered honeypot`);
      await logHoneypotEvent(message, settings, 'failed', 'Cannot action server owner');
      return;
    }

    // Check role hierarchy
    if (member && botMember.roles.highest.position <= member.roles.highest.position) {
      logger.warn(`Cannot action ${user.tag} - role hierarchy issue`);
      await logHoneypotEvent(message, settings, 'failed', 'My role is not high enough to action this user');
      return;
    }

    // Check if bot has ban permission
    if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
      logger.warn(`Cannot action ${user.tag} - missing Ban Members permission`);
      await logHoneypotEvent(message, settings, 'failed', 'Missing Ban Members permission');
      return;
    }

    try {
      // Try to DM the user first (if enabled)
      if (settings.dm_user) {
        try {
          const dmEmbed = new EmbedBuilder()
            .setColor(0xFF6B6B)
            .setTitle('🍯 Honeypot Triggered')
            .setDescription(`You have been ${getActionPastTense(action)} from **${message.guild.name}** for sending a message in a honeypot channel.`)
            .addFields(
              { name: 'What is a honeypot?', value: 'A honeypot is a trap channel designed to catch spam bots. Legitimate users should never send messages in these channels.' }
            )
            .setFooter({ text: 'If you believe this was a mistake, please contact the server administrators.' })
            .setTimestamp();

          await user.send({ embeds: [dmEmbed] });
        } catch (dmErr) {
          logger.debug(`Could not DM user ${user.tag}: ${dmErr.message}`);
        }
      }

      // Delete the message
      try {
        await message.delete();
      } catch (delErr) {
        logger.debug(`Could not delete honeypot message: ${delErr.message}`);
      }

      // Mark bot action to prevent duplicate logging
      markBotAction(message.guild.id, user.id, action === 'softban' ? 'ban' : action);
      if (action === 'softban') {
        markBotAction(message.guild.id, user.id, 'unban');
      }

      // Execute the action
      const deleteMessageSeconds = 3600; // Always delete 1 hour of messages from the spammer
      const reason = `Triggered honeypot channel | Action: ${action}`;

      switch (action) {
        case 'ban':
          await message.guild.members.ban(user.id, {
            reason,
            deleteMessageSeconds
          });
          break;
          
        case 'softban':
          // Softban: ban then immediately unban (deletes messages)
          await message.guild.members.ban(user.id, {
            reason: `${reason} (softban 1/2)`,
            deleteMessageSeconds
          });
          // Small delay to ensure ban is processed
          await new Promise(resolve => setTimeout(resolve, 1000));
          await message.guild.members.unban(user.id, `${reason} (softban 2/2) - unbanning`);
          break;
          
        case 'kick':
          if (member) {
            await member.kick(reason);
          }
          break;
          
        default:
          logger.warn(`Unknown honeypot action: ${action}`);
          return;
      }

      // Log the mod action
      db.logModAction(message.guild.id, user.id, client.user.id, action === 'softban' ? 'softban' : action, reason);

      // Purge the honeypot channel so only the warning embed remains visible
      if (settings.keep_channel_empty) {
        try {
          const fetched = await message.channel.messages.fetch({ limit: 100 });
          const toDelete = fetched.filter(m => m.id !== settings.embed_message_id);
          if (toDelete.size > 0) {
            await message.channel.bulkDelete(toDelete, true).catch(() => {});
          }
        } catch (purgeErr) {
          logger.debug(`Could not purge honeypot channel: ${purgeErr.message}`);
        }
      }

      // Log to the log channel
      await logHoneypotEvent(message, settings, 'success', null, action);

      logger.info(`Honeypot action completed: ${action} on ${user.tag} in ${message.guild.name}`);

    } catch (err) {
      logger.error(`Error executing honeypot action: ${err.message}`);
      await logHoneypotEvent(message, settings, 'failed', err.message);
    }
  }
};

/**
 * Log honeypot event to the log channel
 */
async function logHoneypotEvent(message, settings, status, errorReason = null, action = null) {
  if (!settings.log_channel_id) return;

  try {
    const logChannel = await message.guild.channels.fetch(settings.log_channel_id).catch(() => null);
    if (!logChannel) return;

    const user = message.author;
    const embed = new EmbedBuilder()
      .setTimestamp();

    if (status === 'success') {
      embed
        .setColor(0xFF6B6B)
        .setTitle('🍯 Honeypot Triggered')
        .setDescription(`A user was caught by the honeypot and ${getActionPastTense(action)}.`)
        .addFields(
          { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
          { name: 'Action', value: capitalizeFirst(action), inline: true },
          { name: 'Channel', value: `<#${settings.honeypot_channel_id}>`, inline: true }
        );

      if (message.content) {
        embed.addFields({
          name: 'Message Content',
          value: message.content.length > 1000 
            ? message.content.substring(0, 1000) + '...' 
            : message.content || '*No text content*'
        });
      }

      embed.setThumbnail(user.displayAvatarURL({ dynamic: true }));

    } else if (status === 'failed') {
      embed
        .setColor(0xFFA500)
        .setTitle('⚠️ Honeypot Trigger Failed')
        .setDescription(`A user triggered the honeypot but could not be actioned.`)
        .addFields(
          { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
          { name: 'Reason', value: errorReason || 'Unknown error', inline: false }
        );
    }

    await logChannel.send({ embeds: [embed] });

  } catch (err) {
    logger.error(`Error logging honeypot event: ${err.message}`);
  }
}

/**
 * Get past tense of action
 */
function getActionPastTense(action) {
  switch (action) {
    case 'ban': return 'banned';
    case 'softban': return 'softbanned';
    case 'kick': return 'kicked';
    default: return 'actioned';
  }
}

/**
 * Capitalize first letter
 */
function capitalizeFirst(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}
