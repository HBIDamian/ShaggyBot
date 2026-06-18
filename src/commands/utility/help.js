const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const HELP_COLOR = '#9B59B6';
const CATEGORY_ORDER = ['fun', 'utility', 'features', 'moderation'];
const CATEGORY_STYLES = {
  fun: { icon: '🎮', label: 'Fun', description: 'Entertainment and interactive commands' },
  utility: { icon: '🔧', label: 'Utility', description: 'Helpful everyday commands' },
  features: { icon: '✨', label: 'Features', description: 'Server-powered utility and content features' },
  moderation: { icon: '🛡️', label: 'Moderation', description: 'Moderation and staff tools' },
};
const OPTION_TYPE_NAMES = {
  3: 'string',
  4: 'integer',
  5: 'boolean',
  6: 'user',
  7: 'channel',
  8: 'role',
  9: 'mentionable',
  10: 'number',
  11: 'attachment',
};
const PERMISSION_NAMES = {
  [String(PermissionFlagsBits.Administrator)]: 'Administrator',
  [String(PermissionFlagsBits.ManageGuild)]: 'Manage Server',
  [String(PermissionFlagsBits.ManageRoles)]: 'Manage Roles',
  [String(PermissionFlagsBits.ManageChannels)]: 'Manage Channels',
  [String(PermissionFlagsBits.KickMembers)]: 'Kick Members',
  [String(PermissionFlagsBits.BanMembers)]: 'Ban Members',
  [String(PermissionFlagsBits.ManageMessages)]: 'Manage Messages',
  [String(PermissionFlagsBits.ModerateMembers)]: 'Timeout Members',
  [String(PermissionFlagsBits.ManageNicknames)]: 'Manage Nicknames',
  [String(PermissionFlagsBits.ViewAuditLog)]: 'View Audit Log',
};

let globalCommandCache = null;

function sortCategories(categories) {
  return [...categories].sort((a, b) => {
    const aIndex = CATEGORY_ORDER.indexOf(a);
    const bIndex = CATEGORY_ORDER.indexOf(b);

    if (aIndex !== -1 && bIndex !== -1) {return aIndex - bIndex;}
    if (aIndex !== -1) {return -1;}
    if (bIndex !== -1) {return 1;}
    return a.localeCompare(b);
  });
}

function getCategoryStyle(category) {
  return CATEGORY_STYLES[category] || {
    icon: '🧩',
    label: category.charAt(0).toUpperCase() + category.slice(1),
    description: 'Guild-specific custom commands',
  };
}

function normalizeTopic(input) {
  return String(input || '').trim().replace(/^\//, '').toLowerCase();
}

function chunkLines(lines, maxLength = 950) {
  const chunks = [];
  let current = '';

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLength) {
      if (current) {chunks.push(current);}
      current = line;
    } else {
      current = next;
    }
  }

  if (current) {chunks.push(current);}
  return chunks;
}

function getPermissionNames(permissionBitfield) {
  if (!permissionBitfield) {return [];}

  const permissions = [];
  const permissionValue = BigInt(permissionBitfield);

  for (const [bit, name] of Object.entries(PERMISSION_NAMES)) {
    if ((permissionValue & BigInt(bit)) === BigInt(bit)) {
      permissions.push(name);
    }
  }

  return permissions;
}

function mapOption(option) {
  return {
    name: option.name,
    description: option.description,
    type: OPTION_TYPE_NAMES[option.type] || 'unknown',
    required: option.required || false,
    choices: option.choices?.map(choice => choice.name) || [],
  };
}

function mapSubcommand(subcommand, prefix = '') {
  return {
    name: prefix ? `${prefix} ${subcommand.name}` : subcommand.name,
    description: subcommand.description,
    options: (subcommand.options || []).filter(option => option.type > 2).map(mapOption),
  };
}

