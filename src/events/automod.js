const { Events, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { createLogger } = require('../utils/logger');
const phishingList = require('../utils/phishingList');
const db = require('../database/database');

const logger = createLogger('AutoMod');

// Initialize phishing list on load
phishingList.initialize().catch(err => {
  logger.error(`Failed to initialize phishing list: ${err.message}`);
});

// Spam tracking: Map<guildId, Map<userId, { messages: timestamp[], lastWarning: timestamp }>>
const spamTracker = new Map();

// Regex patterns
const INVITE_REGEX = /(discord\.(gg|io|me|li|com\/invite)|discordapp\.com\/invite)\/[a-zA-Z0-9]+/gi;
const URL_REGEX = /https?:\/\/[^\s]+/gi;
const PHONE_REGEX = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const MARKDOWN_HEADER_REGEX = /^#{1,3}\s+.+$/gm;
const SPOILER_REGEX = /\|\|.+?\|\|/gs;
const ZALGO_REGEX = /[\u0300-\u036f\u0489]/g;
const EMOJI_REGEX = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]|<a?:\w+:\d+>)/gi;

// Default bad words list (common slurs and inappropriate terms)
const DEFAULT_BAD_WORDS = [
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'retarded', 'kys',
  'tranny', 'chink', 'spic', 'kike', 'dyke', 'coon', 'wetback'
];

module.exports = {
  name: Events.MessageCreate,
  once: false,
  
  async execute(message, client) {
    // Skip bot messages and DMs
    if (message.author.bot || !message.guild) return;

    // Get automod settings for this guild
    const settings = db.getAutomodSettings(message.guild.id);
    
    // Skip if automod is disabled
    if (!settings.enabled) {
      logger.debug(`AutoMod disabled for guild ${message.guild.id}`);
      return;
    }

    // Check exemptions
    const memberRoles = message.member?.roles.cache.map(r => r.id) || [];
    
    // Check if user is exempt
    const isRoleExempt = settings.exempt_roles.some(roleId => memberRoles.includes(roleId));
    const isChannelExempt = settings.exempt_channels.includes(message.channel.id);
    
    // Check permission-based exemptions
    const isAdmin = message.member?.permissions.has(PermissionFlagsBits.Administrator);
    const isMod = message.member?.permissions.has(PermissionFlagsBits.ManageMessages) || 
                  message.member?.permissions.has(PermissionFlagsBits.ModerateMembers);
    const isBot = message.author.bot;
    
    if (isRoleExempt || isChannelExempt) {
      logger.debug(`User ${message.author.tag} exempt (role/channel)`);
      return;
    }
    if (settings.exclude_admins && isAdmin) {
      logger.debug(`User ${message.author.tag} exempt (admin)`);
      return;
    }
    if (settings.exclude_mods && isMod) {
      logger.debug(`User ${message.author.tag} exempt (mod)`);
      return;
    }
    if (settings.exclude_bots && isBot) return;

    logger.debug(`Checking message from ${message.author.tag}: "${message.content.substring(0, 50)}..."`);

    // Run all checks
    const violations = [];

    // Phishing URLs (check first - most dangerous)
    if (settings.phishing_enabled) {
      const result = checkPhishing(message, settings);
      if (result) violations.push(result);
    }

    // Anti-spam check
    if (settings.spam_enabled) {
      const result = checkSpam(message, settings);
      if (result) violations.push(result);
    }

    // Bad words check
    if (settings.bad_words_enabled) {
      const result = checkBadWords(message, settings);
      if (result) violations.push(result);
    }

    // Mass Caps check
    if (settings.caps_enabled) {
      const result = checkCaps(message, settings);
      if (result) violations.push(result);
    }

    // Duplicate Characters check
    if (settings.duplicate_chars_enabled) {
      const result = checkDuplicateChars(message, settings);
      if (result) violations.push(result);
    }

    // Duplicate Words check
    if (settings.duplicate_words_enabled) {
      const result = checkDuplicateWords(message, settings);
      if (result) violations.push(result);
    }

    // Mass Mentions check
    if (settings.mass_mentions_enabled) {
      const result = checkMentions(message, settings);
      if (result) violations.push(result);
    }

    // Mass Emoji check
    if (settings.mass_emoji_enabled) {
      const result = checkMassEmoji(message, settings);
      if (result) violations.push(result);
    }

    // Spoilers check
    if (settings.spoilers_enabled) {
      const result = checkSpoilers(message, settings);
      if (result) violations.push(result);
    }

    // Discord Invites check
    if (settings.invites_enabled) {
      const result = checkInvites(message, settings, client);
      if (result) violations.push(result);
    }

    // Website URLs check
    if (settings.links_enabled) {
      const result = checkLinks(message, settings);
      if (result) violations.push(result);
    }

    // File Extensions check
    if (settings.file_extensions_enabled) {
      const result = checkFileExtensions(message, settings);
      if (result) violations.push(result);
    }

    // Stickers check
    if (settings.stickers_enabled) {
      const result = checkStickers(message, settings);
      if (result) violations.push(result);
    }

    // Zalgo Text check
    if (settings.zalgo_enabled) {
      const result = checkZalgo(message, settings);
      if (result) violations.push(result);
    }

    // Phone Numbers check
    if (settings.phone_numbers_enabled) {
      const result = checkPhoneNumbers(message, settings);
      if (result) violations.push(result);
    }

    // Markdown Headers check
    if (settings.markdown_headers_enabled) {
      const result = checkMarkdownHeaders(message, settings);
      if (result) violations.push(result);
    }

    // Process violations (handle the most severe one)
    if (violations.length > 0) {
      // Sort by severity: ban > kick > mute > delete_warn > delete
      const severityOrder = { ban: 5, kick: 4, mute: 3, delete_warn: 2, delete: 1 };
      violations.sort((a, b) => (severityOrder[b.action] || 0) - (severityOrder[a.action] || 0));
      
      const violation = violations[0];
      await handleViolation(message, violation, settings, client);
    }
  }
};

