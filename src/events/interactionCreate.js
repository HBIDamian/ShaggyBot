const { Events, Collection, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { createLogger } = require('../utils/logger');
const { interactionHandler } = require('../utils/errorHandler');
const db = require('../database/database');

const logger = createLogger('InteractionHandler');

/**
 * Check if a command is disabled and if the user can bypass it
 * @param {Object} interaction - Discord interaction
 * @param {string} commandName - Name of the command
 * @returns {boolean} True if command should be blocked
 */
function checkCommandDisabled(interaction, commandName) {
  try {
    const settings = db.getCommandToggleSettings(interaction.guildId);

    // Check if command is in the disabled list
    if (!settings.disabled_commands.includes(commandName)) {
      return false; // Command is not disabled
    }

    // Command is disabled, check for bypasses
    const member = interaction.member;

    // Check admin bypass
    if (settings.admins_bypass && member.permissions.has(PermissionFlagsBits.Administrator)) {
      return false; // Admin can bypass
    }

    // Check mod bypass (Manage Messages permission)
    if (settings.mods_bypass && member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return false; // Mod can bypass
    }

    // Command is disabled and user cannot bypass
    return true;
  } catch (err) {
    logger.error(`Error checking command toggle: ${err.message}`);
    return false; // On error, allow the command
  }
}

module.exports = {
  name: Events.InteractionCreate,
  execute: interactionHandler(async (interaction, client) => {
    if (interaction.isChatInputCommand()) {
      return handleSlashCommand(interaction, client);
    }

    if (interaction.isMessageContextMenuCommand() || interaction.isUserContextMenuCommand()) {
      return handleContextMenuCommand(interaction, client);
    }

    if (interaction.isButton()) {
      return handleButtonInteraction(interaction, client);
    }

    if (interaction.isAutocomplete()) {
      return handleAutocomplete(interaction, client);
    }

    if (interaction.isModalSubmit()) {
      return handleModalSubmit(interaction, client);
    }
  }),
};

/**
 * Handle slash commands
 */
async function handleSlashCommand(interaction, client) {
    const command = client.commands.get(interaction.commandName);

    if (!command) {
      logger.error(`No command matching ${interaction.commandName} was found.`);
      return interaction.reply({
        content: 'There was an error while executing this command!',
        flags: MessageFlags.Ephemeral
      });
    }

    // Check if command is disabled for this guild (only for guild commands)
    if (interaction.guildId) {
      const commandDisabled = checkCommandDisabled(interaction, command.data.name);
      if (commandDisabled) {
        return interaction.reply({
          content: '❌ This command has been disabled by the server administrators.',
          flags: MessageFlags.Ephemeral
        });
      }
    }

    // Implement command cooldowns
    const { cooldowns } = client;

    if (!cooldowns.has(command.data.name)) {
      cooldowns.set(command.data.name, new Collection());
    }

    const now = Date.now();
    const timestamps = cooldowns.get(command.data.name);
    const defaultCooldownDuration = 3; // 3 seconds default cooldown
    const cooldownAmount = (command.cooldown ?? defaultCooldownDuration) * 1000;

    if (timestamps.has(interaction.user.id)) {
      const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;

      if (now < expirationTime) {
        const expiredTimestamp = Math.round(expirationTime / 1000);
        return interaction.reply({
          content: `Please wait, you are on a cooldown for \`${command.data.name}\`. You can use it again <t:${expiredTimestamp}:R>.`,
          flags: MessageFlags.Ephemeral
        });
      }
    }

    timestamps.set(interaction.user.id, now);
    setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

    await command.execute(interaction);
}

/**
 * Handle context menu commands (e.g., Report Message)
 */
async function handleContextMenuCommand(interaction, client) {
  const command = client.commands.get(interaction.commandName);

  if (!command) {
    logger.error(`No context menu command matching ${interaction.commandName} was found.`);
    return interaction.reply({
      content: 'There was an error while executing this command!',
      flags: MessageFlags.Ephemeral,
    });
  }

  await command.execute(interaction);
}

/**
 * Handle button interactions for reports
 */
async function handleButtonInteraction(interaction, client) {
  const customId = interaction.customId;

  // Handle audit log moderation buttons (audit_kick_, audit_ban_, audit_timeout1h_)
  if (customId.startsWith('audit_')) {
    return handleAuditModButton(interaction);
  }

  // Handle view warnings button
  if (customId.startsWith('view_warnings_')) {
    return handleViewWarnings(interaction, customId.replace('view_warnings_', ''));
  }

  // Handle warnings pagination buttons
  if (customId.startsWith('warnings_')) {
    return handleWarningsPagination(interaction, customId);
  }

  if (!customId.startsWith('report_')) { return; }

  const _guild = interaction.guild;
  const member = interaction.member;

  // Check if user has moderation permissions
  if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    return interaction.reply({
      content: '❌ You need the "Moderate Members" permission to use these buttons.',
      flags: MessageFlags.Ephemeral
    });
  }

  const parts = customId.split('_');
  const action = parts[1]; // delete, warn, timeout, dismiss, claim, finish

  try {
    switch (action) {
      case 'delete':
        await handleReportDelete(interaction, parts[2], parts[3]);
        break;
      case 'warn':
        await handleReportWarn(interaction, parts[2], parts[3]);
        break;
      case 'timeout':
        await handleReportTimeout(interaction, parts[2], parts[3]);
        break;
      case 'dismiss':
        await handleReportDismiss(interaction);
        break;
      case 'claim':
        await handleReportClaim(interaction);
        break;
      case 'finish':
        await handleReportFinish(interaction);
        break;
      default:
        logger.warn(`Unknown report action: ${action}`);
    }
  } catch (error) {
    logger.error(`Error handling report button: ${error.message}`);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this action.',
        flags: MessageFlags.Ephemeral
      });
    }
  }
}

