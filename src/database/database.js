const { Database } = require('bun:sqlite');
const path = require('path');
const fs = require('fs');
const { createLogger } = require('../utils/logger');

const logger = createLogger('Database');

// Ensure data directory exists
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'shaggybot.db');
const db = new Database(dbPath);

// Enable foreign keys and WAL mode for better performance
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA journal_mode = WAL');

// Prepared statement cache
const stmtCache = new Map();

/**
 * Get or create a cached prepared statement
 * @param {string} sql - SQL query
 * @returns {Statement} Prepared statement
 */
function stmt(sql) {
  if (!stmtCache.has(sql)) {
    stmtCache.set(sql, db.prepare(sql));
  }
  return stmtCache.get(sql);
}

/**
 * Helper to build and execute UPDATE queries
 * @param {string} table - Table name
 * @param {string} whereColumn - Column for WHERE clause
 * @param {*} whereValue - Value for WHERE clause
 * @param {Object} updates - Object with fields to update
 * @param {string[]} allowedFields - List of allowed field names
 * @param {string[]} jsonFields - List of fields to JSON stringify
 * @returns {Object} Result with success and skippedFields
 */
function updateTable(table, whereColumn, whereValue, updates, allowedFields, jsonFields = []) {
  const unknownFields = Object.keys(updates).filter(key => !allowedFields.includes(key));
  const fields = Object.keys(updates).filter(key => allowedFields.includes(key));
  
  if (fields.length === 0) {
    return { success: false, skippedFields: unknownFields };
  }
  
  // Process JSON fields
  const processedUpdates = { ...updates };
  jsonFields.forEach(field => {
    if (processedUpdates[field] && typeof processedUpdates[field] === 'object') {
      processedUpdates[field] = JSON.stringify(processedUpdates[field]);
    }
  });
  
  const setClause = fields.map(f => `${f} = ?`).join(', ');
  const values = [...fields.map(f => processedUpdates[f]), whereValue];
  
  db.prepare(`UPDATE ${table} SET ${setClause} WHERE ${whereColumn} = ?`).run(...values);
  
  return { success: true, skippedFields: unknownFields };
}

/**
 * Initialize the database with required tables
 */