/**
 * Check for phishing URLs using the dynamic phishing list
 */
function checkPhishing(message, settings) {
  if (phishingList.containsPhishing(message.content)) {
    return {
      type: 'phishing',
      action: settings.phishing_action,
      reason: 'Message contained known phishing/scam link',
      deleteMessage: true
    };
  }
  
  return null;
}

/**
 * Check for spam
 */
function checkSpam(message, settings) {
  const guildId = message.guild.id;
  const userId = message.author.id;
  const now = Date.now();
  
  if (!spamTracker.has(guildId)) {
    spamTracker.set(guildId, new Map());
  }
  
  const guildTracker = spamTracker.get(guildId);
  
  if (!guildTracker.has(userId)) {
    guildTracker.set(userId, { messages: [], lastWarning: 0 });
  }
  
  const userTracker = guildTracker.get(userId);
  
  // Clean old messages
  userTracker.messages = userTracker.messages.filter(
    timestamp => now - timestamp < settings.spam_interval
  );
  
  userTracker.messages.push(now);
  
  if (userTracker.messages.length >= settings.spam_threshold) {
    if (now - userTracker.lastWarning < 10000) return null;
    userTracker.lastWarning = now;
    userTracker.messages = [];
    
    return {
      type: 'spam',
      action: settings.spam_action,
      reason: `Sending ${settings.spam_threshold}+ messages in ${settings.spam_interval / 1000}s`,
      deleteMessage: true
    };
  }
  
  return null;
}

/**
 * Check for bad words
 */
function checkBadWords(message, settings) {
  const content = message.content.toLowerCase();
  
  // Combine default list (if enabled) with custom list
  let wordList = [...(settings.bad_words_list || [])];
  if (settings.bad_words_use_default) {
    wordList = [...DEFAULT_BAD_WORDS, ...wordList];
  }
  
  if (wordList.length === 0) return null;
  
  for (const word of wordList) {
    // Use word boundary check for more accurate matching
    const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(content)) {
      return {
        type: 'bad_word',
        action: settings.bad_words_action,
        reason: 'Message contained blocked word',
        deleteMessage: true
      };
    }
  }
  
  return null;
}

