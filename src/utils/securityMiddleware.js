'use strict';

/**
 * Security Middleware — Node.js Best Practices 6.2, 6.6, 6.14, 6.22
 *
 * @see https://github.com/goldbergyoni/nodebestpractices#-66-adjust-the-http-response-headers-for-enhanced-security
 */

const { createLogger } = require('./logger');

const logger = createLogger('SecurityMiddleware');

// ── Secure headers (BP 6.6) ────────────────────────────────────────────────

/**
 * Apply secure HTTP response headers without requiring the 'helmet' package.
 * This is a lightweight implementation covering the most critical headers.
 *
 * Headers set:
 *   - X-Content-Type-Options: nosniff
 *   - X-Frame-Options: DENY (or SAMEORIGIN for dashboard)
 *   - X-XSS-Protection: 0 (deprecated, but belt-and-suspenders)
 *   - Referrer-Policy: strict-origin-when-cross-origin
 *   - Strict-Transport-Security: max-age=31536000; includeSubDomains (HTTPS only)
 *   - X-Powered-By: (removed)
 *   - Permissions-Policy: minimal set
 */
function secureHeadersMiddleware(req, res, next) {
  // Prevent MIME-type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking — allow same-origin for dashboard pages
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  // Disable XSS auditor (it's deprecated but defense-in-depth)
  res.setHeader('X-XSS-Protection', '0');

  // Control referrer information
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // HSTS — only on HTTPS connections
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Hide the framework (BP 6.22 — don't reveal tech stack)
  res.removeHeader('X-Powered-By');

  // Restrict browser features to minimal needs
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  next();
}

// ── Rate limiting (BP 6.2) ─────────────────────────────────────────────────

/**
 * Simple in-memory rate limiter.
 *
 * For production, replace with rate-limiter-flexible + Redis.
 *
 * @param {Object} opts
 * @param {number} [opts.windowMs=60000]   - Time window in ms
 * @param {number} [opts.maxRequests=100]  - Max requests per window per IP
 * @param {string} [opts.message]          - Error message
 * @returns {Function} Express middleware
 */
function createRateLimiter(opts = {}) {
  const {
    windowMs = 60_000,
    maxRequests = 100,
    message = 'Too many requests, please try again later.',
  } = opts;

  const hits = new Map();

  // Periodic cleanup of stale entries
  const cleanupInterval = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, timestamp] of hits) {
      if (timestamp < cutoff) {hits.delete(key);}
    }
  }, windowMs * 2);
  cleanupInterval.unref?.();

  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${ip}:${req.originalUrl || req.path}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Count requests in the current window for this key
    let count = 0;
    for (const [k, timestamp] of hits) {
      if (k.startsWith(key) && timestamp > windowStart) {count++;}
    }

    if (count >= maxRequests) {
      logger.warn(`Rate limit exceeded for ${ip} on ${req.path}`);
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({ error: { code: 'ERR_RATE_LIMITED', message } });
    }

    hits.set(`${key}:${now}`, now);
    next();
  };
}

// ── Body size limit (BP 6.14) ──────────────────────────────────────────────

/**
 * Express middleware to limit request body size.
 * Place BEFORE body parsers (express.json, express.urlencoded).
 *
 * @param {string} [limit='1mb'] - Max body size (bytes-parseable string)
 * @returns {Function} Express middleware
 */
function bodySizeLimit(limit = '1mb') {
  const bytes = parseBytes(limit);

  return (req, res, next) => {
    const contentLength = parseInt(req.headers['content-length'], 10);
    if (contentLength > bytes) {
      return res.status(413).json({
        error: {
          code: 'ERR_PAYLOAD_TOO_LARGE',
          message: `Request body exceeds ${limit} limit`,
        },
      });
    }
    next();
  };
}

/**
 * Parse a bytes string like '1mb', '500kb', '2gb' to number.
 */
function parseBytes(str) {
  const units = { b: 1, kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024 };
  const match = str.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/);
  if (!match) {return 1024 * 1024;} // default 1MB
  return parseFloat(match[1]) * (units[match[2]] || 1);
}

// ── Combined security stack ─────────────────────────────────────────────────

/**
 * Apply all security middleware to an Express app.
 * Call this once, early in the middleware chain (before routes).
 *
 * ```js
 * applySecurityMiddleware(app, { rateLimit: { maxRequests: 200 } });
 * ```
 *
 * @param {Object} app   - Express application
 * @param {Object} [opts={}]
 * @param {Object} [opts.rateLimit]  - Options for rate limiter
 * @param {string} [opts.bodyLimit]  - Body size limit string (default '1mb')
 */
function applySecurityMiddleware(app, opts = {}) {
  app.use(secureHeadersMiddleware);
  app.use(bodySizeLimit(opts.bodyLimit || '1mb'));
  app.use(createRateLimiter(opts.rateLimit || {}));

  logger.info('Security middleware applied');
}

module.exports = {
  secureHeadersMiddleware,
  createRateLimiter,
  bodySizeLimit,
  applySecurityMiddleware,
};