function initDatabase() {
  logger.info('Initializing database...');

  // Guild settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      guild_name TEXT,
      prefix TEXT DEFAULT '!',
      mod_log_channel TEXT,
      welcome_channel TEXT,
      welcome_message TEXT,
      leave_message TEXT,
      auto_role TEXT,
      suggestion_channel TEXT,
      suggestion_approved_channel TEXT,
      suggestion_denied_channel TEXT,
      server_timezone TEXT DEFAULT 'UTC',
      notes_staff_role TEXT,
      auto_quoter_enabled INTEGER DEFAULT 0,
      git_previewer_enabled INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add new columns if they don't exist (migration for existing databases)
  const existingColumns = db.prepare("PRAGMA table_info(guild_settings)").all().map(c => c.name);
  const newColumns = [
    { name: 'suggestion_channel', type: 'TEXT' },
    { name: 'suggestion_approved_channel', type: 'TEXT' },
    { name: 'suggestion_denied_channel', type: 'TEXT' },
    { name: 'server_timezone', type: 'TEXT DEFAULT \'UTC\'' },
    { name: 'notes_staff_role', type: 'TEXT' },
    { name: 'auto_quoter_enabled', type: 'INTEGER DEFAULT 0' },
    { name: 'git_previewer_enabled', type: 'INTEGER DEFAULT 0' },
    { name: 'tags_manage_own', type: 'TEXT DEFAULT \'users\'' },
    { name: 'tags_manage_all', type: 'TEXT DEFAULT \'admins\'' },
    { name: 'mod_log_retention_days', type: 'INTEGER DEFAULT 7' },
    { name: 'warning_retention_days', type: 'INTEGER DEFAULT 365' }
  ];
  newColumns.forEach(col => {
    if (!existingColumns.includes(col.name)) {
      db.exec(`ALTER TABLE guild_settings ADD COLUMN ${col.name} ${col.type}`);
    }
  });

  // Auto-mod settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS automod_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      log_channel TEXT,
      -- Exemptions
      exempt_roles TEXT DEFAULT '[]',
      exempt_channels TEXT DEFAULT '[]',
      exclude_admins INTEGER DEFAULT 1,
      exclude_mods INTEGER DEFAULT 1,
      exclude_bots INTEGER DEFAULT 1,
      -- Word Blacklist
      bad_words_enabled INTEGER DEFAULT 0,
      bad_words_use_default INTEGER DEFAULT 1,
      bad_words_list TEXT DEFAULT '[]',
      bad_words_action TEXT DEFAULT 'delete',
      -- Mass Capitalization
      caps_enabled INTEGER DEFAULT 0,
      caps_min_chars INTEGER DEFAULT 8,
      caps_percentage INTEGER DEFAULT 70,
      caps_action TEXT DEFAULT 'delete',
      -- Duplicate Characters
      duplicate_chars_enabled INTEGER DEFAULT 0,
      duplicate_chars_min INTEGER DEFAULT 4,
      duplicate_chars_percentage INTEGER DEFAULT 75,
      duplicate_chars_action TEXT DEFAULT 'delete',
      -- Duplicate Words
      duplicate_words_enabled INTEGER DEFAULT 0,
      duplicate_words_count INTEGER DEFAULT 5,
      duplicate_words_action TEXT DEFAULT 'delete',
      -- Mass Mentions
      mass_mentions_enabled INTEGER DEFAULT 0,
      mass_mentions_count INTEGER DEFAULT 5,
      mass_mentions_action TEXT DEFAULT 'delete_warn',
      -- Mass Emoji
      mass_emoji_enabled INTEGER DEFAULT 0,
      mass_emoji_count INTEGER DEFAULT 5,
      mass_emoji_action TEXT DEFAULT 'delete',
      -- Spoilers
      spoilers_enabled INTEGER DEFAULT 0,
      spoilers_min_chars INTEGER DEFAULT 4,
      spoilers_action TEXT DEFAULT 'delete',
      -- Discord Invites
      invites_enabled INTEGER DEFAULT 0,
      invites_ignore_partners INTEGER DEFAULT 0,
      invites_ignore_verified INTEGER DEFAULT 0,
      invites_action TEXT DEFAULT 'delete_warn',
      -- Website URLs
      links_enabled INTEGER DEFAULT 0,
      links_whitelist_mode INTEGER DEFAULT 0,
      links_whitelist TEXT DEFAULT '[]',
      links_action TEXT DEFAULT 'delete',
      -- File Extensions
      file_extensions_enabled INTEGER DEFAULT 0,
      file_extensions_list TEXT DEFAULT '[]',
      file_extensions_action TEXT DEFAULT 'delete',
      file_extensions_whitelist_mode INTEGER DEFAULT 0,
      -- Stickers
      stickers_enabled INTEGER DEFAULT 0,
      stickers_action TEXT DEFAULT 'delete',
      -- Zalgo Text
      zalgo_enabled INTEGER DEFAULT 0,
      zalgo_action TEXT DEFAULT 'delete',
      -- Phishing URLs
      phishing_enabled INTEGER DEFAULT 1,
      phishing_action TEXT DEFAULT 'ban',
      -- Phone Numbers
      phone_numbers_enabled INTEGER DEFAULT 0,
      phone_numbers_action TEXT DEFAULT 'delete_warn',
      -- Markdown Headers
      markdown_headers_enabled INTEGER DEFAULT 0,
      markdown_headers_action TEXT DEFAULT 'delete',
      -- Auto Dehoist
      dehoist_enabled INTEGER DEFAULT 0,
      -- Spam Detection
      spam_enabled INTEGER DEFAULT 0,
      spam_threshold INTEGER DEFAULT 5,
      spam_interval INTEGER DEFAULT 5000,
      spam_action TEXT DEFAULT 'mute',
      FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id) ON DELETE CASCADE
    )
  `);

  // Moderation settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS moderation_settings (
      guild_id TEXT PRIMARY KEY,
      report_enabled INTEGER DEFAULT 0,
      report_channel TEXT,
      persistent_mute_enabled INTEGER DEFAULT 0,
      mute_role TEXT,
      warn_mute_threshold INTEGER DEFAULT 3,
      warn_kick_threshold INTEGER DEFAULT 5,
      warn_ban_threshold INTEGER DEFAULT 0,
      warn_expire_days INTEGER DEFAULT 30,
      punishment_notify_mode TEXT DEFAULT 'dm_only',
      punishment_channel TEXT,
      notify_warn INTEGER DEFAULT 1,
      notify_kick INTEGER DEFAULT 1,
      notify_ban INTEGER DEFAULT 1,
      notify_unban INTEGER DEFAULT 1,
      notify_timeout INTEGER DEFAULT 1,
      notify_mute INTEGER DEFAULT 1,
      FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id) ON DELETE CASCADE
    )
  `);

  // Migration for existing databases - add punishment notification columns
  try {
    const columns = db.prepare("PRAGMA table_info(moderation_settings)").all();
    const columnNames = columns.map(c => c.name);
    
    if (!columnNames.includes('punishment_notify_mode')) {
      db.exec("ALTER TABLE moderation_settings ADD COLUMN punishment_notify_mode TEXT DEFAULT 'dm_only'");
    }
    if (!columnNames.includes('punishment_channel')) {
      db.exec("ALTER TABLE moderation_settings ADD COLUMN punishment_channel TEXT");
    }
    // Add notification toggle columns
    const notifyColumns = ['notify_warn', 'notify_kick', 'notify_ban', 'notify_unban', 'notify_timeout', 'notify_mute'];
    for (const col of notifyColumns) {
      if (!columnNames.includes(col)) {
        db.exec(`ALTER TABLE moderation_settings ADD COLUMN ${col} INTEGER DEFAULT 1`);
      }
    }
    // Add lockdown columns
    if (!columnNames.includes('lockdown_channels')) {
      db.exec("ALTER TABLE moderation_settings ADD COLUMN lockdown_channels TEXT DEFAULT '[]'");
    }
    if (!columnNames.includes('lockdown_active')) {
      db.exec("ALTER TABLE moderation_settings ADD COLUMN lockdown_active INTEGER DEFAULT 0");
    }
    if (!columnNames.includes('lockdown_message')) {
      db.exec("ALTER TABLE moderation_settings ADD COLUMN lockdown_message TEXT");
    }
  } catch (e) {
    // Columns already exist or other non-critical error
  }

  // Migration for automod_settings - add missing columns
  try {
    const automodColumns = db.prepare("PRAGMA table_info(automod_settings)").all();
    const automodColumnNames = automodColumns.map(c => c.name);
    
    if (!automodColumnNames.includes('file_extensions_whitelist_mode')) {
      db.exec("ALTER TABLE automod_settings ADD COLUMN file_extensions_whitelist_mode INTEGER DEFAULT 0");
    }
  } catch (e) {
    // Columns already exist or other non-critical error
  }

  // Mod actions log table
  db.exec(`
    CREATE TABLE IF NOT EXISTS mod_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      moderator_id TEXT,
      action TEXT NOT NULL,
      reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id) ON DELETE CASCADE
    )
  `);

  // Warnings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS warnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id) ON DELETE CASCADE
    )
  `);

  // Message reports table
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      reported_user_id TEXT NOT NULL,
      reporter_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_content TEXT,
      status TEXT DEFAULT 'open',
      claimed_by TEXT,
      resolved_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id) ON DELETE CASCADE
    )
  `);

  // Tags table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      response TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      uses INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
      UNIQUE(guild_id, name)
    )
  `);

  // Starboard settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS starboard_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      channel_id TEXT,
      emoji TEXT DEFAULT '⭐',
      threshold INTEGER DEFAULT 3,
      self_star INTEGER DEFAULT 0,
      ignore_nsfw INTEGER DEFAULT 1,
      ignored_channels TEXT DEFAULT '[]',
      FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id) ON DELETE CASCADE
    )
  `);

  // Starboard messages tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS starboard_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      original_message_id TEXT NOT NULL,
      original_channel_id TEXT NOT NULL,
      starboard_message_id TEXT,
      star_count INTEGER DEFAULT 0,
      author_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
      UNIQUE(guild_id, original_message_id)
    )
  `);

  // Anti-raid settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS anti_raid_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      -- Mass Joins settings
      mass_joins_enabled INTEGER DEFAULT 0,
      mass_joins_ban_users INTEGER DEFAULT 1,
      mass_joins_time_limit INTEGER DEFAULT 15,
      mass_joins_user_limit INTEGER DEFAULT 4,
      mass_joins_pause_duration TEXT DEFAULT '2 Hours',
      mass_joins_channel TEXT,
      mass_joins_role_ping TEXT,
      -- Same Account Creation Time settings
      same_account_enabled INTEGER DEFAULT 0,
      same_account_ban_users INTEGER DEFAULT 1,
      same_account_time_limit INTEGER DEFAULT 10,
      same_account_user_limit INTEGER DEFAULT 4,
      same_account_percentage INTEGER DEFAULT 51,
      same_account_pause_duration TEXT DEFAULT '2 Hours',
      same_account_channel TEXT,
      same_account_role_ping TEXT,
      -- Message Spam settings
      message_spam_enabled INTEGER DEFAULT 0,
      message_spam_ban_users INTEGER DEFAULT 1,
      message_spam_time_limit INTEGER DEFAULT 10,
      message_spam_message_limit INTEGER DEFAULT 10,
      message_spam_timeout_duration TEXT DEFAULT '6 Hours',
      message_spam_channel TEXT,
      message_spam_role_ping TEXT,
      message_spam_ignored_roles TEXT DEFAULT '[]',
      message_spam_ignored_channels TEXT DEFAULT '[]',
      -- Other Message Checks settings
      other_checks_enabled INTEGER DEFAULT 0,
      other_checks_ban_users INTEGER DEFAULT 1,
      other_checks_similarity_limit INTEGER DEFAULT 5,
      other_checks_fuzzy_score INTEGER DEFAULT 200,
      other_checks_mention_limit INTEGER DEFAULT 4,
      other_checks_timeout_duration TEXT DEFAULT '6 Hours',
      other_checks_channel TEXT,
      other_checks_role_ping TEXT,
      other_checks_ignored_roles TEXT DEFAULT '[]',
      other_checks_ignored_channels TEXT DEFAULT '[]',
      -- No Avatar Check settings
      no_avatar_enabled INTEGER DEFAULT 0,
      no_avatar_action TEXT DEFAULT 'kick',
      no_avatar_channel TEXT,
      no_avatar_role_ping TEXT,
      -- Unverified Email Check settings
      unverified_email_enabled INTEGER DEFAULT 0,
      unverified_email_action TEXT DEFAULT 'kick',
      unverified_email_channel TEXT,
      unverified_email_role_ping TEXT,
      -- Ban Evasion Detection settings
      ban_evasion_enabled INTEGER DEFAULT 0,
      ban_evasion_action TEXT DEFAULT 'ban',
      ban_evasion_channel TEXT,
      ban_evasion_role_ping TEXT,
      FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id) ON DELETE CASCADE
    )
  `);

  // Migration for anti_raid_settings - add missing columns
  try {
    const antiRaidColumns = db.prepare("PRAGMA table_info(anti_raid_settings)").all();
    const antiRaidColumnNames = antiRaidColumns.map(c => c.name);
    
    // All columns that should exist in the table
    const requiredColumns = [
      { name: 'enabled', type: 'INTEGER DEFAULT 0' },
      { name: 'no_avatar_enabled', type: 'INTEGER DEFAULT 0' },
      { name: 'no_avatar_action', type: "TEXT DEFAULT 'kick'" },
      { name: 'no_avatar_channel', type: 'TEXT' },
      { name: 'no_avatar_role_ping', type: 'TEXT' },
      { name: 'unverified_email_enabled', type: 'INTEGER DEFAULT 0' },
      { name: 'unverified_email_action', type: "TEXT DEFAULT 'kick'" },
      { name: 'unverified_email_channel', type: 'TEXT' },
      { name: 'unverified_email_role_ping', type: 'TEXT' },
      { name: 'ban_evasion_enabled', type: 'INTEGER DEFAULT 0' },
      { name: 'ban_evasion_action', type: "TEXT DEFAULT 'ban'" },
      { name: 'ban_evasion_channel', type: 'TEXT' },
      { name: 'ban_evasion_role_ping', type: 'TEXT' },
      { name: 'other_checks_enabled', type: 'INTEGER DEFAULT 0' },
      { name: 'other_checks_ban_users', type: 'INTEGER DEFAULT 1' },
      { name: 'other_checks_similarity_limit', type: 'INTEGER DEFAULT 5' },
      { name: 'other_checks_fuzzy_score', type: 'INTEGER DEFAULT 200' },
      { name: 'other_checks_mention_limit', type: 'INTEGER DEFAULT 4' },
      { name: 'other_checks_timeout_duration', type: "TEXT DEFAULT '6 Hours'" },
      { name: 'other_checks_channel', type: 'TEXT' },
      { name: 'other_checks_role_ping', type: 'TEXT' },
      { name: 'other_checks_ignored_roles', type: "TEXT DEFAULT '[]'" },
      { name: 'other_checks_ignored_channels', type: "TEXT DEFAULT '[]'" },
      { name: 'message_spam_ignored_roles', type: "TEXT DEFAULT '[]'" },
      { name: 'message_spam_ignored_channels', type: "TEXT DEFAULT '[]'" }
    ];
    
    for (const col of requiredColumns) {
      if (!antiRaidColumnNames.includes(col.name)) {
        db.exec(`ALTER TABLE anti_raid_settings ADD COLUMN ${col.name} ${col.type}`);
      }
    }
  } catch (e) {
    // Columns already exist or other non-critical error
  }

  // Possible alts detection log table
  db.exec(`
    CREATE TABLE IF NOT EXISTS possible_alts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      suspected_alt_of TEXT NOT NULL,
      detection_reason TEXT NOT NULL,
      action_taken TEXT,
      detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id) ON DELETE CASCADE
    )
  `);

  // Guild settings for possible alts logging
  db.exec(`
    CREATE TABLE IF NOT EXISTS alt_detection_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      retention_days INTEGER DEFAULT 365,
      FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id) ON DELETE CASCADE
    )
  `);

  // Index for efficient cleanup
  db.exec(`CREATE INDEX IF NOT EXISTS idx_possible_alts_guild ON possible_alts(guild_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_possible_alts_detected_at ON possible_alts(detected_at)`);

  // Audit log settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      -- Global settings
      ignored_roles TEXT DEFAULT '[]',
      ignored_channels TEXT DEFAULT '[]',
      -- User events
      user_join_enabled INTEGER DEFAULT 0,
      user_join_channel TEXT,
      user_join_color TEXT DEFAULT '#00FF00',
      user_leave_enabled INTEGER DEFAULT 0,
      user_leave_channel TEXT,
      user_leave_color TEXT DEFAULT '#FF0000',
      user_banned_enabled INTEGER DEFAULT 0,
      user_banned_channel TEXT,
      user_banned_color TEXT DEFAULT '#FF0000',
      user_modified_enabled INTEGER DEFAULT 0,
      user_modified_channel TEXT,
      user_modified_color TEXT DEFAULT '#D93A00',
      -- Message events
      message_deleted_enabled INTEGER DEFAULT 0,
      message_deleted_channel TEXT,
      message_deleted_color TEXT DEFAULT '#FF0000',
      message_modified_enabled INTEGER DEFAULT 0,
      message_modified_channel TEXT,
      message_modified_color TEXT DEFAULT '#D93A00',
      bulk_delete_enabled INTEGER DEFAULT 0,
      bulk_delete_channel TEXT,
      bulk_delete_color TEXT DEFAULT '#FF0000',
      -- Voice events
      voice_join_enabled INTEGER DEFAULT 0,
      voice_join_channel TEXT,
      voice_join_color TEXT DEFAULT '#00FF00',
      voice_swap_enabled INTEGER DEFAULT 0,
      voice_swap_channel TEXT,
      voice_swap_color TEXT DEFAULT '#00C7D9',
      voice_leave_enabled INTEGER DEFAULT 0,
      voice_leave_channel TEXT,
      voice_leave_color TEXT DEFAULT '#FF0000',
      -- Server events
      server_modified_enabled INTEGER DEFAULT 0,
      server_modified_channel TEXT,
      server_modified_color TEXT DEFAULT '#D93A00',
      -- Role events
      role_created_enabled INTEGER DEFAULT 0,
      role_created_channel TEXT,
      role_created_color TEXT DEFAULT '#00FF00',
      role_deleted_enabled INTEGER DEFAULT 0,
      role_deleted_channel TEXT,
      role_deleted_color TEXT DEFAULT '#FF0000',
      role_modified_enabled INTEGER DEFAULT 0,
      role_modified_channel TEXT,
      role_modified_color TEXT DEFAULT '#D93A00',
      -- Channel events
      channel_created_enabled INTEGER DEFAULT 0,
      channel_created_channel TEXT,
      channel_created_color TEXT DEFAULT '#00FF00',
      channel_created_ignore_tickets INTEGER DEFAULT 0,
      channel_deleted_enabled INTEGER DEFAULT 0,
      channel_deleted_channel TEXT,
      channel_deleted_color TEXT DEFAULT '#FF0000',
      channel_deleted_ignore_tickets INTEGER DEFAULT 0,
      channel_modified_enabled INTEGER DEFAULT 0,
      channel_modified_channel TEXT,
      channel_modified_color TEXT DEFAULT '#D93A00',
      -- Invite events
      invite_created_enabled INTEGER DEFAULT 0,
      invite_created_channel TEXT,
      invite_created_color TEXT DEFAULT '#00FF00',
      invite_deleted_enabled INTEGER DEFAULT 0,
      invite_deleted_channel TEXT,
      invite_deleted_color TEXT DEFAULT '#FF0000',
      -- Thread events
      thread_created_enabled INTEGER DEFAULT 0,
      thread_created_channel TEXT,
      thread_created_color TEXT DEFAULT '#00FF00',
      thread_deleted_enabled INTEGER DEFAULT 0,
      thread_deleted_channel TEXT,
      thread_deleted_color TEXT DEFAULT '#FF0000',
      thread_modified_enabled INTEGER DEFAULT 0,
      thread_modified_channel TEXT,
      thread_modified_color TEXT DEFAULT '#D93A00',
      -- Stage events
      stage_started_enabled INTEGER DEFAULT 0,
      stage_started_channel TEXT,
      stage_started_color TEXT DEFAULT '#00FF00',
      stage_ended_enabled INTEGER DEFAULT 0,
      stage_ended_channel TEXT,
      stage_ended_color TEXT DEFAULT '#FF0000',
      stage_modified_enabled INTEGER DEFAULT 0,
      stage_modified_channel TEXT,
      stage_modified_color TEXT DEFAULT '#D93A00',
      -- Bot/Integration events
      bot_added_enabled INTEGER DEFAULT 0,
      bot_added_channel TEXT,
      bot_added_color TEXT DEFAULT '#00FF00',
      -- Webhook events
      webhook_created_enabled INTEGER DEFAULT 0,
      webhook_created_channel TEXT,
      webhook_created_color TEXT DEFAULT '#00FF00',
      webhook_modified_enabled INTEGER DEFAULT 0,
      webhook_modified_channel TEXT,
      webhook_modified_color TEXT DEFAULT '#D93A00',
      webhook_deleted_enabled INTEGER DEFAULT 0,
      webhook_deleted_channel TEXT,
      webhook_deleted_color TEXT DEFAULT '#FF0000',
      -- Monitored roles
      monitored_roles_enabled INTEGER DEFAULT 0,
      monitored_roles TEXT DEFAULT '[]',
      monitored_roles_channel TEXT,
      monitored_roles_color TEXT DEFAULT '#D93A00',
      FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id) ON DELETE CASCADE
    )
  `);

  // Migration for audit_log_settings: add enabled column if it doesn't exist
  const auditLogColumns = db.prepare("PRAGMA table_info(audit_log_settings)").all().map(c => c.name);
  if (!auditLogColumns.includes('enabled')) {
    db.exec('ALTER TABLE audit_log_settings ADD COLUMN enabled INTEGER DEFAULT 0');
  }

  // Tempbans table for scheduled unbans
  db.exec(`
    CREATE TABLE IF NOT EXISTS tempbans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      unban_at INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
      UNIQUE(guild_id, user_id)
    )
  `);

  // Troll Discourager settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS troll_discourager_settings (
      guild_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      target_users TEXT DEFAULT '[]',
      delete_enabled INTEGER DEFAULT 1,
      delete_chance INTEGER DEFAULT 20,
      mock_enabled INTEGER DEFAULT 1,
      mock_chance INTEGER DEFAULT 20,
      clown_enabled INTEGER DEFAULT 1,
      clown_chance INTEGER DEFAULT 80,
      reverse_enabled INTEGER DEFAULT 0,
      reverse_chance INTEGER DEFAULT 30,
      uwu_enabled INTEGER DEFAULT 0,
      uwu_chance INTEGER DEFAULT 40,
      emoji_spam_enabled INTEGER DEFAULT 0,
      emoji_spam_chance INTEGER DEFAULT 50,
      spoiler_enabled INTEGER DEFAULT 0,
      spoiler_chance INTEGER DEFAULT 30,
      FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id) ON DELETE CASCADE
    )
  `);

  // Add new columns if they don't exist (for existing databases)
  const trollCols = ['reverse_enabled', 'reverse_chance', 'uwu_enabled', 'uwu_chance', 'emoji_spam_enabled', 'emoji_spam_chance', 'spoiler_enabled', 'spoiler_chance'];
  try {
    const tableInfo = db.prepare("PRAGMA table_info(troll_discourager_settings)").all();
    const existingCols = tableInfo.map(c => c.name);
    for (const col of trollCols) {
      if (!existingCols.includes(col)) {
        const defaultVal = col.endsWith('_enabled') ? 0 : (col.includes('emoji') ? 50 : col.includes('uwu') ? 40 : 30);
        db.exec(`ALTER TABLE troll_discourager_settings ADD COLUMN ${col} INTEGER DEFAULT ${defaultVal}`);
      }
    }
  } catch (e) { /* Table doesn't exist yet, will be created */ }

  // Reminders table
  db.exec(`
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      message TEXT NOT NULL,
      remind_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mod_actions_guild ON mod_actions(guild_id);
    CREATE INDEX IF NOT EXISTS idx_mod_actions_user ON mod_actions(user_id);
    CREATE INDEX IF NOT EXISTS idx_warnings_guild ON warnings(guild_id);
    CREATE INDEX IF NOT EXISTS idx_warnings_user ON warnings(user_id);
    CREATE INDEX IF NOT EXISTS idx_message_reports_guild ON message_reports(guild_id);
    CREATE INDEX IF NOT EXISTS idx_message_reports_status ON message_reports(status);
    CREATE INDEX IF NOT EXISTS idx_tempbans_unban ON tempbans(unban_at);
    CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id);
    CREATE INDEX IF NOT EXISTS idx_reminders_remind_at ON reminders(remind_at);
  `);

  // Command toggle settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS command_toggle_settings (
      guild_id TEXT PRIMARY KEY,
      admins_bypass INTEGER DEFAULT 1,
      mods_bypass INTEGER DEFAULT 1,
      disabled_commands TEXT DEFAULT '[]',
      FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id) ON DELETE CASCADE
    )
  `);

  logger.info('Database initialized successfully');
}

/**
 * Get or create guild settings
 * @param {string} guildId - The guild ID
 * @param {string} guildName - The guild name (optional)
 * @returns {Object} Guild settings
 */
function getGuildSettings(guildId, guildName = null) {
  let settings = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
  
  if (!settings) {
    db.prepare(`
      INSERT INTO guild_settings (guild_id, guild_name) VALUES (?, ?)
    `).run(guildId, guildName);
    
    // Also create automod settings
    db.prepare(`
      INSERT INTO automod_settings (guild_id) VALUES (?)
    `).run(guildId);
    
    settings = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
  } else if (guildName && settings.guild_name !== guildName) {
    // Update guild name if changed
    db.prepare('UPDATE guild_settings SET guild_name = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?')
      .run(guildName, guildId);
    settings.guild_name = guildName;
  }
  
  return settings;
}

/**
 * Update guild settings
 * @param {string} guildId - The guild ID
 * @param {Object} updates - Object with fields to update
 * @returns {boolean} Success status
 */
function updateGuildSettings(guildId, updates) {
  const allowedFields = ['prefix', 'mod_log_channel', 'welcome_channel', 'welcome_message', 'leave_message', 'auto_role', 'suggestion_channel', 'suggestion_approved_channel', 'suggestion_denied_channel', 'server_timezone', 'notes_staff_role', 'auto_quoter_enabled', 'git_previewer_enabled', 'tags_manage_own', 'tags_manage_all'];
  const fields = Object.keys(updates).filter(key => allowedFields.includes(key));
  
  if (fields.length === 0) return false;
  
  const setClause = fields.map(field => `${field} = ?`).join(', ');
  const values = fields.map(field => updates[field]);
  
  db.prepare(`
    UPDATE guild_settings SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?
  `).run(...values, guildId);
  
  return true;
}

/**
 * Get auto-mod settings for a guild
 * @param {string} guildId - The guild ID
 * @returns {Object} Auto-mod settings
 */
function getAutomodSettings(guildId) {
  // Ensure guild settings exist first
  getGuildSettings(guildId);
  
  let settings = db.prepare('SELECT * FROM automod_settings WHERE guild_id = ?').get(guildId);
  
  if (!settings) {
    db.prepare('INSERT INTO automod_settings (guild_id) VALUES (?)').run(guildId);
    settings = db.prepare('SELECT * FROM automod_settings WHERE guild_id = ?').get(guildId);
  }
  
  // Parse JSON fields
  settings.bad_words_list = JSON.parse(settings.bad_words_list || '[]');
  settings.links_whitelist = JSON.parse(settings.links_whitelist || '[]');
  settings.file_extensions_list = JSON.parse(settings.file_extensions_list || '[]');
  settings.exempt_roles = JSON.parse(settings.exempt_roles || '[]');
  settings.exempt_channels = JSON.parse(settings.exempt_channels || '[]');
  
  return settings;
}

/**
 * Update auto-mod settings
 * @param {string} guildId - The guild ID
 * @param {Object} updates - Object with fields to update
 * @returns {boolean} Success status
 */
function updateAutomodSettings(guildId, updates) {
  const allowedFields = [
    'enabled', 'log_channel',
    'exempt_roles', 'exempt_channels',
    'exclude_admins', 'exclude_mods', 'exclude_bots',
    'bad_words_enabled', 'bad_words_use_default', 'bad_words_list', 'bad_words_action',
    'caps_enabled', 'caps_min_chars', 'caps_percentage', 'caps_action',
    'duplicate_chars_enabled', 'duplicate_chars_min', 'duplicate_chars_percentage', 'duplicate_chars_action',
    'duplicate_words_enabled', 'duplicate_words_count', 'duplicate_words_action',
    'mass_mentions_enabled', 'mass_mentions_count', 'mass_mentions_action',
    'mass_emoji_enabled', 'mass_emoji_count', 'mass_emoji_action',
    'spoilers_enabled', 'spoilers_min_chars', 'spoilers_action',
    'invites_enabled', 'invites_ignore_partners', 'invites_ignore_verified', 'invites_action',
    'links_enabled', 'links_whitelist_mode', 'links_whitelist', 'links_action',
    'file_extensions_enabled', 'file_extensions_list', 'file_extensions_action', 'file_extensions_whitelist_mode',
    'stickers_enabled', 'stickers_action',
    'zalgo_enabled', 'zalgo_action',
    'phishing_enabled', 'phishing_action',
    'phone_numbers_enabled', 'phone_numbers_action',
    'markdown_headers_enabled', 'markdown_headers_action',
    'dehoist_enabled',
    'spam_enabled', 'spam_threshold', 'spam_interval', 'spam_action'
  ];
  
  // Check for unknown fields and warn about them
  const unknownFields = Object.keys(updates).filter(key => !allowedFields.includes(key));
  if (unknownFields.length > 0) {
    console.warn(`[Database] Warning: Unknown automod fields will be skipped: ${unknownFields.join(', ')}`);
  }
  
  const fields = Object.keys(updates).filter(key => allowedFields.includes(key));
  
  if (fields.length === 0) return { success: false, skippedFields: unknownFields };
  
  // Stringify JSON fields
  const jsonFields = ['bad_words_list', 'links_whitelist', 'file_extensions_list', 'exempt_roles', 'exempt_channels'];
  const processedUpdates = { ...updates };
  jsonFields.forEach(field => {
    if (processedUpdates[field] && typeof processedUpdates[field] === 'object') {
      processedUpdates[field] = JSON.stringify(processedUpdates[field]);
    }
  });
  
  const setClause = fields.map(field => `${field} = ?`).join(', ');
  const values = fields.map(field => processedUpdates[field]);
  
  db.prepare(`
    UPDATE automod_settings SET ${setClause} WHERE guild_id = ?
  `).run(...values, guildId);
  
  return { success: true, skippedFields: unknownFields };
}

/**
 * Log a moderation action
 * @param {string} guildId - The guild ID
 * @param {string} userId - The target user ID
 * @param {string} moderatorId - The moderator ID
 * @param {string} action - The action taken
 * @param {string} reason - The reason for the action
 * @returns {number} The ID of the logged action
 */
function logModAction(guildId, userId, moderatorId, action, reason) {
  const result = db.prepare(`
    INSERT INTO mod_actions (guild_id, user_id, moderator_id, action, reason) VALUES (?, ?, ?, ?, ?)
  `).run(guildId, userId, moderatorId, action, reason);
  
  return result.lastInsertRowid;
}

/**
 * Get moderation actions for a guild
 * @param {string} guildId - The guild ID
 * @param {number} limit - Maximum number of actions to return
 * @returns {Array} List of mod actions
 */
function getModActions(guildId, limit = 50) {
  return db.prepare(`
    SELECT * FROM mod_actions WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(guildId, limit);
}