/**
 * Check for excessive caps
 */
function checkCaps(message, settings) {
  const content = message.content;
  
  if (content.length < settings.caps_min_chars) return null;
  
  const letters = content.replace(/[^a-zA-Z]/g, '');
  if (letters.length === 0) return null;
  
  const uppercase = letters.replace(/[^A-Z]/g, '').length;
  const capsPercentage = (uppercase / letters.length) * 100;
  
  if (capsPercentage >= settings.caps_percentage) {
    return {
      type: 'caps',
      action: settings.caps_action,
      reason: `Message contained ${Math.round(capsPercentage)}% caps (max: ${settings.caps_percentage}%)`,
      deleteMessage: true
    };
  }
  
  return null;
}

/**
 * Check for duplicate characters
 */
function checkDuplicateChars(message, settings) {
  const content = message.content;
  
  // Find repeated characters
  const regex = new RegExp(`(.)\\1{${settings.duplicate_chars_min - 1},}`, 'gi');
  const matches = content.match(regex);
  
  if (matches) {
    const totalRepeated = matches.reduce((sum, m) => sum + m.length, 0);
    const percentage = (totalRepeated / content.length) * 100;
    
    if (percentage >= settings.duplicate_chars_percentage) {
      return {
        type: 'duplicate_chars',
        action: settings.duplicate_chars_action,
        reason: 'Message contained excessive repeated characters',
        deleteMessage: true
      };
    }
  }
  
  return null;
}

/**
 * Check for duplicate words
 */
function checkDuplicateWords(message, settings) {
  const words = message.content.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  
  if (words.length < settings.duplicate_words_count) return null;
  
  // Count consecutive duplicates
  let maxDuplicates = 1;
  let currentCount = 1;
  
  for (let i = 1; i < words.length; i++) {
    if (words[i] === words[i - 1]) {
      currentCount++;
      maxDuplicates = Math.max(maxDuplicates, currentCount);
    } else {
      currentCount = 1;
    }
  }
  
  if (maxDuplicates >= settings.duplicate_words_count) {
    return {
      type: 'duplicate_words',
      action: settings.duplicate_words_action,
      reason: `Message contained ${maxDuplicates} repeated words (max: ${settings.duplicate_words_count})`,
      deleteMessage: true
    };
  }
  
  return null;
}

/**
 * Check for mass mentions
 */
function checkMentions(message, settings) {
  const mentionCount = message.mentions.users.size + message.mentions.roles.size;
  
  if (mentionCount >= settings.mass_mentions_count) {
    return {
      type: 'mentions',
      action: settings.mass_mentions_action,
      reason: `Message contained ${mentionCount} mentions (max: ${settings.mass_mentions_count})`,
      deleteMessage: true
    };
  }
  
  return null;
}

/**
 * Check for mass emoji
 */
function checkMassEmoji(message, settings) {
  const emojis = message.content.match(EMOJI_REGEX) || [];
  
  if (emojis.length >= settings.mass_emoji_count) {
    return {
      type: 'mass_emoji',
      action: settings.mass_emoji_action,
      reason: `Message contained ${emojis.length} emojis (max: ${settings.mass_emoji_count})`,
      deleteMessage: true
    };
  }
  
  return null;
}

/**
 * Check for spoilers
 */
function checkSpoilers(message, settings) {
  const matches = message.content.match(SPOILER_REGEX);
  
  if (matches) {
    const totalSpoilerLength = matches.reduce((sum, m) => sum + m.length - 4, 0); // -4 for |||| markers
    
    if (totalSpoilerLength >= settings.spoilers_min_chars) {
      return {
        type: 'spoilers',
        action: settings.spoilers_action,
        reason: 'Message contained spoiler content',
        deleteMessage: true
      };
    }
  }
  
  return null;
}