/**
 * Handle audit log moderation quick-action buttons (Kick / Ban / Timeout 1 Hour)
 */
async function handleAuditModButton(interaction) {
  const parts = interaction.customId.split('_'); // ['audit', action, userId]
  const action = parts[1]; // 'kick' | 'ban' | 'timeout1h'
  const targetId = parts[2];

  const permMap = {
    kick: PermissionFlagsBits.KickMembers,
    ban: PermissionFlagsBits.BanMembers,
    timeout1h: PermissionFlagsBits.ModerateMembers,
  };

  if (!interaction.member.permissions.has(permMap[action])) {
    return interaction.reply({ content: '❌ You don\'t have permission to do that.', flags: MessageFlags.Ephemeral });
  }

  try {
    if (action === 'kick') {
      const target = await interaction.guild.members.fetch(targetId).catch(() => null);
      if (!target) return interaction.reply({ content: '❌ Member not found — they may have already left.', flags: MessageFlags.Ephemeral });
      await target.kick(`Quick-action by ${interaction.user.username} via audit log`);
      await interaction.reply({ content: `✅ Kicked **${target.user.username}**.`, flags: MessageFlags.Ephemeral });

    } else if (action === 'ban') {
      await interaction.guild.bans.create(targetId, { reason: `Quick-action by ${interaction.user.username} via audit log` });
      await interaction.reply({ content: `✅ Banned <@${targetId}>.`, flags: MessageFlags.Ephemeral });

    } else if (action === 'timeout1h') {
      const target = await interaction.guild.members.fetch(targetId).catch(() => null);
      if (!target) return interaction.reply({ content: '❌ Member not found.', flags: MessageFlags.Ephemeral });
      await target.timeout(60 * 60 * 1000, `Quick-action by ${interaction.user.username} via audit log`);
      await interaction.reply({ content: `✅ Timed out **${target.user.username}** for 1 hour.`, flags: MessageFlags.Ephemeral });
    }

    // Disable the buttons on the original message after action is taken
    const disabledRow = interaction.message.components[0] && new (require('discord.js').ActionRowBuilder)()
      .addComponents(
        interaction.message.components[0].components.map(btn =>
          require('discord.js').ButtonBuilder.from(btn).setDisabled(true)
        )
      );
    if (disabledRow) await interaction.message.edit({ components: [disabledRow] }).catch(() => {});

  } catch (err) {
    logger.error(`Audit mod button error: ${err.message}`);
    if (!interaction.replied) {
      await interaction.reply({ content: `❌ Failed: ${err.message}`, flags: MessageFlags.Ephemeral });
    }
  }
}

/**
 * Delete the reported message
 */
