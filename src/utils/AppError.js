'use strict';

/**
 * AppError — Extends the built-in Error object per Node.js Best Practice 2.2.
 *
 * All errors thrown within ShaggyBot should use (or extend) this class
 * so the centralized error handler can distinguish operational errors from
 * catastrophic/programmer errors, log appropriate detail, and decide whether
 * to crash vs. gracefully continue.
 *
 * @see https://github.com/goldbergyoni/nodebestpractices#-22-extend-the-built-in-error-object
 */

// Standardised error codes so callers can handle programmatically
const ErrorCodes = Object.freeze({
  // 4xx — Client / operational errors
  VALIDATION_ERROR:     'ERR_VALIDATION',
  NOT_FOUND:            'ERR_NOT_FOUND',
  FORBIDDEN:            'ERR_FORBIDDEN',
  UNAUTHORIZED:         'ERR_UNAUTHORIZED',
  RATE_LIMITED:         'ERR_RATE_LIMITED',
  CONFLICT:             'ERR_CONFLICT',
  BAD_REQUEST:          'ERR_BAD_REQUEST',

  // 5xx — Server / infrastructure errors
  INTERNAL:             'ERR_INTERNAL',
  DATABASE_ERROR:       'ERR_DATABASE',
  DISCORD_API_ERROR:    'ERR_DISCORD_API',
  EXTERNAL_SERVICE:     'ERR_EXTERNAL_SERVICE',

  // Catastrophic — programmer errors (should cause a restart in production)
  CATASTROPHIC:         'ERR_CATASTROPHIC',
  UNCAUGHT:             'ERR_UNCAUGHT',
});

// Map error codes to HTTP status codes
const HttpStatusMap = {
  [ErrorCodes.VALIDATION_ERROR]: 400,
  [ErrorCodes.NOT_FOUND]:        404,
  [ErrorCodes.FORBIDDEN]:        403,
  [ErrorCodes.UNAUTHORIZED]:     401,
  [ErrorCodes.RATE_LIMITED]:     429,
  [ErrorCodes.CONFLICT]:         409,
  [ErrorCodes.BAD_REQUEST]:      400,
  [ErrorCodes.INTERNAL]:         500,
  [ErrorCodes.DATABASE_ERROR]:   500,
  [ErrorCodes.DISCORD_API_ERROR]:502,
  [ErrorCodes.EXTERNAL_SERVICE]: 502,
  [ErrorCodes.CATASTROPHIC]:     500,
  [ErrorCodes.UNCAUGHT]:         500,
};

/**
 * Application error class.
 *
 * ```js
 * throw new AppError(ErrorCodes.NOT_FOUND, 'User not found', { userId: '123' });
 * ```
 */
class AppError extends Error {
  /**
   * @param {string} code           - One of ErrorCodes values
   * @param {string} message        - Human-readable message (safe to show clients for operational errors)
   * @param {Object} [context={}]   - Additional structured context for logging
   * @param {Error}  [cause]        - The underlying cause, if any (Node 16.9+ error cause)
   */
  constructor(code, message, context = {}, cause) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.context = context;
    this.isOperational = !code.startsWith('ERR_CATASTROPHIC') && code !== ErrorCodes.UNCAUGHT;
    this.isCatastrophic = !this.isOperational;
    this.httpStatus = HttpStatusMap[code] || 500;

    // Capture clean stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    // Attach underlying cause (Node 16.9+)
    if (cause) {
      this.cause = cause;
    }
  }

  /** Convenience: Is this a 4xx client error? */
  get isClientError() {
    return this.httpStatus >= 400 && this.httpStatus < 500;
  }

  /** Convenience: Is this a 5xx server error? */
  get isServerError() {
    return this.httpStatus >= 500;
  }

  /**
   * Create a plain object safe to return to API clients.
   * Omits stack traces, internal context, and causes per BP 6.20.
   */
  toClientJSON() {
    return {
      error: {
        code: this.code,
        message: this.isOperational ? this.message : 'Internal server error',
      },
    };
  }

  // ── Factory helpers ──────────────────────────────────────────────────────

  static validation(message, context) {
    return new AppError(ErrorCodes.VALIDATION_ERROR, message, context);
  }
  static notFound(message, context) {
    return new AppError(ErrorCodes.NOT_FOUND, message, context);
  }
  static forbidden(message, context) {
    return new AppError(ErrorCodes.FORBIDDEN, message, context);
  }
  static unauthorized(message, context) {
    return new AppError(ErrorCodes.UNAUTHORIZED, message, context);
  }
  static conflict(message, context) {
    return new AppError(ErrorCodes.CONFLICT, message, context);
  }
  static internal(message, context, cause) {
    return new AppError(ErrorCodes.INTERNAL, message, context, cause);
  }
  static database(message, context, cause) {
    return new AppError(ErrorCodes.DATABASE_ERROR, message, context, cause);
  }
  static catastrophic(message, context, cause) {
    return new AppError(ErrorCodes.CATASTROPHIC, message, context, cause);
  }
}

module.exports = { AppError, ErrorCodes };