/**
 * Check for Discord invites
 */
async function checkInvites(message, settings, client) {
  const inviteMatches = message.content.match(INVITE_REGEX);
  
  if (!inviteMatches) return null;
  
  // If ignoring partner/verified, we need to check the invites
  if (settings.invites_ignore_partners || settings.invites_ignore_verified) {
    for (const inviteMatch of inviteMatches) {
      try {
        const code = inviteMatch.split('/').pop();
        const invite = await client.fetchInvite(code).catch(() => null);
        
        if (invite && invite.guild) {
          const features = invite.guild.features || [];
          if (settings.invites_ignore_partners && features.includes('PARTNERED')) continue;
          if (settings.invites_ignore_verified && features.includes('VERIFIED')) continue;
        }
        
        // This invite is not exempt
        return {
          type: 'invite',
          action: settings.invites_action,
          reason: 'Message contained Discord invite link',
          deleteMessage: true
        };
      } catch {
        // Invalid invite, still block it
        return {
          type: 'invite',
          action: settings.invites_action,
          reason: 'Message contained Discord invite link',
          deleteMessage: true
        };
      }
    }
    return null;
  }
  
  return {
    type: 'invite',
    action: settings.invites_action,
    reason: 'Message contained Discord invite link',
    deleteMessage: true
  };
}

/**
 * Check for links
 */
function checkLinks(message, settings) {
  const urls = message.content.match(URL_REGEX);
  
  if (!urls || urls.length === 0) return null;
  
  const whitelist = settings.links_whitelist || [];
  
  for (const url of urls) {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.replace('www.', '');
      
      const isWhitelisted = whitelist.some(w => 
        domain === w || domain.endsWith('.' + w)
      );
      
      // In whitelist mode: only allow whitelisted domains
      // In blacklist mode (default): allow everything except blocked
      if (settings.links_whitelist_mode) {
        if (!isWhitelisted) {
          return {
            type: 'link',
            action: settings.links_action,
            reason: 'Message contained non-whitelisted link',
            deleteMessage: true
          };
        }
      } else {
        // Block all links if no whitelist configured
        if (whitelist.length === 0 || !isWhitelisted) {
          return {
            type: 'link',
            action: settings.links_action,
            reason: 'Message contained blocked link',
            deleteMessage: true
          };
        }
      }
    } catch {
      return {
        type: 'link',
        action: settings.links_action,
        reason: 'Message contained invalid link',
        deleteMessage: true
      };
    }
  }
  
  return null;
}

/**
 * Check for blocked file extensions (supports whitelist/blacklist mode)
 */
function checkFileExtensions(message, settings) {
  if (message.attachments.size === 0) return null;
  
  const extensionsList = settings.file_extensions_list || [];
  if (extensionsList.length === 0) return null;
  
  const isWhitelistMode = settings.file_extensions_whitelist_mode;
  
  for (const attachment of message.attachments.values()) {
    const fileName = attachment.name.toLowerCase();
    const ext = '.' + fileName.split('.').pop();
    
    const matchesExtension = extensionsList.some(listed => 
      fileName.endsWith(listed) || ext === listed || ext === '.' + listed.replace(/^\./, '')
    );
    
    // In whitelist mode: block if NOT in list
    // In blacklist mode: block if IS in list
    if (isWhitelistMode ? !matchesExtension : matchesExtension) {
      const reason = isWhitelistMode 
        ? `File type not allowed (${ext})`
        : `Blocked file type (${ext})`;
      
      return {
        type: 'file_extension',
        action: settings.file_extensions_action,
        reason: reason,
        deleteMessage: true
      };
    }
  }
  
  return null;
}

/**
 * Check for stickers
 */
function checkStickers(message, settings) {
  if (message.stickers.size > 0) {
    return {
      type: 'sticker',
      action: settings.stickers_action,
      reason: 'Message contained sticker',
      deleteMessage: true
    };
  }
  
  return null;
}