/**
 * Get moderation actions for a user in a guild
 * @param {string} guildId - The guild ID
 * @param {string} userId - The user ID
 * @returns {Array} List of mod actions for the user
 */
function getUserModActions(guildId, userId) {
  return db.prepare(`
    SELECT * FROM mod_actions WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC
  `).all(guildId, userId);
}

/**
 * Get the mod log retention days for a guild
 * @param {string} guildId - The guild ID
 * @returns {number} Retention days (default 7)
 */
function getModLogRetentionDays(guildId) {
  const result = db.prepare(`
    SELECT mod_log_retention_days FROM guild_settings WHERE guild_id = ?
  `).get(guildId);
  return result?.mod_log_retention_days ?? 7;
}

/**
 * Set the mod log retention days for a guild
 * @param {string} guildId - The guild ID
 * @param {number} days - Retention days (1-31)
 * @returns {boolean} Success
 */
function setModLogRetentionDays(guildId, days) {
  const clampedDays = Math.min(31, Math.max(1, parseInt(days) || 7));
  db.prepare(`
    UPDATE guild_settings SET mod_log_retention_days = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?
  `).run(clampedDays, guildId);
  return true;
}

/**
 * Clean up old mod actions based on retention settings
 * @param {string} guildId - Optional guild ID to clean (if null, cleans all guilds)
 * @returns {number} Number of deleted records
 */