function loadCommandsByCategory(commandsPath, meta = {}) {
  const cache = new Map();

  if (!fs.existsSync(commandsPath)) {return cache;}

  const categories = fs.readdirSync(commandsPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  for (const category of categories) {
    const categoryPath = path.join(commandsPath, category);
    const files = fs.readdirSync(categoryPath).filter(file => file.endsWith('.js'));
    const commands = [];

    for (const file of files) {
      try {
        const command = require(path.join(categoryPath, file));
        if (!command.data) {continue;}

        const json = command.data.toJSON ? command.data.toJSON() : command.data;
        commands.push({
          name: json.name,
          description: json.description || 'No description provided.',
          category,
          options: (json.options || []).filter(option => option.type > 2).map(mapOption),
          subcommands: (json.options || []).filter(option => option.type === 1).map(option => mapSubcommand(option)),
          subcommandGroups: (json.options || [])
            .filter(option => option.type === 2)
            .map(group => ({
              name: group.name,
              description: group.description,
              subcommands: (group.options || []).map(option => mapSubcommand(option, group.name)),
            })),
          permissions: getPermissionNames(json.default_member_permissions),
          dmPermission: json.dm_permission !== false,
          isGuildCustom: !!meta.isGuildCustom,
          guildId: meta.guildId || null,
        });
      } catch {
        // Ignore broken command modules in help metadata generation.
      }
    }

    if (commands.length > 0) {
      commands.sort((a, b) => a.name.localeCompare(b.name));
      cache.set(category, commands);
    }
  }

  return cache;
}

function getGlobalCommandCache() {
  if (globalCommandCache) {return globalCommandCache;}
  globalCommandCache = loadCommandsByCategory(path.join(__dirname, '..'));
  return globalCommandCache;
}

function mergeCommandCaches(globalCache, guildCache) {
  const merged = new Map();

  for (const [category, commands] of globalCache) {
    merged.set(category, [...commands]);
  }

  for (const [category, commands] of guildCache) {
    const existing = merged.get(category) || [];
    const seen = new Set(existing.map(command => command.name));

    for (const command of commands) {
      if (!seen.has(command.name)) {
        existing.push(command);
        seen.add(command.name);
      }
    }

    existing.sort((a, b) => a.name.localeCompare(b.name));
    merged.set(category, existing);
  }

  return merged;
}

function flattenTopics(cache) {
  const categories = sortCategories([...cache.keys()]).map(category => ({
    type: 'category',
    key: category,
    label: getCategoryStyle(category).label,
    count: cache.get(category)?.length || 0,
  }));

  const commands = [];
  for (const [category, categoryCommands] of cache) {
    for (const command of categoryCommands) {
      commands.push({ type: 'command', category, command });
    }
  }

  return { categories, commands };
}

function findCategory(cache, topic) {
  return [...cache.keys()].find(category => category.toLowerCase() === topic) || null;
}

function findCommand(cache, topic) {
  for (const [, commands] of cache) {
    const match = commands.find(command => command.name.toLowerCase() === topic);
    if (match) {return match;}
  }
  return null;
}

function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) {matrix[i][0] = i;}
  for (let j = 0; j <= b.length; j++) {matrix[0][j] = j;}

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

function scoreMatch(query, candidate) {
  const normalizedCandidate = candidate.toLowerCase();

  if (normalizedCandidate === query) {return 1000;}
  if (normalizedCandidate.startsWith(query)) {return 800 - (normalizedCandidate.length - query.length);}

  const includesAt = normalizedCandidate.indexOf(query);
  if (includesAt !== -1) {return 600 - includesAt;}

  return 300 - levenshtein(query, normalizedCandidate);
}

function findSuggestions(topic, cache, limit = 5) {
  const query = normalizeTopic(topic);
  const { categories, commands } = flattenTopics(cache);
  const candidates = [
    ...categories.map(category => ({ value: category.key, label: category.label, score: scoreMatch(query, category.key) })),
    ...commands.map(({ command }) => ({ value: command.name, label: `/${command.name}`, score: scoreMatch(query, command.name) })),
  ];

  return candidates
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.value.localeCompare(b.value))
    .slice(0, limit);
}