/**
 * Check for Zalgo text
 */
function checkZalgo(message, settings) {
  const zalgoChars = message.content.match(ZALGO_REGEX);
  
  // If more than 10% of characters are zalgo combining marks
  if (zalgoChars && zalgoChars.length > message.content.length * 0.1) {
    return {
      type: 'zalgo',
      action: settings.zalgo_action,
      reason: 'Message contained zalgo/glitch text',
      deleteMessage: true
    };
  }
  
  return null;
}

/**
 * Check for phone numbers
 */
function checkPhoneNumbers(message, settings) {
  if (PHONE_REGEX.test(message.content)) {
    return {
      type: 'phone_number',
      action: settings.phone_numbers_action,
      reason: 'Message contained phone number',
      deleteMessage: true
    };
  }
  
  return null;
}

/**
 * Check for markdown headers
 */
function checkMarkdownHeaders(message, settings) {
  if (MARKDOWN_HEADER_REGEX.test(message.content)) {
    return {
      type: 'markdown_header',
      action: settings.markdown_headers_action,
      reason: 'Message contained markdown headers',
      deleteMessage: true
    };
  }
  
  return null;
}

/**
 * Handle a violation
 */
async function handleViolation(message, violation, settings, client) {
  const { type, action, reason } = violation;
  
  logger.info(`AutoMod: ${type} violation by ${message.author.tag} in ${message.guild.name} - Action: ${action}`);
  
  // Determine if message should be deleted based on action
  const shouldDelete = action.includes('delete') || action === 'ban';
  
  try {
    // Delete message if needed
    if (shouldDelete && message.deletable) {
      await message.delete().catch(() => {});
    }
    
    // Log the mod action
    db.logModAction(
      message.guild.id,
      message.author.id,
      null,
      `automod_${type}`,
      reason
    );
    
    // Perform the action
    switch (action) {
      case 'delete':
        // Already deleted above
        break;
        
      case 'warn':
        await sendWarning(message, reason);
        db.addWarning(message.guild.id, message.author.id, client.user.id, `[AutoMod] ${reason}`);
        break;
        
      case 'delete_warn':
        await sendWarning(message, reason);
        db.addWarning(message.guild.id, message.author.id, client.user.id, `[AutoMod] ${reason}`);
        break;
        
      case 'delete_timeout':
        await timeoutUser(message, reason, 60 * 60 * 1000); // 1 hour
        break;
        
      case 'delete_kick':
        await kickUser(message, reason, false);
        break;
        
      case 'delete_kick_warn':
        db.addWarning(message.guild.id, message.author.id, client.user.id, `[AutoMod] ${reason}`);
        await kickUser(message, reason, true);
        break;
        
      case 'ban':
        await banUser(message, reason);
        break;
    }
    
    // Send to automod log channel if configured
    if (settings.log_channel) {
      await sendAutomodLog(message, violation, settings.log_channel, client);
    }
    
  } catch (error) {
    logger.error(`AutoMod action error: ${error.message}`);
  }
}

/**
 * Send a warning to the user
 */
async function sendWarning(message, reason) {
  try {
    await message.channel.send({
      content: `⚠️ ${message.author}, ${reason}. Please follow the server rules.`,
      allowedMentions: { users: [message.author.id] }
    }).then(msg => {
      setTimeout(() => msg.delete().catch(() => {}), 10000);
    });
  } catch (error) {
    logger.error(`Failed to send warning: ${error.message}`);
  }
}

/**
 * Timeout user for specified duration
 */
async function timeoutUser(message, reason, duration = 60 * 60 * 1000) {
  try {
    if (message.member.moderatable) {
      await message.member.timeout(duration, `[AutoMod] ${reason}`);
      const hours = Math.round(duration / (60 * 60 * 1000));
      await message.channel.send({
        content: `⏱️ ${message.author} has been timed out for ${hours} hour(s). Reason: ${reason}`,
        allowedMentions: { users: [] }
      }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 10000));
    }
  } catch (error) {
    logger.error(`Failed to timeout user: ${error.message}`);
  }
}

