const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const {
    getStarboardSettings,
    addStarboardMessage,
    getStarboardMessage,
    updateStarboardMessage,
    removeStarboardMessage
} = require('../database/database');
const logger = require('../utils/logger');

module.exports = [
    {
        name: Events.MessageReactionAdd,
        async execute(reaction, user) {
            await handleReaction(reaction, user, 'add');
        },
    },
    {
        name: Events.MessageReactionRemove,
        async execute(reaction, user) {
            await handleReaction(reaction, user, 'remove');
        },
    },
];

async function handleReaction(reaction, _user, _action) {
    try {
        // Ignore DMs
        if (!reaction.message.guild) {return;}

        // Fetch partial messages/reactions if needed
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                logger.error('Failed to fetch partial reaction:', error);
                return;
            }
        }

        if (reaction.message.partial) {
            try {
                await reaction.message.fetch();
            } catch (error) {
                logger.error('Failed to fetch partial message:', error);
                return;
            }
        }

        const guildId = reaction.message.guild.id;
        const settings = getStarboardSettings(guildId);

        // Check if starboard is enabled
        if (!settings || !settings.enabled) {return;}

        // Check if starboard channel is set
        if (!settings.channel_id) {return;}

        // Get the emoji to check
        const starEmoji = settings.emoji || '⭐';
        const reactionEmoji = reaction.emoji.id ? reaction.emoji.id : reaction.emoji.name;

        // Check if this is the correct emoji
        if (reactionEmoji !== starEmoji && reaction.emoji.toString() !== starEmoji) {
            return;
        }

        const message = reaction.message;

        // Don't star messages from the starboard channel itself
        if (message.channel.id === settings.channel_id) {return;}

        // Check if channel is ignored
        const ignoredChannels = settings.ignored_channels || [];
        if (ignoredChannels.includes(message.channel.id)) {return;}

        // Check NSFW setting
        if (settings.ignore_nsfw && message.channel.nsfw) {return;}

        // Count valid stars
        const starCount = await countValidStars(reaction, message, settings);

        const threshold = settings.threshold || 3;
        const existingEntry = getStarboardMessage(guildId, message.id);

        if (starCount >= threshold) {
            // Should be on the starboard
            if (existingEntry) {
                // Update existing starboard message
                await updateStarboardEntry(message, existingEntry, starCount, settings);
            } else {
                // Create new starboard entry
                await createStarboardEntry(message, starCount, settings);
            }
        } else if (existingEntry) {
            // Below threshold - optionally remove or just update
            if (starCount === 0) {
                // Remove from starboard entirely
                await deleteStarboardEntry(message, existingEntry, settings);
            } else {
                // Just update the count
                await updateStarboardEntry(message, existingEntry, starCount, settings);
            }
        }
    } catch (error) {
        logger.error('Starboard error:', error);
    }
}

async function countValidStars(reaction, message, settings) {
    // Fetch all users who reacted with this emoji
    let users;
    try {
        users = await reaction.users.fetch();
    } catch {
        return reaction.count || 0;
    }

    let count = users.size;

    // If self-starring is disabled, subtract the author's star if present
    if (!settings.self_star && users.has(message.author.id)) {
        count--;
    }

    // Don't count bot reactions
    users.forEach(u => {
        if (u.bot) {count--;}
    });

    return Math.max(0, count);
}

async function createStarboardEntry(message, starCount, settings) {
    const guild = message.guild;
    const starboardChannel = guild.channels.cache.get(settings.channel_id);

    if (!starboardChannel) {
        logger.warn(`Starboard channel ${settings.channel_id} not found in guild ${guild.id}`);
        return;
    }

    const embed = buildStarboardEmbed(message, starCount, settings);
    const jumpButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('Jump to Message')
            .setStyle(ButtonStyle.Link)
            .setURL(message.url)
    );

    try {
        const starboardMessage = await starboardChannel.send({
            content: `${settings.emoji || '⭐'} **${starCount}** | <#${message.channel.id}>`,
            embeds: [embed],
            components: [jumpButton]
        });

        // Save to database
        addStarboardMessage({ guildId: guild.id, originalMessageId: message.id, originalChannelId: message.channel.id, authorId: message.author.id, starboardMessageId: starboardMessage.id, starCount });

        logger.info(`Added message ${message.id} to starboard in guild ${guild.name}`);
    } catch (error) {
        logger.error('Failed to create starboard entry:', error);
    }
}

