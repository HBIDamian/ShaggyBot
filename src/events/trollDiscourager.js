const { Events } = require('discord.js');
const { createLogger } = require('../utils/logger');
const db = require('../database/database');
const crypto = require('crypto');

const logger = createLogger('TrollDiscourager');

// Random emojis for emoji spam
const TROLL_EMOJIS = ['🤡', '💀', '😂', '🤣', '😭', '🙄', '🤨', '😐', '👀', '🤓', '🤪', '😈', '👎', '🚫', '❌', '💩'];

module.exports = {
  name: Events.MessageCreate,
  once: false,
  async execute(message) {
    // Skip bot messages and DMs
    if (message.author.bot || !message.guild) {return;}

    // Get settings from database
    const settings = db.getTrollDiscouragerSettings(message.guild.id);

    // Check if enabled
    if (!settings.enabled) {return;}

    // Get target users from settings
    const targetUserIds = settings.target_users || [];

    // Check if the user is in the target list
    if (!targetUserIds.includes(message.author.id)) {return;}

    // Build available actions based on what's enabled
    const actions = [];
    if (settings.delete_enabled) {actions.push('delete');}
    if (settings.mock_enabled) {actions.push('mock');}
    if (settings.clown_enabled) {actions.push('clown');}
    if (settings.reverse_enabled) {actions.push('reverse');}
    if (settings.uwu_enabled) {actions.push('uwu');}
    if (settings.emoji_spam_enabled) {actions.push('emoji_spam');}
    if (settings.spoiler_enabled) {actions.push('spoiler');}

    if (actions.length === 0) {return;}

    // Securely choose one action (using crypto module for better randomness)
    const randomBytes = crypto.randomBytes(1);
    const chosenAction = actions[randomBytes[0] % actions.length];

    // Generate a secure percentage chance
    const percentageChance = crypto.randomInt(100) + 1;

    logger.debug(`Chosen action: ${chosenAction}, percentage chance: ${percentageChance}`);

    // Perform actions based on the chosen action and its individual chance
    if (chosenAction === 'delete' && percentageChance <= settings.delete_chance) {
      if (message.deletable) {
        logger.info(`Deleting message from ${message.author.tag} in ${message.guild.name}`);
        message.delete()
          .catch(error => logger.error(`Error deleting message: ${error.message}`));
      }
    } else if (chosenAction === 'mock' && percentageChance <= settings.mock_chance) {
      const mockedText = toggleCaseText(message.content);
      if (mockedText.trim()) {
        logger.info(`Mocking message from ${message.author.tag} in ${message.guild.name}`);
        message.channel.send(mockedText)
          .catch(error => logger.error(`Error sending mocked message: ${error.message}`));
      }
    } else if (chosenAction === 'clown' && percentageChance <= settings.clown_chance) {
      logger.info(`Reacting with clown to message from ${message.author.tag} in ${message.guild.name}`);
      message.react('🤡')
        .catch(error => logger.error(`Error reacting to message: ${error.message}`));
    } else if (chosenAction === 'reverse' && percentageChance <= settings.reverse_chance) {
      const reversedText = reverseText(message.content);
      if (reversedText.trim()) {
        logger.info(`Reversing message from ${message.author.tag} in ${message.guild.name}`);
        message.channel.send(`${message.author} says: ${reversedText}`)
          .catch(error => logger.error(`Error sending reversed message: ${error.message}`));
      }
    } else if (chosenAction === 'uwu' && percentageChance <= settings.uwu_chance) {
      const uwuText = uwuify(message.content);
      if (uwuText.trim()) {
        logger.info(`UwU-ifying message from ${message.author.tag} in ${message.guild.name}`);
        message.channel.send(`${message.author} says: ${uwuText}`)
          .catch(error => logger.error(`Error sending uwu message: ${error.message}`));
      }
    } else if (chosenAction === 'emoji_spam' && percentageChance <= settings.emoji_spam_chance) {
      logger.info(`Emoji spamming message from ${message.author.tag} in ${message.guild.name}`);
      // React with 3-5 random emojis
      const numEmojis = crypto.randomInt(3, 6);
      const shuffled = [...TROLL_EMOJIS].sort(() => crypto.randomInt(3) - 1);
      for (let i = 0; i < numEmojis; i++) {
        await message.react(shuffled[i]).catch(() => {});
        await sleep(300); // Small delay between reactions
      }
    } else if (chosenAction === 'spoiler' && percentageChance <= settings.spoiler_chance) {
      if (message.content.trim()) {
        logger.info(`Spoilering message from ${message.author.tag} in ${message.guild.name}`);
        message.reply({ content: `||${message.content}||`, allowedMentions: { repliedUser: false } })
          .catch(error => logger.error(`Error sending spoiler reply: ${error.message}`));
      }
    }
  },
};

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => { setTimeout(resolve, ms); });
}

/**
 * Toggles case of characters in a string (mocking text style)
 * @param {string} text - Text to toggle case
 * @returns {string} - Text with toggled case
 */
function toggleCaseText(text) {
  let result = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (i % 2 === 0) {
      result += toggleCase(char);
    } else {
      result += char;
    }
  }

  return result;
}

/**
 * Toggles case of a single character
 * @param {string} char - Character to toggle case
 * @returns {string} - Character with toggled case
 */
function toggleCase(char) {
  if (char.length !== 1) {return char;}
  if (/[a-zA-Z]/.test(char)) {
    return char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase();
  }
  return char;
}

/**
 * Reverses a string
 * @param {string} text - Text to reverse
 * @returns {string} - Reversed text
 */
function reverseText(text) {
  return text.split('').reverse().join('');
}

/**
 * UwU-ifies text
 * @param {string} text - Text to uwu-ify
 * @returns {string} - UwU-ified text
 */
function uwuify(text) {
  const faces = ['(・`ω´・)', ';;w;;', 'owo', 'UwU', '>w<', '^w^', '(⁄ ⁄•⁄ω⁄•⁄ ⁄)', '(╥﹏╥)'];

  let uwu = text
    .replace(/(?:r|l)/g, 'w')
    .replace(/(?:R|L)/g, 'W')
    .replace(/n([aeiou])/gi, 'ny$1')
    .replace(/N([aeiou])/gi, 'Ny$1')
    .replace(/N([AEIOU])/g, 'NY$1')
    .replace(/ove/g, 'uv')
    .replace(/!+/g, ' ' + faces[crypto.randomInt(faces.length)] + ' ');

  // Add random face at end sometimes
  if (crypto.randomInt(2) === 0) {
    uwu += ' ' + faces[crypto.randomInt(faces.length)];
  }

  return uwu;
}