async function handleReportDelete(interaction, channelId, messageId) {
  const channel = interaction.guild.channels.cache.get(channelId);

  if (!channel) {
    return interaction.reply({
      content: '❌ The channel no longer exists.',
      flags: MessageFlags.Ephemeral
    });
  }

  try {
    const message = await channel.messages.fetch(messageId);
    await message.delete();

    // Update the embed to show the message was deleted
    const embed = EmbedBuilder.from(interaction.message.embeds[0]);
    const currentFields = embed.data.fields || [];
    const existingActionIndex = currentFields.findIndex(f => f.name === '📋 Actions Taken:');

    if (existingActionIndex !== -1) {
      currentFields[existingActionIndex].value += `\n• Message deleted by <@${interaction.user.id}>`;
    } else {
      embed.addFields({ name: '📋 Actions Taken:', value: `• Message deleted by <@${interaction.user.id}>` });
    }

    await interaction.update({ embeds: [embed] });

    logger.info(`Report: Message ${messageId} deleted by ${interaction.user.tag}`);
  } catch (error) {
    if (error.code === 10008) {
      return interaction.reply({
        content: '❌ The message has already been deleted.',
        flags: MessageFlags.Ephemeral
      });
    }
    throw error;
  }
}

/**
 * Warn the reported user
 */
async function handleReportWarn(interaction, userId, messageId) {
  const reason = `Warned via message report (Message ID: ${messageId})`;

  db.addWarning(interaction.guild.id, userId, interaction.user.id, reason);
  db.logModAction(interaction.guild.id, userId, interaction.user.id, 'warn', reason);

  // Update the embed
  const embed = EmbedBuilder.from(interaction.message.embeds[0]);
  const currentFields = embed.data.fields || [];
  const existingActionIndex = currentFields.findIndex(f => f.name === '📋 Actions Taken:');

  if (existingActionIndex !== -1) {
    currentFields[existingActionIndex].value += `\n• User warned by <@${interaction.user.id}>`;
  } else {
    embed.addFields({ name: '📋 Actions Taken:', value: `• User warned by <@${interaction.user.id}>` });
  }

  await interaction.update({ embeds: [embed] });

  // Try to DM the user
  try {
    const user = await interaction.client.users.fetch(userId);
    await user.send(`⚠️ You have been warned in **${interaction.guild.name}** for a reported message.\nReason: ${reason}`);
  } catch (_e) {
    // User has DMs disabled
  }

  logger.info(`Report: User ${userId} warned by ${interaction.user.tag}`);
}

/**
 * Timeout the reported user for 24 hours
 */
