'use strict';

/**
 * Centralized Error Handler — Node.js Best Practice 2.4
 *
 * All entry-points (API routes, event handlers, cron jobs) should route
 * errors through this single module so logging, response formatting, and
 * crash decisions happen in exactly one place.
 *
 * @see https://github.com/goldbergyoni/nodebestpractices#-24-handle-errors-centrally-not-within-a-middleware
 */

const { createLogger } = require('./logger');
const { AppError, ErrorCodes } = require('./AppError');

const errorLogger = createLogger('ErrorHandler');

// ── Configuration ──────────────────────────────────────────────────────────

/** In production, catastrophic errors trigger a graceful shutdown */
const SHOULD_EXIT_ON_CATASTROPHIC = process.env.NODE_ENV === 'production';

/** Max milliseconds to wait for cleanup before force-exiting */
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 10_000;

/** Registered shutdown hooks */
const shutdownHooks = new Set();

// ── Core handler ───────────────────────────────────────────────────────────

/**
 * Handle any error that reaches an entry-point.
 *
 * - Operational errors (4xx) → log as warning, return safe response
 * - Server errors (5xx)      → log as error, notify, return generic response
 * - Catastrophic errors       → log as error, schedule graceful shutdown
 *
 * @param {Error|AppError} err      - The error to handle
 * @param {Object}         [ctx={}] - Additional context { req, res, interaction, guildId, userId, ... }
 * @returns {Object} { status, body } — suitable for an HTTP response (null if non-HTTP context)
 */
function handleError(err, ctx = {}) {
  // Normalise to AppError
  const appError = err instanceof AppError
    ? err
    : new AppError(ErrorCodes.INTERNAL, err.message || 'Internal server error', {}, err);

  // Enrich context with the raw error for logging
  const logMeta = { ...appError.context, ...ctx };

  if (appError.isCatastrophic) {
    errorLogger.error(
      `[CATASTROPHIC] ${appError.code}: ${appError.message}`,
      { ...logMeta, stack: appError.stack, cause: appError.cause }
    );
    scheduleGracefulShutdown(appError);
    return { status: 500, body: { error: { message: 'Internal server error' } } };
  }

  if (appError.isClientError) {
    errorLogger.warn(`[${appError.code}] ${appError.message}`, logMeta);
  } else {
    errorLogger.error(`[${appError.code}] ${appError.message}`, { ...logMeta, stack: appError.stack });
  }

  return { status: appError.httpStatus, body: appError.toClientJSON() };
}

// ── Express middleware (for API routes) ────────────────────────────────────

/**
 * Express error-handling middleware (4 args).
 * Place AFTER all routes.
 *
 * Per BP 6.20, never leaks stack traces or internal details to clients.
 */
function apiErrorMiddleware(err, req, res, _next) {
  const ctx = {
    method: req.method,
    path: req.originalUrl || req.path,
    guildId: req.params?.guildId,
    userId: req.session?.user?.id,
    ip: req.ip || req.socket?.remoteAddress,
  };

  const { status, body } = handleError(err, ctx);
  res.status(status).json(body);
}

// ── Async route wrapper (try/catch) ────────────────────────────────────────

/**
 * Wraps an async Express route handler so thrown/rejected errors
 * are forwarded to the error middleware via next(err).
 *
 * ```js
 * router.get('/data', asyncHandler(async (req, res) => { ... }));
 * ```
 *
 * @param {Function} fn - async (req, res, next) route handler
 * @returns {Function} wrapped handler
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ── Discord interaction error wrapper ──────────────────────────────────────

/**
 * Wraps a Discord interaction handler so errors are centrally processed.
 *
 * ```js
 * module.exports = { execute: interactionHandler(async (interaction) => { ... }) };
 * ```
 *
 * @param {Function} fn - async (interaction) handler
 * @returns {Function} wrapped handler
 */
