'use strict';

/**
 * Upgraded Logger — Node.js Best Practices 2.7, 5.2, 5.14, 5.18
 *
 * - Logs exclusively to stdout (BP 5.18 — let infrastructure route logs)
 * - Supports structured JSON output in production for log aggregators
 * - Supports transaction/correlation IDs via AsyncLocalStorage (BP 5.14)
 * - Includes log levels with runtime filtering
 * - All previously file-based logging is now stdout-only
 *
 * @see https://github.com/goldbergyoni/nodebestpractices#-27-use-a-mature-logger-to-increase-errors-visibility
 */

const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');

// ── Transaction context (BP 5.14) ──────────────────────────────────────────

const requestContext = new AsyncLocalStorage();

/**
 * Run a function within a request context, attaching a correlation ID
 * to every log statement emitted during execution.
 *
 * ```js
 * runWithContext({ requestId: 'abc-123' }, () => { ... });
 * ```
 *
 * @param {Object}   context - Key/value pairs to attach to logs
 * @param {Function} fn      - Function to run within the context
 * @returns {*} Result of fn()
 */
function runWithContext(context, fn) {
  return requestContext.run(context, fn);
}

/** Get the current request context (if any) */
function getRequestContext() {
  return requestContext.getStore();
}

// ── Configuration ──────────────────────────────────────────────────────────

const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const LOG_PRIORITIES = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 };
const MIN_PRIORITY = LOG_PRIORITIES[LOG_LEVEL] ?? LOG_PRIORITIES.info;

// ── Sensitive data redaction ───────────────────────────────────────────────

const SENSITIVE_KEYS = new Set([
  'token', 'password', 'secret', 'authorization', 'cookie',
  'set-cookie', 'session', 'apikey', 'api_key', 'accessToken',
]);

/**
 * Deep-redact sensitive values from an object (mutates a clone).
 * Protected against circular references via a WeakSet tracker.
 */
function redact(obj, _seen = new WeakSet(), _depth = 0) {
  if (!obj || typeof obj !== 'object') { return obj; }

  // Guard against circular references
  if (_seen.has(obj)) { return '[Circular]'; }
  _seen.add(obj);

  // Guard against excessive depth
  if (_depth > 4) { return '[Object]'; }

  if (Array.isArray(obj)) {
    return obj.map((item) => redact(item, _seen, _depth + 1));
  }

  // Handle native objects — extract a safe summary instead of the raw object
  if (obj.constructor && obj.constructor.name && !['Object', 'Array'].includes(obj.constructor.name)) {
    const ctor = obj.constructor.name;
    // Extract safe properties from common HTTP types
    if (ctor === 'IncomingMessage' || ctor === 'ClientRequest') {
      return { '[$]': ctor, method: obj.method, url: obj.url };
    }
    if (ctor === 'ServerResponse') {
      return { '[$]': ctor, statusCode: obj.statusCode };
    }
    if (ctor === 'Socket') {
      return { '[$]': ctor, remoteAddress: obj.remoteAddress };
    }
    return { '[$]': ctor };
  }

  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      out[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      out[key] = redact(value, _seen, _depth + 1);
    } else {
      out[key] = value;
    }
  }
  return out;
}

// ── Core logger ────────────────────────────────────────────────────────────

/**
 * Creates a logger instance for a named module.
 *
 * @param {string} module - Module name (e.g., 'APIRoutes', 'BanCommand')
 * @returns {{ debug, info, warn, error, fatal }}
 */
function createLogger(module) {
  function emit(level, message, extra = {}) {
    if (LOG_PRIORITIES[level] < MIN_PRIORITY) { return; }

    const ctx = getRequestContext() || {};
    const logEntry = {
      level,
      module,
      message,
      timestamp: new Date().toISOString(),
      ctx,
      extra,
    };

    if (IS_PRODUCTION) {
      emitProduction(logEntry);
    } else {
      emitDev(logEntry);
    }
  }

  return {
    debug: (message, extra) => emit('debug', message, extra),
    info: (message, extra) => emit('info', message, extra),
    warn: (message, extra) => emit('warn', message, extra),
    error: (message, extra) => emit('error', message, extra),
    fatal: (message, extra) => emit('fatal', message, extra),
  };
}

/**
 * Format the `extra` argument for structured log output.
 */
function formatExtra(extra) {
  if (extra instanceof Error) {
    const result = { error: extra.message, stack: extra.stack, code: extra.code };
    if (extra.cause) { result.cause = extra.cause.message; }
    return result;
  }
  return redact(extra);
}

/**
 * Emit a structured JSON log entry for production.
 */
function emitProduction({ level, module, message, timestamp, ctx, extra }) {
  const entry = {
    timestamp,
    level,
    module,
    message,
    requestId: ctx.requestId,
    transactionId: ctx.transactionId,
    guildId: ctx.guildId,
    userId: ctx.userId,
    ...formatExtra(extra),
  };
  console.log(JSON.stringify(entry));
}

/**
 * Emit a human-readable colored log entry for development.
 */
function emitDev({ level, module, message, timestamp, ctx, extra }) {
  const colorMap = { error: '\x1b[31m', fatal: '\x1b[35m', warn: '\x1b[33m', info: '\x1b[36m', debug: '\x1b[90m' };
  const color = colorMap[level] || '';
  const reset = '\x1b[0m';
  const requestId = ctx.requestId ? ` [${ctx.requestId}]` : '';

  let line = `${timestamp} [${level.toUpperCase()}] [${module}]${requestId} ${message}`;

  if (extra instanceof Error) {
    line += `\n  → Error: ${extra.message}`;
    if (extra.stack) {
      line += `\n  ${extra.stack.split('\n').slice(0, 4).join('\n  ')}`;
    }
  } else if (extra && typeof extra === 'object' && Object.keys(extra).length > 0) {
    line += ` ${JSON.stringify(redact(extra))}`;
  } else if (extra && typeof extra === 'string') {
    line += ` ${extra}`;
  }

  console.log(`${color}${line}${reset}`);
}

/**
 * Close the logger (no-op — we only write to stdout now per BP 5.18).
 * Kept for backward compatibility.
 */
function closeLogger() {
  // stdout is managed by the runtime — nothing to close
}

/**
 * Express middleware that attaches request context (BP 5.14).
 * Place early in the middleware chain.
 *
 * ```js
 * app.use(requestContextMiddleware);
 * ```
 */
function requestContextMiddleware(req, res, next) {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  const transactionId = req.headers['x-transaction-id'] || requestId;

  runWithContext({ requestId, transactionId }, () => {
    // Echo the request ID on the response header for client traceability
    res.setHeader('x-request-id', requestId);
    next();
  });
}

module.exports = {
  createLogger,
  closeLogger,
  runWithContext,
  getRequestContext,
  requestContextMiddleware,
};