async function handleReportTimeout(interaction, userId, messageId) {
  const member = await interaction.guild.members.fetch(userId).catch(() => null);

  if (!member) {
    return interaction.reply({
      content: '❌ The user is no longer in this server.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (!member.moderatable) {
    return interaction.reply({
      content: '❌ I cannot timeout this user. They may have higher permissions than me.',
      flags: MessageFlags.Ephemeral
    });
  }

  const reason = `24h timeout via message report (Message ID: ${messageId})`;
  const duration = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

  await member.timeout(duration, reason);
  db.logModAction(interaction.guild.id, userId, interaction.user.id, 'mute', reason);

  // Update the embed
  const embed = EmbedBuilder.from(interaction.message.embeds[0]);
  const currentFields = embed.data.fields || [];
  const existingActionIndex = currentFields.findIndex(f => f.name === '📋 Actions Taken:');

  if (existingActionIndex !== -1) {
    currentFields[existingActionIndex].value += `\n• User timed out 24h by <@${interaction.user.id}>`;
  } else {
    embed.addFields({ name: '📋 Actions Taken:', value: `• User timed out 24h by <@${interaction.user.id}>` });
  }

  await interaction.update({ embeds: [embed] });

  // Try to DM the user
  try {
    const user = await interaction.client.users.fetch(userId);
    await user.send(`🔇 You have been timed out for 24 hours in **${interaction.guild.name}** for a reported message.`);
  } catch (_e) {
    // User has DMs disabled
  }

  logger.info(`Report: User ${userId} timed out 24h by ${interaction.user.tag}`);
}

/**
 * Dismiss/delete the report
 */
async function handleReportDismiss(interaction) {
  await interaction.message.delete();
  logger.info(`Report dismissed by ${interaction.user.tag}`);
}

/**
 * Claim a report
 */
async function handleReportClaim(interaction) {
  const embed = EmbedBuilder.from(interaction.message.embeds[0]);
  const currentFields = embed.data.fields || [];

  // Check if already claimed
  const claimedIndex = currentFields.findIndex(f => f.name === '👤 Claimed By:');
  if (claimedIndex !== -1) {
    return interaction.reply({
      content: `❌ This report has already been claimed.`,
      flags: MessageFlags.Ephemeral
    });
  }

  embed.addFields({ name: '👤 Claimed By:', value: `<@${interaction.user.id}>` });
  embed.setColor(0x3B82F6); // Blue to indicate in progress

  await interaction.update({ embeds: [embed] });

  logger.info(`Report claimed by ${interaction.user.tag}`);
}

/**
 * Mark a report as finished
 */
async function handleReportFinish(interaction) {
  const embed = EmbedBuilder.from(interaction.message.embeds[0]);

  embed.setColor(0x22C55E); // Green to indicate resolved
  embed.setFooter({
    text: `✅ Resolved by ${interaction.user.username} • ${new Date().toLocaleString()}`,
    iconURL: interaction.user.displayAvatarURL({ dynamic: true })
  });

  // Remove action buttons, keep only info
  await interaction.update({
    embeds: [embed],
    components: []
  });

  logger.info(`Report marked as finished by ${interaction.user.tag}`);
}

/**
 * Handle autocomplete interactions
 */
async function handleAutocomplete(interaction, client) {
  const command = client.commands.get(interaction.commandName);

  if (!command || !command.autocomplete) {
    return;
  }

  try {
    await command.autocomplete(interaction);
  } catch (error) {
    logger.error(`Error handling autocomplete for ${interaction.commandName}: ${error.message}`);
  }
}

/**
 * Check if user has permission based on tier setting
 */
function hasTagPermissionTier(member, tier) {
  if (tier === 'users') {return true;}
  if (tier === 'mods') {
    return member.permissions.has(PermissionFlagsBits.ModerateMembers) ||
           member.permissions.has(PermissionFlagsBits.ManageMessages) ||
           member.permissions.has(PermissionFlagsBits.ManageGuild);
  }
  if (tier === 'admins') {
    return member.permissions.has(PermissionFlagsBits.ManageGuild);
  }
  return false;
}

/**
 * Handle modal submissions
 */
async function handleModalSubmit(interaction, client) {
  const customId = interaction.customId;

  try {
    // Handle report user modal
    if (customId.startsWith('report_user_modal_')) {
      const targetUserId = customId.replace('report_user_modal_', '');
      const reportUserCommand = client.commands.get('Report User');
      if (reportUserCommand && reportUserCommand.handleModalSubmit) {
        return reportUserCommand.handleModalSubmit(interaction, targetUserId);
      }
    }

    // Handle tag create modal
    if (customId === 'tag_create_modal') {
      // Check permission tier for creating tags
      const settings = db.getGuildSettings(interaction.guildId);
      const manageOwn = settings.tags_manage_own || 'users';
      if (!hasTagPermissionTier(interaction.member, manageOwn)) {
        const tierName = manageOwn === 'admins' ? 'administrators' : 'moderators';
        return interaction.reply({
          content: `❌ Only ${tierName} can create tags in this server.`,
          flags: MessageFlags.Ephemeral
        });
      }

      const tagName = interaction.fields.getTextInputValue('tag_name').toLowerCase().trim();
      const response = interaction.fields.getTextInputValue('tag_response');

      // Validate tag name
      if (!/^[a-z0-9-_]+$/.test(tagName)) {
        return interaction.reply({
          content: '❌ Tag names can only contain lowercase letters, numbers, hyphens, and underscores.',
          flags: MessageFlags.Ephemeral
        });
      }

      // Check if tag already exists
      const existing = db.getTag(interaction.guildId, tagName);
      if (existing) {
        return interaction.reply({
          content: `❌ A tag with the name \`${tagName}\` already exists.`,
          flags: MessageFlags.Ephemeral
        });
      }

      // Create the tag
      db.createTag(interaction.guildId, tagName, response, interaction.user.id, interaction.user.username);

      return interaction.reply({
        content: `✅ Tag \`${tagName}\` has been created! Use \`/tag ${tagName}\` to display it.`,
        flags: MessageFlags.Ephemeral
      });
    }

    // Handle tag edit modal
    if (customId.startsWith('tag_edit_modal_')) {
      const tagId = customId.replace('tag_edit_modal_', '');
      const currentTag = db.getTagById(tagId);

      if (!currentTag) {
        return interaction.reply({ content: '❌ Tag not found.', flags: MessageFlags.Ephemeral });
      }

      // Check permission tier for editing tags
      const settings = db.getGuildSettings(interaction.guildId);
      const manageOwn = settings.tags_manage_own || 'users';
      const manageAll = settings.tags_manage_all || 'admins';
      const isOwner = currentTag.owner_id === interaction.user.id;
      const canManageOwn = hasTagPermissionTier(interaction.member, manageOwn);
      const canManageAll = hasTagPermissionTier(interaction.member, manageAll);

      if (!isOwner && !canManageAll) {
        return interaction.reply({ content: '❌ You can only edit your own tags.', flags: MessageFlags.Ephemeral });
      }
      if (isOwner && !canManageOwn) {
        const tierName = manageOwn === 'admins' ? 'administrators' : 'moderators';
        return interaction.reply({
          content: `❌ Only ${tierName} can manage tags in this server.`,
          flags: MessageFlags.Ephemeral
        });
      }

      const newName = interaction.fields.getTextInputValue('tag_name').toLowerCase().trim();
      const newResponse = interaction.fields.getTextInputValue('tag_response');

      // Validate tag name
      if (!/^[a-z0-9-_]+$/.test(newName)) {
        return interaction.reply({
          content: '❌ Tag names can only contain lowercase letters, numbers, hyphens, and underscores.',
          flags: MessageFlags.Ephemeral
        });
      }

      // Check if new name conflicts with existing tag
      const existing = db.getTag(interaction.guildId, newName);

      if (existing && existing.id !== parseInt(tagId)) {
        return interaction.reply({
          content: `❌ A tag with the name \`${newName}\` already exists.`,
          flags: MessageFlags.Ephemeral
        });
      }

      // Update the tag
      db.updateTag(tagId, newName, newResponse);

      return interaction.reply({
        content: `✅ Tag has been updated to \`${newName}\`!`,
        flags: MessageFlags.Ephemeral
      });
    }
  } catch (error) {
    logger.error(`Error handling modal submit: ${error.message}`);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing your submission.',
        flags: MessageFlags.Ephemeral
      });
    }
  }
}

