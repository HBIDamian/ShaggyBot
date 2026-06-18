const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invitechecker')
    .setDescription('Check information about a Discord invite')
    .addStringOption(option =>
      option
        .setName('url')
        .setDescription('The Discord invite URL to check')
        .setRequired(true)
    )
    .setDMPermission(true),

  async execute(interaction) {
    const inviteUrl = interaction.options.getString('url');

    try {
      // Extract invite code from URL
      const inviteMatch = inviteUrl.match(/discord(?:app\.com\/invite|\.gg(?:\/invite)?)\/([\w-]{2,255})/);

      if (!inviteMatch || !inviteMatch[1]) {
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ Invalid Invite URL')
          .setDescription('The provided URL is not a valid Discord invite.')
          .setColor('#FF0000')
          .setFooter({ text: `Requested by ${interaction.user.tag}` })
          .setTimestamp();

        return await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      }

      const inviteCode = inviteMatch[1];

      // Fetch invite information directly from Discord API to get raw response
      const apiUrl = `https://discord.com/api/v10/invites/${inviteCode}?with_counts=true`;
      const inviteResponse = await fetch(apiUrl);

      if (!inviteResponse.ok) {
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ Invalid Invite')
          .setDescription('This invite is invalid or has expired.')
          .setColor('#FF0000')
          .setFooter({ text: `Requested by ${interaction.user.tag}` })
          .setTimestamp();

        return await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      }

      const invite = await inviteResponse.json();

      // Parse expiration date
      let expirationText = 'Never';
      if (invite.expires_at) {
        const date1 = new Date(invite.expires_at);
        const date2 = new Date();
        const diffTime = Math.abs(date2 - date1);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        expirationText = `${date1.toLocaleString()} (in ${diffDays} days)`;
      }

      // Build the embed with invite information
      const embed = new EmbedBuilder()
        .setTitle('Info | Discord Invite')
        .setDescription(`Details for invite code **${invite.code || inviteCode}**`)
        .setColor('#5865F2')
        .setFooter({ text: `Requested by ${interaction.user.tag}` })
        .setTimestamp();

      // Guild information
      if (invite.guild) {
        const memberCount = invite.approximate_member_count || invite.profile?.member_count || 0;
        const presenceCount = invite.approximate_presence_count || invite.profile?.online_count || 0;

        embed.addFields(
          { name: '🏢 Server Name', value: invite.guild.name || 'N/A', inline: true },
          { name: '🆔 Server ID', value: `\`${invite.guild.id}\``, inline: true },
          { name: '👥 Members Online', value: `\`${presenceCount} / ${memberCount}\``, inline: true }
        );

        if (invite.guild.icon) {
          embed.setThumbnail(`https://cdn.discordapp.com/icons/${invite.guild.id}/${invite.guild.icon}.png`);
        }
      }

      // Channel information
      if (invite.channel) {
        embed.addFields(
          { name: '📢 Channel', value: `${invite.channel.name} • <#${invite.channel.id}>`, inline: true }
        );
      }

      // Inviter information
      if (invite.inviter) {
        embed.addFields(
          { name: '👤 Inviter', value: `${invite.inviter.username}${invite.inviter.discriminator !== '0' ? '#' + invite.inviter.discriminator : ''} (<@${invite.inviter.id}>)`, inline: true }
        );
      } else {
        embed.addFields(
          { name: '👤 Inviter', value: 'N/A', inline: true }
        );
      }

      // Invite code
      embed.addFields(
        { name: '🔗 Invite Code', value: `\`${invite.code || inviteCode}\``, inline: true }
      );

      // Expiration and usage information
      embed.addFields(
        { name: '⏰ Expires At', value: expirationText, inline: true },
        { name: '📊 Max Uses', value: `\`${invite.max_uses ? invite.max_uses.toString() : 'Unlimited'}\``, inline: true },
        { name: '🔄 Current Uses', value: `\`${invite.uses ? invite.uses.toString() : '0'}\``, inline: true },
        { name: '⌛ Max Age', value: `\`${invite.max_age ? `${invite.max_age} seconds` : 'Unlimited'}\``, inline: true },
        { name: '🎫 Temporary', value: invite.temporary ? 'Yes' : 'No', inline: true }
      );

      // Create debug JSON attachment
      const debugData = JSON.stringify(invite, null, 2);
      const debugAttachment = new AttachmentBuilder(Buffer.from(debugData), { name: `${invite.code}_debug_array.json` });

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      await interaction.followUp({ files: [debugAttachment], flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.error('Error fetching invite:', error);

      let errorDescription = 'An error occurred while fetching the invite.';
      if (error.code === 'INVITE_UNKNOWN') {
        errorDescription = 'The invite is invalid or has expired.';
      } else if (error.message.includes('429')) {
        errorDescription = 'Too many requests! Please try again later.';
      }

      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Error')
        .setDescription(errorDescription)
        .setColor('#FF0000')
        .setFooter({ text: `Requested by ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    }
  },
};