function buildUsage(command) {
  if (command.subcommands.length > 0 || command.subcommandGroups.length > 0) {
    return `/${command.name} <subcommand>`;
  }

  const options = command.options.map(option => option.required ? `<${option.name}>` : `[${option.name}]`).join(' ');
  return options ? `/${command.name} ${options}` : `/${command.name}`;
}

function buildOverviewEmbed(interaction, cache) {
  const categories = sortCategories([...cache.keys()]);
  const totalCommands = categories.reduce((sum, category) => sum + (cache.get(category)?.length || 0), 0);
  const categoryLines = categories.map(category => {
    const style = getCategoryStyle(category);
    const commands = cache.get(category) || [];
    return `${style.icon} **${style.label}** — ${commands.length} command${commands.length === 1 ? '' : 's'}`;
  });

  const exampleCommands = categories
    .flatMap(category => (cache.get(category) || []).slice(0, 2))
    .slice(0, 6)
    .map(command => `\`${command.name}\``)
    .join(', ');

  const embed = new EmbedBuilder()
    .setTitle('📚 Help')
    .setDescription([
      `**${totalCommands} commands** available${interaction.guildId ? ' in this server context' : ''}.`,
      '',
      categoryLines.join('\n'),
      '',
      'Use `/help topic:<category or command>` to jump straight to what you need.',
      exampleCommands ? `Try: ${exampleCommands}` : null,
    ].filter(Boolean).join('\n'))
    .setColor(HELP_COLOR)
    .setFooter({ text: `Requested by ${interaction.user.tag}` })
    .setTimestamp();

  const guildCustomCommands = [...cache.values()].flat().filter(command => command.isGuildCustom);
  if (interaction.guildId && guildCustomCommands.length > 0) {
    embed.addFields({
      name: 'Server extras',
      value: guildCustomCommands.map(command => `\`/${command.name}\``).join(', '),
      inline: true,
    });
  }

  return embed;
}

function buildCategoryEmbeds(interaction, category, commands) {
  const style = getCategoryStyle(category);
  const lines = commands.map(command => {
    const badge = command.isGuildCustom ? ' 🏠' : '';
    return `\`/${command.name}\`${badge} — ${command.description}`;
  });

  return chunkLines(lines).map((chunk, index) => new EmbedBuilder()
    .setTitle(`${style.icon} ${style.label}`)
    .setDescription(index === 0 ? `${style.description}\n\n${chunk}` : chunk)
    .setColor(HELP_COLOR)
    .setFooter({ text: `Requested by ${interaction.user.tag} • ${commands.length} command${commands.length === 1 ? '' : 's'}` })
    .setTimestamp());
}

function buildCommandEmbed(interaction, command) {
  const subcommandLines = [
    ...command.subcommands.map(subcommand => `• \`${subcommand.name}\` — ${subcommand.description}`),
    ...command.subcommandGroups.flatMap(group => group.subcommands.map(subcommand => `• \`${subcommand.name}\` — ${subcommand.description}`)),
  ];
  const optionLines = command.options.map(option => {
    const choices = option.choices.length ? ` Choices: ${option.choices.slice(0, 5).map(choice => `\`${choice}\``).join(', ')}` : '';
    return `• \`${option.name}\` (${option.type}, ${option.required ? 'required' : 'optional'}) — ${option.description}.${choices}`;
  });

  const descriptionLines = [command.description];
  if (command.subcommands.length > 0 || command.subcommandGroups.length > 0) {
    const subcommandCount = command.subcommands.length + command.subcommandGroups.reduce((sum, group) => sum + group.subcommands.length, 0);
    descriptionLines.push(`Includes ${subcommandCount} subcommand${subcommandCount === 1 ? '' : 's'}.`);
  }

  const embed = new EmbedBuilder()
    .setTitle(`/${command.name}`)
    .setDescription(descriptionLines.join('\n'))
    .setColor(HELP_COLOR)
    .addFields(
      { name: 'Usage', value: `\`${buildUsage(command)}\``, inline: false },
    )
    .setFooter({ text: `Requested by ${interaction.user.tag}` })
    .setTimestamp();

  const meta = [getCategoryStyle(command.category).label];
  if (!command.dmPermission) {meta.push('Guild only');}
  if (command.isGuildCustom) {meta.push('Guild custom');}
  if (command.permissions.length > 0) {meta.push(command.permissions.join(', '));}

  if (meta.length > 0) {
    embed.addFields({ name: 'Details', value: meta.join(' • '), inline: false });
  }

  if (optionLines.length > 0) {
    embed.addFields({ name: 'Options', value: chunkLines(optionLines, 1000)[0], inline: false });
  }

  if (subcommandLines.length > 0) {
    embed.addFields({ name: 'Subcommands', value: chunkLines(subcommandLines, 1000)[0], inline: false });
  }

  if (command.isGuildCustom) {
    embed.addFields({
      name: 'Note',
      value: 'This is a server-specific custom command.',
      inline: false,
    });
  }

  return embed;
}

