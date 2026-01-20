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
  if (!fs.existsSync(dirPath)) return commands;
  
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

async function deploy() {
  const commands = [
    ...loadCommands(path.join(__dirname, 'commands')),
    ...loadCommands(path.join(__dirname, 'contextMenus'))
  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  try {
    logger.info(`Deploying ${commands.length} commands...`);

    const data = await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );

    logger.info(`Successfully deployed ${data.length} commands`);
  } catch (error) {
    logger.error(`Deployment failed: ${error.message}`, error);
    process.exit(1);
  }
}

deploy();