async function updateStarboardEntry(message, existingEntry, starCount, settings) {
    const guild = message.guild;
    const starboardChannel = guild.channels.cache.get(settings.channel_id);

    if (!starboardChannel) {return;}

    try {
        const starboardMessage = await starboardChannel.messages.fetch(existingEntry.starboard_message_id);

        const embed = buildStarboardEmbed(message, starCount, settings);
        const jumpButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Jump to Message')
                .setStyle(ButtonStyle.Link)
                .setURL(message.url)
        );

        await starboardMessage.edit({
            content: `${settings.emoji || '⭐'} **${starCount}** | <#${message.channel.id}>`,
            embeds: [embed],
            components: [jumpButton]
        });

        // Update database
        updateStarboardMessage(guild.id, message.id, starCount);
    } catch (error) {
        // Message might have been deleted
        if (error.code === 10008) {
            // Unknown Message - remove from database
            removeStarboardMessage(guild.id, message.id);
        } else {
            logger.error('Failed to update starboard entry:', error);
        }
    }
}

async function deleteStarboardEntry(message, existingEntry, settings) {
    const guild = message.guild;
    const starboardChannel = guild.channels.cache.get(settings.channel_id);

    if (!starboardChannel) {return;}

    try {
        const starboardMessage = await starboardChannel.messages.fetch(existingEntry.starboard_message_id);
        await starboardMessage.delete();
    } catch (error) {
        // Ignore if message already deleted
        if (error.code !== 10008) {
            logger.error('Failed to delete starboard entry:', error);
        }
    }

    // Remove from database
    removeStarboardMessage(guild.id, message.id);
    logger.info(`Removed message ${message.id} from starboard in guild ${guild.name}`);
}

function buildStarboardEmbed(message, starCount, _settings) {
    const embed = new EmbedBuilder()
        .setColor(getStarColor(starCount))
        .setAuthor({
            name: message.author.displayName || message.author.username,
            iconURL: message.author.displayAvatarURL({ dynamic: true })
        })
        .setTimestamp(message.createdTimestamp)
        .setFooter({ text: `Message ID: ${message.id}` });

    // Add message content if present
    if (message.content) {
        embed.setDescription(message.content.slice(0, 4096));
    }

    // Add image if present
    const attachment = message.attachments.first();
    if (attachment) {
        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
        if (imageExtensions.some(ext => attachment.url.toLowerCase().includes(ext))) {
            embed.setImage(attachment.url);
        } else {
            // Non-image attachment
            embed.addFields({ name: 'Attachment', value: `[${attachment.name}](${attachment.url})` });
        }
    }

    // Check for embeds with images
    if (!embed.data.image && message.embeds.length > 0) {
        const msgEmbed = message.embeds[0];
        if (msgEmbed.image) {
            embed.setImage(msgEmbed.image.url);
        } else if (msgEmbed.thumbnail) {
            embed.setThumbnail(msgEmbed.thumbnail.url);
        }
    }

    // Add sticker preview if present
    if (message.stickers.size > 0) {
        const sticker = message.stickers.first();
        if (sticker.url) {
            embed.setImage(sticker.url);
        }
    }

    return embed;
}

function getStarColor(starCount) {
    // Color gradient based on star count
    if (starCount >= 20) {return 0xFFD700;} // Gold
    if (starCount >= 15) {return 0xFFE135;} // Banana yellow
    if (starCount >= 10) {return 0xFFE680;} // Light gold
    if (starCount >= 5) {return 0xFFEC8B;}  // Light goldenrod
    return 0xFFFF9F; // Light yellow
}
