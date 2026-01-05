// Basic Service Worker for Lakeside Retreat
// Minimal implementation to prevent 404 errors

const CACHE_NAME = 'lakeside-retreat-v1';

self.addEventListener('install', (event) => {
    console.log('Service Worker installing');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('Service Worker activated');
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    // Let all requests pass through - no caching for now
    return;
});