/**
 * Handle View Warnings button click
 */
async function handleViewWarnings(interaction, userId) {
  try {
    const { buildWarningsEmbed, buildPaginationButtons } = require('../commands/moderation/warnings');

    const warnings = db.getUserWarnings(interaction.guildId, userId);
    const user = await interaction.client.users.fetch(userId).catch(() => null);
    const username = user ? user.username : 'Unknown User';

    if (warnings.length === 0) {
      return interaction.reply({
        content: `✅ ${username} has no warnings.`,
        flags: MessageFlags.Ephemeral
      });
    }

    const { embed, totalPages } = await buildWarningsEmbed(warnings, user, 1, interaction.client);
    const row = buildPaginationButtons(userId, 1, totalPages);

    return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
  } catch (error) {
    logger.error(`Error viewing warnings: ${error.message}`);
    return interaction.reply({
      content: '❌ An error occurred while fetching warnings.',
      flags: MessageFlags.Ephemeral
    });
  }
}

/**
 * Handle warnings pagination button clicks
 */
async function handleWarningsPagination(interaction, customId) {
  try {
    const { buildWarningsEmbed, buildPaginationButtons, WARNINGS_PER_PAGE } = require('../commands/moderation/warnings');

    const parts = customId.split('_');
    const action = parts[1]; // first, prev, close, next, last
    const userId = parts[2];
    const currentPage = parseInt(parts[3]) || 1;

    // Handle close button
    if (action === 'close') {
      return interaction.update({
        components: [] // Remove buttons
      });
    }

    const warnings = db.getUserWarnings(interaction.guildId, userId);
    const user = await interaction.client.users.fetch(userId).catch(() => null);

    if (!user || warnings.length === 0) {
      return interaction.update({
        content: '❌ Unable to fetch warnings.',
        embeds: [],
        components: []
      });
    }

    const totalPages = Math.ceil(warnings.length / WARNINGS_PER_PAGE) || 1;
    let newPage = currentPage;

    switch (action) {
      case 'first':
        newPage = 1;
        break;
      case 'prev':
        newPage = Math.max(1, currentPage - 1);
        break;
      case 'next':
        newPage = Math.min(totalPages, currentPage + 1);
        break;
      case 'last':
        newPage = totalPages;
        break;
    }

    const { embed } = await buildWarningsEmbed(warnings, user, newPage, interaction.client);
    const row = buildPaginationButtons(userId, newPage, totalPages);

    return interaction.update({ embeds: [embed], components: [row] });
  } catch (error) {
    logger.error(`Error handling warnings pagination: ${error.message}`);
    return interaction.reply({
      content: '❌ An error occurred while navigating warnings.',
      flags: MessageFlags.Ephemeral
    });
  }
}
