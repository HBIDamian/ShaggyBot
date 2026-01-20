const fs = require('fs');
const path = require('path');
const util = require('util');

// Configuration
const LOG_DIR = path.join(process.cwd(), 'logs');
const MAX_LOG_FILES = 7; // Keep last 7 days of logs
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Log level priorities (higher = more important)
const LOG_PRIORITIES = { debug: 0, info: 1, warn: 2, error: 3 };

// ANSI color codes
const COLORS = {
  error: '\x1b[31m', // Red
  warn: '\x1b[33m',  // Yellow
  info: '\x1b[36m',  // Cyan
  debug: '\x1b[90m', // Grey
  reset: '\x1b[0m'
};

// Shared state across all logger instances
let currentLogFile = null;
let currentLogDate = null;
let writeStream = null;
let isInitialized = false;

/**
 * Initialize logging directory and clean up old logs
 */
function initializeLogging() {
  if (isInitialized) return;
  
  // Create logs directory if needed
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
  
  // Clean up old log files
  cleanupOldLogs();
  isInitialized = true;
}

/**
 * Remove log files older than MAX_LOG_FILES days
 */
function cleanupOldLogs() {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => f.startsWith('shaggyLog-') && f.endsWith('.log'))
      .map(f => ({ name: f, path: path.join(LOG_DIR, f), mtime: fs.statSync(path.join(LOG_DIR, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
    
    // Remove files beyond the limit
    files.slice(MAX_LOG_FILES).forEach(f => {
      try { fs.unlinkSync(f.path); } catch {}
    });
  } catch {}
}

/**
 * Get or create the write stream for today's log file
 * @returns {fs.WriteStream}
 */
function getWriteStream() {
  const today = new Date().toISOString().slice(0, 10);
  
  if (currentLogDate !== today) {
    // Close old stream if exists
    if (writeStream) {
      writeStream.end();
    }
    
    currentLogDate = today;
    currentLogFile = path.join(LOG_DIR, `shaggyLog-${today}.log`);
    writeStream = fs.createWriteStream(currentLogFile, { flags: 'a' });
    
    writeStream.on('error', (err) => {
      console.error(`Log write error: ${err.message}`);
    });
  }
  
  return writeStream;
}

/**
 * Creates a logger instance for the specified module
 * @param {string} moduleName - The name of the module
 * @returns {Object} - Logger object with methods for different log levels
 */
function createLogger(moduleName) {
  initializeLogging();
  
  const minPriority = LOG_PRIORITIES[LOG_LEVEL] ?? LOG_PRIORITIES.info;

  /**
   * Format and write log message
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {Error|undefined} error - Optional error object
   */
  function log(level, message, error) {
    // Skip if below minimum log level
    if (LOG_PRIORITIES[level] < minPriority) return;
    
    const timestamp = new Date().toISOString();
    const errorStr = error ? '\n' + util.format(error) : '';
    const logLine = `${timestamp} [${level.toUpperCase().padEnd(5)}] [${moduleName}] ${message}${errorStr}`;

    // Write to console with color
    const color = COLORS[level] || '';
    console.log(`${color}${logLine}${COLORS.reset}`);

    // Write to file asynchronously
    try {
      const stream = getWriteStream();
      stream.write(logLine + '\n');
    } catch {}
  }

  return {
    error: (message, error) => log('error', message, error),
    warn: (message, error) => log('warn', message, error),
    info: (message) => log('info', message),
    debug: (message) => log('debug', message)
  };
}

/**
 * Gracefully close the log stream
 */
function closeLogger() {
  if (writeStream) {
    writeStream.end();
    writeStream = null;
  }
}

module.exports = { createLogger, closeLogger };
