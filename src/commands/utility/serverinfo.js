const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Display detailed information about this server')
    .setDMPermission(false),
  
  async execute(interaction) {
    const guild = interaction.guild;
    
    // Fetch guild if needed for complete data
    await guild.fetch();
    
    // Calculate server age
    const createdTimestamp = Math.floor(guild.createdTimestamp / 1000);
    const serverAgeDays = Math.floor((Date.now() - guild.createdTimestamp) / (1000 * 60 * 60 * 24));
    
    // Count members and bots
    const totalMembers = guild.memberCount;
    const botCount = guild.members.cache.filter(m => m.user.bot).size;
    
    // Count channels by type
    const channels = guild.channels.cache;
    const textChannels = channels.filter(c => c.type === ChannelType.GuildText).size;
    const newsChannels = channels.filter(c => c.type === ChannelType.GuildAnnouncement).size;
    const voiceChannels = channels.filter(c => c.type === ChannelType.GuildVoice).size;
    const stageChannels = channels.filter(c => c.type === ChannelType.GuildStageVoice).size;
    const forumChannels = channels.filter(c => c.type === ChannelType.GuildForum).size;
    const mediaChannels = channels.filter(c => c.type === ChannelType.GuildMedia).size;
    const threads = channels.filter(c => c.isThread()).size;
    const categories = channels.filter(c => c.type === ChannelType.GuildCategory).size;
    
    // Boost info
    const boostTier = guild.premiumTier;
    const boostTierName = ['None', 'Level 1', 'Level 2', 'Level 3'][boostTier] || 'None';
    const boostCount = guild.premiumSubscriptionCount || 0;
    
    // Emojis
    const emojis = guild.emojis.cache;
    const staticEmojis = emojis.filter(e => !e.animated).size;
    const animatedEmojis = emojis.filter(e => e.animated).size;
    const maxEmojis = getMaxEmojis(guild.premiumTier);
    const staticSlotsLeft = maxEmojis - staticEmojis;
    const animatedSlotsLeft = maxEmojis - animatedEmojis;
    
    // Stickers
    const stickers = guild.stickers.cache.size;
    const maxStickers = getMaxStickers(guild.premiumTier);
    const stickerSlotsLeft = maxStickers - stickers;
    
    // Scheduled events
    const events = guild.scheduledEvents.cache.size;
    
    // Locale
    const locale = guild.preferredLocale || 'en-US';
    
    // Role list (excluding @everyone)
    const roles = guild.roles.cache
      .filter(r => r.id !== guild.id)
      .sort((a, b) => b.position - a.position)
      .map(r => r.name)
      .join(', ') || 'None';
    
    // Server features (formatted nicely)
    const features = guild.features.length > 0 
      ? guild.features.map(f => formatFeature(f)).join(', ')
      : 'None';
    
    const embed = new EmbedBuilder()
      .setTitle(`Info | ${guild.name} Server Info`)
      .setDescription(`Created on <t:${createdTimestamp}:f>. That's **${serverAgeDays.toLocaleString()} days** ago!`)
      .setColor(0x5865F2)
      .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }));
    
    embed.addFields(
      { name: '👥 Members', value: `\`\`\`${totalMembers} (${botCount} bots)\`\`\``, inline: true },
      { name: '🎭 Roles', value: `\`\`\`${guild.roles.cache.size - 1}\`\`\``, inline: true },
      { name: '🌐 Locale', value: `\`\`\`${locale}\`\`\``, inline: true },
      { name: '💬 Channels', value: `\`\`\`${textChannels} Text / ${newsChannels} News\n${voiceChannels} Voice / ${stageChannels} Stages\n${forumChannels} Forums / ${mediaChannels} Media / ${threads} Threads\n${categories} Categories\`\`\``, inline: false },
      { name: '😀 Total Emojis', value: `\`\`\`${staticEmojis} / ${maxEmojis} (${staticSlotsLeft} Slots Left)\`\`\``, inline: true },
      { name: '😎 Total Gifmojis', value: `\`\`\`${animatedEmojis} / ${maxEmojis} (${animatedSlotsLeft} Slots Left)\`\`\``, inline: true },
      { name: '🏷️ Stickers', value: `\`\`\`${stickers} / ${maxStickers} (${stickerSlotsLeft} Slots Left)\`\`\``, inline: true },
      { name: '💎 Boost Level', value: `\`\`\`${boostTierName} (${boostCount} Boosts)\`\`\``, inline: true },
      { name: '📅 Events', value: `\`\`\`${events}\`\`\``, inline: true },
      { name: '🎭 Role List', value: `\`\`\`${roles.length > 1000 ? roles.slice(0, 1000) + '...' : roles}\`\`\``, inline: false },
      { name: '🏆 Server Features', value: `\`\`\`${features.length > 1000 ? features.slice(0, 1000) + '...' : features || 'None'}\`\`\``, inline: false }
    );
    
    embed.setFooter({ 
      text: `Requested by ${interaction.user.username} | Guild ID: ${guild.id}`,
      iconURL: interaction.user.displayAvatarURL({ dynamic: true })
    });
    
    await interaction.reply({ embeds: [embed] });
  },
};

