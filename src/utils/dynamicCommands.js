const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { createLogger } = require('./logger');

const logger = createLogger('DynamicCommands');

/**
 * Build a SlashCommandBuilder from a DB custom command record
 * @param {Object} cmd - Custom command from DB {command_name, command_description, subcommands}
 * @returns {SlashCommandBuilder}
 */
function buildSlashCommand(cmd) {
  const builder = new SlashCommandBuilder()
    .setName(cmd.command_name)
    .setDescription(cmd.command_description || 'No description')
    .setDMPermission(false);

  // Set default member permissions if specified
  if (cmd.default_permissions) {
    builder.setDefaultMemberPermissions(BigInt(cmd.default_permissions));
  }

  for (const sc of (cmd.subcommands || [])) {
    builder.addSubcommand(sub =>
      sub
        .setName(sc.name)
        .setDescription(sc.description || 'No description')
    );
  }

  return builder;
}

/**
 * Create an executable command object from a DB custom command record
 * Returns an object with `data` (SlashCommandBuilder) and `execute` (async function)
 * @param {Object} cmd - Custom command from DB
 * @returns {Object} { data: SlashCommandBuilder, execute: Function }
 */
function createDynamicCommand(cmd) {
  return {
    data: buildSlashCommand(cmd),
    async execute(interaction) {
      const subcommandName = interaction.options.getSubcommand(false);

      // Reload command from DB to get latest subcommands
      const db = require('../database/database');
      const currentCmd = db.getCustomGuildCommandByName(interaction.guildId, cmd.command_name);

      if (!currentCmd || !currentCmd.enabled) {
        return interaction.reply({
          content: '❌ This command is no longer available.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (!subcommandName) {
        // No subcommand provided — list available subcommands
        const subcommandList = (currentCmd.subcommands || [])
          .map(sc => `\`/${currentCmd.command_name} ${sc.name}\` — ${sc.description}`)
          .join('\n');

        return interaction.reply({
          content: `**/${currentCmd.command_name}** — ${currentCmd.command_description}\n\n**Subcommands:**\n${subcommandList || 'No subcommands available.'}`,
          flags: MessageFlags.Ephemeral
        });
      }

      const subcommand = (currentCmd.subcommands || []).find(sc => sc.name === subcommandName);

      if (!subcommand) {
        return interaction.reply({
          content: `❌ Unknown subcommand \`${subcommandName}\`. Use \`/${currentCmd.command_name}\` to see available options.`,
          flags: MessageFlags.Ephemeral
        });
      }

      try {
        const message = subcommand.message || '';
        const hasEmbed = subcommand.response_type === 'embed' && subcommand.response_content;

        if (hasEmbed) {
          const embedData = typeof subcommand.response_content === 'string'
            ? JSON.parse(subcommand.response_content)
            : subcommand.response_content;

          const embed = new EmbedBuilder(embedData);

          if (!embed.data.color) {
            embed.setColor('#5865F2');
          }

          return interaction.reply({
            content: message || undefined,
            embeds: [embed]
          });
        } else {
          const content = message || subcommand.response_content || 'No response configured.';
          return interaction.reply({ content });
        }
      } catch (err) {
        logger.error(`Error executing dynamic command /${cmd.command_name} ${subcommandName}: ${err.message}`);
        return interaction.reply({
          content: '❌ There was an error running this command. Please contact the server administrators.',
          flags: MessageFlags.Ephemeral
        });
      }
    }
  };
}

/**
 * Load all dynamic custom guild commands into the client's commands collection
 * @param {Object} client - Discord.js client
 * @returns {Map<string, string[]>} Map of guildId -> array of command names loaded
 */
function loadDynamicCommands(client) {
  const db = require('../database/database');
  const allCommands = db.getAllCustomGuildCommands();
  const guildMap = new Map();

  for (const [guildId, commands] of allCommands) {
    const names = [];
    for (const cmd of commands) {
      try {
        const command = createDynamicCommand(cmd);
        client.commands.set(cmd.command_name, command);
        names.push(cmd.command_name);
        logger.info(`Loaded dynamic guild command: /${cmd.command_name} (guild ${guildId})`);
      } catch (err) {
        logger.error(`Failed to build dynamic command /${cmd.command_name}: ${err.message}`);
      }
    }
    if (names.length > 0) {
      guildMap.set(guildId, names);
    }
  }

  return guildMap;
}

module.exports = {
  buildSlashCommand,
  createDynamicCommand,
  loadDynamicCommands
};
