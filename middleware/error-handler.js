/**
 * Error Handling & Graceful Shutdown
 * 
 * Provides:
 * - Global Express error middleware (catches unhandled route errors)
 * - Process-level error handlers (uncaughtException, unhandledRejection)
 * - Graceful shutdown on SIGTERM/SIGINT (drains connections, closes DB)
 * - Structured error logging with context
 * 
 * Usage in server.js:
 *   const { errorMiddleware, setupProcessHandlers, setupGracefulShutdown } = require('./middleware/error-handler');
 *   
 *   // After all routes:
 *   app.use(errorMiddleware);
 *   
 *   // After app.listen():
 *   setupProcessHandlers(log);
 *   setupGracefulShutdown(server, db, database);
 */

const { ERROR_CODES, sendError } = require('./auth');

/**
 * Global Express error-handling middleware.
 * Must be registered AFTER all routes (4 params = Express error handler).
 */
function errorMiddleware(err, req, res, next) {
    // Already sent headers — delegate to Express default
    if (res.headersSent) {
        return next(err);
    }

    const statusCode = err.statusCode || err.status || 500;
    const isProduction = process.env.NODE_ENV === 'production';

    // Sanitized error log — never log request body (may contain guest personal data)
    // and never log authorization headers
    const errorLog = {
        timestamp: new Date().toISOString(),
        level: statusCode >= 500 ? 'error' : 'warn',
        message: err.message,
        method: req.method,
        path: req.path,
        statusCode,
        ...(isProduction ? {} : { stack: err.stack })
    };

    // Log at appropriate level
    if (statusCode >= 500) {
        console.error(JSON.stringify(errorLog));
    } else {
        console.warn(JSON.stringify(errorLog));
    }

    // Known error types
    if (err.type === 'entity.parse.failed') {
        return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Invalid JSON in request body');
    }

    if (err.code === 'EBADCSRFTOKEN') {
        return sendError(res, 403, ERROR_CODES.AUTH_INVALID_TOKEN, 'Invalid CSRF token');
    }

    // Stripe errors
    if (err.type && err.type.startsWith('Stripe')) {
        return sendError(res, 402, 'PAYMENT_ERROR', 'Payment processing error');
    }

    // SQLite BUSY
    if (err.code === 'SQLITE_BUSY') {
        return sendError(res, 503, ERROR_CODES.DATABASE_ERROR, 'Database busy, please retry');
    }

    // Never send stack traces to clients in production
    const clientMessage = isProduction
        ? 'An internal error occurred'
        : err.message;

    res.status(statusCode).json({
        success: false,
        error: clientMessage,
        code: ERROR_CODES.INTERNAL_SERVER_ERROR
    });
}

/**
 * Set up process-level error handlers to prevent silent crashes.
 * @param {Function} log - Structured logger (from monitoring-system.js)
 */
function setupProcessHandlers(log) {
    const logger = log || console.error;

    process.on('uncaughtException', (err) => {
        console.error('💀 UNCAUGHT EXCEPTION:', err.message);
        console.error(err.stack);

        if (typeof logger === 'function') {
            try { logger('CRITICAL', 'Uncaught exception', { error: err.message, stack: err.stack }); } catch (_) {}
        }

        // Give time for logs to flush, then exit
        setTimeout(() => process.exit(1), 1000);
    });

    process.on('unhandledRejection', (reason, _promise) => {
        const message = reason instanceof Error ? reason.message : String(reason);
        const stack = reason instanceof Error ? reason.stack : undefined;

        console.error('⚠️ UNHANDLED REJECTION:', message);
        if (stack) console.error(stack);

        if (typeof logger === 'function') {
            try { logger('ERROR', 'Unhandled promise rejection', { error: message, stack }); } catch (_) {}
        }

        // Don't exit for rejections — log and continue
    });

    process.on('warning', (warning) => {
        console.warn('⚠️ NODE WARNING:', warning.name, warning.message);
    });

    console.log('✅ Process error handlers registered');
}

/**
 * Set up graceful shutdown: drain connections, close DB, exit cleanly.
 * @param {Object} server - HTTP server from app.listen()
 * @param {Object} db - Raw database connection
 * @param {Object} database - Database abstraction layer (has .close())
 */
function setupGracefulShutdown(server, db, database) {
    let shuttingDown = false;

    async function shutdown(signal) {
        if (shuttingDown) return;
        shuttingDown = true;

        console.log(`\n🛑 ${signal} received — starting graceful shutdown...`);

        // 1. Stop accepting new connections
        server.close(() => {
            console.log('✅ HTTP server closed');
        });

        // 2. Give in-flight requests time to finish (10s timeout)
        const forceTimeout = setTimeout(() => {
            console.error('⏰ Forced shutdown after timeout');
            process.exit(1);
        }, 10000);

        try {
            // 3. Close database connection
            if (database && typeof database.close === 'function') {
                await database.close();
                console.log('✅ Database connection closed');
            }
        } catch (err) {
            console.error('❌ Error closing database:', err.message);
        }

        clearTimeout(forceTimeout);
        console.log('👋 Shutdown complete');
        process.exit(0);
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    console.log('✅ Graceful shutdown handlers registered');
}

module.exports = { errorMiddleware, setupProcessHandlers, setupGracefulShutdown };
