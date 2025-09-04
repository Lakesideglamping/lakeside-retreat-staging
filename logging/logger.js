/**
 * Production-Ready Centralized Logging System
 * Structured logging with multiple transports and security filtering
 */

const winston = require('winston');
const path = require('path');

class SecureLogger {
    constructor() {
        this.sensitivePatterns = [
            /password["\s]*[:=]["\s]*([^"'\s,}]+)/gi,
            /token["\s]*[:=]["\s]*([^"'\s,}]+)/gi,
            /secret["\s]*[:=]["\s]*([^"'\s,}]+)/gi,
            /api[_-]?key["\s]*[:=]["\s]*([^"'\s,}]+)/gi,
            /stripe[_-]?key["\s]*[:=]["\s]*([^"'\s,}]+)/gi,
            /credit[_-]?card["\s]*[:=]["\s]*([^"'\s,}]+)/gi,
            /\b4[0-9]{12}(?:[0-9]{3})?\b/g, // Visa credit cards
            /\b5[1-5][0-9]{14}\b/g, // Mastercard
        ];

        this.logger = this.createLogger();
    }

    sanitizeData(data) {
        if (typeof data !== 'string') {
            data = JSON.stringify(data);
        }

        // Remove sensitive information
        this.sensitivePatterns.forEach(pattern => {
            data = data.replace(pattern, (match, group) => {
                return match.replace(group, '[REDACTED]');
            });
        });

        return data;
    }

    createLogger() {
        const logFormat = winston.format.combine(
            winston.format.timestamp({
                format: 'YYYY-MM-DD HH:mm:ss.SSS'
            }),
            winston.format.errors({ stack: true }),
            winston.format.json(),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
                const sanitizedMessage = this.sanitizeData(message);
                const sanitizedMeta = Object.keys(meta).length ? this.sanitizeData(JSON.stringify(meta)) : '';
                
                return JSON.stringify({
                    timestamp,
                    level,
                    message: sanitizedMessage,
                    ...(sanitizedMeta ? { meta: JSON.parse(sanitizedMeta) } : {}),
                    service: 'lakeside-retreat',
                    environment: process.env.NODE_ENV || 'development',
                    pid: process.pid,
                    hostname: require('os').hostname()
                });
            })
        );

        const transports = [];

        // Console transport for development
        if (process.env.NODE_ENV !== 'production') {
            transports.push(new winston.transports.Console({
                format: winston.format.combine(
                    winston.format.colorize(),
                    winston.format.simple()
                )
            }));
        }

        // File transports for production
        if (process.env.NODE_ENV === 'production' || process.env.ENABLE_FILE_LOGGING === 'true') {
            // Application logs
            transports.push(new winston.transports.File({
                filename: path.join(process.env.LOG_DIR || './logs', 'app.log'),
                level: process.env.LOG_LEVEL || 'info',
                maxsize: 10 * 1024 * 1024, // 10MB
                maxFiles: 5,
                tailable: true
            }));

            // Error logs
            transports.push(new winston.transports.File({
                filename: path.join(process.env.LOG_DIR || './logs', 'error.log'),
                level: 'error',
                maxsize: 10 * 1024 * 1024,
                maxFiles: 10,
                tailable: true
            }));

            // Security logs
            transports.push(new winston.transports.File({
                filename: path.join(process.env.LOG_DIR || './logs', 'security.log'),
                level: 'warn',
                maxsize: 5 * 1024 * 1024,
                maxFiles: 20,
                tailable: true
            }));
        }

        // External logging service (optional)
        if (process.env.LOGTAIL_TOKEN) {
            const { Logtail } = require('@logtail/node');
            const { LogtailTransport } = require('@logtail/winston');
            
            const logtail = new Logtail(process.env.LOGTAIL_TOKEN);
            transports.push(new LogtailTransport(logtail));
        }

        return winston.createLogger({
            level: process.env.LOG_LEVEL || 'info',
            format: logFormat,
            transports,
            exitOnError: false
        });
    }

    // Standard logging methods
    error(message, meta = {}) {
        this.logger.error(message, { ...meta, category: 'error' });
    }

    warn(message, meta = {}) {
        this.logger.warn(message, { ...meta, category: 'warning' });
    }

    info(message, meta = {}) {
        this.logger.info(message, { ...meta, category: 'info' });
    }

    debug(message, meta = {}) {
        this.logger.debug(message, { ...meta, category: 'debug' });
    }

    // Security-specific logging
    security(event, details = {}) {
        this.logger.warn(`SECURITY: ${event}`, {
            ...details,
            category: 'security',
            timestamp: new Date().toISOString(),
            ip: details.ip || 'unknown',
            userAgent: details.userAgent || 'unknown'
        });
    }

    // Audit logging for business events
    audit(action, details = {}) {
        this.logger.info(`AUDIT: ${action}`, {
            ...details,
            category: 'audit',
            timestamp: new Date().toISOString()
        });
    }

    // Performance monitoring
    performance(operation, duration, details = {}) {
        const level = duration > 1000 ? 'warn' : 'info';
        this.logger[level](`PERFORMANCE: ${operation} took ${duration}ms`, {
            ...details,
            category: 'performance',
            duration,
            operation
        });
    }

    // HTTP request logging
    httpRequest(req, res, duration) {
        const logData = {
            method: req.method,
            url: req.originalUrl,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            statusCode: res.statusCode,
            responseTime: duration,
            category: 'http'
        };

        // Log level based on status code
        if (res.statusCode >= 500) {
            this.error('HTTP Request', logData);
        } else if (res.statusCode >= 400) {
            this.warn('HTTP Request', logData);
        } else {
            this.info('HTTP Request', logData);
        }
    }

    // Database operation logging
    database(operation, table, duration, details = {}) {
        this.info(`DB: ${operation} on ${table}`, {
            ...details,
            category: 'database',
            operation,
            table,
            duration
        });
    }

    // Booking-specific logging
    booking(event, bookingData = {}) {
        // Remove sensitive data
        const sanitizedData = { ...bookingData };
        delete sanitizedData.paymentDetails;
        delete sanitizedData.creditCard;
        
        this.info(`BOOKING: ${event}`, {
            ...sanitizedData,
            category: 'booking'
        });
    }

    // Payment logging (extra security)
    payment(event, paymentData = {}) {
        // Only log non-sensitive payment information
        const safeData = {
            amount: paymentData.amount,
            currency: paymentData.currency,
            status: paymentData.status,
            paymentId: paymentData.paymentId,
            // Never log card details, tokens, or secrets
        };

        this.audit(`PAYMENT: ${event}`, {
            ...safeData,
            category: 'payment'
        });
    }
}

// Singleton instance
let loggerInstance = null;

function getLogger() {
    if (!loggerInstance) {
        loggerInstance = new SecureLogger();
    }
    return loggerInstance;
}

module.exports = {
    getLogger,
    SecureLogger
};