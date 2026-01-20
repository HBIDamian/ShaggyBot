const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder , MessageFlags } = require('discord.js');
const db = require('../../database/database');

/**
 * Check if user has permission based on tier setting
 * @param {Object} member - Guild member
 * @param {string} tier - Permission tier: 'admins', 'mods', or 'users'
 * @returns {boolean}
 */
function hasPermissionTier(member, tier) {
  if (tier === 'users') return true;
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
 * Get tag permission settings for a guild
 * @param {string} guildId - Guild ID
 * @returns {Object} { manageOwn, manageAll }
 */
function getTagPermissions(guildId) {
  const settings = db.getGuildSettings(guildId);
  return {
    manageOwn: settings.tags_manage_own || 'users',
    manageAll: settings.tags_manage_all || 'admins'
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tags')
    .setDescription('Manage server tags')
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List all tags in this server')
    )
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('Create a new tag')
    )
    .addSubcommand(sub =>
      sub.setName('edit')
        .setDescription('Edit an existing tag')
        .addStringOption(option =>
          option.setName('tag')
            .setDescription('The tag to edit')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('delete')
        .setDescription('Delete a tag')
        .addStringOption(option =>
          option.setName('tag')
            .setDescription('The tag to delete')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('info')
        .setDescription('View info for a specific tag')
        .addStringOption(option =>
          option.setName('tag')
            .setDescription('The tag to view info for')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('raw')
        .setDescription('Display a tag in raw format (shows markdown)')
        .addStringOption(option =>
          option.setName('tag')
            .setDescription('The tag to display raw')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('user')
        .setDescription('List tags created by a user')
        .addUserOption(option =>
          option.setName('user')
            .setDescription('The user to list tags for')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('transfer')
        .setDescription('Transfer one of your tags to someone else')
        .addStringOption(option =>
          option.setName('tag')
            .setDescription('The tag to transfer')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addUserOption(option =>
          option.setName('user')
            .setDescription('The user to transfer the tag to')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('nuke')
        .setDescription('Delete ALL tags in the server (Admin only)')
    )
    .addSubcommand(sub =>
      sub.setName('prune')
        .setDescription('Delete all tags from a user (Admin only)')
        .addUserOption(option =>
          option.setName('user')
            .setDescription('The user whose tags to delete')
            .setRequired(true)
        )
    ),

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const subcommand = interaction.options.getSubcommand();
    
    let tags;
    
    // For transfer, only show user's own tags
    if (subcommand === 'transfer') {
      tags = db.getTagsByOwner(interaction.guildId, interaction.user.id);
    } else if (subcommand === 'edit' || subcommand === 'delete') {
      // For edit/delete, check permission tiers
      const perms = getTagPermissions(interaction.guildId);
      const canManageAll = hasPermissionTier(interaction.member, perms.manageAll);
      if (canManageAll) {
        tags = db.getTags(interaction.guildId);
      } else {
        tags = db.getTagsByOwner(interaction.guildId, interaction.user.id);
      }
    } else {
      tags = db.getTags(interaction.guildId);
    }
    
    const filtered = tags
      .filter(tag => tag.name.includes(focusedValue))
      .slice(0, 25)
      .map(tag => ({ name: tag.name, value: tag.name }));
    
    await interaction.respond(filtered);
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'list':
        return handleList(interaction);
      case 'create':
        return handleCreate(interaction);
      case 'edit':
        return handleEdit(interaction);
      case 'delete':
        return handleDelete(interaction);
      case 'info':
        return handleInfo(interaction);
      case 'raw':
        return handleRaw(interaction);
      case 'user':
        return handleUser(interaction);
      case 'transfer':
        return handleTransfer(interaction);
      case 'nuke':
        return handleNuke(interaction);
      case 'prune':
        return handlePrune(interaction);
    }
  }
};

async function handleList(interaction) {
  const tags = db.getTags(interaction.guildId);
  
  if (tags.length === 0) {
    return interaction.reply({
      content: '📭 No tags have been created in this server yet.\nUse `/tags create` to create one!',
      flags: MessageFlags.Ephemeral
    });
  }
  
  const tagList = tags.map(t => `\`${t.name}\``).join(', ');
  
  const embed = new EmbedBuilder()
    .setTitle('🏷️ Server Tags')
    .setDescription(tagList.length > 4000 ? tagList.substring(0, 4000) + '...' : tagList)
    .setColor(0x6366f1)
    .setFooter({ text: `${tags.length} tags total • Use /tag <name> to use a tag` });
  
  await interaction.reply({ embeds: [embed] });
}

async function handleCreate(interaction) {
  // Check permission tier for creating tags
  const perms = getTagPermissions(interaction.guildId);
  if (!hasPermissionTier(interaction.member, perms.manageOwn)) {
    const tierName = perms.manageOwn === 'admins' ? 'administrators' : 'moderators';
    return interaction.reply({
      content: `❌ Only ${tierName} can create tags in this server.`,
      flags: MessageFlags.Ephemeral
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('tag_create_modal')
    .setTitle('Create New Tag');
  
  const nameInput = new TextInputBuilder()
    .setCustomId('tag_name')
    .setLabel('Tag Name')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g., rules, faq, welcome')
    .setMaxLength(32)
    .setRequired(true);
  
  const responseInput = new TextInputBuilder()
    .setCustomId('tag_response')
    .setLabel('Response')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Enter the tag response...')
    .setMaxLength(2000)
    .setRequired(true);
  
  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(responseInput)
  );
  
  await interaction.showModal(modal);
}

async function handleEdit(interaction) {
  const tagName = interaction.options.getString('tag').toLowerCase();
  const tag = db.getTag(interaction.guildId, tagName);
  
  if (!tag) {
    return interaction.reply({ content: `❌ Tag \`${tagName}\` not found.`, flags: MessageFlags.Ephemeral });
  }
  
  // Check permissions using tier settings
  const perms = getTagPermissions(interaction.guildId);
  const isOwner = tag.owner_id === interaction.user.id;
  const canManageOwn = hasPermissionTier(interaction.member, perms.manageOwn);
  const canManageAll = hasPermissionTier(interaction.member, perms.manageAll);
  
  if (!isOwner && !canManageAll) {
    return interaction.reply({ content: '❌ You can only edit your own tags.', flags: MessageFlags.Ephemeral });
  }
  if (isOwner && !canManageOwn) {
    const tierName = perms.manageOwn === 'admins' ? 'administrators' : 'moderators';
    return interaction.reply({
      content: `❌ Only ${tierName} can manage tags in this server.`,
      flags: MessageFlags.Ephemeral
    });
  }
  
  const modal = new ModalBuilder()
    .setCustomId(`tag_edit_modal_${tag.id}`)
    .setTitle('Edit Tag');
  
  const nameInput = new TextInputBuilder()
    .setCustomId('tag_name')
    .setLabel('Tag Name')
    .setStyle(TextInputStyle.Short)
    .setValue(tag.name)
    .setMaxLength(32)
    .setRequired(true);
  
  const responseInput = new TextInputBuilder()
    .setCustomId('tag_response')
    .setLabel('Response')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(tag.response)
    .setMaxLength(2000)
    .setRequired(true);
  
  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(responseInput)
  );
  
  await interaction.showModal(modal);
}

async function handleDelete(interaction) {
  const tagName = interaction.options.getString('tag').toLowerCase();
  const tag = db.getTag(interaction.guildId, tagName);
  
  if (!tag) {
    return interaction.reply({ content: `❌ Tag \`${tagName}\` not found.`, flags: MessageFlags.Ephemeral });
  }
  
  // Check permissions using tier settings
  const perms = getTagPermissions(interaction.guildId);
  const isOwner = tag.owner_id === interaction.user.id;
  const canManageOwn = hasPermissionTier(interaction.member, perms.manageOwn);
  const canManageAll = hasPermissionTier(interaction.member, perms.manageAll);
  
  if (!isOwner && !canManageAll) {
    return interaction.reply({ content: '❌ You can only delete your own tags.', flags: MessageFlags.Ephemeral });
  }
  if (isOwner && !canManageOwn) {
    const tierName = perms.manageOwn === 'admins' ? 'administrators' : 'moderators';
    return interaction.reply({
      content: `❌ Only ${tierName} can manage tags in this server.`,
      flags: MessageFlags.Ephemeral
    });
  }
  
  db.deleteTag(tag.id);
  
  await interaction.reply({
    content: `✅ Tag \`${tagName}\` has been deleted.`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleInfo(interaction) {
  const tagName = interaction.options.getString('tag').toLowerCase();
  const tag = db.getTag(interaction.guildId, tagName);
  
  if (!tag) {
    return interaction.reply({ content: `❌ Tag \`${tagName}\` not found.`, flags: MessageFlags.Ephemeral });
  }
  
  const embed = new EmbedBuilder()
    .setTitle(`🏷️ Tag: ${tag.name}`)
    .addFields(
      { name: 'Owner', value: `<@${tag.owner_id}> (${tag.owner_name})`, inline: true },
      { name: 'Uses', value: tag.uses.toString(), inline: true },
      { name: 'Created', value: `<t:${Math.floor(new Date(tag.created_at).getTime() / 1000)}:R>`, inline: true }
    )
    .setColor(0x6366f1)
    .setFooter({ text: `Tag ID: ${tag.id}` });
  
  await interaction.reply({ embeds: [embed] });
}

async function handleRaw(interaction) {
  const tagName = interaction.options.getString('tag').toLowerCase();
  const tag = db.getTag(interaction.guildId, tagName);
  
  if (!tag) {
    return interaction.reply({ content: `❌ Tag \`${tagName}\` not found.`, flags: MessageFlags.Ephemeral });
  }
  
  // Escape markdown
  const escaped = tag.response
    .replace(/`/g, '\\`')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/~/g, '\\~')
    .replace(/\|/g, '\\|');
  
  await interaction.reply({
    content: `**Raw content of \`${tag.name}\`:**\n\`\`\`\n${tag.response}\n\`\`\``,
    flags: MessageFlags.Ephemeral
  });
}

async function handleUser(interaction) {
  const user = interaction.options.getUser('user');
  const tags = db.getTagsByOwner(interaction.guildId, user.id);
  
  if (tags.length === 0) {
    return interaction.reply({
      content: `📭 ${user.username} hasn't created any tags in this server.`,
      flags: MessageFlags.Ephemeral
    });
  }
  
  const tagList = tags.map(t => `\`${t.name}\` (${t.uses} uses)`).join('\n');
  
  const embed = new EmbedBuilder()
    .setTitle(`🏷️ Tags by ${user.username}`)
    .setDescription(tagList.length > 4000 ? tagList.substring(0, 4000) + '...' : tagList)
    .setColor(0x6366f1)
    .setThumbnail(user.displayAvatarURL())
    .setFooter({ text: `${tags.length} tags total` });
  
  await interaction.reply({ embeds: [embed] });
}

async function handleTransfer(interaction) {
  const tagName = interaction.options.getString('tag').toLowerCase();
  const newOwner = interaction.options.getUser('user');
  const tag = db.getTag(interaction.guildId, tagName);
  
  if (!tag) {
    return interaction.reply({ content: `❌ Tag \`${tagName}\` not found.`, flags: MessageFlags.Ephemeral });
  }
  
  if (tag.owner_id !== interaction.user.id) {
    return interaction.reply({ content: '❌ You can only transfer your own tags.', flags: MessageFlags.Ephemeral });
  }
  
  if (newOwner.bot) {
    return interaction.reply({ content: '❌ You cannot transfer tags to bots.', flags: MessageFlags.Ephemeral });
  }
  
  db.transferTag(tag.id, newOwner.id, newOwner.username);
  
  await interaction.reply({
    content: `✅ Tag \`${tagName}\` has been transferred to ${newOwner}.`
  });
}

async function handleNuke(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: '❌ You need the **Manage Server** permission to use this command.',
      flags: MessageFlags.Ephemeral
    });
  }
  
  const count = db.nukeTags(interaction.guildId);
  
  await interaction.reply({
    content: `🗑️ Deleted **${count}** tags from this server.`,
    flags: MessageFlags.Ephemeral
  });
}

async function handlePrune(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: '❌ You need the **Manage Server** permission to use this command.',
      flags: MessageFlags.Ephemeral
    });
  }
  
  const user = interaction.options.getUser('user');
  const count = db.pruneTagsByUser(interaction.guildId, user.id);
  
  await interaction.reply({
    content: `🗑️ Deleted **${count}** tags from ${user}.`,
    flags: MessageFlags.Ephemeral
  });
}
