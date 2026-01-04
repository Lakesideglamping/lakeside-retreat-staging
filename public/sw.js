const CACHE_NAME = 'lakeside-retreat-v3';

// Only cache static assets - NOT HTML files
// HTML should always be fetched fresh to get latest CSP headers and content
const urlsToCache = [
    '/images/logormbg.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(urlsToCache))
            .catch((err) => {
                console.warn('Service worker cache failed:', err);
            })
    );
    // Skip waiting to activate immediately
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // Clean up ALL old caches on activation
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        }).then(() => {
            // Take control of all clients immediately
            return self.clients.claim();
        })
    );
});

self.addEventListener('fetch', (event) => {
    // Only handle same-origin requests to avoid CSP issues
    if (!event.request.url.startsWith(self.location.origin)) {
        return;
    }
    
    // For HTML requests (navigation), always use network-first
    // This ensures fresh CSP headers and content are always served
    if (event.request.mode === 'navigate' || 
        event.request.destination === 'document' ||
        event.request.url.endsWith('/') ||
        event.request.url.endsWith('.html')) {
        event.respondWith(
            fetch(event.request)
                .catch(() => {
                    // Only fall back to cache if network fails
                    return caches.match('/');
                })
        );
        return;
    }
    
    // For other requests (images, scripts, etc.), use cache-first
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                return response || fetch(event.request);
            })
            .catch(() => {
                return caches.match('/');
            })
    );
});
