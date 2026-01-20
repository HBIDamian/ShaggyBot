const express = require('express');
const router = express.Router();
const axios = require('axios');
const { createLogger } = require('../../utils/logger');

const logger = createLogger('AuthRoutes');

// Discord OAuth2 configuration
const DISCORD_API = 'https://discord.com/api';
const OAUTH2_AUTHORIZE = `${DISCORD_API}/oauth2/authorize`;
const OAUTH2_TOKEN = `${DISCORD_API}/oauth2/token`;
const USERS_ME = `${DISCORD_API}/users/@me`;
const USERS_ME_GUILDS = `${DISCORD_API}/users/@me/guilds`;

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.DASHBOARD_URL 
  ? `${process.env.DASHBOARD_URL}/auth/callback` 
  : 'http://localhost:3000/auth/callback';

const SCOPES = 'identify guilds';

/**
 * Helper to make authenticated Discord API requests
 */
async function discordRequest(url, accessToken) {
  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return data;
}

/**
 * Redirect to Discord OAuth2 login
 */
router.get('/login', (req, res) => {
  const state = Math.random().toString(36).substring(7);
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    state
  });

  res.redirect(`${OAUTH2_AUTHORIZE}?${params}`);
});

/**
 * OAuth2 callback handler
 */
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;

  if (state !== req.session.oauthState) {
    return res.status(400).send('Invalid state parameter');
  }

  if (!code) {
    return res.status(400).send('No code provided');
  }

  try {
    // Exchange code for access token
    const { data: tokenData } = await axios.post(OAUTH2_TOKEN,
      new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, expires_in } = tokenData;

    // Fetch user info and guilds in parallel
    const [userData, guildsData] = await Promise.all([
      discordRequest(USERS_ME, access_token),
      discordRequest(USERS_ME_GUILDS, access_token)
    ]);

    // Store in session
    req.session.user = {
      id: userData.id,
      username: userData.username,
      discriminator: userData.discriminator,
      avatar: userData.avatar,
      globalName: userData.global_name
    };
    req.session.accessToken = access_token;
    req.session.refreshToken = refresh_token;
    req.session.tokenExpires = Date.now() + (expires_in * 1000);
    req.session.guilds = guildsData;

    logger.info(`User ${userData.username} (${userData.id}) logged in`);
    res.redirect('/dashboard');
  } catch (err) {
    logger.error(`OAuth callback error: ${err.message}`);
    res.status(500).send('Authentication failed');
  }
});

/**
 * Logout handler
 */
router.get('/logout', (req, res) => {
  const username = req.session.user?.username;
  
  req.session.destroy((err) => {
    if (err) {
      logger.error(`Logout error: ${err.message}`);
    } else if (username) {
      logger.info(`User ${username} logged out`);
    }
    res.redirect('/');
  });
});

/**
 * Get current user info
 */
router.get('/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  res.json({
    user: req.session.user,
    guilds: req.session.guilds
  });
});

module.exports = router;