function buildNotFoundEmbed(interaction, topic, suggestions) {
  const embed = new EmbedBuilder()
    .setTitle('🔎 Not found')
    .setDescription(`I couldn’t find help for \`${topic}\`.`)
    .setColor('#E67E22')
    .setFooter({ text: `Requested by ${interaction.user.tag}` })
    .setTimestamp();

  if (suggestions.length > 0) {
    embed.addFields({
      name: 'Maybe you meant',
      value: suggestions.map(suggestion => `• ${suggestion.label}`).join('\n'),
      inline: false,
    });
  }

  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Browse categories or inspect a specific command')
    .setDMPermission(true)
    .addStringOption(option =>
      option.setName('topic')
        .setDescription('A category or command name')
        .setRequired(false)
        .setAutocomplete(true)),

  async autocomplete(interaction) {
    const focusedValue = normalizeTopic(interaction.options.getFocused());
    const cache = mergeCommandCaches(
      getGlobalCommandCache(),
      interaction.guildId ? new Map() : new Map(),
    );
    const { categories, commands } = flattenTopics(cache);

    const choices = [
      ...categories.map(category => ({
        name: `Category: ${category.label} (${category.count})`,
        value: category.key,
        score: focusedValue ? scoreMatch(focusedValue, category.key) : 500,
      })),
      ...commands.map(({ command, category }) => ({
        name: `/${command.name} — ${getCategoryStyle(category).label}${command.isGuildCustom ? ' • guild custom' : ''}`,
        value: command.name,
        score: focusedValue ? scoreMatch(focusedValue, command.name) : 400,
      })),
    ]
      .filter(choice => focusedValue ? choice.score > 0 : true)
      .sort((a, b) => b.score - a.score || a.value.localeCompare(b.value))
      .slice(0, 25)
      .map(({ name, value }) => ({ name: name.slice(0, 100), value }));

    await interaction.respond(choices);
  },

  async execute(interaction) {
    const topicInput = interaction.options.getString('topic');
    const cache = mergeCommandCaches(
      getGlobalCommandCache(),
      interaction.guildId ? new Map() : new Map(),
    );

    if (!topicInput) {
      return interaction.reply({ embeds: [buildOverviewEmbed(interaction, cache)] });
    }

    const topic = normalizeTopic(topicInput);
    const category = findCategory(cache, topic);
    if (category) {
      return interaction.reply({ embeds: buildCategoryEmbeds(interaction, category, cache.get(category) || []) });
    }

    const command = findCommand(cache, topic);
    if (command) {
      return interaction.reply({ embeds: [buildCommandEmbed(interaction, command)] });
    }

    return interaction.reply({
      embeds: [buildNotFoundEmbed(interaction, topicInput, findSuggestions(topicInput, cache))],
      flags: MessageFlags.Ephemeral,
    });
  },
};
