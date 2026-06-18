const { Events, EmbedBuilder } = require('discord.js');
const { createLogger } = require('../utils/logger');
const db = require('../database/database');

const logger = createLogger('MessageFeatures');

// Discord message link regex
const DISCORD_MESSAGE_LINK = /https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/gi;

// GitHub file link with line numbers regex
const GITHUB_FILE_LINK = /https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+?)(?:#L(\d+)(?:-L(\d+))?)?(?:\s|$)/gi;

module.exports = {
  name: Events.MessageCreate,
  once: false,

  async execute(message, client) {
    // Skip bot messages and DMs
    if (message.author.bot || !message.guild) {return;}

    // Get guild settings
    const settings = db.getGuildSettings(message.guild.id);

    // Auto Quoter feature
    if (settings.auto_quoter_enabled) {
      await handleAutoQuoter(message, client);
    }

    // Git Code Previewer feature
    if (settings.git_previewer_enabled) {
      await handleGitPreviewer(message);
    }
  }
};

/**
 * Handle auto-quoting Discord message links
 */
async function handleAutoQuoter(message, client) {
  const links = [...message.content.matchAll(DISCORD_MESSAGE_LINK)];

  if (links.length === 0) {return;}

  for (const match of links.slice(0, 3)) { // Limit to 3 quotes per message
    const [, guildId, channelId, messageId] = match;

    try {
      // Get the guild
      const targetGuild = client.guilds.cache.get(guildId);
      if (!targetGuild) {continue;}

      // Get the channel
      const targetChannel = targetGuild.channels.cache.get(channelId);
      if (!targetChannel) {continue;}

      // Fetch the message
      const targetMessage = await targetChannel.messages.fetch(messageId).catch(() => null);
      if (!targetMessage) {continue;}

      // Build the quote embed
      const embed = new EmbedBuilder()
        .setAuthor({
          name: targetMessage.author.tag,
          iconURL: targetMessage.author.displayAvatarURL({ dynamic: true })
        })
        .setColor(0x5865F2)
        .setTimestamp(targetMessage.createdAt)
        .setFooter({ text: `#${targetChannel.name} • ${targetGuild.name}` });

      // Add message content
      if (targetMessage.content) {
        embed.setDescription(targetMessage.content.length > 4000
          ? targetMessage.content.slice(0, 4000) + '...'
          : targetMessage.content);
      }

      // Add first image attachment if present
      const imageAttachment = targetMessage.attachments.find(att =>
        att.contentType?.startsWith('image/')
      );
      if (imageAttachment) {
        embed.setImage(imageAttachment.url);
      }

      // Add embed images from the original message
      if (targetMessage.embeds.length > 0 && !imageAttachment) {
        const embedWithImage = targetMessage.embeds.find(e => e.image || e.thumbnail);
        if (embedWithImage) {
          embed.setImage(embedWithImage.image?.url || embedWithImage.thumbnail?.url);
        }
      }

      await message.channel.send({ embeds: [embed] });
      logger.debug(`Auto-quoted message ${messageId} in ${message.guild.name}`);

    } catch (error) {
      logger.error(`Error in auto quoter: ${error.message}`);
    }
  }
}

/**
 * Handle GitHub file link previews with code
 */
async function handleGitPreviewer(message) {
  const links = [...message.content.matchAll(GITHUB_FILE_LINK)];

  if (links.length === 0) {return;}

  for (const match of links.slice(0, 2)) { // Limit to 2 previews per message
    const [fullMatch, owner, repo, branch, filePath, startLine, endLine] = match;

    try {
      // Build raw file URL
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;

      // Fetch the file content
      const response = await fetch(rawUrl, {
        headers: {
          'User-Agent': 'ShaggyBot-Discord'
        }
      });

      if (!response.ok) {continue;}

      const content = await response.text();
      const lines = content.split('\n');

      // Determine line range
      let start = startLine ? parseInt(startLine) : 1;
      let end = endLine ? parseInt(endLine) : (startLine ? parseInt(startLine) : Math.min(15, lines.length));

      // Limit preview to 25 lines max
      if (end - start > 25) {
        end = start + 25;
      }

      // Clamp to valid line numbers
      start = Math.max(1, Math.min(start, lines.length));
      end = Math.max(start, Math.min(end, lines.length));

      // Extract the lines
      const codeLines = lines.slice(start - 1, end);

      // Format with line numbers
      const formattedCode = codeLines
        .map((line, i) => `${String(start + i).padStart(3)} │ ${line}`)
        .join('\n');

      // Get file extension for syntax highlighting
      const extension = filePath.split('.').pop() || '';

      // Determine language for code block
      const langMap = {
        'js': 'javascript',
        'ts': 'typescript',
        'py': 'python',
        'rb': 'ruby',
        'rs': 'rust',
        'go': 'go',
        'java': 'java',
        'c': 'c',
        'cpp': 'cpp',
        'h': 'c',
        'hpp': 'cpp',
        'cs': 'csharp',
        'php': 'php',
        'yml': 'yaml',
        'yaml': 'yaml',
        'json': 'json',
        'md': 'markdown',
        'sh': 'bash',
        'bash': 'bash',
        'sql': 'sql',
        'html': 'html',
        'css': 'css',
        'scss': 'scss',
        'xml': 'xml'
      };
      const lang = langMap[extension] || extension;

      // Build embed
      const fileName = filePath.split('/').pop();
      const embed = new EmbedBuilder()
        .setColor(0x24292e)
        .setAuthor({
          name: `${owner}/${repo}`,
          iconURL: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
          url: `https://github.com/${owner}/${repo}`
        })
        .setTitle(`📄 ${fileName}`)
        .setURL(fullMatch.trim())
        .setDescription(`Showing lines ${start}-${end} of \`${filePath}\`\n\`\`\`${lang}\n${formattedCode}\n\`\`\``)
        .setFooter({ text: `Branch: ${branch}` });

      // Check if description is too long
      if (embed.data.description.length > 4096) {
        // Truncate the code
        const truncatedCode = formattedCode.slice(0, 3800);
        embed.setDescription(`Showing lines ${start}-${end} of \`${filePath}\`\n\`\`\`${lang}\n${truncatedCode}\n... (truncated)\n\`\`\``);
      }

      await message.channel.send({ embeds: [embed] });
      logger.debug(`Git preview for ${owner}/${repo}/${filePath} in ${message.guild.name}`);

    } catch (error) {
      logger.error(`Error in git previewer: ${error.message}`);
    }
  }
}