function cleanupOldModActions(guildId = null) {
  let totalDeleted = 0;
  
  if (guildId) {
    // Clean specific guild
    const retentionDays = getModLogRetentionDays(guildId);
    const result = db.prepare(`
      DELETE FROM mod_actions 
      WHERE guild_id = ? 
      AND created_at < datetime('now', '-' || ? || ' days')
    `).run(guildId, retentionDays);
    totalDeleted = result.changes;
  } else {
    // Clean all guilds based on their individual retention settings
    const guilds = db.prepare(`SELECT guild_id, mod_log_retention_days FROM guild_settings`).all();
    for (const guild of guilds) {
      const retentionDays = guild.mod_log_retention_days ?? 7;
      const result = db.prepare(`
        DELETE FROM mod_actions 
        WHERE guild_id = ? 
        AND created_at < datetime('now', '-' || ? || ' days')
      `).run(guild.guild_id, retentionDays);
      totalDeleted += result.changes;
    }
  }
  
  if (totalDeleted > 0) {
    logger.info(`Cleaned up ${totalDeleted} old mod action logs`);
  }
  
  return totalDeleted;
}

/**
 * Get the warning retention days for a guild
 * @param {string} guildId - The guild ID
 * @returns {number} Retention days (default 365, 0 = keep forever)
 */
