const express = require('express');
const router = express.Router();

/**
 * Middleware to check if user is logged in
 */
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  next();
}

// Common render options for guild pages
const GUILD_PAGE_DEFAULTS = {
  activePage: 'dashboard',
  requiresAuth: true,
  showDashboardLink: true
};

// Guild page routes configuration
const GUILD_PAGES = [
  { path: '', view: 'guild', title: 'Bot Settings', section: 'settings' },
  { path: '/commandtoggles', view: 'commandtoggles', title: 'Command Toggles', section: 'commandtoggles' },
  { path: '/automod', view: 'automod', title: 'Auto-Moderation', section: 'automod' },
  { path: '/logs', view: 'logs', title: 'Audit Log', section: 'logs' },
  { path: '/moderation', view: 'moderation', title: 'Moderation', section: 'moderation' },
  { path: '/auditlog', view: 'auditlog', title: 'Audit Log', section: 'auditlog' },
  { path: '/tags', view: 'tags', title: 'Tags', section: 'tags' },
  { path: '/trolldiscourager', view: 'trolldiscourager', title: 'Troll Discourager', section: 'trolldiscourager' },
  { path: '/starboard', view: 'starboard', title: 'Starboard', section: 'starboard' },
  { path: '/antiraid', view: 'antiraid', title: 'Anti-Raid', section: 'antiraid' },
  { path: '/lockdown', view: 'lockdown', title: 'Lockdown', section: 'lockdown' },
  { path: '/honeypot', view: 'honeypot', title: 'Honeypot', section: 'honeypot' }
];

/**
 * Home page
 */
router.get('/', (req, res) => {
  res.render('index', { activePage: 'home' });
});

/**
 * Commands page - public, no auth required
 */
router.get('/commands', (req, res) => {
  res.render('commands', { activePage: 'commands' });
});

/**
 * Dashboard - guild selection
 */
router.get('/dashboard', requireAuth, (req, res) => {
  res.render('dashboard', { activePage: 'dashboard', requiresAuth: true });
});

// Register all guild page routes dynamically
GUILD_PAGES.forEach(({ path, view, title, section }) => {
  router.get(`/dashboard/:guildId${path}`, requireAuth, (req, res) => {
    res.render(view, { title, activeSection: section, ...GUILD_PAGE_DEFAULTS });
  });
});

/**
 * Error page
 */
router.get('/error', (req, res) => {
  const statusCode = parseInt(req.query.code) || 500;
  const message = req.query.message || 'An unexpected error occurred.';
  res.status(statusCode).render('error', {
    title: `${statusCode} - Error`,
    statusCode,
    message
  });
});

/**
 * 404 handler
 */
router.use((req, res) => {
  res.status(404).render('error', { 
    title: '404 - Page Not Found',
    statusCode: 404,
    message: "The page you're looking for doesn't exist."
  });
});

module.exports = router;
