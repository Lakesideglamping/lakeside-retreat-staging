/**
 * Secure Error Handling Middleware
 * Prevents information leakage while providing meaningful error responses
 */

const { getLogger } = require('../logging/logger');
const { getConfig } = require('../config/config');

class SecureErrorHandler {
    constructor() {
        this.logger = getLogger();
        this.config = getConfig();
        
        // Error types that are safe to expose to clients
        this.safeErrors = new Set([
            'ValidationError',
            'AuthenticationError',
            'AuthorizationError',
            'RateLimitError',
            'NotFoundError',
            'ConflictError',
            'BadRequestError'
        ]);

        // Sensitive patterns to scrub from error messages
        this.sensitivePatterns = [
            /password[:\s]*[^\s]+/gi,
            /token[:\s]*[^\s]+/gi,
            /secret[:\s]*[^\s]+/gi,
            /key[:\s]*[^\s]+/gi,
            /database[:\s]*[^\s]+/gi,
            /connection[:\s]*string[:\s]*[^\s]+/gi,
            /\b\d{13,19}\b/g, // Credit card numbers
            /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, // Email addresses in error messages
        ];
    }

    // Main error handling middleware
    handleError(error, req, res, next) {
        const errorId = this.generateErrorId();
        const sanitizedError = this.sanitizeError(error);
        
        // Log full error details securely
        this.logError(error, req, errorId);
        
        // Determine response based on error type and environment
        const response = this.buildErrorResponse(sanitizedError, errorId);
        
        // Set appropriate HTTP status
        const statusCode = this.getStatusCode(error);
        
        // Security headers for error responses
        this.setSecurityHeaders(res);
        
        res.status(statusCode).json(response);
    }

    // Create custom error classes
    static ValidationError(message, field = null) {
        const error = new Error(message);
        error.name = 'ValidationError';
        error.field = field;
        error.statusCode = 400;
        return error;
    }

    static AuthenticationError(message = 'Authentication required') {
        const error = new Error(message);
        error.name = 'AuthenticationError';
        error.statusCode = 401;
        return error;
    }

    static AuthorizationError(message = 'Access denied') {
        const error = new Error(message);
        error.name = 'AuthorizationError';
        error.statusCode = 403;
        return error;
    }

    static NotFoundError(resource = 'Resource') {
        const error = new Error(`${resource} not found`);
        error.name = 'NotFoundError';
        error.statusCode = 404;
        return error;
    }

    static ConflictError(message) {
        const error = new Error(message);
        error.name = 'ConflictError';
        error.statusCode = 409;
        return error;
    }

    static RateLimitError(message = 'Rate limit exceeded') {
        const error = new Error(message);
        error.name = 'RateLimitError';
        error.statusCode = 429;
        return error;
    }

    static BadRequestError(message) {
        const error = new Error(message);
        error.name = 'BadRequestError';
        error.statusCode = 400;
        return error;
    }