function getWarningRetentionDays(guildId) {
  const result = db.prepare(`
    SELECT warning_retention_days FROM guild_settings WHERE guild_id = ?
  `).get(guildId);
  return result?.warning_retention_days ?? 365;
}

/**
 * Set the warning retention days for a guild
 * @param {string} guildId - The guild ID
 * @param {number} days - Retention days (0-365, 0 = keep forever)
 * @returns {boolean} Success
 */
function setWarningRetentionDays(guildId, days) {
  const parsed = parseInt(days);
  const clampedDays = isNaN(parsed) ? 365 : Math.min(365, Math.max(0, parsed));
  db.prepare(`
    UPDATE guild_settings SET warning_retention_days = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?
  `).run(clampedDays, guildId);
  return true;
}

/**
 * Clean up old warnings based on retention settings
 * @param {string} guildId - Optional guild ID to clean (if null, cleans all guilds)
 * @returns {number} Number of deleted records
 */
function cleanupOldWarnings(guildId = null) {
  let totalDeleted = 0;
  
  if (guildId) {
    // Clean specific guild
    const retentionDays = getWarningRetentionDays(guildId);
    // 0 means keep forever
    if (retentionDays === 0) return 0;
    const result = db.prepare(`
      DELETE FROM warnings 
      WHERE guild_id = ? 
      AND created_at < datetime('now', '-' || ? || ' days')
    `).run(guildId, retentionDays);
    totalDeleted = result.changes;
  } else {
    // Clean all guilds based on their individual retention settings
    const guilds = db.prepare(`SELECT guild_id, warning_retention_days FROM guild_settings`).all();
    for (const guild of guilds) {
      const retentionDays = guild.warning_retention_days ?? 365;
      // 0 means keep forever
      if (retentionDays === 0) continue;
      const result = db.prepare(`
        DELETE FROM warnings 
        WHERE guild_id = ? 
        AND created_at < datetime('now', '-' || ? || ' days')
      `).run(guild.guild_id, retentionDays);
      totalDeleted += result.changes;
    }
  }
  
  if (totalDeleted > 0) {
    logger.info(`Cleaned up ${totalDeleted} old warnings`);
  }
  
  return totalDeleted;
}

/**
 * Add a warning to a user
 * @param {string} guildId - The guild ID
 * @param {string} userId - The user ID
 * @param {string} moderatorId - The moderator ID
 * @param {string} reason - The reason for the warning
 * @returns {number} The warning ID
 */
function addWarning(guildId, userId, moderatorId, reason) {
  const result = db.prepare(`
    INSERT INTO warnings (guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?)
  `).run(guildId, userId, moderatorId, reason);
  
  return result.lastInsertRowid;
}

/**
 * Get warnings for a user in a guild
 * @param {string} guildId - The guild ID
 * @param {string} userId - The user ID
 * @returns {Array} List of warnings
 */
function getUserWarnings(guildId, userId) {
  return db.prepare(`
    SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC
  `).all(guildId, userId);
}

/**
 * Get warning count for a user
 * @param {string} guildId - The guild ID
 * @param {string} userId - The user ID
 * @returns {number} Warning count
 */
function getWarningCount(guildId, userId) {
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM warnings WHERE guild_id = ? AND user_id = ?
  `).get(guildId, userId);
  return result.count;
}

/**
 * Delete a warning
 * @param {number} warningId - The warning ID
 * @param {string} guildId - The guild ID
 * @returns {boolean} Success status
 */
function deleteWarning(warningId, guildId) {
  const result = db.prepare(`
    DELETE FROM warnings WHERE id = ? AND guild_id = ?
  `).run(warningId, guildId);
  return result.changes > 0;
}

/**
 * Clear all warnings for a user
 * @param {string} guildId - The guild ID
 * @param {string} userId - The user ID
 * @returns {number} Number of warnings cleared
 */
function clearUserWarnings(guildId, userId) {
  const result = db.prepare(`
    DELETE FROM warnings WHERE guild_id = ? AND user_id = ?
  `).run(guildId, userId);
  return result.changes;
}

/**
 * Schedule a tempban (for persistent unban scheduling)
 * @param {string} guildId - The guild ID
 * @param {string} userId - The user ID
 * @param {number} unbanAt - Timestamp when to unban (ms)
 */
function scheduleTempban(guildId, userId, unbanAt) {
  db.prepare(`
    INSERT OR REPLACE INTO tempbans (guild_id, user_id, unban_at) VALUES (?, ?, ?)
  `).run(guildId, userId, unbanAt);
}

/**
 * Remove a tempban record
 * @param {string} guildId - The guild ID
 * @param {string} userId - The user ID
 */
function removeTempban(guildId, userId) {
  db.prepare(`
    DELETE FROM tempbans WHERE guild_id = ? AND user_id = ?
  `).run(guildId, userId);
}

/**
 * Get all pending tempbans (for bot restart recovery)
 * @returns {Array} List of pending tempbans
 */
function getPendingTempbans() {
  return db.prepare(`
    SELECT * FROM tempbans WHERE unban_at > ?
  `).all(Date.now());
}

/**
 * Get expired tempbans that need processing
 * @returns {Array} List of expired tempbans
 */
function getExpiredTempbans() {
  return db.prepare(`
    SELECT * FROM tempbans WHERE unban_at <= ?
  `).all(Date.now());
}

/**
 * Create a message report
 * @param {string} guildId - The guild ID
 * @param {string} messageId - The reported message ID
 * @param {string} reportedUserId - The reported user's ID
 * @param {string} reporterId - The reporter's ID
 * @param {string} channelId - The channel ID where the message was
 * @param {string} messageContent - The message content
 * @returns {number} The report ID
 */
function createMessageReport(guildId, messageId, reportedUserId, reporterId, channelId, messageContent) {
  const result = db.prepare(`
    INSERT INTO message_reports (guild_id, message_id, reported_user_id, reporter_id, channel_id, message_content)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(guildId, messageId, reportedUserId, reporterId, channelId, messageContent);
  return result.lastInsertRowid;
}

/**
 * Get a message report by ID
 * @param {number} reportId - The report ID
 * @returns {Object} The report
 */
function getMessageReport(reportId) {
  return db.prepare('SELECT * FROM message_reports WHERE id = ?').get(reportId);
}

/**
 * Get message reports for a guild
 * @param {string} guildId - The guild ID
 * @param {string} status - Filter by status (optional)
 * @returns {Array} List of reports
 */
function getMessageReports(guildId, status = null) {
  if (status) {
    return db.prepare('SELECT * FROM message_reports WHERE guild_id = ? AND status = ? ORDER BY created_at DESC').all(guildId, status);
  }
  return db.prepare('SELECT * FROM message_reports WHERE guild_id = ? ORDER BY created_at DESC').all(guildId);
}

/**
 * Update a message report
 * @param {number} reportId - The report ID
 * @param {Object} updates - Object with fields to update
 * @returns {boolean} Success status
 */