/**
 * Kick user
 */
async function kickUser(message, reason, warned = false) {
  try {
    if (message.member.kickable) {
      await message.author.send({
        content: `You have been kicked from **${message.guild.name}** by AutoMod.\nReason: ${reason}`
      }).catch(() => {});
      
      await message.member.kick(`[AutoMod] ${reason}`);
      const warnText = warned ? ' (+ warning added)' : '';
      await message.channel.send({
        content: `👢 ${message.author.tag} has been kicked by AutoMod${warnText}. Reason: ${reason}`,
        allowedMentions: { users: [] }
      }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 10000));
    }
  } catch (error) {
    logger.error(`Failed to kick user: ${error.message}`);
  }
}

/**
 * Ban user (delete 24h of messages)
 */
async function banUser(message, reason) {
  try {
    if (message.member.bannable) {
      await message.author.send({
        content: `You have been banned from **${message.guild.name}** by AutoMod.\nReason: ${reason}`
      }).catch(() => {});
      
      await message.member.ban({ reason: `[AutoMod] ${reason}`, deleteMessageSeconds: 24 * 60 * 60 }); // 24 hours
      await message.channel.send({
        content: `🔨 ${message.author.tag} has been banned by AutoMod. Reason: ${reason}`,
        allowedMentions: { users: [] }
      }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 10000));
    }
  } catch (error) {
    logger.error(`Failed to ban user: ${error.message}`);
  }
}

/**
 * Send automod log embed
 */
async function sendAutomodLog(message, violation, channelId, client) {
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;
    
    const actionColors = {
      delete: 0xfee75c,        // Yellow
      warn: 0xf97316,          // Orange
      delete_warn: 0xf97316,   // Orange
      delete_timeout: 0xeb4899, // Pink
      delete_kick: 0xed4245,   // Red
      delete_kick_warn: 0xed4245, // Red
      ban: 0x000000            // Black
    };
    
    const actionEmojis = {
      delete: '🗑️',
      warn: '⚠️',
      delete_warn: '🗑️⚠️',
      delete_timeout: '⏱️',
      delete_kick: '👢',
      delete_kick_warn: '👢⚠️',
      ban: '🔨'
    };
    
    const actionLabels = {
      delete: 'Delete Message',
      warn: 'Warn User',
      delete_warn: 'Delete & Warn',
      delete_timeout: 'Delete & Timeout (1h)',
      delete_kick: 'Delete & Kick',
      delete_kick_warn: 'Delete & Kick + Warn',
      ban: 'Ban (Delete 24h)'
    };
    
    const shouldDelete = violation.action.includes('delete') || violation.action === 'ban';
    
    const embed = new EmbedBuilder()
      .setColor(actionColors[violation.action] || 0xed4245)
      .setTitle(`${actionEmojis[violation.action] || '🛡️'} AutoMod: ${violation.type.replace(/_/g, ' ').toUpperCase()}`)
      .setDescription(`Action taken against ${message.author}`)
      .addFields(
        { name: 'User', value: `${message.author.tag}\n\`${message.author.id}\``, inline: true },
        { name: 'Punishment', value: actionLabels[violation.action] || violation.action.replace(/_/g, ' ').toUpperCase(), inline: true },
        { name: 'Channel', value: `${message.channel}`, inline: true },
        { name: 'Reason', value: violation.reason }
      )
      .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
      .setTimestamp()
      .setFooter({ text: 'ShaggyBot AutoMod' });
    
    if (shouldDelete && message.content) {
      embed.addFields({
        name: 'Deleted Message',
        value: message.content.substring(0, 1000) || '[No text content]'
      });
    }
    
    await channel.send({ embeds: [embed] });
  } catch (error) {
    logger.error(`Failed to send automod log: ${error.message}`);
  }
}
