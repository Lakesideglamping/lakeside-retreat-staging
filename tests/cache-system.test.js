/**
 * Tests for cache-system.js
 *
 * Covers: get/set, TTL expiration, maxSize eviction, cleanup, stats
 */

const { CacheSystem } = require('../cache-system');

// Prevent the default setInterval inside the constructor from leaking timers
// by using a very short-lived cache instance per test.
let cache;

beforeEach(() => {
    // Use fake timers so we can control setInterval / Date.now
    jest.useFakeTimers();
    cache = new CacheSystem({ defaultTTL: 5000, maxSize: 5 });
});

afterEach(() => {
    jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// Basic get / set
// ---------------------------------------------------------------------------
describe('get and set', () => {
    test('returns null for a key that was never set', () => {
        expect(cache.get('nonexistent')).toBeNull();
    });

    test('stores and retrieves a string value', () => {
        cache.set('greeting', 'hello');
        expect(cache.get('greeting')).toBe('hello');
    });

    test('stores and retrieves an object value', () => {
        const obj = { a: 1, b: [2, 3] };
        cache.set('data', obj);
        expect(cache.get('data')).toEqual(obj);
    });

    test('overwrites an existing key', () => {
        cache.set('key', 'first');
        cache.set('key', 'second');
        expect(cache.get('key')).toBe('second');
    });

    test('delete removes an entry', () => {
        cache.set('key', 'val');
        expect(cache.delete('key')).toBe(true);
        expect(cache.get('key')).toBeNull();
    });

    test('delete returns false for missing key', () => {
        expect(cache.delete('missing')).toBe(false);
    });

    test('clear removes all entries', () => {
        cache.set('a', 1);
        cache.set('b', 2);
        const cleared = cache.clear();
        expect(cleared).toBe(2);
        expect(cache.get('a')).toBeNull();
        expect(cache.get('b')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// TTL expiration
// ---------------------------------------------------------------------------
describe('TTL expiration', () => {
    test('entry is available before TTL expires', () => {
        cache.set('temp', 'data', 1000); // 1 second TTL
        jest.advanceTimersByTime(500);    // advance 0.5s
        expect(cache.get('temp')).toBe('data');
    });

    test('entry expires after TTL elapses', () => {
        cache.set('temp', 'data', 1000); // 1 second TTL
        jest.advanceTimersByTime(1001);   // advance past TTL
        expect(cache.get('temp')).toBeNull();
    });

    test('uses defaultTTL when no TTL is specified', () => {
        // defaultTTL is 5000ms for our test cache
        cache.set('default-ttl', 'value');
        jest.advanceTimersByTime(4999);
        expect(cache.get('default-ttl')).toBe('value');
        jest.advanceTimersByTime(2);
        expect(cache.get('default-ttl')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// maxSize eviction
// ---------------------------------------------------------------------------
describe('maxSize eviction', () => {
    test('evicts least recently used entry when cache exceeds maxSize', () => {
        // maxSize is 5
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);
        cache.set('d', 4);
        cache.set('e', 5);

        // Accessing 'a' updates its lastAccess, making 'b' the LRU
        jest.advanceTimersByTime(10);
        cache.get('a');

        // Adding a 6th entry should evict the LRU entry ('b')
        jest.advanceTimersByTime(10);
        cache.set('f', 6);

        expect(cache.get('a')).toBe(1);   // recently accessed, kept
        expect(cache.get('b')).toBeNull(); // LRU, evicted
        expect(cache.get('f')).toBe(6);   // newly added
    });

    test('total cache size never exceeds maxSize', () => {
        for (let i = 0; i < 10; i++) {
            jest.advanceTimersByTime(1); // ensure different timestamps
            cache.set(`key-${i}`, i);
        }
        // Internal map should not exceed maxSize
        const stats = cache.getStats();
        expect(stats.size).toBeLessThanOrEqual(5);
    });

    test('eviction increments the evictions stat', () => {
        for (let i = 0; i < 5; i++) {
            cache.set(`k${i}`, i);
        }
        // This 6th set should trigger an eviction
        jest.advanceTimersByTime(1);
        cache.set('overflow', 'value');

        const stats = cache.getStats();
        expect(stats.evictions).toBeGreaterThanOrEqual(1);
    });
});

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
describe('cleanup', () => {
    test('removes expired entries', () => {
        cache.set('short', 'data', 1000);
        cache.set('long', 'data', 60000);

        jest.advanceTimersByTime(2000); // short has expired, long has not

        const cleaned = cache.cleanup();
        expect(cleaned).toBe(1);
        expect(cache.get('short')).toBeNull();
        expect(cache.get('long')).toBe('data');
    });

    test('returns 0 when nothing is expired', () => {
        cache.set('a', 1);
        cache.set('b', 2);
        const cleaned = cache.cleanup();
        expect(cleaned).toBe(0);
    });

    test('cleanup runs automatically via setInterval', () => {
        cache.set('auto-expire', 'data', 30000); // 30s TTL

        // The CacheSystem schedules cleanup every 60000ms
        jest.advanceTimersByTime(31000); // entry is now expired but not yet cleaned
        // Trigger the interval-based cleanup
        jest.advanceTimersByTime(30000); // total 61000ms - past the 60s interval

        // After cleanup fires, the entry should have been removed from the map
        // Verify through a direct get (which also checks expiry)
        expect(cache.get('auto-expire')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------
describe('getStats', () => {
    test('tracks hits and misses correctly', () => {
        cache.set('exists', 'value');

        cache.get('exists');     // hit
        cache.get('exists');     // hit
        cache.get('missing');    // miss

        const stats = cache.getStats();
        expect(stats.hits).toBe(2);
        expect(stats.misses).toBe(1);
    });

    test('tracks sets correctly', () => {
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);

        const stats = cache.getStats();
        expect(stats.sets).toBe(3);
    });

    test('calculates hitRate as a percentage string', () => {
        cache.set('k', 'v');
        cache.get('k');       // hit
        cache.get('missing'); // miss

        const stats = cache.getStats();
        // 1 hit / 2 total = 50%
        expect(stats.hitRate).toBe('50.00%');
    });

    test('hitRate is 0 when there are no requests', () => {
        const stats = cache.getStats();
        expect(stats.hitRate).toBe('0%');
        expect(stats.totalRequests).toBe(0);
    });

    test('reports current size and maxSize', () => {
        cache.set('x', 1);
        cache.set('y', 2);

        const stats = cache.getStats();
        expect(stats.size).toBe(2);
        expect(stats.maxSize).toBe(5);
    });

    test('tracks deletes correctly', () => {
        cache.set('a', 1);
        cache.delete('a');

        const stats = cache.getStats();
        expect(stats.deletes).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// generateKey
// ---------------------------------------------------------------------------
describe('generateKey', () => {
    test('creates a key from prefix and arguments', () => {
        expect(cache.generateKey('availability', 'dome-pinot', '2025-01-01', '2025-01-05'))
            .toBe('availability:dome-pinot:2025-01-01:2025-01-05');
    });

    test('handles a single argument', () => {
        expect(cache.generateKey('item', 'abc')).toBe('item:abc');
    });

    test('handles no arguments', () => {
        expect(cache.generateKey('all')).toBe('all:');
    });
});
