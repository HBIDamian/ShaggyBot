const express = require('express');
const session = require('express-session');
const { Database } = require('bun:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createLogger, requestContextMiddleware } = require('../utils/logger');
const { applySecurityMiddleware } = require('../utils/securityMiddleware');
const { apiErrorMiddleware } = require('../utils/errorHandler');

const logger = createLogger('Dashboard');

// Constants
const DATA_DIR = path.join(__dirname, '../../data');
const SESSION_DB_PATH = path.join(DATA_DIR, 'sessions.db');
const SECRET_FILE_PATH = path.join(DATA_DIR, '.session-secret');
const SESSION_CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const STATIC_CACHE_AGE = '1d';

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const sessionDb = new Database(SESSION_DB_PATH);

// Initialize session table for bun:sqlite
sessionDb.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expire INTEGER NOT NULL
  )
`);
sessionDb.run('CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions(expire)');

// Custom session store for bun:sqlite
class BunSqliteStore extends session.Store {
  constructor(options = {}) {
    super();
    this.db = options.client;
    this.cleanupInterval = options.expired?.intervalMs || SESSION_CLEANUP_INTERVAL_MS;
    if (options.expired?.clear !== false) {
      this._startCleanup();
    }
  }

  _startCleanup() {
    this._cleanupTimer = setInterval(() => {
      this.db.run('DELETE FROM sessions WHERE expire < ?', [Date.now()]);
    }, this.cleanupInterval);
    this._cleanupTimer.unref?.();
  }

  get(sid, callback) {
    try {
      const row = this.db.query('SELECT sess FROM sessions WHERE sid = ? AND expire > ?').get(sid, Date.now());
      if (row) {
        callback(null, JSON.parse(row.sess));
      } else {
        callback(null, null);
      }
    } catch (err) {
      callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      const maxAge = sess.cookie?.maxAge || SESSION_MAX_AGE_MS;
      const expire = Date.now() + maxAge;
      this.db.run(
        'INSERT OR REPLACE INTO sessions (sid, sess, expire) VALUES (?, ?, ?)',
        [sid, JSON.stringify(sess), expire]
      );
      callback?.(null);
    } catch (err) {
      callback?.(err);
    }
  }

  destroy(sid, callback) {
    try {
      this.db.run('DELETE FROM sessions WHERE sid = ?', [sid]);
      callback?.(null);
    } catch (err) {
      callback?.(err);
    }
  }

  touch(sid, sess, callback) {
    this.set(sid, sess, callback);
  }
}

/**
 * Get or generate session secret
 */
function getSessionSecret() {
  if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }

  if (fs.existsSync(SECRET_FILE_PATH)) {
    return fs.readFileSync(SECRET_FILE_PATH, 'utf8').trim();
  }

  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE_PATH, secret);
  logger.info('Generated new session secret (add SESSION_SECRET to .env for manual control)');
  return secret;
}

/**
 * Create and configure the Express dashboard server
 * @param {Object} client - Discord.js client
 * @returns {Object} Express app
 */
function createDashboard(client) {
  const app = express();

  // Trust proxy for rate limiting IP detection (BP 6.2)
  app.set('trust proxy', 1);

  // ── Security middleware (BP 6.2, 6.6, 6.14) ─────────────────────────────
  applySecurityMiddleware(app, {
    rateLimit: { maxRequests: 200, windowMs: 60_000 },
    bodyLimit: '1mb',
  });

  // ── Request context / correlation IDs (BP 5.14) ─────────────────────────
  app.use(requestContextMiddleware);

  // ── Body parsers (placed AFTER body size limit) ─────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // ── Session configuration (BP 6.22 — hardened defaults) ─────────────────
  const isProduction = process.env.NODE_ENV === 'production';

  app.use(session({
    store: new BunSqliteStore({
      client: sessionDb,
      expired: { clear: true, intervalMs: SESSION_CLEANUP_INTERVAL_MS },
    }),
    secret: getSessionSecret(),
    resave: false,
    saveUninitialized: false,
    name: 'shaggy.sid',                  // Don't use default 'connect.sid' — hide tech stack
    cookie: {
      secure: isProduction,               // HTTPS only in production
      httpOnly: true,                     // Not accessible via JS (XSS protection)
      sameSite: 'lax',                    // CSRF protection
      maxAge: SESSION_MAX_AGE_MS,
    },
    rolling: true,                        // Refresh expiry on activity
  }));

  // Store client reference
  app.set('client', client);

  // ── Cache headers ───────────────────────────────────────────────────────
  // Prevent caching of dynamic pages
  app.use((_req, res, next) => {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    next();
  });

  // Static files (cacheable)
  app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: STATIC_CACHE_AGE }));

  // View engine setup (EJS)
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  // Inject user data into all views
  app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
  });

  // ── Routes ───────────────────────────────────────────────────────────────
  app.use('/auth', require('./routes/auth'));
  app.use('/api', require('./routes/api'));
  app.use('/', require('./routes/dashboard'));

  // ── Centralized error handling (BP 2.4, 6.20) ───────────────────────────
  app.use(apiErrorMiddleware);

  return app;
}

/**
 * Start the dashboard server
 * @param {Object} client - Discord.js client
 * @param {number} port - Port to listen on
 * @returns {Object} HTTP server instance
 */
function startDashboard(client, port = 3000) {
  const app = createDashboard(client);
  return app.listen(port, () => logger.info(`Dashboard running at http://localhost:${port}`));
}

module.exports = { createDashboard, startDashboard };