function updateMessageReport(reportId, updates) {
  const allowedFields = ['status', 'claimed_by', 'resolved_by', 'resolved_at'];
  const fields = Object.keys(updates).filter(key => allowedFields.includes(key));
  
  if (fields.length === 0) return false;
  
  const setClause = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => updates[f]);
  values.push(reportId);
  
  const result = db.prepare(`UPDATE message_reports SET ${setClause} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

/**
 * Delete a message report
 * @param {number} reportId - The report ID
 * @returns {boolean} Success status
 */
function deleteMessageReport(reportId) {
  const result = db.prepare('DELETE FROM message_reports WHERE id = ?').run(reportId);
  return result.changes > 0;
}

/**
 * Get or create moderation settings
 * @param {string} guildId - The guild ID
 * @returns {Object} Moderation settings
 */
function getModerationSettings(guildId) {
  let settings = db.prepare('SELECT * FROM moderation_settings WHERE guild_id = ?').get(guildId);
  
  if (!settings) {
    // Ensure guild settings exist first
    getGuildSettings(guildId);
    
    db.prepare(`
      INSERT INTO moderation_settings (guild_id) VALUES (?)
    `).run(guildId);
    
    settings = db.prepare('SELECT * FROM moderation_settings WHERE guild_id = ?').get(guildId);
  }
  
  return settings;
}

/**
 * Update moderation settings
 * @param {string} guildId - The guild ID
 * @param {Object} updates - Object with fields to update
 * @returns {boolean} Success status
 */
function updateModerationSettings(guildId, updates) {
  // Ensure settings exist
  getModerationSettings(guildId);
  
  const allowedFields = [
    'report_enabled', 'report_channel', 'persistent_mute_enabled', 'mute_role',
    'warn_mute_threshold', 'warn_kick_threshold', 'warn_ban_threshold', 'warn_expire_days',
    'punishment_notify_mode', 'punishment_channel',
    'notify_warn', 'notify_kick', 'notify_ban', 'notify_unban', 'notify_timeout', 'notify_mute',
    'lockdown_channels', 'lockdown_active', 'lockdown_message'
  ];
  
  // Check for unknown fields and warn about them
  const unknownFields = Object.keys(updates).filter(key => !allowedFields.includes(key));
  if (unknownFields.length > 0) {
    console.warn(`[Database] Warning: Unknown moderation fields will be skipped: ${unknownFields.join(', ')}`);
  }
  
  const fields = Object.keys(updates).filter(key => allowedFields.includes(key));
  
  if (fields.length === 0) return { success: false, skippedFields: unknownFields };
  
  const setClause = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => updates[f]);
  values.push(guildId);
  
  db.prepare(`UPDATE moderation_settings SET ${setClause} WHERE guild_id = ?`).run(...values);
  return { success: true, skippedFields: unknownFields };
}

/**
 * Get audit log settings for a guild
 * @param {string} guildId - The guild ID
 * @returns {Object} Audit log settings
 */
function getAuditLogSettings(guildId) {
  // Ensure guild settings exist first
  getGuildSettings(guildId);
  
  let settings = db.prepare('SELECT * FROM audit_log_settings WHERE guild_id = ?').get(guildId);
  
  if (!settings) {
    db.prepare('INSERT INTO audit_log_settings (guild_id) VALUES (?)').run(guildId);
    settings = db.prepare('SELECT * FROM audit_log_settings WHERE guild_id = ?').get(guildId);
  }
  
  // Parse JSON fields
  settings.ignored_roles = JSON.parse(settings.ignored_roles || '[]');
  settings.ignored_channels = JSON.parse(settings.ignored_channels || '[]');
  settings.monitored_roles = JSON.parse(settings.monitored_roles || '[]');
  
  return settings;
}

/**
 * Update audit log settings
 * @param {string} guildId - The guild ID
 * @param {Object} updates - Object with fields to update
 * @returns {boolean} Success status
 */
function updateAuditLogSettings(guildId, updates) {
  // Ensure settings exist
  getAuditLogSettings(guildId);
  
  const allowedFields = [
    'ignored_roles', 'ignored_channels',
    'user_join_enabled', 'user_join_channel', 'user_join_color',
    'user_leave_enabled', 'user_leave_channel', 'user_leave_color',
    'user_banned_enabled', 'user_banned_channel', 'user_banned_color',
    'user_modified_enabled', 'user_modified_channel', 'user_modified_color',
    'message_deleted_enabled', 'message_deleted_channel', 'message_deleted_color',
    'message_modified_enabled', 'message_modified_channel', 'message_modified_color',
    'bulk_delete_enabled', 'bulk_delete_channel', 'bulk_delete_color',
    'voice_join_enabled', 'voice_join_channel', 'voice_join_color',
    'voice_swap_enabled', 'voice_swap_channel', 'voice_swap_color',
    'voice_leave_enabled', 'voice_leave_channel', 'voice_leave_color',
    'server_modified_enabled', 'server_modified_channel', 'server_modified_color',
    'role_created_enabled', 'role_created_channel', 'role_created_color',
    'role_deleted_enabled', 'role_deleted_channel', 'role_deleted_color',
    'role_modified_enabled', 'role_modified_channel', 'role_modified_color',
    'channel_created_enabled', 'channel_created_channel', 'channel_created_color', 'channel_created_ignore_tickets',
    'channel_deleted_enabled', 'channel_deleted_channel', 'channel_deleted_color', 'channel_deleted_ignore_tickets',
    'channel_modified_enabled', 'channel_modified_channel', 'channel_modified_color',
    'invite_created_enabled', 'invite_created_channel', 'invite_created_color',
    'invite_deleted_enabled', 'invite_deleted_channel', 'invite_deleted_color',
    'thread_created_enabled', 'thread_created_channel', 'thread_created_color',
    'thread_deleted_enabled', 'thread_deleted_channel', 'thread_deleted_color',
    'thread_modified_enabled', 'thread_modified_channel', 'thread_modified_color',
    'stage_started_enabled', 'stage_started_channel', 'stage_started_color',
    'stage_ended_enabled', 'stage_ended_channel', 'stage_ended_color',
    'stage_modified_enabled', 'stage_modified_channel', 'stage_modified_color',
    'bot_added_enabled', 'bot_added_channel', 'bot_added_color',
    'webhook_created_enabled', 'webhook_created_channel', 'webhook_created_color',
    'webhook_modified_enabled', 'webhook_modified_channel', 'webhook_modified_color',
    'webhook_deleted_enabled', 'webhook_deleted_channel', 'webhook_deleted_color',
    'monitored_roles_enabled', 'monitored_roles', 'monitored_roles_channel', 'monitored_roles_color',
    'enabled'
  ];
  
  const fields = Object.keys(updates).filter(key => allowedFields.includes(key));
  
  if (fields.length === 0) return false;
  
  // Stringify JSON fields
  const jsonFields = ['ignored_roles', 'ignored_channels', 'monitored_roles'];
  const processedUpdates = { ...updates };
  jsonFields.forEach(field => {
    if (processedUpdates[field] && Array.isArray(processedUpdates[field])) {
      processedUpdates[field] = JSON.stringify(processedUpdates[field]);
    }
  });
  
  const setClause = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => processedUpdates[f]);
  values.push(guildId);
  
  db.prepare(`UPDATE audit_log_settings SET ${setClause} WHERE guild_id = ?`).run(...values);
  return true;
}

// ============================================
// Tags Functions
// ============================================

/**
 * Create a new tag
 */
function createTag(guildId, name, response, ownerId, ownerName) {
  const stmt = db.prepare(`
    INSERT INTO tags (guild_id, name, response, owner_id, owner_name)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(guildId, name.toLowerCase(), response, ownerId, ownerName);
  return result.lastInsertRowid;
}

/**
 * Get a tag by name
 */
function getTag(guildId, name) {
  return db.prepare('SELECT * FROM tags WHERE guild_id = ? AND name = ?').get(guildId, name.toLowerCase());
}

/**
 * Get a tag by ID
 */
function getTagById(id) {
  return db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
}

/**
 * Get all tags for a guild
 */
function getTags(guildId) {
  return db.prepare('SELECT * FROM tags WHERE guild_id = ? ORDER BY name').all(guildId);
}

/**
 * Get tags by owner
 */
function getTagsByOwner(guildId, ownerId) {
  return db.prepare('SELECT * FROM tags WHERE guild_id = ? AND owner_id = ? ORDER BY name').all(guildId, ownerId);
}

/**
 * Update a tag
 */
function updateTag(id, updates) {
  const allowedFields = ['name', 'response', 'owner_id', 'owner_name'];
  const fields = Object.keys(updates).filter(key => allowedFields.includes(key));
  
  if (fields.length === 0) return false;
  
  // If updating name, convert to lowercase
  if (updates.name) updates.name = updates.name.toLowerCase();
  
  const setClause = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => updates[f]);
  values.push(id);
  
  db.prepare(`UPDATE tags SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values);
  return true;
}

/**
 * Increment tag uses
 */
function incrementTagUses(id) {
  db.prepare('UPDATE tags SET uses = uses + 1 WHERE id = ?').run(id);
}

/**
 * Delete a tag
 */
function deleteTag(id) {
  db.prepare('DELETE FROM tags WHERE id = ?').run(id);
}

/**
 * Delete all tags for a guild
 */
function nukeTags(guildId) {
  const result = db.prepare('DELETE FROM tags WHERE guild_id = ?').run(guildId);
  return result.changes;
}

/**
 * Delete all tags by a user in a guild
 */
function pruneTagsByUser(guildId, ownerId) {
  const result = db.prepare('DELETE FROM tags WHERE guild_id = ? AND owner_id = ?').run(guildId, ownerId);
  return result.changes;
}

/**
 * Transfer tag ownership
 */
function transferTag(id, newOwnerId, newOwnerName) {
  db.prepare('UPDATE tags SET owner_id = ?, owner_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newOwnerId, newOwnerName, id);
}

/**
 * Get troll discourager settings for a guild
 * @param {string} guildId - The guild ID
 * @returns {Object} Troll discourager settings
 */
function getTrollDiscouragerSettings(guildId) {
  getGuildSettings(guildId);
  
  let settings = db.prepare('SELECT * FROM troll_discourager_settings WHERE guild_id = ?').get(guildId);
  
  if (!settings) {
    db.prepare('INSERT INTO troll_discourager_settings (guild_id) VALUES (?)').run(guildId);
    settings = db.prepare('SELECT * FROM troll_discourager_settings WHERE guild_id = ?').get(guildId);
  }
  
  settings.target_users = JSON.parse(settings.target_users || '[]');
  
  return settings;
}

/**
 * Update troll discourager settings
 * @param {string} guildId - The guild ID
 * @param {Object} updates - Object with fields to update
 * @returns {boolean} Success status
 */
function updateTrollDiscouragerSettings(guildId, updates) {
  const allowedFields = [
    'enabled', 'target_users',
    'delete_enabled', 'delete_chance',
    'mock_enabled', 'mock_chance',
    'clown_enabled', 'clown_chance',
    'reverse_enabled', 'reverse_chance',
    'uwu_enabled', 'uwu_chance',
    'emoji_spam_enabled', 'emoji_spam_chance',
    'spoiler_enabled', 'spoiler_chance'
  ];
  
  getTrollDiscouragerSettings(guildId);
  
  const fields = [];
  const values = [];
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = ?`);
      if (key === 'target_users') {
        values.push(JSON.stringify(value));
      } else {
        values.push(value);
      }
    }
  }
  
  if (fields.length === 0) return false;
  
  values.push(guildId);
  db.prepare(`UPDATE troll_discourager_settings SET ${fields.join(', ')} WHERE guild_id = ?`).run(...values);
  
  return true;
}

