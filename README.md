# ShaggyBot

A powerful, feature-rich Discord bot built with Discord.js v14 featuring comprehensive moderation tools, auto-moderation, audit logging, and a modern web dashboard.

## ✨ Features

### 🌐 Web Dashboard
- Modern, responsive design with Tailwind CSS
- Discord OAuth2 authentication
- Per-server configuration for all features
- Real-time settings management
- Mobile-friendly interface

### 🛡️ Auto-Moderation
- **Spam Protection** - Configurable message rate limits
- **Bad Words Filter** - Custom word/phrase blacklist with wildcard support
- **Link Filtering** - Block links with domain whitelist
- **Phishing Protection** - 876,000+ known phishing domains blocked
- **Caps Detection** - Prevent excessive capitalization
- **Mass Mention Prevention** - Limit mentions per message
- **Invite Link Blocking** - Block Discord invite links
- **File Extension Filtering** - Whitelist/blacklist file types
- **Configurable Actions** - Warn, delete, mute, kick, or ban
- **Role & Channel Exemptions** - Fine-grained control

### 🚨 Anti-Raid Protection
- **Mass Join Detection** - Detect and respond to join raids
- **Account Age Filtering** - Flag new/suspicious accounts
- **Message Spam Detection** - Catch coordinated spam attacks
- **Similar Message Detection** - Fuzzy matching for raid messages
- **No Avatar Check** - Action on accounts without avatars
- **Unverified Email Check** - Action on unverified accounts
- **Ban Evasion Detection** - Detect potential ban evaders

### 📋 Comprehensive Audit Logging
- 25+ event types tracked
- Per-event channel configuration
- Custom embed colors per event type
- Role and channel exemptions
- Events include: joins, leaves, bans, message edits/deletes, role changes, channel updates, voice activity, and more

### 🔨 Moderation Commands
| Command | Description |
|---------|-------------|
| `/ban` | Ban a user with optional message deletion |
| `/unban` | Unban a user |
| `/kick` | Kick a member |
| `/timeout` | Temporarily timeout a user |
| `/mute` | Persistent mute with role |
| `/unmute` | Remove mute from user |
| `/warn` | Issue a warning |
| `/unwarn` | Remove a warning |
| `/warnings` | View user warnings |
| `/clearwarnings` | Clear all warnings for a user |
| `/tempban` | Temporarily ban a user |
| `/purge` | Bulk delete messages |
| `/lockdown` | Lock/unlock channels |
| `/slowmode` | Set channel slowmode |

All moderation commands support:
- **Silent mode** - Hide response from others
- **Anonymous mode** - Hide moderator identity
- **DM notifications** - Notify users of actions
- **Audit logging** - All actions logged

### ⭐ Starboard
- Configurable star emoji and threshold
- Automatic starboard channel posting
- Star count updates
- Self-star prevention option

### 🤡 Troll Discourager
- Shadow-mute trolls without them knowing
- Configurable percentage of messages to hide
- DM interception with fake responses
- Reaction removal

### 🎮 Fun Commands
| Command | Description |
|---------|-------------|
| `/8ball` | Ask the magic 8-ball |
| `/roll` | Roll dice (supports XdY notation) |
| `/roast` | Roast another user |
| `/monkeyspaw` | AI-powered twisted wish granting |

### 🏷️ Custom Tags
- Create server-specific custom commands
- Support for text and embed responses
- Tag ownership and editing
- Search and list functionality

### 🔧 Utility Commands
| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/ping` | Check bot latency |
| `/uptime` | Bot uptime |
| `/userinfo` | User information |
| `/serverinfo` | Server information |
| `/reminder` | Set personal reminders |

### 📱 Context Menu Commands
- **Report Message** - Right-click to report a message
- **Report User** - Right-click to report a user

## 📋 Requirements

- Node.js 18.0.0 or newer
- Discord Bot Token
- Discord OAuth2 Application (for dashboard)
- OpenAI API Key (optional, for `/monkeyspaw` command)

## 🚀 Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/shaggyBot-js.git
   cd shaggyBot-js
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   
   Create a `.env` file with:
   ```env
   # Required
   DISCORD_TOKEN=your_bot_token
   DISCORD_CLIENT_ID=your_client_id
   DISCORD_CLIENT_SECRET=your_client_secret
   
   # Dashboard
   DASHBOARD_URL=http://localhost:3000
   DASHBOARD_PORT=3000
   SESSION_SECRET=your_session_secret
   
   # Optional
   OPENAI_API_KEY=your_openai_key
   ```

4. **Start the bot**
   ```bash
   npm start
   ```

   Commands are automatically deployed on startup.

## 🖥️ Dashboard Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your application → OAuth2 → General
3. Add redirect URL: `http://localhost:3000/auth/callback`
4. Copy Client ID and Client Secret to `.env`
5. Enable required intents under Bot settings:
   - Server Members Intent
   - Message Content Intent

The dashboard will be available at `http://localhost:3000`

## 📁 Project Structure

```
shaggyBot-js/
├── src/
│   ├── commands/
│   │   ├── features/       # Tags, etc.
│   │   ├── fun/            # 8ball, roll, roast, monkeyspaw
│   │   ├── moderation/     # All moderation commands
│   │   └── utility/        # Help, ping, info commands
│   │
│   ├── contextMenus/       # Right-click commands
│   │
│   ├── dashboard/
│   │   ├── routes/         # API, auth, dashboard routes
│   │   ├── views/          # EJS templates
│   │   └── server.js       # Express server
│   │
│   ├── database/
│   │   └── database.js     # SQLite database layer
│   │
│   ├── events/
│   │   ├── auditLog.js     # Audit logging
│   │   ├── automod.js      # Auto-moderation
│   │   ├── starboard.js    # Starboard feature
│   │   └── ...             # Other event handlers
│   │
│   ├── utils/
│   │   ├── logger.js       # Logging utility
│   │   ├── moderationHelpers.js  # Shared moderation utilities
│   │   ├── phishingList.js # Phishing domain list
│   │   └── punishmentNotifier.js # DM notifications
│   │
│   └── index.js            # Main entry point
│
├── data/                   # Database & cache (auto-created)
├── logs/                   # Log files (auto-created)
├── resources/              # Static resources
└── package.json
```

## 🛠️ Development

```bash
# Run with auto-restart on changes
npm run dev

# Manually deploy commands
npm run deploy

# Lint code
npm run lint
```

## 📊 Database

ShaggyBot uses SQLite for data persistence. The database is automatically created and migrated on startup. Data includes:
- Guild settings
- Moderation settings & logs
- Auto-mod configuration
- Warnings
- Tags
- Starboard messages
- Audit log settings
- Anti-raid settings
- And more...

## 🔒 Required Bot Permissions

- Manage Roles
- Kick Members
- Ban Members
- Manage Channels
- Manage Messages
- Read Message History
- Send Messages
- Embed Links
- Attach Files
- Add Reactions
- Moderate Members (for timeouts)
