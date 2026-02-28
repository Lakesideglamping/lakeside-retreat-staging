/**
 * Shared Middleware & Utilities
 * 
 * Extracted from server.js to be shared across route modules.
 * Contains auth middleware, error/success helpers, input sanitization,
 * and database operation wrappers.
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { log } = require('../monitoring-system');

// ==========================================
// ERROR RESPONSE SYSTEM
// ==========================================

const ERROR_CODES = {
    // Validation errors (400)
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    INVALID_INPUT: 'INVALID_INPUT',
    MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
    INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',
    
    // Authentication errors (401)
    AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
    INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
    TOKEN_EXPIRED: 'TOKEN_EXPIRED',
    INVALID_TOKEN: 'INVALID_TOKEN',
    
    // Authorization errors (403)
    INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
    ADMIN_ACCESS_REQUIRED: 'ADMIN_ACCESS_REQUIRED',
    
    // Not found errors (404)
    RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
    BOOKING_NOT_FOUND: 'BOOKING_NOT_FOUND',
    ENDPOINT_NOT_FOUND: 'ENDPOINT_NOT_FOUND',
    
    // Conflict errors (409)
    RESOURCE_CONFLICT: 'RESOURCE_CONFLICT',
    DATES_NOT_AVAILABLE: 'DATES_NOT_AVAILABLE',
    BOOKING_ALREADY_EXISTS: 'BOOKING_ALREADY_EXISTS',
    
    // Server errors (500)
    INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
    DATABASE_ERROR: 'DATABASE_ERROR',
    PAYMENT_ERROR: 'PAYMENT_ERROR',
    EMAIL_ERROR: 'EMAIL_ERROR',
    EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR'
};

function createErrorResponse(code, message, details = null, requestId = null) {
    const response = {
        success: false,
        error: {
            code: code,
            message: message,
            timestamp: new Date().toISOString(),
            ...(details && { details }),
            ...(requestId && { requestId })
        }
    };
    
    if (process.env.NODE_ENV === 'development' && details) {
        response.debug = details;
    }
    
    return response;
}

function sendError(res, statusCode, errorCode, message, details = null, requestId = null) {
    const errorResponse = createErrorResponse(errorCode, message, details, requestId);
    return res.status(statusCode).json(errorResponse);
}

function sendSuccess(res, data = null, message = null, statusCode = 200) {
    const response = {
        success: true,
        timestamp: new Date().toISOString(),
        ...(message && { message }),
        ...(data && { data })
    };
    
    return res.status(statusCode).json(response);
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    // Strip HTML tags but preserve quotes and apostrophes
    return input.replace(/<[^>]*>/g, '').trim();
}

function escapeHtml(text) {
    if (typeof text !== 'string') return text;
    const htmlEntities = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };
    return text.replace(/[&<>"']/g, char => htmlEntities[char]);
}

// ==========================================
// DATABASE HELPERS
// ==========================================

/**
 * Database operation wrapper with retry logic for SQLite busy errors.
 * @param {Function} operation - (db, params, callback) => void
 * @param {any} db - Database connection
 * @param {Array} params - Query parameters
 * @param {number} retries - Max retry attempts
 */
