// Starlink Reseller — Service Worker v3
const CACHE = 'starlink-v4';
const PRECACHE = [
    '/starlink/',
    '/starlink/index.html',
    '/starlink/status.html',
    '/starlink/plans.html',
    '/starlink/orders.html',
    '/starlink/settings.html',
    '/starlink/manifest.json',
    '/starlink/pwa-install.js',
    '/starlink/icons/icon-192.png',
    '/starlink/icons/icon-512.png',
    '/starlink/icons/icon-192.svg',
    '/starlink/icons/icon-512.svg'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE).then(cache => {
            return cache.addAll(PRECACHE).catch(() => {/* ignore individual failures */});
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Network-first for HTML, cache-first for assets
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    const isHTML = event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html');

    if (isHTML) {
        event.respondWith(
            fetch(event.request)
                .then(res => {
                    const clone = res.clone();
                    caches.open(CACHE).then(c => c.put(event.request, clone));
                    return res;
                })
                .catch(() => caches.match(event.request))
        );
    } else {
        event.respondWith(
            caches.match(event.request).then(cached => cached || fetch(event.request))
        );
    }
});
