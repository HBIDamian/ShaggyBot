const { Events, EmbedBuilder } = require('discord.js');
const { createLogger } = require('../utils/logger');
const db = require('../database/database');

const logger = createLogger('AuditLog');

/**
 * Helper function to send audit log embed
 */
async function sendAuditLog(guild, channelId, embed) {
  if (!channelId) {return;}

  try {
    const channel = guild.channels.cache.get(channelId);
    if (channel) {
      await channel.send({ embeds: [embed] });
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

// ==================== USER EVENTS ====================

module.exports = {
  // Guild Member Add (User Join)
  guildMemberAdd: {
    name: Events.GuildMemberAdd,
    once: false,
    async execute(member) {
      const settings = db.getAuditLogSettings(member.guild.id);
      if (!settings.enabled || !settings.user_join_enabled) {return;}
      if (shouldIgnore(settings, member)) {return;}

      const embed = new EmbedBuilder()
        .setTitle('👋 Member Joined')
        .setColor(colorToInt(settings.user_join_color))
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: 'User', value: `${member.user.tag}\n${member.user.id}`, inline: true },
          { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: 'Member Count', value: `${member.guild.memberCount}`, inline: true }
        )
        .setTimestamp();

      await sendAuditLog(member.guild, settings.user_join_channel, embed);
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

      const roles = member.roles.cache
        .filter(r => r.id !== member.guild.id)
        .map(r => r.toString())
        .join(', ') || 'None';

      const embed = new EmbedBuilder()
        .setTitle('👋 Member Left')
        .setColor(colorToInt(settings.user_leave_color))
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: 'User', value: `${member.user.tag}\n${member.user.id}`, inline: true },
          { name: 'Joined', value: member.joinedAt ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown', inline: true },
          { name: 'Roles', value: roles.length > 1000 ? roles.slice(0, 1000) + '...' : roles }
        )
        .setTimestamp();

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

      const embed = new EmbedBuilder()
        .setTitle('🗑️ Message Deleted')
        .setColor(colorToInt(settings.message_deleted_color))
        .addFields(
          { name: 'Author', value: message.author ? `${message.author.tag}\n${message.author.id}` : 'Unknown', inline: true },
          { name: 'Channel', value: `${message.channel}\n${message.channel.id}`, inline: true }
        )
        .setTimestamp();

      if (message.content) {
        embed.setDescription(`**Content:**\n${message.content.slice(0, 1000)}${message.content.length > 1000 ? '...' : ''}`);
      }

      if (message.attachments.size > 0) {
        embed.addFields({
          name: 'Attachments',
          value: message.attachments.map(a => a.name).join('\n').slice(0, 1000)
        });
      }

      await sendAuditLog(message.guild, settings.message_deleted_channel, embed);
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

      const embed = new EmbedBuilder()
        .setTitle('🗑️ Bulk Messages Deleted')
        .setColor(colorToInt(settings.bulk_delete_color))
        .addFields(
          { name: 'Channel', value: `${channel}\n${channel.id}`, inline: true },
          { name: 'Messages Deleted', value: `${messages.size}`, inline: true }
        )
        .setTimestamp();

      await sendAuditLog(channel.guild, settings.bulk_delete_channel, embed);
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
