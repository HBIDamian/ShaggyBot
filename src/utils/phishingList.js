const fs = require('fs');
const path = require('path');
const https = require('https');
const { createLogger } = require('./logger');

const logger = createLogger('PhishingList');

// Configuration
const PHISHING_LIST_URL = 'https://phish.co.za/latest/ALL-phishing-domains.lst';
const CACHE_DIR = path.join(__dirname, '../../data');
const CACHE_FILE = path.join(CACHE_DIR, 'phishing-domains.txt');
const ETAG_FILE = path.join(CACHE_DIR, 'phishing-domains.etag');
const UPDATE_INTERVAL = 6 * 60 * 60 * 1000; // Check for updates every 6 hours

// Fallback domains if download fails and no cache exists
const FALLBACK_DOMAINS = [
  'discord-nitro', 'discordgift', 'discord-gift', 'steamcommunlty',
  'steamnconnmunity', 'steamcomrnunity', 'dlscord-nitro', 'discorcl',
  'dlscord', 'discorde', 'free-nitro', 'nitro-discord', 'discord-airdrop', "hbidamian.xyz"
];

// In-memory domain set for fast lookups
let phishingDomains = new Set();
let lastUpdate = 0;
let updateTimer = null;

/**
 * Initialize the phishing list - load from cache or download
 */
async function initialize() {
  // Ensure cache directory exists
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  // Try to load from cache first
  if (fs.existsSync(CACHE_FILE)) {
    await loadFromCache();
    logger.info(`Loaded ${phishingDomains.size} phishing domains from cache`);
  } else {
    // No cache, use fallback while downloading
    phishingDomains = new Set(FALLBACK_DOMAINS);
    logger.info('No cache found, using fallback domains');
  }

  // Download latest in background
  downloadList().catch(err => {
    logger.error(`Initial download failed: ${err.message}`);
  });

  // Set up periodic updates
  startUpdateTimer();
}

/**
 * Load domains from cache file
 */
async function loadFromCache() {
  try {
    const data = fs.readFileSync(CACHE_FILE, 'utf-8');
    const domains = data.split('\n')
      .map(line => line.trim().toLowerCase())
      .filter(line => line && !line.startsWith('#'));
    
    phishingDomains = new Set(domains);
    
    // Get file modification time as last update
    const stats = fs.statSync(CACHE_FILE);
    lastUpdate = stats.mtimeMs;
  } catch (error) {
    logger.error(`Failed to load cache: ${error.message}`);
    phishingDomains = new Set(FALLBACK_DOMAINS);
  }
}

/**
 * Download the phishing list from the remote URL
 */
async function downloadList() {
  return new Promise((resolve, reject) => {
    logger.info('Checking for phishing list updates...');

    // Get stored ETag for conditional request
    let storedEtag = null;
    if (fs.existsSync(ETAG_FILE)) {
      storedEtag = fs.readFileSync(ETAG_FILE, 'utf-8').trim();
    }

    const options = {
      headers: {}
    };

    // Add If-None-Match header if we have a cached version
    if (storedEtag) {
      options.headers['If-None-Match'] = storedEtag;
    }

    https.get(PHISHING_LIST_URL, options, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        https.get(response.headers.location, options, handleResponse);
        return;
      }

      handleResponse(response);
    }).on('error', (error) => {
      logger.error(`Download request failed: ${error.message}`);
      reject(error);
    });

    function handleResponse(response) {
      // Not modified - our cache is still valid
      if (response.statusCode === 304) {
        logger.info('Phishing list is up to date (not modified)');
        lastUpdate = Date.now();
        resolve(false);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      let data = '';
      
      response.on('data', chunk => {
        data += chunk;
      });

      response.on('end', () => {
        try {
          // Parse and store domains
          const domains = data.split('\n')
            .map(line => line.trim().toLowerCase())
            .filter(line => line && !line.startsWith('#'));

          if (domains.length < 100) {
            // Suspiciously small list, might be an error
            logger.warn(`Downloaded list has only ${domains.length} domains, keeping existing`);
            resolve(false);
            return;
          }

          // Update in-memory set
          phishingDomains = new Set(domains);
          lastUpdate = Date.now();

          // Save to cache
          fs.writeFileSync(CACHE_FILE, data);

          // Save ETag if present
          const etag = response.headers['etag'];
          if (etag) {
            fs.writeFileSync(ETAG_FILE, etag);
          }

          logger.info(`Updated phishing list: ${domains.length} domains`);
          resolve(true);
        } catch (error) {
          logger.error(`Failed to process download: ${error.message}`);
          reject(error);
        }
      });

      response.on('error', (error) => {
        logger.error(`Response error: ${error.message}`);
        reject(error);
      });
    }
  });
}

/**
 * Start the periodic update timer
 */
function startUpdateTimer() {
  if (updateTimer) {
    clearInterval(updateTimer);
  }

  updateTimer = setInterval(() => {
    downloadList().catch(err => {
      logger.error(`Periodic update failed: ${err.message}`);
    });
  }, UPDATE_INTERVAL);

  // Don't prevent process exit
  updateTimer.unref();
}

/**
 * Check if a URL/text contains a phishing domain
 * @param {string} text - The text to check
 * @returns {boolean} - True if phishing domain found
 */
function containsPhishing(text) {
  const lowerText = text.toLowerCase();
  
  // Check each phishing domain
  for (const domain of phishingDomains) {
    if (lowerText.includes(domain)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get the count of loaded domains
 * @returns {number}
 */
function getDomainCount() {
  return phishingDomains.size;
}

/**
 * Get the last update timestamp
 * @returns {number}
 */
function getLastUpdate() {
  return lastUpdate;
}

/**
 * Force a manual update
 */
async function forceUpdate() {
  return downloadList();
}

/**
 * Cleanup on shutdown
 */
function shutdown() {
  if (updateTimer) {
    clearInterval(updateTimer);
    updateTimer = null;
  }
}

module.exports = {
  initialize,
  containsPhishing,
  getDomainCount,
  getLastUpdate,
  forceUpdate,
  shutdown
};
