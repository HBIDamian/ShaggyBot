const express = require('express');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createLogger } = require('../utils/logger');

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

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
  // Session configuration with SQLite store
  app.use(session({
    store: new SqliteStore({
      client: sessionDb,
      expired: { clear: true, intervalMs: SESSION_CLEANUP_INTERVAL_MS }
    }),
    secret: getSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_MAX_AGE_MS
    }
  }));

  // Store client reference
  app.set('client', client);

  // Prevent caching of dynamic pages
  app.use((req, res, next) => {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'Pragma': 'no-cache',
      'Expires': '0'
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

  // Load routes
  app.use('/auth', require('./routes/auth'));
  app.use('/api', require('./routes/api'));
  app.use('/', require('./routes/dashboard'));

  // Error handling
  app.use((err, req, res, next) => {
    logger.error(`Dashboard error: ${err.stack || err.message}`);
    res.status(500).render('404', { title: 'Error' });
  });

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
