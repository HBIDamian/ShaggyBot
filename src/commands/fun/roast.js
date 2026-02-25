const { SlashCommandBuilder, EmbedBuilder , MessageFlags } = require('discord.js');
const { createLogger } = require('../../utils/logger');
const fs = require('fs');
const path = require('path');

const logger = createLogger('RoastCommand');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roast')
    .setDescription('Roast a user')
    .setDMPermission(true)
    .addUserOption(option => 
      option
        .setName('member')
        .setDescription('The member to roast')
        .setRequired(true)),
  
  // Store insults cache
  insults: [],
  
  /**
   * Load insults from local JSON file
   * @returns {Promise<string[]>} Array of insults
   */
  async loadInsults() {
    try {
      const insultFilePath = path.join(__dirname, '../../../resources/insults.json');
      const insultData = fs.readFileSync(insultFilePath, 'utf8');
      const parsedData = JSON.parse(insultData);
      
      if (parsedData && Array.isArray(parsedData.insults)) {
        this.insults = parsedData.insults;
        logger.info(`Loaded ${this.insults.length} insults from local file`);
      } else {
        throw new Error('Invalid insults data format');
      }
    } catch (error) {
      logger.error(`Failed to load insults from local file: ${error.message}`);
      // Fallback insults in case file loading fails
      this.insults = [
        "You're so ugly that when you look in the mirror, your reflection ducks.",
        "If I had a face like yours, I'd sue my parents.",
        "Your birth certificate is an apology letter from the condom factory.",
        "I'd explain it to you but I don't have any crayons.",
        "You're as useful as a screen door on a submarine."
      ];
    }
    return this.insults;
  },
  
  async execute(interaction) {
    await interaction.deferReply();
    
    // Load insults if needed
    if (this.insults.length === 0) {
      await this.loadInsults();
      if (this.insults.length === 0) {
        return interaction.followUp({ content: "Sorry, couldn't load any insults right now.", flags: MessageFlags.Ephemeral });
      }
    }
    
    const targetUser = interaction.options.getUser('member');
    
    // Prevent roasting self, the bot, or other bots
    if (targetUser.id === interaction.user.id || 
        targetUser.id === interaction.client.user.id || 
        targetUser.bot) {
      return interaction.followUp({ content: "You can't roast this user!", flags: MessageFlags.Ephemeral });
    }
    
    try {
      const insult = this.insults[Math.floor(Math.random() * this.insults.length)];
      
      const embed = new EmbedBuilder()
        .setTitle('🔥 Roast!')
        .setDescription(insult)
        .setColor('#FF0000')
        .setFooter({ text: `Roasted by ${interaction.user.tag}` });
      
      await interaction.followUp({ 
        content: `${targetUser}`, 
        embeds: [embed] 
      });
    } catch (error) {
      logger.error(`Error in roast command: ${error.message}`);
      await interaction.followUp({ 
        content: "An error occurred while trying to roast the user.", 
        flags: MessageFlags.Ephemeral 
      });
    }
  },
};
