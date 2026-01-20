const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Display detailed information about a user')
    .addUserOption(option => 
      option.setName('user')
        .setDescription('The user to get information about')
        .setRequired(false)),
  
  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const member = interaction.guild?.members.cache.get(targetUser.id);
    
    // Calculate account age
    const createdTimestamp = Math.floor(targetUser.createdTimestamp / 1000);
    const accountAgeDays = Math.floor((Date.now() - targetUser.createdTimestamp) / (1000 * 60 * 60 * 24));
    
    const embed = new EmbedBuilder()
      .setTitle(`Info | ${targetUser.username}'s User Info`)
      .setDescription(`Joined Discord on <t:${createdTimestamp}:f>. That is **${accountAgeDays.toLocaleString()} days** ago!`)
      .setColor(member?.displayHexColor !== '#000000' ? member?.displayHexColor : '#5865F2')
      .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }));
    
    if (member) {
      // Calculate guild join info
      const joinedTimestamp = Math.floor(member.joinedTimestamp / 1000);
      const joinedAgeDays = Math.floor((Date.now() - member.joinedTimestamp) / (1000 * 60 * 60 * 24));
      const joinedDate = member.joinedAt.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      // Get presence/status
      const presence = member.presence;
      let status = 'Offline';
      if (presence) {
        const statusMap = {
          'online': 'Online',
          'idle': 'Idle',
          'dnd': 'Do Not Disturb',
          'offline': 'Offline'
        };
        status = statusMap[presence.status] || 'Offline';
      }
      
      // Get activity
      let activity = 'None';
      if (presence?.activities?.length > 0) {
        const act = presence.activities[0];
        if (act.type === 0) activity = `Playing ${act.name}`;
        else if (act.type === 1) activity = `Streaming ${act.name}`;
        else if (act.type === 2) activity = `Listening to ${act.name}`;
        else if (act.type === 3) activity = `Watching ${act.name}`;
        else if (act.type === 4) activity = act.state || 'Custom Status';
        else if (act.type === 5) activity = `Competing in ${act.name}`;
        else activity = act.name;
      }
      
      // Calculate join position
      const sortedMembers = [...interaction.guild.members.cache.values()]
        .sort((a, b) => a.joinedTimestamp - b.joinedTimestamp);
      const joinPosition = sortedMembers.findIndex(m => m.id === member.id);
      
      // Get voice state
      const voiceState = member.voice;
      const isMuted = voiceState?.mute || voiceState?.selfMute ? 'Yes' : 'No';
      const isDeafened = voiceState?.deaf || voiceState?.selfDeaf ? 'Yes' : 'No';
      
      // Get boosting status
      let boostStatus = 'N/A';
      if (member.premiumSince) {
        const boostDays = Math.floor((Date.now() - member.premiumSinceTimestamp) / (1000 * 60 * 60 * 24));
        boostStatus = `Since <t:${Math.floor(member.premiumSinceTimestamp / 1000)}:d> (${boostDays} days)`;
      }
      
      // Get acknowledgements (special roles/permissions)
      const acknowledgements = [];
      if (interaction.guild.ownerId === member.id) acknowledgements.push('Server Owner');
      if (member.permissions.has('Administrator')) acknowledgements.push('Administrator');
      else if (member.permissions.has('ManageGuild')) acknowledgements.push('Server Manager');
      else if (member.permissions.has('ModerateMembers')) acknowledgements.push('Moderator');
      
      // Get roles
      const roles = member.roles.cache
        .filter(role => role.id !== interaction.guild.id)
        .sort((a, b) => b.position - a.position)
        .map(role => role.name)
        .join(', ') || 'None';
      
      // Get warnings count for this guild
      const warningCount = db.getWarningCount(interaction.guild.id, targetUser.id);
      
      // Get highest role for the replaced Avatar field
      const highestRole = member.roles.highest.id !== interaction.guild.id 
        ? member.roles.highest.name 
        : 'None';
      
      embed.addFields(
        { name: '🚦 Status', value: `\`\`\`${status}\`\`\``, inline: true },
        { name: '🎮 Activity', value: `\`\`\`${activity.slice(0, 100)}\`\`\``, inline: true },
        { name: '👤 Nickname', value: `\`\`\`${member.nickname || 'None'}\`\`\``, inline: true },
        { name: '👑 Highest Role', value: `\`\`\`${highestRole}\`\`\``, inline: true },
        { name: '📥 Joined Guild', value: `\`\`\`${joinedDate}\n(${joinedAgeDays.toLocaleString()} days ago)\`\`\``, inline: true },
        { name: '🤖 Bot or Human?', value: `\`\`\`${targetUser.bot ? 'Bot' : 'Human'}\`\`\``, inline: true },
        { name: '💎 Boosting?', value: `\`\`\`${boostStatus}\`\`\``, inline: true },
        { name: '🔇 Is Muted?', value: `\`\`\`${isMuted}\`\`\``, inline: true },
        { name: '🔈 Is Deafened?', value: `\`\`\`${isDeafened}\`\`\``, inline: true },
        { name: '📊 Join Position', value: `\`\`\`${joinPosition >= 0 ? joinPosition.toString() : 'Unknown'}\`\`\``, inline: true },
        { name: '📜 Acknowledgements', value: `\`\`\`${acknowledgements.length > 0 ? acknowledgements.join(', ') : 'None'}\`\`\``, inline: true },
        { name: `🎭 Roles [${member.roles.cache.size - 1}]`, value: `\`\`\`${roles.length > 1000 ? roles.slice(0, 1000) + '...' : roles}\`\`\``, inline: false },
        { name: '⚠️ Warnings', value: `\`\`\`${warningCount} warning${warningCount !== 1 ? 's' : ''} in this server.\`\`\``, inline: false }
      );
    } else {
      // User not in guild - show basic info
      embed.addFields(
        { name: '🤖 Bot or Human?', value: `\`\`\`${targetUser.bot ? 'Bot' : 'Human'}\`\`\``, inline: true },
        { name: '📛 Username', value: `\`\`\`${targetUser.username}\`\`\``, inline: true },
        { name: 'ℹ️ Note', value: `\`\`\`This user is not in this server. Limited information available.\`\`\``, inline: false }
      );
    }
    
    embed.setFooter({ 
      text: `Requested by ${interaction.user.username} | User ID: ${targetUser.id}`,
      iconURL: interaction.user.displayAvatarURL({ dynamic: true })
    });
    
    await interaction.reply({ embeds: [embed] });
  },
};
