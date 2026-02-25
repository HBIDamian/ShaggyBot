const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType, MessageFlags } = require('discord.js');
const { createLogger } = require('../../utils/logger');
const db = require('../../database/database');

const logger = createLogger('HoneypotCommand');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('honeypot')
    .setDescription('Configure honeypot channel to automatically catch and ban spam bots')
    .setDMPermission(false)
    .addSubcommand(subcommand =>
      subcommand
        .setName('setup')
        .setDescription('Set up or update honeypot configuration')
        .addChannelOption(option =>
          option.setName('honeypot_channel')
            .setDescription('The honeypot channel (any message here triggers ban/kick)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true))
        .addChannelOption(option =>
          option.setName('log_channel')
            .setDescription('Channel to log honeypot catches')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true))
        .addStringOption(option =>
          option.setName('action')
            .setDescription('Action to take when user triggers honeypot')
            .setRequired(false)
            .addChoices(
              { name: 'Softban (ban & unban to delete messages)', value: 'softban' },
              { name: 'Ban (permanent)', value: 'ban' },
              { name: 'Kick', value: 'kick' }
            )))
    .addSubcommand(subcommand =>
      subcommand
        .setName('disable')
        .setDescription('Disable the honeypot feature'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('View current honeypot configuration'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('settings')
        .setDescription('Configure additional honeypot settings')
        .addBooleanOption(option =>
          option.setName('dm_user')
            .setDescription('DM the user when they trigger the honeypot (default: true)')
            .setRequired(false))
        .addBooleanOption(option =>
          option.setName('delete_messages')
            .setDescription('Delete recent messages from the user (default: true)')
            .setRequired(false)))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'setup':
        return handleSetup(interaction);
      case 'disable':
        return handleDisable(interaction);
      case 'status':
        return handleStatus(interaction);
      case 'settings':
        return handleSettings(interaction);
      default:
        return interaction.reply({ content: '❌ Unknown subcommand.', flags: MessageFlags.Ephemeral });
    }
  }
};

async function handleSetup(interaction) {
  const honeypotChannel = interaction.options.getChannel('honeypot_channel');
  const logChannel = interaction.options.getChannel('log_channel');
  const action = interaction.options.getString('action') || 'softban';

  // Check bot permissions in honeypot channel
  const botMember = interaction.guild.members.me;
  const honeypotPerms = honeypotChannel.permissionsFor(botMember);
  
  if (!honeypotPerms.has(PermissionFlagsBits.ViewChannel) || !honeypotPerms.has(PermissionFlagsBits.ManageMessages)) {
    return interaction.reply({
      content: `❌ I need **View Channel** and **Manage Messages** permissions in ${honeypotChannel}.`,
      flags: MessageFlags.Ephemeral
    });
  }

  // Check bot permissions in log channel
  const logPerms = logChannel.permissionsFor(botMember);
  if (!logPerms.has(PermissionFlagsBits.ViewChannel) || !logPerms.has(PermissionFlagsBits.SendMessages)) {
    return interaction.reply({
      content: `❌ I need **View Channel** and **Send Messages** permissions in ${logChannel}.`,
      flags: MessageFlags.Ephemeral
    });
  }

  // Check if bot has ban permission
  if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
    return interaction.reply({
      content: '❌ I need **Ban Members** permission to use the honeypot feature.',
      flags: MessageFlags.Ephemeral
    });
  }

  try {
    db.updateHoneypotSettings(interaction.guildId, {
      enabled: 1,
      honeypot_channel_id: honeypotChannel.id,
      log_channel_id: logChannel.id,
      action: action
    });

    const actionDescriptions = {
      softban: 'Softban (ban & immediately unban to delete messages)',
      ban: 'Permanent ban',
      kick: 'Kick from server'
    };

    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('🍯 Honeypot Configured')
      .setDescription('The honeypot feature has been set up successfully!')
      .addFields(
        { name: 'Honeypot Channel', value: `${honeypotChannel}`, inline: true },
        { name: 'Log Channel', value: `${logChannel}`, inline: true },
        { name: 'Action', value: actionDescriptions[action], inline: true }
      )
      .setFooter({ text: 'Any user who sends a message in the honeypot channel will be actioned' })
      .setTimestamp();

    // Send a warning message to the honeypot channel
    try {
      const currentSettings = db.getHoneypotSettings(interaction.guildId);
      const embedTitle = currentSettings.embed_title || 'DO NOT SEND MESSAGES IN THIS CHANNEL';
      const embedDesc = currentSettings.embed_description || 'This channel is used to catch spam bots. Any messages sent here will result in automatic moderation action.';

      const warningEmbed = new EmbedBuilder()
        .setColor(0xFF6B6B)
        .setTitle(embedTitle)
        .setDescription(embedDesc);

      if (currentSettings.embed_image) {
        warningEmbed.setImage(currentSettings.embed_image);
      }

      const sent = await honeypotChannel.send({ embeds: [warningEmbed] });
      db.updateHoneypotSettings(interaction.guildId, { embed_message_id: sent.id });
    } catch (err) {
      logger.warn(`Could not send warning message to honeypot channel: ${err.message}`);
    }

    // Send confirmation to log channel
    try {
      const logEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🍯 Honeypot Enabled')
        .setDescription(`Honeypot has been configured by ${interaction.user.tag}`)
        .addFields(
          { name: 'Honeypot Channel', value: `${honeypotChannel}`, inline: true },
          { name: 'Action', value: actionDescriptions[action], inline: true }
        )
        .setTimestamp();

      await logChannel.send({ embeds: [logEmbed] });
    } catch (err) {
      logger.warn(`Could not send confirmation to log channel: ${err.message}`);
    }

    logger.info(`Honeypot configured in ${interaction.guild.name} (${interaction.guildId})`);
    return interaction.reply({ embeds: [embed] });

  } catch (err) {
    logger.error(`Error setting up honeypot: ${err.message}`);
    return interaction.reply({
      content: '❌ An error occurred while setting up the honeypot.',
      flags: MessageFlags.Ephemeral
    });
  }
}

