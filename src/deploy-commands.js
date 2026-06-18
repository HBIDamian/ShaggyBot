#!/usr/bin/env node
// Script to register slash commands with Discord
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { createLogger } = require('./utils/logger');

const logger = createLogger('DeployCommands');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID;

// Custom commands config
const CUSTOM_COMMANDS_MODE = (process.env.CUSTOM_COMMANDS_MODE || 'whitelist').toLowerCase();
const CUSTOM_COMMANDS_ALLOWED = (process.env.CUSTOM_COMMANDS_ALLOWED_GUILDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(id => /^\d{17,20}$/.test(id));

function isCustomCommandsAllowed(guildId) {
  if (CUSTOM_COMMANDS_MODE === 'off') {return false;}
  if (CUSTOM_COMMANDS_MODE === 'global') {return true;}
  if (CUSTOM_COMMANDS_MODE === 'whitelist') {return CUSTOM_COMMANDS_ALLOWED.includes(guildId);}
  return false;
}

// DB and dynamic command builder (for DB-based guild custom commands)
const db = require('./database/database');
const { buildSlashCommand } = require('./utils/dynamicCommands');

// Validate required environment variables
if (!TOKEN) {
  logger.error('DISCORD_TOKEN is not set');
  process.exit(1);
}

if (!CLIENT_ID) {
  logger.error('DISCORD_CLIENT_ID or CLIENT_ID is not set');
  process.exit(1);
}

/**
 * Recursively load commands from a directory
 */
function loadCommands(dirPath, commands = []) {
  if (!fs.existsSync(dirPath)) {return commands;}

  const items = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const item of items) {
    const itemPath = path.join(dirPath, item.name);

    if (item.isDirectory()) {
      loadCommands(itemPath, commands);
    } else if (item.name.endsWith('.js')) {
      try {
        const command = require(itemPath);
        if (command.data) {
          logger.info(`Adding: ${command.data.name}`);
          commands.push(command.data.toJSON());
        }
      } catch (err) {
        logger.warn(`Failed to load ${itemPath}: ${err.message}`);
      }
    }
  }

  return commands;
}

/**
 * Convert deprecated dm_permission to current integration/context fields
 */
function processCommandContexts(commands) {
  return commands.map(cmd => {
    const dmAllowed = cmd.dm_permission !== false;
    const { dm_permission: _dm, ...cleanCmd } = cmd;

    return {
      ...cleanCmd,
      integration_types: dmAllowed ? [0, 1] : [0],
      contexts: dmAllowed ? [0, 1, 2] : [0],
    };
  });
}

async function deploy() {
  const globalCommands = [
    ...loadCommands(path.join(__dirname, 'commands')),
    ...loadCommands(path.join(__dirname, 'contextMenus'))
  ];
  const guildCommandMap = new Map();

  // Merge DB-based dynamic guild commands (only if mode allows)
  if (CUSTOM_COMMANDS_MODE !== 'off') {
    const dbCommandMap = db.getAllCustomGuildCommands();
    for (const [guildId, dbCommands] of dbCommandMap) {
      if (!isCustomCommandsAllowed(guildId)) {continue;}

      const dynamicCommandsJson = dbCommands
        .filter(cmd => cmd.enabled)
        .map(cmd => buildSlashCommand(cmd).toJSON());

      if (dynamicCommandsJson.length === 0) {continue;}
      guildCommandMap.set(guildId, dynamicCommandsJson);
    }
  }

  // Collect guilds to clear (mode off)
  const guildsToClear = new Set();
  if (CUSTOM_COMMANDS_MODE === 'off') {
    const dbCommandMap = db.getAllCustomGuildCommands();
    for (const [guildId] of dbCommandMap) {
      guildsToClear.add(guildId);
    }
  }

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  try {
    logger.info(`Deploying ${globalCommands.length} global commands...`);

    const processedGlobalCommands = processCommandContexts(globalCommands);

    const data = await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: processedGlobalCommands }
    );

    logger.info(`Successfully deployed ${data.length} global commands`);

    // Clear guild commands for guilds that lost access
    for (const guildId of guildsToClear) {
      try {
        logger.info(`Clearing guild commands for ${guildId} (not allowed/off)...`);
        await rest.put(
          Routes.applicationGuildCommands(CLIENT_ID, guildId),
          { body: [] }
        );
        logger.info(`Cleared guild commands for ${guildId}`);
      } catch (err) {
        logger.error(`Failed to clear guild commands for ${guildId}: ${err.message}`);
      }
    }

    // Deploy for allowed guilds
    for (const [guildId, guildCommands] of guildCommandMap.entries()) {
      const processedGuildCommands = processCommandContexts(guildCommands);
      logger.info(`Deploying ${processedGuildCommands.length} guild command(s) to ${guildId}...`);

      const guildData = await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, guildId),
        { body: processedGuildCommands }
      );

      logger.info(`Successfully deployed ${guildData.length} guild command(s) to ${guildId}`);
    }
  } catch (error) {
    logger.error(`Deployment failed: ${error.message}`, error);
    process.exit(1);
  }
}

deploy();
