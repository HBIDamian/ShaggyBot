const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk delete messages from a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(subcommand =>
      subcommand
        .setName('any')
        .setDescription('Delete a number of messages in the channel')
        .addIntegerOption(option =>
          option.setName('amount')
            .setDescription('Number of messages to delete (1-100)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100))
        .addBooleanOption(option =>
          option.setName('reactions-only')
            .setDescription('Only remove reactions instead of deleting messages')
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('between')
        .setDescription('Delete every message between two given message IDs (includes the two given)')
        .addStringOption(option =>
          option.setName('first-message-id')
            .setDescription('The first message ID')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('second-message-id')
            .setDescription('The second message ID')
            .setRequired(true))
        .addBooleanOption(option =>
          option.setName('reactions-only')
            .setDescription('Only remove reactions instead of deleting messages')
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('bots')
        .setDescription('Delete messages sent by any bots in the channel')
        .addIntegerOption(option =>
          option.setName('amount')
            .setDescription('Number of messages to scan (1-100)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100))
        .addBooleanOption(option =>
          option.setName('reactions-only')
            .setDescription('Only remove reactions instead of deleting messages')
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('components')
        .setDescription('Delete messages that contain components (buttons/selects)')
        .addIntegerOption(option =>
          option.setName('amount')
            .setDescription('Number of messages to scan (1-100)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100))
        .addBooleanOption(option =>
          option.setName('reactions-only')
            .setDescription('Only remove reactions instead of deleting messages')
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('embeds')
        .setDescription('Delete messages containing rich embeds in the channel')
        .addIntegerOption(option =>
          option.setName('amount')
            .setDescription('Number of messages to scan (1-100)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100))
        .addBooleanOption(option =>
          option.setName('reactions-only')
            .setDescription('Only remove reactions instead of deleting messages')
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('images')
        .setDescription('Delete a number of images in the channel')
        .addIntegerOption(option =>
          option.setName('amount')
            .setDescription('Number of messages to scan (1-100)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100))
        .addBooleanOption(option =>
          option.setName('reactions-only')
            .setDescription('Only remove reactions instead of deleting messages')
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('invites')
        .setDescription('Delete server invites posted in the channel')
        .addIntegerOption(option =>
          option.setName('amount')
            .setDescription('Number of messages to scan (1-100)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100))
        .addBooleanOption(option =>
          option.setName('reactions-only')
            .setDescription('Only remove reactions instead of deleting messages')
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('links')
        .setDescription('Delete a number of links posted in the channel')
        .addIntegerOption(option =>
          option.setName('amount')
            .setDescription('Number of messages to scan (1-100)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100))
        .addBooleanOption(option =>
          option.setName('reactions-only')
            .setDescription('Only remove reactions instead of deleting messages')
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('mentions')
        .setDescription('Delete messages with mentions in the channel')
        .addIntegerOption(option =>
          option.setName('amount')
            .setDescription('Number of messages to scan (1-100)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100))
        .addBooleanOption(option =>
          option.setName('reactions-only')
            .setDescription('Only remove reactions instead of deleting messages')
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('self')
        .setDescription('Delete messages sent by this bot in the channel')
        .addIntegerOption(option =>
          option.setName('amount')
            .setDescription('Number of messages to scan (1-100)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100))
        .addBooleanOption(option =>
          option.setName('reactions-only')
            .setDescription('Only remove reactions instead of deleting messages')
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('until')
        .setDescription('Delete every message after the given message ID')
        .addStringOption(option =>
          option.setName('message-id')
            .setDescription('The message ID to delete messages after')
            .setRequired(true))
        .addBooleanOption(option =>
          option.setName('reactions-only')
            .setDescription('Only remove reactions instead of deleting messages')
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('user')
        .setDescription('Delete messages sent by given user')
        .addUserOption(option =>
          option.setName('user')
            .setDescription('The user whose messages to delete')
            .setRequired(true))
        .addIntegerOption(option =>
          option.setName('amount')
            .setDescription('Number of messages to scan (1-100)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100))
        .addBooleanOption(option =>
          option.setName('reactions-only')
            .setDescription('Only remove reactions instead of deleting messages')
            .setRequired(false))),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const reactionsOnly = interaction.options.getBoolean('reactions-only') || false;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      let messagesToProcess = [];
      let deleted = 0;

      switch (subcommand) {
        case 'any': {
          const amount = interaction.options.getInteger('amount');
          messagesToProcess = await interaction.channel.messages.fetch({ limit: amount });
          break;
        }

        case 'between': {
          const firstId = interaction.options.getString('first-message-id');
          const secondId = interaction.options.getString('second-message-id');
          
          // Determine which ID is older (smaller snowflake = older)
          const startId = BigInt(firstId) < BigInt(secondId) ? firstId : secondId;
          const endId = BigInt(firstId) < BigInt(secondId) ? secondId : firstId;
          
          // Fetch messages after the start ID
          const messages = await interaction.channel.messages.fetch({ after: startId, limit: 100 });
          
          // Filter to only include messages up to and including the end ID, plus the start message
          messagesToProcess = messages.filter(m => BigInt(m.id) <= BigInt(endId));
          
          // Try to include the start message
          try {
            const startMessage = await interaction.channel.messages.fetch(startId);
            messagesToProcess.set(startMessage.id, startMessage);
          } catch (e) {
            // Start message may have been deleted
          }
          break;
        }

        case 'bots': {
          const amount = interaction.options.getInteger('amount');
          const messages = await interaction.channel.messages.fetch({ limit: amount });
          messagesToProcess = messages.filter(m => m.author.bot);
          break;
        }

        case 'components': {
          const amount = interaction.options.getInteger('amount');
          const messages = await interaction.channel.messages.fetch({ limit: amount });
          messagesToProcess = messages.filter(m => m.components.length > 0);
          break;
        }

        case 'embeds': {
          const amount = interaction.options.getInteger('amount');
          const messages = await interaction.channel.messages.fetch({ limit: amount });
          messagesToProcess = messages.filter(m => m.embeds.length > 0);
          break;
        }

        case 'images': {
          const amount = interaction.options.getInteger('amount');
          const messages = await interaction.channel.messages.fetch({ limit: amount });
          const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
          messagesToProcess = messages.filter(m => 
            m.attachments.some(a => imageExtensions.some(ext => a.name?.toLowerCase().endsWith(ext))) ||
            m.embeds.some(e => e.image || e.thumbnail)
          );
          break;
        }

        case 'invites': {
          const amount = interaction.options.getInteger('amount');
          const messages = await interaction.channel.messages.fetch({ limit: amount });
          const inviteRegex = /(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/[\w-]+/i;
          messagesToProcess = messages.filter(m => inviteRegex.test(m.content));
          break;
        }

        case 'links': {
          const amount = interaction.options.getInteger('amount');
          const messages = await interaction.channel.messages.fetch({ limit: amount });
          const urlRegex = /https?:\/\/[^\s]+/i;
          messagesToProcess = messages.filter(m => urlRegex.test(m.content));
          break;
        }

        case 'mentions': {
          const amount = interaction.options.getInteger('amount');
          const messages = await interaction.channel.messages.fetch({ limit: amount });
          messagesToProcess = messages.filter(m => 
            m.mentions.users.size > 0 || 
            m.mentions.roles.size > 0 || 
            m.mentions.everyone
          );
          break;
        }

        case 'self': {
          const amount = interaction.options.getInteger('amount');
          const messages = await interaction.channel.messages.fetch({ limit: amount });
          messagesToProcess = messages.filter(m => m.author.id === interaction.client.user.id);
          break;
        }

        case 'until': {
          const messageId = interaction.options.getString('message-id');
          
          // Fetch messages after the given ID
          messagesToProcess = await interaction.channel.messages.fetch({ after: messageId, limit: 100 });
          break;
        }

        case 'user': {
          const user = interaction.options.getUser('user');
          const amount = interaction.options.getInteger('amount');
          const messages = await interaction.channel.messages.fetch({ limit: amount });
          messagesToProcess = messages.filter(m => m.author.id === user.id);
          break;
        }
      }

      // Convert to array if it's a Collection
      const messagesArray = messagesToProcess instanceof Map ? [...messagesToProcess.values()] : messagesToProcess;

      if (messagesArray.length === 0) {
        return interaction.editReply({ content: '❌ No messages found matching the criteria.' });
      }

      if (reactionsOnly) {
        // Remove reactions only
        for (const message of messagesArray) {
          if (message.reactions.cache.size > 0) {
            await message.reactions.removeAll();
            deleted++;
          }
        }
        return interaction.editReply({ 
          content: `✅ Removed reactions from **${deleted}** message${deleted !== 1 ? 's' : ''}.` 
        });
      } else {
        // Filter out messages older than 14 days (Discord limitation)
        const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
        const deletableMessages = messagesArray.filter(m => m.createdTimestamp > twoWeeksAgo);
        const oldMessages = messagesArray.length - deletableMessages.length;

        if (deletableMessages.length === 0) {
          return interaction.editReply({ 
            content: '❌ All messages are older than 14 days and cannot be bulk deleted.' 
          });
        }

        // Bulk delete (works for 2+ messages)
        if (deletableMessages.length >= 2) {
          const deletedMessages = await interaction.channel.bulkDelete(deletableMessages, true);
          deleted = deletedMessages.size;
        } else if (deletableMessages.length === 1) {
          // Single message delete
          await deletableMessages[0].delete();
          deleted = 1;
        }

        let response = `✅ Deleted **${deleted}** message${deleted !== 1 ? 's' : ''}.`;
        if (oldMessages > 0) {
          response += `\n⚠️ ${oldMessages} message${oldMessages !== 1 ? 's were' : ' was'} older than 14 days and could not be deleted.`;
        }

        return interaction.editReply({ content: response });
      }

    } catch (error) {
      console.error('Purge error:', error);
      
      if (error.code === 10008) {
        return interaction.editReply({ content: '❌ One or more message IDs were invalid.' });
      }
      
      return interaction.editReply({ content: `❌ An error occurred: ${error.message}` });
    }
  },
};
