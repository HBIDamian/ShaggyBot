const { Events } = require('discord.js');
const { createLogger } = require('../utils/logger');
const db = require('../database/database');

const logger = createLogger('AutoDehoist');

// Characters that "hoist" a name to the top of the member list
const HOIST_CHARS = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~0123456789';

module.exports = {
  name: Events.GuildMemberUpdate,
  once: false,

  async execute(oldMember, newMember) {
    // Check if username/nickname changed
    const oldName = oldMember.displayName;
    const newName = newMember.displayName;

    if (oldName === newName) {return;}

    // Get automod settings
    const settings = db.getAutomodSettings(newMember.guild.id);

    // Check if automod and dehoist are enabled
    if (!settings.enabled || !settings.dehoist_enabled) {return;}

    // Check if name starts with a hoist character
    const firstChar = newName.charAt(0);
    if (!HOIST_CHARS.includes(firstChar)) {return;}

    // Don't modify bots if excluded
    if (settings.exclude_bots && newMember.user.bot) {return;}

    // Don't modify admins/mods if excluded
    if (settings.exclude_admins && newMember.permissions.has('Administrator')) {return;}
    if (settings.exclude_mods && newMember.permissions.has('ModerateMembers')) {return;}

    // Check exempt roles
    const memberRoles = newMember.roles.cache.map(r => r.id);
    if (settings.exempt_roles.some(roleId => memberRoles.includes(roleId))) {return;}

    try {
      // Find the first non-hoist character
      let cleanName = newName;
      while (cleanName.length > 0 && HOIST_CHARS.includes(cleanName.charAt(0))) {
        cleanName = cleanName.substring(1);
      }

      // If the name is empty or still invalid, use a default
      if (!cleanName || cleanName.length === 0) {
        cleanName = 'Dehoisted User';
      }

      // Only change if we can
      if (newMember.manageable) {
        await newMember.setNickname(cleanName, '[AutoMod] Auto-dehoist');
        logger.info(`Dehoisted ${newMember.user.tag} in ${newMember.guild.name}: "${newName}" -> "${cleanName}"`);

        // Log to automod channel if configured
        if (settings.log_channel) {
          const channel = await newMember.guild.channels.fetch(settings.log_channel).catch(() => null);
          if (channel) {
            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle('⬆️ Auto-Dehoist')
              .setDescription(`Renamed ${newMember} to remove hoisting characters`)
              .addFields(
                { name: 'User', value: `${newMember.user.tag}\n\`${newMember.id}\``, inline: true },
                { name: 'Old Name', value: newName, inline: true },
                { name: 'New Name', value: cleanName, inline: true }
              )
              .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true }))
              .setTimestamp()
              .setFooter({ text: 'ShaggyBot AutoMod' });

            await channel.send({ embeds: [embed] });
          }
        }
      }
    } catch (error) {
      logger.error(`Failed to dehoist ${newMember.user.tag}: ${error.message}`);
    }
  }
};
