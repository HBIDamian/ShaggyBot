const { Events, EmbedBuilder, AuditLogEvent, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { createLogger } = require('../utils/logger');
const db = require('../database/database');

const logger = createLogger('AuditLog');

/**
 * Helper function to send audit log embed
 */
async function sendAuditLog(guild, channelId, embed, row = null, files = []) {
  if (!channelId) {return;}

  try {
    const channel = guild.channels.cache.get(channelId);
    if (channel) {
      const payload = { embeds: [embed] };
      if (row) payload.components = [row];
      if (files.length > 0) payload.files = files;
      await channel.send(payload);
    }
  } catch (error) {
    logger.error(`Failed to send audit log: ${error.message}`);
  }
}

/**
 * Check if event should be ignored based on settings
 */
function shouldIgnore(settings, member, channelId) {
  // Check ignored channels
  if (channelId && settings.ignored_channels.includes(channelId)) {
    return true;
  }

  // Check ignored roles
  if (member && member.roles) {
    const memberRoles = member.roles.cache?.map(r => r.id) || [];
    if (settings.ignored_roles.some(roleId => memberRoles.includes(roleId))) {
      return true;
    }
  }

  return false;
}

/**
 * Convert hex color string to integer
 */
function colorToInt(colorString) {
  if (!colorString) {return 0x5865F2;}
  return parseInt(colorString.replace('#', ''), 16);
}

/**
 * Format a Date to "DD/MM/YYYY HH:MM:SS +00:00"
 */
function formatDateUTC(date) {
  const pad = n => String(n).padStart(2, '0');
  const d = new Date(date);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +00:00`;
}

/**
 * Format a duration in ms to "X years, X months, X days, X hours, X minutes and X seconds"
 */
function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);

  const years = Math.floor(totalDays / 365);
  const months = Math.floor((totalDays % 365) / 30);
  const days = Math.floor((totalDays % 365) % 30);
  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;
  const seconds = totalSeconds % 60;

  const parts = [];
  if (years > 0) parts.push(`${years} year${years !== 1 ? 's' : ''}`);
  if (months > 0) parts.push(`${months} month${months !== 1 ? 's' : ''}`);
  if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
  parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);

  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

// ==================== USER EVENTS ====================

// ==================== DELETION POOL ====================
// Batches individual messageDelete events so a purge/ban doesn't spam the log channel.
// All deletes within DEBOUNCE_MS of each other in a guild are collected into one log.

const DEBOUNCE_MS = 2500;
const deletionPool = new Map(); // guildId -> { messages: [], timer, settings, guild }

function poolMessage(guild, settings, msgData) {
  let pool = deletionPool.get(guild.id);
  if (!pool) {
    pool = { messages: [], timer: null, settings, guild };
    deletionPool.set(guild.id, pool);
  }
  pool.messages.push(msgData);
  clearTimeout(pool.timer);
  pool.timer = setTimeout(() => flushDeletionPool(guild.id), DEBOUNCE_MS);
}

async function flushDeletionPool(guildId) {
  const pool = deletionPool.get(guildId);
  if (!pool || pool.messages.length === 0) {return;}
  deletionPool.delete(guildId);

  const { messages, settings, guild } = pool;
  const count = messages.length;

  // --- Build .txt attachment ---
  const lines = [
    '=== Deleted Messages Log ===',
    `Guild: ${guild.name} (${guild.id})`,
    `Logged at: ${new Date().toUTCString()}`,
    '',
  ];
  for (const msg of messages) {
    lines.push(`[#${msg.channelName}] ${msg.authorTag} (${msg.authorId}) — Message ID: ${msg.id}`);
    lines.push(`Content: ${msg.content || '(no text content)'}`);
    if (msg.attachments.length > 0) {
      lines.push(`Attachments: ${msg.attachments.join(', ')}`);
    }
    lines.push('');
  }
  const txtBuffer = Buffer.from(lines.join('\n'), 'utf-8');
  const attachment = new AttachmentBuilder(txtBuffer, { name: 'deleted-messages.txt' });

  // --- Build embed ---
  const uniqueChannels = [...new Map(messages.map(m => [m.channelId, m.channelMention])).values()];
  const uniqueUsers   = [...new Map(messages.map(m => [m.authorId,  `${m.authorTag} (${m.authorId})`])).values()];

  const channelsValue = uniqueChannels.join('\n').slice(0, 1024) || 'Unknown';
  const usersValue    = uniqueUsers.join('\n').slice(0, 1024)    || 'Unknown';

  const embed = new EmbedBuilder()
    .setTitle(`🗑️ ${count} Message${count !== 1 ? 's' : ''} Deleted`)
    .setColor(colorToInt(settings.message_deleted_color))
    .addFields(
      { name: 'Messages', value: `${count}`, inline: true },
      { name: `Channel${uniqueChannels.length !== 1 ? 's' : ''}`, value: channelsValue, inline: true },
      { name: `User${uniqueUsers.length !== 1 ? 's' : ''}`, value: usersValue, inline: true }
    )
    .setDescription('Full context in the file below.')
    .setFooter({ text: `Guild ID: ${guild.id}` })
    .setTimestamp();

  // Send embed first, then the file so it appears below the embed
  const channel = guild.channels.cache.get(settings.message_deleted_channel);
  if (channel) {
    try {
      await channel.send({ embeds: [embed] });
      await channel.send({ files: [attachment] });
    } catch (error) {
      logger.error(`Failed to send deletion log: ${error.message}`);
    }
  }
}

module.exports = {
  // Guild Member Add (User Join)
  guildMemberAdd: {
    name: Events.GuildMemberAdd,
    once: false,
    async execute(member) {
      const settings = db.getAuditLogSettings(member.guild.id);
      if (!settings.enabled || !settings.user_join_enabled) {return;}
      if (shouldIgnore(settings, member)) {return;}

      const createdTs = Math.floor(member.user.createdTimestamp / 1000);

      const embed = new EmbedBuilder()
        .setAuthor({ name: member.guild.name, iconURL: member.guild.iconURL({ dynamic: true }) ?? undefined })
        .setTitle('👋 Member Joined')
        .setDescription(`**User Joined:** ${member.user} (${member.user.username})`)
        .setColor(colorToInt(settings.user_join_color))
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: 'Account Created On:', value: `Created on <t:${createdTs}:F>. That's <t:${createdTs}:R>!` }
        )
        .setFooter({ text: `User ID: ${member.user.id} • Guild ID: ${member.guild.id}` })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`audit_kick_${member.user.id}`)
          .setLabel('Kick User')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`audit_ban_${member.user.id}`)
          .setLabel('Ban User')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`audit_timeout1h_${member.user.id}`)
          .setLabel('Timeout 1 Hour')
          .setStyle(ButtonStyle.Danger)
      );

      await sendAuditLog(member.guild, settings.user_join_channel, embed, row);
    }
  },

  // Guild Member Remove (User Leave)
  guildMemberRemove: {
    name: Events.GuildMemberRemove,
    once: false,
    async execute(member) {
      const settings = db.getAuditLogSettings(member.guild.id);
      if (!settings.enabled || !settings.user_leave_enabled) {return;}
      if (shouldIgnore(settings, member)) {return;}

      // Joined Guild field
      const joinedField = member.joinedAt
        ? `${formatDateUTC(member.joinedAt)} (<t:${Math.floor(member.joinedTimestamp / 1000)}:R>)`
        : 'Unknown';

      // Stayed For field
      const stayedFor = member.joinedAt
        ? formatDuration(Date.now() - member.joinedTimestamp)
        : 'Unknown';

      // Roles field
      const roleNames = member.roles.cache
        .filter(r => r.id !== member.guild.id)
        .sort((a, b) => b.position - a.position)
        .map(r => r.name);
      const roleCount = roleNames.length;
      let rolesValue = roleCount > 0 ? roleNames.join(', ') : 'None';
      if (rolesValue.length > 1000) rolesValue = rolesValue.slice(0, 997) + '...';

      // Check audit log for kick or ban (moderation-triggered leave)
      let modActionName = null;
      let modReason = null;
      let modExecutor = null;
      try {
        const kickLogs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 5 });
        const kickEntry = kickLogs.entries.find(
          e => e.target?.id === member.user.id && Date.now() - e.createdTimestamp < 10000
        );
        if (kickEntry) {
          modActionName = 'Kick';
          modReason = kickEntry.reason || 'No reason provided';
          modExecutor = kickEntry.executor;
        }
      } catch { /* audit log access denied or unavailable */ }

      if (!modActionName) {
        try {
          const banLogs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 5 });
          const banEntry = banLogs.entries.find(
            e => e.target?.id === member.user.id && Date.now() - e.createdTimestamp < 10000
          );
          if (banEntry) {
            modActionName = 'Ban';
            modReason = banEntry.reason || 'No reason provided';
            modExecutor = banEntry.executor;
          }
        } catch { /* audit log access denied or unavailable */ }
      }

      const embed = new EmbedBuilder()
        .setAuthor({ name: member.guild.name, iconURL: member.guild.iconURL({ dynamic: true }) ?? undefined })
        .setTitle('👋 Member Left')
        .setDescription(`**User Left:** ${member.user} (${member.user.username})`)
        .setColor(colorToInt(settings.user_leave_color))
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: 'Joined Guild', value: joinedField },
          { name: 'Stayed For', value: stayedFor },
          { name: `Roles [${roleCount}]`, value: `\`\`\`${rolesValue}\`\`\`` }
        )
        .setFooter({ text: `User ID: ${member.user.id} • Guild ID: ${member.guild.id}` })
        .setTimestamp();

      if (modActionName) {
        const executorText = modExecutor ? ` by ${modExecutor.tag ?? modExecutor.username}` : '';
        embed.addFields({ name: `⚠️ Triggered By: ${modActionName}${executorText}`, value: `**Reason:** ${modReason}` });
      }

      await sendAuditLog(member.guild, settings.user_leave_channel, embed);
    }
  },

  // Guild Ban Add
  guildBanAdd: {
    name: Events.GuildBanAdd,
    once: false,
    async execute(ban) {
      const settings = db.getAuditLogSettings(ban.guild.id);
      if (!settings.enabled || !settings.user_banned_enabled) {return;}

      const embed = new EmbedBuilder()
        .setTitle('🔨 Member Banned')
        .setColor(colorToInt(settings.user_banned_color))
        .setThumbnail(ban.user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: 'User', value: `${ban.user.tag}\n${ban.user.id}`, inline: true },
          { name: 'Reason', value: ban.reason || 'No reason provided', inline: true }
        )
        .setTimestamp();

      await sendAuditLog(ban.guild, settings.user_banned_channel, embed);
    }
  },

  // Guild Member Update (User Modified)
  guildMemberUpdate: {
    name: Events.GuildMemberUpdate,
    once: false,
    async execute(oldMember, newMember) {
      const settings = db.getAuditLogSettings(newMember.guild.id);
      if (!settings.enabled || !settings.user_modified_enabled) {return;}
      if (shouldIgnore(settings, newMember)) {return;}

      const changes = [];

      // Nickname change
      if (oldMember.nickname !== newMember.nickname) {
        changes.push(`**Nickname:** ${oldMember.nickname || 'None'} → ${newMember.nickname || 'None'}`);
      }

      // Role changes
      const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
      const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));

      if (addedRoles.size > 0) {
        changes.push(`**Roles Added:** ${addedRoles.map(r => r.toString()).join(', ')}`);
      }
      if (removedRoles.size > 0) {
        changes.push(`**Roles Removed:** ${removedRoles.map(r => r.toString()).join(', ')}`);
      }

      // Timeout changes
      if (oldMember.communicationDisabledUntil !== newMember.communicationDisabledUntil) {
        if (newMember.communicationDisabledUntil) {
          changes.push(`**Timed Out Until:** <t:${Math.floor(newMember.communicationDisabledUntilTimestamp / 1000)}:F>`);
        } else {
          changes.push(`**Timeout Removed**`);
        }
      }

      if (changes.length === 0) {return;}

      const embed = new EmbedBuilder()
        .setTitle('✏️ Member Updated')
        .setColor(colorToInt(settings.user_modified_color))
        .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: 'User', value: `${newMember.user.tag}\n${newMember.user.id}`, inline: true }
        )
        .setDescription(changes.join('\n'))
        .setTimestamp();

      await sendAuditLog(newMember.guild, settings.user_modified_channel, embed);
    }
  },

  // Message Delete
  messageDelete: {
    name: Events.MessageDelete,
    once: false,
    async execute(message) {
      if (!message.guild || message.author?.bot) {return;}

      const settings = db.getAuditLogSettings(message.guild.id);
      if (!settings.enabled || !settings.message_deleted_enabled) {return;}
      if (shouldIgnore(settings, message.member, message.channel.id)) {return;}

      poolMessage(message.guild, settings, {
        id:             message.id,
        content:        message.content || '',
        authorTag:      message.author?.username ?? 'Unknown',
        authorId:       message.author?.id ?? 'Unknown',
        channelName:    message.channel.name ?? message.channel.id,
        channelId:      message.channel.id,
        channelMention: `${message.channel}`,
        attachments:    message.attachments.map(a => a.name),
      });
    }
  },

  // Message Update
  messageUpdate: {
    name: Events.MessageUpdate,
    once: false,
    async execute(oldMessage, newMessage) {
      if (!newMessage.guild || newMessage.author?.bot) {return;}
      if (oldMessage.content === newMessage.content) {return;}

      const settings = db.getAuditLogSettings(newMessage.guild.id);
      if (!settings.enabled || !settings.message_modified_enabled) {return;}
      if (shouldIgnore(settings, newMessage.member, newMessage.channel.id)) {return;}

      const embed = new EmbedBuilder()
        .setTitle('✏️ Message Edited')
        .setColor(colorToInt(settings.message_modified_color))
        .setURL(newMessage.url)
        .addFields(
          { name: 'Author', value: newMessage.author ? `${newMessage.author.tag}\n${newMessage.author.id}` : 'Unknown', inline: true },
          { name: 'Channel', value: `${newMessage.channel}\n${newMessage.channel.id}`, inline: true },
          { name: 'Before', value: oldMessage.content?.slice(0, 1000) || 'Unknown' },
          { name: 'After', value: newMessage.content?.slice(0, 1000) || 'Empty' }
        )
        .setTimestamp();

      await sendAuditLog(newMessage.guild, settings.message_modified_channel, embed);
    }
  },

  // Message Bulk Delete
  messageDeleteBulk: {
    name: Events.MessageBulkDelete,
    once: false,
    async execute(messages, channel) {
      if (!channel.guild) {return;}

      const settings = db.getAuditLogSettings(channel.guild.id);
      if (!settings.enabled || !settings.bulk_delete_enabled) {return;}
      if (settings.ignored_channels.includes(channel.id)) {return;}

      // Feed every message into the shared pool and flush immediately
      for (const msg of messages.values()) {
        if (msg.author?.bot) {continue;}
        poolMessage(channel.guild, settings, {
          id:             msg.id,
          content:        msg.content || '',
          authorTag:      msg.author?.username ?? 'Unknown',
          authorId:       msg.author?.id ?? 'Unknown',
          channelName:    channel.name ?? channel.id,
          channelId:      channel.id,
          channelMention: `${channel}`,
          attachments:    msg.attachments?.map(a => a.name) ?? [],
        });
      }

      // Force an immediate flush instead of waiting for the debounce
      const pool = deletionPool.get(channel.guild.id);
      if (pool) {
        clearTimeout(pool.timer);
        await flushDeletionPool(channel.guild.id);
      }
    }
  },

  // Voice State Update
  voiceStateUpdate: {
    name: Events.VoiceStateUpdate,
    once: false,
    async execute(oldState, newState) {
      const guild = newState.guild || oldState.guild;
      if (!guild) {return;}

      const settings = db.getAuditLogSettings(guild.id);
      if (!settings.enabled) {return;}

      const member = newState.member || oldState.member;
      if (shouldIgnore(settings, member)) {return;}

      let title, color, description, channel;

      if (!oldState.channelId && newState.channelId) {
        // Joined
        if (!settings.voice_join_enabled) {return;}
        title = '🎤 Joined Voice Channel';
        color = settings.voice_join_color;
        channel = settings.voice_join_channel;
        description = `**Channel:** ${newState.channel}`;
      } else if (oldState.channelId && !newState.channelId) {
        // Left
        if (!settings.voice_leave_enabled) {return;}
        title = '🎤 Left Voice Channel';
        color = settings.voice_leave_color;
        channel = settings.voice_leave_channel;
        description = `**Channel:** ${oldState.channel}`;
      } else if (oldState.channelId !== newState.channelId) {
        // Swapped
        if (!settings.voice_swap_enabled) {return;}
        title = '🎤 Switched Voice Channel';
        color = settings.voice_swap_color;
        channel = settings.voice_swap_channel;
        description = `**From:** ${oldState.channel}\n**To:** ${newState.channel}`;
      } else {
        return; // No channel change
      }

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(colorToInt(color))
        .setDescription(description)
        .addFields(
          { name: 'User', value: `${member.user.tag}\n${member.user.id}`, inline: true }
        )
        .setTimestamp();

      await sendAuditLog(guild, channel, embed);
    }
  },

  // Guild Update (Server Modified)
  guildUpdate: {
    name: Events.GuildUpdate,
    once: false,
    async execute(oldGuild, newGuild) {
      const settings = db.getAuditLogSettings(newGuild.id);
      if (!settings.enabled || !settings.server_modified_enabled) {return;}

      const changes = [];

      if (oldGuild.name !== newGuild.name) {
        changes.push(`**Name:** ${oldGuild.name} → ${newGuild.name}`);
      }
      if (oldGuild.icon !== newGuild.icon) {
        changes.push(`**Icon:** Changed`);
      }
      if (oldGuild.banner !== newGuild.banner) {
        changes.push(`**Banner:** Changed`);
      }
      if (oldGuild.description !== newGuild.description) {
        changes.push(`**Description:** ${oldGuild.description || 'None'} → ${newGuild.description || 'None'}`);
      }
      if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
        changes.push(`**Verification Level:** ${oldGuild.verificationLevel} → ${newGuild.verificationLevel}`);
      }

      if (changes.length === 0) {return;}

      const embed = new EmbedBuilder()
        .setTitle('🏠 Server Updated')
        .setColor(colorToInt(settings.server_modified_color))
        .setDescription(changes.join('\n'))
        .setThumbnail(newGuild.iconURL({ dynamic: true }))
        .setTimestamp();

      await sendAuditLog(newGuild, settings.server_modified_channel, embed);
    }
  },

  // Role Create
  roleCreate: {
    name: Events.GuildRoleCreate,
    once: false,
    async execute(role) {
      const settings = db.getAuditLogSettings(role.guild.id);
      if (!settings.enabled || !settings.role_created_enabled) {return;}

      const embed = new EmbedBuilder()
        .setTitle('🎭 Role Created')
        .setColor(colorToInt(settings.role_created_color))
        .addFields(
          { name: 'Role', value: `${role}\n${role.id}`, inline: true },
          { name: 'Color', value: role.hexColor, inline: true },
          { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true }
        )
        .setTimestamp();

      await sendAuditLog(role.guild, settings.role_created_channel, embed);
    }
  },

  // Role Delete
  roleDelete: {
    name: Events.GuildRoleDelete,
    once: false,
    async execute(role) {
      const settings = db.getAuditLogSettings(role.guild.id);
      if (!settings.enabled || !settings.role_deleted_enabled) {return;}

      const embed = new EmbedBuilder()
        .setTitle('🎭 Role Deleted')
        .setColor(colorToInt(settings.role_deleted_color))
        .addFields(
          { name: 'Role', value: `${role.name}\n${role.id}`, inline: true },
          { name: 'Color', value: role.hexColor, inline: true }
        )
        .setTimestamp();

      await sendAuditLog(role.guild, settings.role_deleted_channel, embed);
    }
  },

  // Role Update
  roleUpdate: {
    name: Events.GuildRoleUpdate,
    once: false,
    async execute(oldRole, newRole) {
      const settings = db.getAuditLogSettings(newRole.guild.id);
      if (!settings.enabled || !settings.role_modified_enabled) {return;}

      const changes = [];

      if (oldRole.name !== newRole.name) {
        changes.push(`**Name:** ${oldRole.name} → ${newRole.name}`);
      }
      if (oldRole.hexColor !== newRole.hexColor) {
        changes.push(`**Color:** ${oldRole.hexColor} → ${newRole.hexColor}`);
      }
      if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
        changes.push(`**Permissions:** Modified`);
      }
      if (oldRole.hoist !== newRole.hoist) {
        changes.push(`**Hoisted:** ${oldRole.hoist} → ${newRole.hoist}`);
      }
      if (oldRole.mentionable !== newRole.mentionable) {
        changes.push(`**Mentionable:** ${oldRole.mentionable} → ${newRole.mentionable}`);
      }

      if (changes.length === 0) {return;}

      const embed = new EmbedBuilder()
        .setTitle('🎭 Role Updated')
        .setColor(colorToInt(settings.role_modified_color))
        .addFields(
          { name: 'Role', value: `${newRole}\n${newRole.id}`, inline: true }
        )
        .setDescription(changes.join('\n'))
        .setTimestamp();

      await sendAuditLog(newRole.guild, settings.role_modified_channel, embed);
    }
  },

  // Channel Create
  channelCreate: {
    name: Events.ChannelCreate,
    once: false,
    async execute(channel) {
      if (!channel.guild) {return;}

      const settings = db.getAuditLogSettings(channel.guild.id);
      if (!settings.enabled || !settings.channel_created_enabled) {return;}

      // Check if we should ignore ticket channels
      if (settings.channel_created_ignore_tickets) {
        const name = channel.name.toLowerCase();
        if (name.includes('ticket') || name.includes('support')) {return;}
      }

      const embed = new EmbedBuilder()
        .setTitle('📁 Channel Created')
        .setColor(colorToInt(settings.channel_created_color))
        .addFields(
          { name: 'Channel', value: `${channel}\n${channel.id}`, inline: true },
          { name: 'Type', value: channel.type.toString(), inline: true }
        )
        .setTimestamp();

      await sendAuditLog(channel.guild, settings.channel_created_channel, embed);
    }
  },

  // Channel Delete
  channelDelete: {
    name: Events.ChannelDelete,
    once: false,
    async execute(channel) {
      if (!channel.guild) {return;}

      const settings = db.getAuditLogSettings(channel.guild.id);
      if (!settings.enabled || !settings.channel_deleted_enabled) {return;}

      if (settings.channel_deleted_ignore_tickets) {
        const name = channel.name.toLowerCase();
        if (name.includes('ticket') || name.includes('support')) {return;}
      }

      const embed = new EmbedBuilder()
        .setTitle('📁 Channel Deleted')
        .setColor(colorToInt(settings.channel_deleted_color))
        .addFields(
          { name: 'Channel', value: `#${channel.name}\n${channel.id}`, inline: true },
          { name: 'Type', value: channel.type.toString(), inline: true }
        )
        .setTimestamp();

      await sendAuditLog(channel.guild, settings.channel_deleted_channel, embed);
    }
  },

  // Channel Update
  channelUpdate: {
    name: Events.ChannelUpdate,
    once: false,
    async execute(oldChannel, newChannel) {
      if (!newChannel.guild) {return;}

      const settings = db.getAuditLogSettings(newChannel.guild.id);
      if (!settings.enabled || !settings.channel_modified_enabled) {return;}

      const changes = [];

      if (oldChannel.name !== newChannel.name) {
        changes.push(`**Name:** ${oldChannel.name} → ${newChannel.name}`);
      }
      if (oldChannel.topic !== newChannel.topic) {
        changes.push(`**Topic:** ${oldChannel.topic || 'None'} → ${newChannel.topic || 'None'}`);
      }
      if (oldChannel.nsfw !== newChannel.nsfw) {
        changes.push(`**NSFW:** ${oldChannel.nsfw} → ${newChannel.nsfw}`);
      }
      if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
        changes.push(`**Slowmode:** ${oldChannel.rateLimitPerUser}s → ${newChannel.rateLimitPerUser}s`);
      }

      if (changes.length === 0) {return;}

      const embed = new EmbedBuilder()
        .setTitle('📁 Channel Updated')
        .setColor(colorToInt(settings.channel_modified_color))
        .addFields(
          { name: 'Channel', value: `${newChannel}\n${newChannel.id}`, inline: true }
        )
        .setDescription(changes.join('\n'))
        .setTimestamp();

      await sendAuditLog(newChannel.guild, settings.channel_modified_channel, embed);
    }
  },

  // Invite Create
  inviteCreate: {
    name: Events.InviteCreate,
    once: false,
    async execute(invite) {
      if (!invite.guild) {return;}

      const settings = db.getAuditLogSettings(invite.guild.id);
      if (!settings.enabled || !settings.invite_created_enabled) {return;}

      const embed = new EmbedBuilder()
        .setTitle('🔗 Invite Created')
        .setColor(colorToInt(settings.invite_created_color))
        .addFields(
          { name: 'Code', value: invite.code, inline: true },
          { name: 'Channel', value: `${invite.channel}`, inline: true },
          { name: 'Created By', value: invite.inviter ? invite.inviter.tag : 'Unknown', inline: true },
          { name: 'Max Uses', value: invite.maxUses ? invite.maxUses.toString() : 'Unlimited', inline: true },
          { name: 'Expires', value: invite.maxAge ? `<t:${Math.floor(Date.now() / 1000) + invite.maxAge}:R>` : 'Never', inline: true }
        )
        .setTimestamp();

      await sendAuditLog(invite.guild, settings.invite_created_channel, embed);
    }
  },

  // Invite Delete
  inviteDelete: {
    name: Events.InviteDelete,
    once: false,
    async execute(invite) {
      if (!invite.guild) {return;}

      const settings = db.getAuditLogSettings(invite.guild.id);
      if (!settings.enabled || !settings.invite_deleted_enabled) {return;}

      const embed = new EmbedBuilder()
        .setTitle('🔗 Invite Deleted')
        .setColor(colorToInt(settings.invite_deleted_color))
        .addFields(
          { name: 'Code', value: invite.code, inline: true },
          { name: 'Channel', value: invite.channel ? `${invite.channel}` : 'Unknown', inline: true }
        )
        .setTimestamp();

      await sendAuditLog(invite.guild, settings.invite_deleted_channel, embed);
    }
  },

  // Thread Create
  threadCreate: {
    name: Events.ThreadCreate,
    once: false,
    async execute(thread, newlyCreated) {
      if (!newlyCreated) {return;}

      const settings = db.getAuditLogSettings(thread.guild.id);
      if (!settings.enabled || !settings.thread_created_enabled) {return;}

      const embed = new EmbedBuilder()
        .setTitle('🧵 Thread Created')
        .setColor(colorToInt(settings.thread_created_color))
        .addFields(
          { name: 'Thread', value: `${thread}\n${thread.id}`, inline: true },
          { name: 'Parent Channel', value: `${thread.parent}`, inline: true }
        )
        .setTimestamp();

      await sendAuditLog(thread.guild, settings.thread_created_channel, embed);
    }
  },

  // Thread Delete
  threadDelete: {
    name: Events.ThreadDelete,
    once: false,
    async execute(thread) {
      const settings = db.getAuditLogSettings(thread.guild.id);
      if (!settings.enabled || !settings.thread_deleted_enabled) {return;}

      const embed = new EmbedBuilder()
        .setTitle('🧵 Thread Deleted')
        .setColor(colorToInt(settings.thread_deleted_color))
        .addFields(
          { name: 'Thread', value: `${thread.name}\n${thread.id}`, inline: true }
        )
        .setTimestamp();

      await sendAuditLog(thread.guild, settings.thread_deleted_channel, embed);
    }
  },

  // Thread Update
  threadUpdate: {
    name: Events.ThreadUpdate,
    once: false,
    async execute(oldThread, newThread) {
      const settings = db.getAuditLogSettings(newThread.guild.id);
      if (!settings.enabled || !settings.thread_modified_enabled) {return;}

      const changes = [];

      if (oldThread.name !== newThread.name) {
        changes.push(`**Name:** ${oldThread.name} → ${newThread.name}`);
      }
      if (oldThread.archived !== newThread.archived) {
        changes.push(`**Archived:** ${oldThread.archived} → ${newThread.archived}`);
      }
      if (oldThread.locked !== newThread.locked) {
        changes.push(`**Locked:** ${oldThread.locked} → ${newThread.locked}`);
      }

      if (changes.length === 0) {return;}

      const embed = new EmbedBuilder()
        .setTitle('🧵 Thread Updated')
        .setColor(colorToInt(settings.thread_modified_color))
        .addFields(
          { name: 'Thread', value: `${newThread}\n${newThread.id}`, inline: true }
        )
        .setDescription(changes.join('\n'))
        .setTimestamp();

      await sendAuditLog(newThread.guild, settings.thread_modified_channel, embed);
    }
  },

  // Stage Instance Create
  stageInstanceCreate: {
    name: Events.StageInstanceCreate,
    once: false,
    async execute(stageInstance) {
      const settings = db.getAuditLogSettings(stageInstance.guild.id);
      if (!settings.enabled || !settings.stage_started_enabled) {return;}

      const embed = new EmbedBuilder()
        .setTitle('🎭 Stage Started')
        .setColor(colorToInt(settings.stage_started_color))
        .addFields(
          { name: 'Topic', value: stageInstance.topic, inline: true },
          { name: 'Channel', value: `${stageInstance.channel}`, inline: true }
        )
        .setTimestamp();

      await sendAuditLog(stageInstance.guild, settings.stage_started_channel, embed);
    }
  },

  // Stage Instance Delete
  stageInstanceDelete: {
    name: Events.StageInstanceDelete,
    once: false,
    async execute(stageInstance) {
      const settings = db.getAuditLogSettings(stageInstance.guild.id);
      if (!settings.enabled || !settings.stage_ended_enabled) {return;}

      const embed = new EmbedBuilder()
        .setTitle('🎭 Stage Ended')
        .setColor(colorToInt(settings.stage_ended_color))
        .addFields(
          { name: 'Topic', value: stageInstance.topic, inline: true },
          { name: 'Channel', value: `${stageInstance.channel}`, inline: true }
        )
        .setTimestamp();

      await sendAuditLog(stageInstance.guild, settings.stage_ended_channel, embed);
    }
  },

  // Stage Instance Update
  stageInstanceUpdate: {
    name: Events.StageInstanceUpdate,
    once: false,
    async execute(oldStage, newStage) {
      const settings = db.getAuditLogSettings(newStage.guild.id);
      if (!settings.enabled || !settings.stage_modified_enabled) {return;}

      const changes = [];

      if (oldStage.topic !== newStage.topic) {
        changes.push(`**Topic:** ${oldStage.topic} → ${newStage.topic}`);
      }

      if (changes.length === 0) {return;}

      const embed = new EmbedBuilder()
        .setTitle('🎭 Stage Updated')
        .setColor(colorToInt(settings.stage_modified_color))
        .addFields(
          { name: 'Channel', value: `${newStage.channel}`, inline: true }
        )
        .setDescription(changes.join('\n'))
        .setTimestamp();

      await sendAuditLog(newStage.guild, settings.stage_modified_channel, embed);
    }
  },

  // Webhooks Update (covers create, update, delete)
  webhooksUpdate: {
    name: Events.WebhooksUpdate,
    once: false,
    async execute(channel) {
      // This event fires when webhooks are created, updated, or deleted
      // We can't tell which action occurred, so we just log the channel
      const settings = db.getAuditLogSettings(channel.guild.id);
      if (!settings.enabled) {return;}

      // Check if any webhook logging is enabled
      if (!settings.webhook_created_enabled && !settings.webhook_modified_enabled && !settings.webhook_deleted_enabled) {
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('🔌 Webhooks Updated')
        .setColor(colorToInt(settings.webhook_modified_color))
        .addFields(
          { name: 'Channel', value: `${channel}\n${channel.id}`, inline: true }
        )
        .setDescription('A webhook was created, modified, or deleted in this channel.')
        .setTimestamp();

      // Use the first available channel
      const logChannel = settings.webhook_created_channel || settings.webhook_modified_channel || settings.webhook_deleted_channel;
      await sendAuditLog(channel.guild, logChannel, embed);
    }
  }
};
