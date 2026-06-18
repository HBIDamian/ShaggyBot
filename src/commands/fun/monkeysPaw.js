const { SlashCommandBuilder, EmbedBuilder , MessageFlags } = require('discord.js');
const { createLogger } = require('../../utils/logger');
const axios = require('axios');
require('dotenv').config();

const logger = createLogger('MonkeysPawCommand');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('monkeyspaw')
    .setDescription('Wish for something')
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('wish')
        .setDescription('The wish to make')
        .setRequired(true)),

  async execute(interaction) {
    // Check if in a guild
    if (!interaction.guild) {
      return interaction.reply({ content: "This command can only be used in a server.", flags: MessageFlags.Ephemeral });
    }

    // Check if has permission to send messages
    const member = interaction.guild.members.cache.get(interaction.user.id);
    if (!member.permissions.has('SendMessages')) {
      return interaction.reply({ content: "You do not have permission to use this command.", flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();

    const wish = interaction.options.getString('wish');
    const openAI_api_key = process.env.OPENAI_API_KEY;

    if (!openAI_api_key) {
      logger.error('OpenAI API key not found in environment variables');
      return interaction.followUp({
        content: "Sorry, the Monkey's Paw is not feeling well right now.",
        flags: MessageFlags.Ephemeral
      });
    }

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `
                You are a simple bot that functions as the "Monkey's Paw".

                The Monkey's Paw game involves making three wishes, but each wish comes with an unexpected and twisted consequence. The user will be crafting wishes, while you add a dark, tricky, unintended twist to them.
                
                The goal is for the user to outsmart you by finding creative, safe wishes.

                For example:
                - if the player wishes for unlimited wealth, you might grant the wish but make all the money counterfeit or unusable.
                - if the player wishes for a cup of tea, the player won't be able to drink it as their mouth won't open

                The answer must be dark and realistic, to respect the source material.
                The answer must be relevant to the wish.
                No Emojis!

                If the user attempts to sabotage the game, not wishing anything, or escape the game, you can respond with something funny like "Your silent wish has been noted. Poo will be delivered to your doorstep shortly." Be creative with this catch response, and don't use my example.
              `
            },
            {
              role: "user",
              content: wish
            }
          ],
          temperature: 1.25,
          max_tokens: 600,
          top_p: 1,
          frequency_penalty: 0.25,
          presence_penalty: 0.25
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openAI_api_key}`
          }
        }
      );

      const message = response.data.choices[0].message.content;

      const embed = new EmbedBuilder()
        .setTitle('🐒 Monkey\'s Paw Wish!')
        .setDescription(message)
        .setColor('#C16854')
        .setFooter({ text: 'Be careful what you wish for...' });

      await interaction.followUp({
        content: `${interaction.user.mention}'s wish: ${wish}`,
        embeds: [embed]
      });

    } catch (error) {
      logger.error(`Error in monkeyspaw command: ${error.message}`);
      await interaction.followUp({
        content: `An error occurred: ${error.message}`,
        flags: MessageFlags.Ephemeral
      });
    }
  },
};