// ==================== STARBOARD ====================

/**
 * Get starboard settings for a guild
 * @param {string} guildId - The guild ID
 * @returns {Object} Starboard settings
 */
function getStarboardSettings(guildId) {
  getGuildSettings(guildId);
  
  let settings = db.prepare('SELECT * FROM starboard_settings WHERE guild_id = ?').get(guildId);
  
  if (!settings) {
    db.prepare('INSERT INTO starboard_settings (guild_id) VALUES (?)').run(guildId);
    settings = db.prepare('SELECT * FROM starboard_settings WHERE guild_id = ?').get(guildId);
  }
  
  settings.ignored_channels = JSON.parse(settings.ignored_channels || '[]');
  
  return settings;
}

/**
 * Update starboard settings
 * @param {string} guildId - The guild ID
 * @param {Object} updates - Object with fields to update
 * @returns {boolean} Success status
 */
function updateStarboardSettings(guildId, updates) {
  const allowedFields = [
    'enabled', 'channel_id', 'emoji', 'threshold',
    'self_star', 'ignore_nsfw', 'ignored_channels'
  ];
  
  getStarboardSettings(guildId);
  
  const fields = [];
  const values = [];
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = ?`);
      if (key === 'ignored_channels') {
        values.push(JSON.stringify(value));
      } else {
        values.push(value);
      }
    }
  }
  
  if (fields.length === 0) return false;
  
  values.push(guildId);
  db.prepare(`UPDATE starboard_settings SET ${fields.join(', ')} WHERE guild_id = ?`).run(...values);
  
  return true;
}

/**
 * Add or update a starboard message entry
 * @param {string} guildId - The guild ID
 * @param {string} originalMessageId - The original message ID
 * @param {string} originalChannelId - The original channel ID
 * @param {string} authorId - The author ID
 * @param {string|null} starboardMessageId - The starboard message ID (null if not yet posted)
 * @param {number} starCount - The star count
 */
function addStarboardMessage(guildId, originalMessageId, originalChannelId, authorId, starboardMessageId, starCount) {
  db.prepare(`
    INSERT OR REPLACE INTO starboard_messages 
    (guild_id, original_message_id, original_channel_id, author_id, starboard_message_id, star_count)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(guildId, originalMessageId, originalChannelId, authorId, starboardMessageId, starCount);
}

/**
 * Get starboard message entry
 * @param {string} guildId - The guild ID
 * @param {string} originalMessageId - The original message ID
 * @returns {Object|null} Starboard message entry
 */
function getStarboardMessage(guildId, originalMessageId) {
  return db.prepare('SELECT * FROM starboard_messages WHERE guild_id = ? AND original_message_id = ?').get(guildId, originalMessageId);
}

/**
 * Update starboard message entry
 * @param {string} guildId - The guild ID
 * @param {string} originalMessageId - The original message ID
 * @param {Object} updates - Updates to apply
 */
function updateStarboardMessage(guildId, originalMessageId, updates) {
  const allowedFields = ['starboard_message_id', 'star_count'];
  
  const fields = [];
  const values = [];
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  
  if (fields.length === 0) return false;
  
  values.push(guildId, originalMessageId);
  db.prepare(`UPDATE starboard_messages SET ${fields.join(', ')} WHERE guild_id = ? AND original_message_id = ?`).run(...values);
  
  return true;
}

/**
 * Remove starboard message entry
 * @param {string} guildId - The guild ID
 * @param {string} originalMessageId - The original message ID
 */
function removeStarboardMessage(guildId, originalMessageId) {
  db.prepare('DELETE FROM starboard_messages WHERE guild_id = ? AND original_message_id = ?').run(guildId, originalMessageId);
}

// ==================== ANTI-RAID ====================

/**
 * Get anti-raid settings for a guild
 * @param {string} guildId - The guild ID
 * @returns {Object} Anti-raid settings
 */
function getAntiRaidSettings(guildId) {
  getGuildSettings(guildId);
  
  let settings = db.prepare('SELECT * FROM anti_raid_settings WHERE guild_id = ?').get(guildId);
  
  if (!settings) {
    db.prepare('INSERT INTO anti_raid_settings (guild_id) VALUES (?)').run(guildId);
    settings = db.prepare('SELECT * FROM anti_raid_settings WHERE guild_id = ?').get(guildId);
  }
  
  // Parse JSON arrays
  settings.message_spam_ignored_roles = JSON.parse(settings.message_spam_ignored_roles || '[]');
  settings.message_spam_ignored_channels = JSON.parse(settings.message_spam_ignored_channels || '[]');
  settings.other_checks_ignored_roles = JSON.parse(settings.other_checks_ignored_roles || '[]');
  settings.other_checks_ignored_channels = JSON.parse(settings.other_checks_ignored_channels || '[]');
  
  return settings;
}

/**
 * Update anti-raid settings
 * @param {string} guildId - The guild ID
 * @param {Object} updates - Object with fields to update
 * @returns {boolean} Success status
 */