async function handleDisable(interaction) {
  try {
    db.updateHoneypotSettings(interaction.guildId, {
      enabled: 0
    });

    const embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('🍯 Honeypot Disabled')
      .setDescription('The honeypot feature has been disabled. Users can now safely send messages in the honeypot channel.')
      .setTimestamp();

    logger.info(`Honeypot disabled in ${interaction.guild.name} (${interaction.guildId})`);
    return interaction.reply({ embeds: [embed] });

  } catch (err) {
    logger.error(`Error disabling honeypot: ${err.message}`);
    return interaction.reply({
      content: '❌ An error occurred while disabling the honeypot.',
      flags: MessageFlags.Ephemeral
    });
  }
}

async function handleStatus(interaction) {
  try {
    const settings = db.getHoneypotSettings(interaction.guildId);

    const embed = new EmbedBuilder()
      .setColor(settings.enabled ? 0x00FF00 : 0xFF0000)
      .setTitle('🍯 Honeypot Status')
      .setTimestamp();

    if (!settings.enabled) {
      embed.setDescription('The honeypot feature is currently **disabled**.\n\nUse `/honeypot setup` to enable it.');
    } else {
      const honeypotChannel = settings.honeypot_channel_id ? `<#${settings.honeypot_channel_id}>` : 'Not set';
      const logChannel = settings.log_channel_id ? `<#${settings.log_channel_id}>` : 'Not set';
      
      const actionDescriptions = {
        softban: 'Softban (ban & unban)',
        ban: 'Permanent ban',
        kick: 'Kick'
      };

      embed.setDescription('The honeypot feature is currently **enabled**.')
        .addFields(
          { name: 'Honeypot Channel', value: honeypotChannel, inline: true },
          { name: 'Log Channel', value: logChannel, inline: true },
          { name: 'Action', value: actionDescriptions[settings.action] || 'Softban', inline: true },
          { name: 'DM User', value: settings.dm_user ? 'Yes' : 'No', inline: true },
          { name: 'Delete Messages', value: settings.delete_messages ? 'Yes' : 'No', inline: true }
        );
    }

    return interaction.reply({ embeds: [embed] });

  } catch (err) {
    logger.error(`Error getting honeypot status: ${err.message}`);
    return interaction.reply({
      content: '❌ An error occurred while getting honeypot status.',
      flags: MessageFlags.Ephemeral
    });
  }
}

async function handleSettings(interaction) {
  const dmUser = interaction.options.getBoolean('dm_user');
  const deleteMessages = interaction.options.getBoolean('delete_messages');

  if (dmUser === null && deleteMessages === null) {
    return interaction.reply({
      content: '❌ Please specify at least one setting to change.',
      flags: MessageFlags.Ephemeral
    });
  }

  try {
    const updates = {};
    const changes = [];

    if (dmUser !== null) {
      updates.dm_user = dmUser ? 1 : 0;
      changes.push(`DM User: **${dmUser ? 'Enabled' : 'Disabled'}**`);
    }

    if (deleteMessages !== null) {
      updates.delete_messages = deleteMessages ? 1 : 0;
      changes.push(`Delete Messages: **${deleteMessages ? 'Enabled' : 'Disabled'}**`);
    }

    db.updateHoneypotSettings(interaction.guildId, updates);

    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('🍯 Honeypot Settings Updated')
      .setDescription(changes.join('\n'))
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });

  } catch (err) {
    logger.error(`Error updating honeypot settings: ${err.message}`);
    return interaction.reply({
      content: '❌ An error occurred while updating honeypot settings.',
      flags: MessageFlags.Ephemeral
    });
  }
}