function interactionHandler(fn) {
  return async (interaction) => {
    try {
      await fn(interaction);
    } catch (err) {
      const ctx = {
        guildId: interaction.guildId,
        userId: interaction.user?.id,
        channelId: interaction.channelId,
        commandName: interaction.commandName,
      };

      handleError(err, ctx);

      // Reply to the interaction if it hasn't been acknowledged yet
      const reply = err instanceof AppError && err.isOperational
        ? { content: `❌ ${err.message}`, ephemeral: true }
        : { content: '❌ An unexpected error occurred. Please try again later.', ephemeral: true };

      try {
        if (interaction.deferred) {
          await interaction.editReply(reply);
        } else if (interaction.replied) {
          await interaction.followUp(reply);
        } else {
          await interaction.reply(reply);
        }
      } catch (_) {
        // Interaction may have expired
      }
    }
  };
}

// ── Graceful shutdown ──────────────────────────────────────────────────────

/**
 * Register a cleanup function to be called during graceful shutdown.
 *
 * ```js
 * registerShutdownHook('database', () => db.close());
 * ```
 *
 * @param {string}   name - Human-readable name for logging
 * @param {Function} fn   - Async or sync cleanup function
 */
function registerShutdownHook(name, fn) {
  shutdownHooks.add({ name, fn });
  errorLogger.debug(`Registered shutdown hook: ${name}`);
}

let shutdownInProgress = false;

/**
 * Schedule a graceful shutdown. Gives hooks a chance to clean up
 * before calling process.exit(1).
 *
 * @param {AppError} [error] - The error that triggered the shutdown
 */
function scheduleGracefulShutdown(error) {
  if (shutdownInProgress) {return;}
  shutdownInProgress = true;

  errorLogger.error('Initiating graceful shutdown...', error ? { code: error.code } : {});

  // Give hooks a bounded time to run
  const deadline = Date.now() + GRACEFUL_SHUTDOWN_TIMEOUT_MS;

  Promise.allSettled(
    [...shutdownHooks].map(({ name, fn }) => {
      errorLogger.info(`Running shutdown hook: ${name}`);
      try {
        const result = fn();
        // If it returns a promise, respect it
        if (result && typeof result.then === 'function') {
          return result;
        }
      } catch (hookErr) {
        errorLogger.error(`Shutdown hook "${name}" threw: ${hookErr.message}`);
      }
      return Promise.resolve();
    })
  ).finally(() => {
    const elapsed = Date.now();

    // If hooks took too long, force exit
    if (elapsed > deadline) {
      errorLogger.warn('Shutdown hooks exceeded deadline — forcing exit');
    }

    errorLogger.info('Exiting process');
    process.exit(1);
  });

  // Safety net: force exit after timeout
  setTimeout(() => {
    errorLogger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
}

// ── Unhandled rejection / uncaught exception (BP 2.10) ─────────────────────

function installGlobalErrorHandlers() {
  process.on('unhandledRejection', (reason, _promise) => {
    errorLogger.error('Unhandled promise rejection', {
      reason: reason?.message || reason,
      stack: reason?.stack,
    });
    // Don't crash on unhandled rejections — let the error handler decide
  });

  process.on('uncaughtException', (err) => {
    const appError = err instanceof AppError
      ? err
      : new AppError(ErrorCodes.CATASTROPHIC, err.message || 'Uncaught exception', {}, err);
    handleError(appError, { source: 'uncaughtException' });
  });

  // Log process warnings
  process.on('warning', (warning) => {
    errorLogger.warn(`Process warning: ${warning.name} — ${warning.message}`, {
      stack: warning.stack,
    });
  });
}

module.exports = {
  handleError,
  apiErrorMiddleware,
  asyncHandler,
  interactionHandler,
  registerShutdownHook,
  scheduleGracefulShutdown,
  installGlobalErrorHandlers,
  SHOULD_EXIT_ON_CATASTROPHIC,
  GRACEFUL_SHUTDOWN_TIMEOUT_MS,
};