async function executeDbOperation(operation, db, params = [], retries = 3) {
    return new Promise((resolve, reject) => {
        const attemptOperation = (attemptsLeft) => {
            const startTime = Date.now();
            
            operation(db, params, (err, result) => {
                const duration = Date.now() - startTime;
                
                if (duration > 1000) {
                    log('WARN', `Slow database operation: ${duration}ms`, {
                        duration,
                        performance: 'slow_query'
                    });
                }
                
                if (err) {
                    if ((err.code === 'SQLITE_BUSY' || err.code === 'SQLITE_LOCKED') && attemptsLeft > 0) {
                        const retryDelay = Math.random() * 1000 + 500;
                        setTimeout(() => attemptOperation(attemptsLeft - 1), retryDelay);
                        return;
                    }
                    
                    log('ERROR', `Database operation failed: ${err.message}`, {
                        error: err.message,
                        code: err.code,
                        duration,
                        retriesLeft: attemptsLeft
                    });
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        };
        
        attemptOperation(retries);
    });
}

// ==========================================
// AUTH MIDDLEWARE
// ==========================================

/**
 * Verify admin JWT token. Attaches decoded token to req.admin.
 */
function verifyAdmin(req, res, next) {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return sendError(res, 401, ERROR_CODES.AUTHENTICATION_REQUIRED, 'No token provided');
        }
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.role !== 'admin') {
            return sendError(res, 403, ERROR_CODES.ADMIN_ACCESS_REQUIRED, 'Admin access required');
        }
        
        req.admin = decoded;
        next();
        
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
}

// ==========================================
// CSRF PROTECTION MIDDLEWARE
// ==========================================

/**
 * Server-side secret for CSRF token signing.
 * Falls back to JWT_SECRET if CSRF_SECRET is not set.
 */
const CSRF_SECRET = process.env.CSRF_SECRET || process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

/**
 * Parse cookies from the Cookie header manually (avoids cookie-parser dependency).
 * Returns an object mapping cookie names to their values.
 */
function parseCookies(req) {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return {};

    const cookies = {};
    cookieHeader.split(';').forEach(cookie => {
        const parts = cookie.trim().split('=');
        if (parts.length >= 2) {
            const name = parts[0].trim();
            const value = parts.slice(1).join('=').trim();
            cookies[name] = decodeURIComponent(value);
        }
    });
    return cookies;
}

/**
 * Generate a signed CSRF token using HMAC.
 * Token format: <random>.<signature>
 * The random part is unique per token; the signature proves it was issued by this server.
 */
function generateCsrfToken() {
    const random = crypto.randomBytes(32).toString('hex');
    const signature = crypto
        .createHmac('sha256', CSRF_SECRET)
        .update(random)
        .digest('hex');
    return `${random}.${signature}`;
}

/**
 * Verify a CSRF token's signature is valid (was generated by this server).
 */
function isValidCsrfToken(token) {
    if (!token || typeof token !== 'string') return false;

    const parts = token.split('.');
    if (parts.length !== 2) return false;

    const [random, signature] = parts;
    const expectedSignature = crypto
        .createHmac('sha256', CSRF_SECRET)
        .update(random)
        .digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    try {
        return crypto.timingSafeEqual(
            Buffer.from(signature, 'hex'),
            Buffer.from(expectedSignature, 'hex')
        );
    } catch (e) {
        return false;
    }
}

/**
 * CSRF protection middleware using double-submit cookie pattern.
 *
 * How it works:
 * - GET /api/csrf-token sets a signed CSRF token in a cookie and returns it in JSON
 * - The frontend sends the token back via the X-CSRF-Token header on mutations
 * - This middleware verifies the header value matches the cookie AND the signature is valid
 *
 * Skips CSRF check for:
 * - Safe HTTP methods: GET, HEAD, OPTIONS
 * - Webhook endpoints (they use their own signature verification)
 */
function verifyCsrf(req, res, next) {
    // Skip CSRF for safe (read-only) methods
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (safeMethods.includes(req.method)) {
        return next();
    }

    // Skip CSRF for webhook endpoints (they have their own auth via signatures)
    const webhookPaths = [
        '/api/stripe/webhook',
        '/api/uplisting/webhook'
    ];
    if (webhookPaths.some(path => req.path.startsWith(path))) {
        return next();
    }

    // Parse cookies from the request
    const cookies = parseCookies(req);
    const cookieToken = cookies['csrf-token'];
    const headerToken = req.headers['x-csrf-token'];

    // Both cookie and header must be present
    if (!cookieToken || !headerToken) {
        return sendError(res, 403, ERROR_CODES.INSUFFICIENT_PERMISSIONS,
            'CSRF token missing. Fetch GET /api/csrf-token first.');
    }

    // Header must match cookie (double-submit pattern)
    if (headerToken !== cookieToken) {
        return sendError(res, 403, ERROR_CODES.INSUFFICIENT_PERMISSIONS,
            'CSRF token mismatch.');
    }

    // Verify the token signature is valid (was issued by this server)
    if (!isValidCsrfToken(headerToken)) {
        return sendError(res, 403, ERROR_CODES.INSUFFICIENT_PERMISSIONS,
            'CSRF token invalid.');
    }

    next();
}

module.exports = {
    ERROR_CODES,
    createErrorResponse,
    sendError,
    sendSuccess,
    sanitizeInput,
    escapeHtml,
    executeDbOperation,
    verifyAdmin,
    verifyCsrf,
    generateCsrfToken,
    parseCookies
};
