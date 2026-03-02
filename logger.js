/**
 * Structured Logger
 *
 * A thin wrapper around console methods that adds structured output.
 *
 * - In production (NODE_ENV=production): outputs JSON lines (one object per line).
 * - In development: outputs human-readable colored messages.
 *
 * Log levels (in ascending severity): debug, info, warn, error
 * The minimum level is controlled by the LOG_LEVEL env var (default: 'info').
 *
 * Usage:
 *   const { logger } = require('./logger');
 *   logger.info('Server started', { port: 3000 });
 *   logger.error('Something failed', { err: error.message });
 */

const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

const LEVEL_COLORS = {
    debug: '\x1b[36m',  // cyan
    info: '\x1b[32m',   // green
    warn: '\x1b[33m',   // yellow
    error: '\x1b[31m',  // red
};

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

const isProduction = process.env.NODE_ENV === 'production';

function getMinLevel() {
    const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
    return LOG_LEVELS[envLevel] ?? LOG_LEVELS.info;
}

function formatDev(level, message, context) {
    const timestamp = new Date().toISOString();
    const color = LEVEL_COLORS[level];
    const tag = `${color}[${level.toUpperCase()}]${RESET}`;
    const ts = `${DIM}${timestamp}${RESET}`;

    if (context && Object.keys(context).length > 0) {
        return `${ts} ${tag} ${message} ${DIM}${JSON.stringify(context)}${RESET}`;
    }
    return `${ts} ${tag} ${message}`;
}

function formatJson(level, message, context) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
    };
    if (context && Object.keys(context).length > 0) {
        entry.context = context;
    }
    return JSON.stringify(entry);
}

function createLogFn(level) {
    const consoleFn =
        level === 'error' ? console.error
        : level === 'warn' ? console.warn
        : console.log;

    return function log(message, context) {
        if (LOG_LEVELS[level] < getMinLevel()) return;

        const output = isProduction
            ? formatJson(level, message, context)
            : formatDev(level, message, context);

        consoleFn(output);
    };
}

const logger = {
    debug: createLogFn('debug'),
    info: createLogFn('info'),
    warn: createLogFn('warn'),
    error: createLogFn('error'),
};

module.exports = { logger };
