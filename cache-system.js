/**
 * In-Memory Caching System for Lakeside Retreat
 * Reduces database load and improves response times
 */

class CacheSystem {
    constructor(options = {}) {
        this.cache = new Map();
        this.defaultTTL = options.defaultTTL || 300000; // 5 minutes
        this.maxSize = options.maxSize || 1000;
        this.stats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0,
            evictions: 0
        };
        
        // Cleanup expired entries every minute
        this._cleanupTimer = setInterval(() => this.cleanup(), 60000);
        // Allow the timer to not prevent Node/Jest from exiting
        if (this._cleanupTimer.unref) {
            this._cleanupTimer.unref();
        }
    }
    
    // Generate cache key
    generateKey(prefix, ...args) {
        return `${prefix}:${args.join(':')}`;
    }
    
    // Get value from cache
    get(key) {
        const entry = this.cache.get(key);
        
        if (!entry) {
            this.stats.misses++;
            return null;
        }
        
        // Check if expired
        if (Date.now() > entry.expires) {
            this.cache.delete(key);
            this.stats.misses++;
            this.stats.deletes++;
            return null;
        }
        
        // Update access time
        entry.lastAccess = Date.now();
        this.stats.hits++;
        return entry.value;
    }
    
    // Set value in cache
    set(key, value, ttl = null) {
        const expires = Date.now() + (ttl || this.defaultTTL);

        // Evict if at capacity (check after potential concurrent sets)
        while (this.cache.size >= this.maxSize && !this.cache.has(key)) {
            this.evictLeastRecentlyUsed();
        }

        this.cache.set(key, {
            value,
            expires,
            lastAccess: Date.now(),
            created: Date.now()
        });

        this.stats.sets++;
        return true;
    }
    
    // Delete from cache
    delete(key) {
        const deleted = this.cache.delete(key);
        if (deleted) {
            this.stats.deletes++;
        }
        return deleted;
    }
    
    // Clear entire cache
    clear() {
        const size = this.cache.size;
        this.cache.clear();
        this.stats.deletes += size;
        return size;
    }
    
    // Evict least recently used entry
    evictLeastRecentlyUsed() {
        let oldestKey = null;
        let oldestTime = Date.now();
        
        for (const [key, entry] of this.cache.entries()) {
            if (entry.lastAccess < oldestTime) {
                oldestTime = entry.lastAccess;
                oldestKey = key;
            }
        }
        
        if (oldestKey) {
            this.cache.delete(oldestKey);
            this.stats.evictions++;
        }
    }
    
    // Clean up expired entries
    cleanup() {
        const now = Date.now();
        let cleaned = 0;
        
        for (const [key, entry] of this.cache.entries()) {
            if (now > entry.expires) {
                this.cache.delete(key);
                cleaned++;
            }
        }
        
        this.stats.deletes += cleaned;
        return cleaned;
    }
    
    // Get cache statistics
    getStats() {
        const totalRequests = this.stats.hits + this.stats.misses;
        const hitRate = totalRequests > 0 ? (this.stats.hits / totalRequests * 100).toFixed(2) : 0;
        
        return {
            ...this.stats,
            size: this.cache.size,
            maxSize: this.maxSize,
            hitRate: `${hitRate}%`,
            totalRequests
        };
    }
    
    // Express middleware for caching GET requests
    middleware(options = {}) {
        const ttl = options.ttl || this.defaultTTL;
        const keyGenerator = options.keyGenerator || ((req) => req.originalUrl);
        const condition = options.condition || (() => true);
        
        return (req, res, next) => {
            // Only cache GET requests
            if (req.method !== 'GET' || !condition(req)) {
                return next();
            }
            
            const cacheKey = keyGenerator(req);
            const cachedResponse = this.get(cacheKey);
            
            if (cachedResponse) {
                // Add cache headers
                res.set('X-Cache', 'HIT');
                res.set('X-Cache-Key', cacheKey);
                return res.json(cachedResponse);
            }
            
            // Override res.json to cache the response
            const originalJson = res.json;
            res.json = (data) => {
                // Only cache successful responses
                if (res.statusCode === 200 && data) {
                    this.set(cacheKey, data, ttl);
                }
                
                res.set('X-Cache', 'MISS');
                res.set('X-Cache-Key', cacheKey);
                return originalJson.call(res, data);
            };
            
            next();
        };
    }
}

// Create cache instances for different data types
const accommodationCache = new CacheSystem({
    defaultTTL: 600000,  // 10 minutes for accommodations
    maxSize: 100
});

const availabilityCache = new CacheSystem({
    defaultTTL: 300000,  // 5 minutes for availability
    maxSize: 500
});

const generalCache = new CacheSystem({
    defaultTTL: 180000,  // 3 minutes for general data
    maxSize: 1000
});

// Specific caching functions for common operations
const CacheManager = {
    // Cache accommodations data
    getAccommodations: async (fetchFunction) => {
        const cacheKey = 'accommodations:all';
        let accommodations = accommodationCache.get(cacheKey);
        
        if (!accommodations) {
            accommodations = await fetchFunction();
            accommodationCache.set(cacheKey, accommodations);
        }
        
        return accommodations;
    },
    
    // Cache availability check
    getAvailability: async (accommodation, checkIn, checkOut, fetchFunction) => {
        const cacheKey = availabilityCache.generateKey('availability', accommodation, checkIn, checkOut);
        let availability = availabilityCache.get(cacheKey);
        
        if (availability === null) {
            availability = await fetchFunction(accommodation, checkIn, checkOut);
            // Shorter TTL for availability to ensure accuracy
            availabilityCache.set(cacheKey, availability, 180000); // 3 minutes
        }
        
        return availability;
    },
    
    // Cache pricing information
    getPricing: async (accommodation, dates, fetchFunction) => {
        const cacheKey = generalCache.generateKey('pricing', accommodation, dates);
        let pricing = generalCache.get(cacheKey);
        
        if (!pricing) {
            pricing = await fetchFunction(accommodation, dates);
            generalCache.set(cacheKey, pricing, 300000); // 5 minutes
        }
        
        return pricing;
    },
    
    // Invalidate cache entries
    invalidateAccommodations: () => {
        accommodationCache.delete('accommodations:all');
    },
    
    invalidateAvailability: (accommodation, checkIn, checkOut) => {
        const cacheKey = availabilityCache.generateKey('availability', accommodation, checkIn, checkOut);
        availabilityCache.delete(cacheKey);
    },
    
    // Get all cache statistics
    getAllStats: () => ({
        accommodations: accommodationCache.getStats(),
        availability: availabilityCache.getStats(),
        general: generalCache.getStats()
    }),
    
    // Clear all caches
    clearAll: () => {
        const cleared = {
            accommodations: accommodationCache.clear(),
            availability: availabilityCache.clear(),
            general: generalCache.clear()
        };
        return cleared;
    }
};

module.exports = {
    CacheSystem,
    accommodationCache,
    availabilityCache,
    generalCache,
    CacheManager
};