// Helper function to get max emojis based on boost tier
function getMaxEmojis(tier) {
  switch (tier) {
    case 1: return 100;
    case 2: return 150;
    case 3: return 250;
    default: return 50;
  }
}

// Helper function to get max stickers based on boost tier
function getMaxStickers(tier) {
  switch (tier) {
    case 1: return 15;
    case 2: return 30;
    case 3: return 60;
    default: return 5;
  }
}

// Helper function to format feature names nicely
function formatFeature(feature) {
  const featureMap = {
    'ANIMATED_BANNER': 'Animated Banner',
    'ANIMATED_ICON': 'Animated Icon',
    'APPLICATION_COMMAND_PERMISSIONS_V2': 'Command Permissions V2',
    'AUTO_MODERATION': 'Auto Mod',
    'BANNER': 'Banner',
    'COMMUNITY': 'Community',
    'CREATOR_MONETIZABLE_PROVISIONAL': 'Creator Monetization',
    'CREATOR_STORE_PAGE': 'Creator Store',
    'DEVELOPER_SUPPORT_SERVER': 'Dev Support Server',
    'DISCOVERABLE': 'Discoverable',
    'FEATURABLE': 'Featurable',
    'INVITES_DISABLED': 'Invites Disabled',
    'INVITE_SPLASH': 'Invite Splash',
    'MEMBER_VERIFICATION_GATE_ENABLED': 'Member Verification',
    'MORE_STICKERS': 'More Stickers',
    'NEWS': 'News',
    'PARTNERED': 'Partnered',
    'PREVIEW_ENABLED': 'Preview Enabled',
    'RAID_ALERTS_DISABLED': 'Raid Alerts Disabled',
    'ROLE_ICONS': 'Role Icons',
    'ROLE_SUBSCRIPTIONS_AVAILABLE_FOR_PURCHASE': 'Role Subscriptions',
    'ROLE_SUBSCRIPTIONS_ENABLED': 'Role Subscriptions Enabled',
    'TICKETED_EVENTS_ENABLED': 'Ticketed Events',
    'VANITY_URL': 'Vanity URL',
    'VERIFIED': 'Verified',
    'VIP_REGIONS': 'VIP Regions',
    'WELCOME_SCREEN_ENABLED': 'Welcome Screen',
    'THREADS_ENABLED': 'Threads',
    'NEW_THREAD_PERMISSIONS': 'Thread Permissions',
    'TEXT_IN_VOICE_ENABLED': 'Text in Voice',
    'GUILD_ONBOARDING': 'Onboarding',
    'GUILD_ONBOARDING_EVER_ENABLED': 'Onboarding Enabled',
    'GUILD_ONBOARDING_HAS_PROMPTS': 'Onboarding Prompts',
    'GUILD_SERVER_GUIDE': 'Server Guide',
    'GUILD_HOME_TEST': 'Home Test',
    'GUILD_WEB_PAGE_VANITY_URL': 'Web Vanity URL',
  };
  
  return featureMap[feature] || feature.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}