function updateAntiRaidSettings(guildId, updates) {
  const allowedFields = [
    'enabled',
    // Mass Joins
    'mass_joins_enabled', 'mass_joins_ban_users', 'mass_joins_time_limit',
    'mass_joins_user_limit', 'mass_joins_pause_duration', 'mass_joins_channel', 'mass_joins_role_ping',
    // Same Account Creation Time
    'same_account_enabled', 'same_account_ban_users', 'same_account_time_limit',
    'same_account_user_limit', 'same_account_percentage', 'same_account_pause_duration',
    'same_account_channel', 'same_account_role_ping',
    // Message Spam
    'message_spam_enabled', 'message_spam_ban_users', 'message_spam_time_limit',
    'message_spam_message_limit', 'message_spam_timeout_duration', 'message_spam_channel',
    'message_spam_role_ping', 'message_spam_ignored_roles', 'message_spam_ignored_channels',
    // Other Checks
    'other_checks_enabled', 'other_checks_ban_users', 'other_checks_similarity_limit',
    'other_checks_fuzzy_score', 'other_checks_mention_limit', 'other_checks_timeout_duration',
    'other_checks_channel', 'other_checks_role_ping', 'other_checks_ignored_roles', 'other_checks_ignored_channels',
    // No Avatar Check
    'no_avatar_enabled', 'no_avatar_action', 'no_avatar_channel', 'no_avatar_role_ping',
    // Unverified Email Check
    'unverified_email_enabled', 'unverified_email_action', 'unverified_email_channel', 'unverified_email_role_ping',
    // Ban Evasion Detection
    'ban_evasion_enabled', 'ban_evasion_action', 'ban_evasion_channel', 'ban_evasion_role_ping'
  ];
  
  getAntiRaidSettings(guildId);
  
  const fields = [];
  const values = [];
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = ?`);
      if (key.includes('ignored_roles') || key.includes('ignored_channels')) {
        values.push(JSON.stringify(value));
      } else {
        values.push(value);
      }
    }
  }
  
  if (fields.length === 0) return false;
  
  values.push(guildId);
  db.prepare(`UPDATE anti_raid_settings SET ${fields.join(', ')} WHERE guild_id = ?`).run(...values);
  
  return true;
}

// ==================== POSSIBLE ALTS ====================

/**
 * Get alt detection settings for a guild
 * @param {string} guildId - The guild ID
 * @returns {Object} Alt detection settings
 */
function getAltDetectionSettings(guildId) {
  getGuildSettings(guildId);
  
  let settings = db.prepare('SELECT * FROM alt_detection_settings WHERE guild_id = ?').get(guildId);
  
  if (!settings) {
    db.prepare('INSERT INTO alt_detection_settings (guild_id) VALUES (?)').run(guildId);
    settings = db.prepare('SELECT * FROM alt_detection_settings WHERE guild_id = ?').get(guildId);
  }
  
  return settings;
}

/**
 * Update alt detection settings
 * @param {string} guildId - The guild ID
 * @param {Object} updates - Object with fields to update
 * @returns {boolean} Success status
 */
function updateAltDetectionSettings(guildId, updates) {
  const allowedFields = ['enabled', 'retention_days'];
  
  getAltDetectionSettings(guildId);
  
  const fields = [];
  const values = [];
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  
  if (fields.length === 0) return false;
  
  values.push(guildId);
  db.prepare(`UPDATE alt_detection_settings SET ${fields.join(', ')} WHERE guild_id = ?`).run(...values);
  
  return true;
}

/**
 * Log a possible alt detection
 * @param {string} guildId - The guild ID
 * @param {string} userId - The detected user ID
 * @param {string} suspectedAltOf - The banned user ID they might be an alt of
 * @param {string} reason - Detection reason (e.g., "Ban Evasion - Discord Detection")
 * @param {string} actionTaken - Action taken (e.g., "Banned", "Kicked", "Flagged")
 */
function logPossibleAlt(guildId, userId, suspectedAltOf, reason, actionTaken) {
  db.prepare(`
    INSERT INTO possible_alts (guild_id, user_id, suspected_alt_of, detection_reason, action_taken)
    VALUES (?, ?, ?, ?, ?)
  `).run(guildId, userId, suspectedAltOf, reason, actionTaken);
}

/**
 * Get possible alts log for a guild
 * @param {string} guildId - The guild ID
 * @param {number} limit - Max results
 * @param {number} offset - Offset for pagination
 * @returns {Array} Array of possible alt entries
 */
function getPossibleAlts(guildId, limit = 50, offset = 0) {
  return db.prepare(`
    SELECT * FROM possible_alts 
    WHERE guild_id = ? 
    ORDER BY detected_at DESC 
    LIMIT ? OFFSET ?
  `).all(guildId, limit, offset);
}

/**
 * Get possible alts count for a guild
 * @param {string} guildId - The guild ID
 * @returns {number} Count of entries
 */
function getPossibleAltsCount(guildId) {
  const result = db.prepare('SELECT COUNT(*) as count FROM possible_alts WHERE guild_id = ?').get(guildId);
  return result.count;
}

/**
 * Delete a possible alt entry
 * @param {number} id - The entry ID
 * @param {string} guildId - The guild ID
 * @returns {boolean} Success status
 */
function deletePossibleAlt(id, guildId) {
  const result = db.prepare('DELETE FROM possible_alts WHERE id = ? AND guild_id = ?').run(id, guildId);
  return result.changes > 0;
}

/**
 * Clean up old possible alt entries based on retention settings
 * @param {string} guildId - Optional specific guild ID
 * @param {number} retentionDays - Optional retention days override
 */
function cleanupOldPossibleAlts(guildId = null, retentionDays = null) {
  if (guildId && retentionDays !== null) {
    // Clean specific guild with specific retention
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    db.prepare(`
      DELETE FROM possible_alts 
      WHERE guild_id = ? AND detected_at < ?
    `).run(guildId, cutoffDate.toISOString());
    return;
  }
  
  // Clean all guilds based on their retention settings
  const guilds = db.prepare('SELECT guild_id, retention_days FROM alt_detection_settings WHERE retention_days > 0').all();
  
  for (const guild of guilds) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - guild.retention_days);
    
    db.prepare(`
      DELETE FROM possible_alts 
      WHERE guild_id = ? AND detected_at < ?
    `).run(guild.guild_id, cutoffDate.toISOString());
  }
}

// ============================================
// Reminder Functions
// ============================================

/**
 * Create a new reminder
 * @param {string} userId - The user ID
 * @param {string} message - The reminder message
 * @param {Date} remindAt - When to remind the user
 * @returns {Object} The created reminder
 */
function createReminder(userId, message, remindAt) {
  const result = db.prepare(`
    INSERT INTO reminders (user_id, message, remind_at)
    VALUES (?, ?, ?)
  `).run(userId, message, remindAt.toISOString());
  
  return {
    id: result.lastInsertRowid,
    user_id: userId,
    message,
    remind_at: remindAt.toISOString(),
    created_at: new Date().toISOString()
  };
}

/**
 * Get a specific reminder by ID
 * @param {number} id - The reminder ID
 * @param {string} userId - The user ID (for ownership verification)
 * @returns {Object|null} The reminder or null
 */
function getReminder(id, userId) {
  return db.prepare('SELECT * FROM reminders WHERE id = ? AND user_id = ?').get(id, userId);
}

/**
 * Get all reminders for a user
 * @param {string} userId - The user ID
 * @returns {Array} List of reminders
 */
function getUserReminders(userId) {
  return db.prepare('SELECT * FROM reminders WHERE user_id = ? ORDER BY remind_at ASC').all(userId);
}

/**
 * Delete a reminder
 * @param {number} id - The reminder ID
 * @param {string} userId - The user ID (for ownership verification)
 * @returns {boolean} Success status
 */
function deleteReminder(id, userId) {
  const result = db.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?').run(id, userId);
  return result.changes > 0;
}

/**
 * Get all reminders that are due (remind_at <= now)
 * @returns {Array} List of due reminders
 */
function getDueReminders() {
  const now = new Date().toISOString();
  return db.prepare('SELECT * FROM reminders WHERE remind_at <= ?').all(now);
}

/**
 * Delete a reminder by ID (internal use after sending)
 * @param {number} id - The reminder ID
 * @returns {boolean} Success status
 */
function deleteReminderById(id) {
  const result = db.prepare('DELETE FROM reminders WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Get command toggle settings for a guild
 * @param {string} guildId - The guild ID
 * @returns {Object} Command toggle settings
 */
function getCommandToggleSettings(guildId) {
  // Ensure guild settings exist first
  getGuildSettings(guildId);
  
  let settings = db.prepare('SELECT * FROM command_toggle_settings WHERE guild_id = ?').get(guildId);
  
  if (!settings) {
    db.prepare('INSERT INTO command_toggle_settings (guild_id) VALUES (?)').run(guildId);
    settings = db.prepare('SELECT * FROM command_toggle_settings WHERE guild_id = ?').get(guildId);
  }
  
  // Parse JSON fields
  settings.disabled_commands = JSON.parse(settings.disabled_commands || '[]');
  
  return settings;
}

/**
 * Update command toggle settings
 * @param {string} guildId - The guild ID
 * @param {Object} updates - Object with fields to update
 * @returns {Object} Result with success and skippedFields
 */
function updateCommandToggleSettings(guildId, updates) {
  const allowedFields = ['admins_bypass', 'mods_bypass', 'disabled_commands'];
  const jsonFields = ['disabled_commands'];
  
  return updateTable('command_toggle_settings', 'guild_id', guildId, updates, allowedFields, jsonFields);
}

/**
 * Check if a command is disabled for a guild
 * @param {string} guildId - The guild ID
 * @param {string} commandName - The command name
 * @returns {boolean} True if command is disabled
 */
function isCommandDisabled(guildId, commandName) {
  const settings = getCommandToggleSettings(guildId);
  return settings.disabled_commands.includes(commandName);
}

// Initialize on require
initDatabase();

module.exports = {
  db,
  initDatabase,
  getGuildSettings,
  updateGuildSettings,
  getAutomodSettings,
  updateAutomodSettings,
  logModAction,
  getModActions,
  getUserModActions,
  getModLogRetentionDays,
  setModLogRetentionDays,
  cleanupOldModActions,
  getWarningRetentionDays,
  setWarningRetentionDays,
  cleanupOldWarnings,
  addWarning,
  getUserWarnings,
  getWarningCount,
  deleteWarning,
  clearUserWarnings,
  scheduleTempban,
  removeTempban,
  getPendingTempbans,
  getExpiredTempbans,
  createMessageReport,
  getMessageReport,
  getMessageReports,
  updateMessageReport,
  deleteMessageReport,
  getModerationSettings,
  updateModerationSettings,
  getAuditLogSettings,
  updateAuditLogSettings,
  // Tags
  createTag,
  getTag,
  getTagById,
  getTags,
  getTagsByOwner,
  updateTag,
  incrementTagUses,
  deleteTag,
  nukeTags,
  pruneTagsByUser,
  transferTag,
  // Troll Discourager
  getTrollDiscouragerSettings,
  updateTrollDiscouragerSettings,
  // Starboard
  getStarboardSettings,
  updateStarboardSettings,
  addStarboardMessage,
  getStarboardMessage,
  updateStarboardMessage,
  removeStarboardMessage,
  // Anti-Raid
  getAntiRaidSettings,
  updateAntiRaidSettings,
  // Possible Alts Detection
  getAltDetectionSettings,
  updateAltDetectionSettings,
  logPossibleAlt,
  getPossibleAlts,
  getPossibleAltsCount,
  deletePossibleAlt,
  cleanupOldPossibleAlts,
  // Reminders
  createReminder,
  getReminder,
  getUserReminders,
  deleteReminder,
  getDueReminders,
  deleteReminderById,
  // Command Toggles
  getCommandToggleSettings,
  updateCommandToggleSettings,
  isCommandDisabled
};
