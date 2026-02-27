/**
 * Enhanced Rate Limiting
 * 
 * Adds per-user rate limiting for authenticated admin endpoints.
 * Standard IP-based limiters stay in server.js (generalLimiter, bookingLimiter, etc.).
 * 
 * This module provides:
 * - adminActionLimiter: rate limit admin write operations by JWT user identity
 * - adminBurstLimiter: prevent rapid-fire admin requests (DDoS via compromised JWT)
 * - rateLimitByKey: generic factory for custom rate limits
 * 
 * Usage:
 *   const { adminActionLimiter, adminBurstLimiter } = require('./middleware/rate-limit');
 *   router.post('/api/admin/bookings', verifyAdmin, adminActionLimiter, handler);
 */

/**
 * In-memory sliding window rate limiter.
 * Tracks request timestamps per key and enforces limits.
 */
class SlidingWindowLimiter {
    constructor({ windowMs, maxRequests, keyPrefix = 'rl' }) {
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
        this.keyPrefix = keyPrefix;
        this.store = new Map();

        // Cleanup stale entries every minute
        this.cleanupInterval = setInterval(() => this._cleanup(), 60000);
        // Allow GC of the interval if this object is collected
        if (this.cleanupInterval.unref) this.cleanupInterval.unref();
    }

    /**
     * Check if a key is rate-limited.
     * @returns {{ allowed: boolean, remaining: number, retryAfterMs: number }}
     */
    check(key) {
        const fullKey = `${this.keyPrefix}:${key}`;
        const now = Date.now();
        const windowStart = now - this.windowMs;

        let timestamps = this.store.get(fullKey) || [];
        // Remove expired entries
        timestamps = timestamps.filter(t => t > windowStart);
        this.store.set(fullKey, timestamps);

        if (timestamps.length >= this.maxRequests) {
            const oldestInWindow = timestamps[0];
            const retryAfterMs = oldestInWindow + this.windowMs - now;
            return {
                allowed: false,
                remaining: 0,
                retryAfterMs: Math.max(retryAfterMs, 0)
            };
        }

        return {
            allowed: true,
            remaining: this.maxRequests - timestamps.length - 1,
            retryAfterMs: 0
        };
    }

    /** Record a request for a key. */
    record(key) {
        const fullKey = `${this.keyPrefix}:${key}`;
        const timestamps = this.store.get(fullKey) || [];
        timestamps.push(Date.now());
        this.store.set(fullKey, timestamps);
    }

    _cleanup() {
        const now = Date.now();
        for (const [key, timestamps] of this.store) {
            const active = timestamps.filter(t => t > now - this.windowMs);
            if (active.length === 0) {
                this.store.delete(key);
            } else {
                this.store.set(key, active);
            }
        }
    }

    destroy() {
        clearInterval(this.cleanupInterval);
        this.store.clear();
    }
}

/**
 * Create Express middleware from a SlidingWindowLimiter.
 * @param {Object} opts
 * @param {number} opts.windowMs - Time window in milliseconds
 * @param {number} opts.maxRequests - Max requests per window
 * @param {Function} opts.keyFn - Extract rate limit key from request (default: req.adminId || req.ip)
 * @param {string} opts.message - Error message when rate limited
 */
function rateLimitByKey({ windowMs, maxRequests, keyFn, message, keyPrefix }) {
    const limiter = new SlidingWindowLimiter({
        windowMs,
        maxRequests,
        keyPrefix: keyPrefix || 'custom'
    });

    const defaultKeyFn = (req) => req.adminId || req.ip;
    const getKey = keyFn || defaultKeyFn;

    return function rateLimitMiddleware(req, res, next) {
        const key = getKey(req);
        const result = limiter.check(key);

        // Set standard rate limit headers
        res.setHeader('X-RateLimit-Limit', maxRequests);
        res.setHeader('X-RateLimit-Remaining', Math.max(result.remaining, 0));

        if (!result.allowed) {
            res.setHeader('Retry-After', Math.ceil(result.retryAfterMs / 1000));
            return res.status(429).json({
                success: false,
                error: message || 'Too many requests, please try again later',
                retryAfterSeconds: Math.ceil(result.retryAfterMs / 1000)
            });
        }

        limiter.record(key);
        next();
    };
}

// ==========================================
// Pre-built admin limiters
// ==========================================

/**
 * Rate limit admin write operations (create/update/delete).
 * 30 writes per 5 minutes per admin user.
 * Keyed by admin user ID from JWT (not IP).
 */
const adminActionLimiter = rateLimitByKey({
    windowMs: 5 * 60 * 1000,
    maxRequests: 30,
    keyPrefix: 'admin-action',
    keyFn: (req) => req.adminId || req.ip,
    message: 'Too many admin actions. Please wait before making more changes.'
});

/**
 * Rate limit admin burst requests (rapid reads).
 * 200 requests per minute per admin user.
 * Catches DDoS through compromised admin JWTs.
 */
const adminBurstLimiter = rateLimitByKey({
    windowMs: 60 * 1000,
    maxRequests: 200,
    keyPrefix: 'admin-burst',
    keyFn: (req) => req.adminId || req.ip,
    message: 'Request rate exceeded. Please slow down.'
});

/**
 * Strict limiter for destructive operations (delete, refund).
 * 5 per 10 minutes per admin user.
 */
const adminDestructiveLimiter = rateLimitByKey({
    windowMs: 10 * 60 * 1000,
    maxRequests: 5,
    keyPrefix: 'admin-destructive',
    keyFn: (req) => req.adminId || req.ip,
    message: 'Too many destructive operations. Please wait before continuing.'
});

module.exports = {
    SlidingWindowLimiter,
    rateLimitByKey,
    adminActionLimiter,
    adminBurstLimiter,
    adminDestructiveLimiter
};