    generateErrorId() {
        return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    sanitizeError(error) {
        let message = error.message || 'An error occurred';
        
        // Remove sensitive information from error messages
        this.sensitivePatterns.forEach(pattern => {
            message = message.replace(pattern, '[REDACTED]');
        });
        
        return {
            name: error.name || 'Error',
            message,
            statusCode: error.statusCode,
            field: error.field,
            code: error.code
        };
    }

    logError(error, req, errorId) {
        const errorDetails = {
            errorId,
            name: error.name,
            message: error.message,
            stack: error.stack,
            statusCode: error.statusCode,
            url: req.originalUrl,
            method: req.method,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            userId: req.user?.id,
            sessionId: req.sessionID,
            timestamp: new Date().toISOString()
        };

        // Log at appropriate level
        if (error.statusCode >= 500) {
            this.logger.error('Server Error', errorDetails);
        } else if (error.statusCode >= 400) {
            this.logger.warn('Client Error', errorDetails);
        } else {
            this.logger.info('Application Error', errorDetails);
        }

        // Log security events separately
        if (['AuthenticationError', 'AuthorizationError', 'RateLimitError'].includes(error.name)) {
            this.logger.security(`Security Event: ${error.name}`, {
                errorId,
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                url: req.originalUrl,
                method: req.method
            });
        }
    }

    buildErrorResponse(sanitizedError, errorId) {
        const isProduction = this.config.isProduction();
        
        // Base response
        const response = {
            error: true,
            errorId,
            timestamp: new Date().toISOString()
        };

        // Add message based on error type and environment
        if (this.safeErrors.has(sanitizedError.name)) {
            // Safe to expose these errors
            response.message = sanitizedError.message;
            if (sanitizedError.field) {
                response.field = sanitizedError.field;
            }
        } else {
            // Generic message for unsafe errors
            if (sanitizedError.statusCode >= 500) {
                response.message = 'Internal server error';
                response.code = 'INTERNAL_ERROR';
            } else {
                response.message = 'Bad request';
                response.code = 'BAD_REQUEST';
            }
        }

        // Add additional details in development
        if (!isProduction) {
            response.debug = {
                originalError: sanitizedError.name,
                originalMessage: sanitizedError.message
            };
        }

        // Add helpful information based on error type
        switch (sanitizedError.name) {
            case 'ValidationError':
                response.type = 'validation_error';
                response.code = 'VALIDATION_FAILED';
                break;
            case 'AuthenticationError':
                response.type = 'authentication_error';
                response.code = 'AUTH_REQUIRED';
                break;
            case 'AuthorizationError':
                response.type = 'authorization_error';
                response.code = 'ACCESS_DENIED';
                break;
            case 'RateLimitError':
                response.type = 'rate_limit_error';
                response.code = 'RATE_LIMIT_EXCEEDED';
                response.retryAfter = sanitizedError.retryAfter;
                break;
            case 'NotFoundError':
                response.type = 'not_found_error';
                response.code = 'NOT_FOUND';
                break;
            case 'ConflictError':
                response.type = 'conflict_error';
                response.code = 'CONFLICT';
                break;
        }

        return response;
    }

    getStatusCode(error) {
        // Return explicit status code if set
        if (error.statusCode && error.statusCode >= 400 && error.statusCode < 600) {
            return error.statusCode;
        }

        // Map error names to status codes
        const statusMap = {
            'ValidationError': 400,
            'BadRequestError': 400,
            'AuthenticationError': 401,
            'AuthorizationError': 403,
            'NotFoundError': 404,
            'ConflictError': 409,
            'RateLimitError': 429,
            'DatabaseError': 503,
            'ServiceUnavailableError': 503
        };

        return statusMap[error.name] || 500;
    }

    setSecurityHeaders(res) {
        // Prevent caching of error responses
        res.set({
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Surrogate-Control': 'no-store'
        });
    }

    // Async error wrapper for route handlers
    static asyncHandler(fn) {
        return (req, res, next) => {
            Promise.resolve(fn(req, res, next)).catch(next);
        };
    }

    // Database error handler
    handleDatabaseError(error) {
        // Map database errors to user-friendly messages
        if (error.code === '23505') { // PostgreSQL unique violation
            return SecureErrorHandler.ConflictError('This record already exists');
        }
        
        if (error.code === '23503') { // PostgreSQL foreign key violation
            return SecureErrorHandler.BadRequestError('Referenced record not found');
        }
        
        if (error.code === '23514') { // PostgreSQL check constraint violation
            return SecureErrorHandler.ValidationError('Data validation failed');
        }

        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            const dbError = new Error('Database temporarily unavailable');
            dbError.name = 'ServiceUnavailableError';
            dbError.statusCode = 503;
            return dbError;
        }

        // Generic database error
        const genericError = new Error('Database operation failed');
        genericError.name = 'DatabaseError';
        genericError.statusCode = 500;
        return genericError;
    }

    // Stripe error handler
    handleStripeError(error) {
        if (error.type === 'StripeCardError') {
            return SecureErrorHandler.BadRequestError('Payment card declined');
        }
        
        if (error.type === 'StripeInvalidRequestError') {
            return SecureErrorHandler.BadRequestError('Invalid payment request');
        }
        
        if (error.type === 'StripeAuthenticationError') {
            const authError = new Error('Payment processing unavailable');
            authError.name = 'ServiceUnavailableError';
            authError.statusCode = 503;
            return authError;
        }

        // Generic payment error
        return SecureErrorHandler.BadRequestError('Payment processing failed');
    }

    // 404 handler for unmatched routes
    handleNotFound(req, res, next) {
        const error = SecureErrorHandler.NotFoundError('Endpoint');
        next(error);
    }

    // Unhandled rejection handler
    handleUnhandledRejection(reason, promise) {
        this.logger.error('Unhandled Promise Rejection', {
            reason: reason?.message || reason,
            stack: reason?.stack,
            promise: promise.toString()
        });
        
        // In production, exit gracefully
        if (this.config.isProduction()) {
            console.error('❌ Unhandled promise rejection. Shutting down gracefully...');
            process.exit(1);
        }
    }

    // Uncaught exception handler
    handleUncaughtException(error) {
        this.logger.error('Uncaught Exception', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        
        console.error('❌ Uncaught exception. Shutting down...');
        process.exit(1);
    }
}

// Create singleton instance
const errorHandler = new SecureErrorHandler();

// Export middleware and utilities
module.exports = {
    handleError: errorHandler.handleError.bind(errorHandler),
    handleNotFound: errorHandler.handleNotFound.bind(errorHandler),
    handleDatabaseError: errorHandler.handleDatabaseError.bind(errorHandler),
    handleStripeError: errorHandler.handleStripeError.bind(errorHandler),
    asyncHandler: SecureErrorHandler.asyncHandler,
    
    // Error classes
    ValidationError: SecureErrorHandler.ValidationError,
    AuthenticationError: SecureErrorHandler.AuthenticationError,
    AuthorizationError: SecureErrorHandler.AuthorizationError,
    NotFoundError: SecureErrorHandler.NotFoundError,
    ConflictError: SecureErrorHandler.ConflictError,
    RateLimitError: SecureErrorHandler.RateLimitError,
    BadRequestError: SecureErrorHandler.BadRequestError,
    
    // Process error handlers
    setupProcessErrorHandlers: () => {
        process.on('unhandledRejection', errorHandler.handleUnhandledRejection.bind(errorHandler));
        process.on('uncaughtException', errorHandler.handleUncaughtException.bind(errorHandler));
    }
};