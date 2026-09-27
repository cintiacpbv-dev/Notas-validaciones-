/* Service worker para usar la app sin conexión desde el navegador (PC/tablet). */
var CACHE = 'misnotas-v3';
var FILES = [
    './', 'index.html', 'manifest.webmanifest',
    'css/app.css', 'css/validaciones.css', 'css/agenda.css',
    'js/config.js', 'js/icons.js', 'js/ui.js', 'js/store.js', 'js/sync.js', 'js/share.js',
    'js/validaciones.js', 'js/agenda.js', 'js/app.js',
    'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/localforage.min.js', 'vendor/jszip.min.js',
    'fonts/fredoka.woff2', 'fonts/plex-sans-400.woff2', 'fonts/plex-sans-500.woff2', 'fonts/plex-sans-600.woff2', 'fonts/plex-mono-500.woff2', 'icons/schnauzer.svg', 'icons/icon-192.png', 'icons/icon-512.png'
];
self.addEventListener('install', function(e) {
    e.waitUntil(caches.open(CACHE).then(function(c) { return c.addAll(FILES); }).then(function() { return self.skipWaiting(); }));
});
self.addEventListener('activate', function(e) {
    e.waitUntil(caches.keys().then(function(keys) {
        return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
    }).then(function() { return self.clients.claim(); }));
});
// Primero red (para recibir actualizaciones), caché si no hay conexión.
self.addEventListener('fetch', function(e) {
    if (e.request.method !== 'GET') return;
    e.respondWith(fetch(e.request).then(function(r) {
        var copy = r.clone();
        caches.open(CACHE).then(function(c) { c.put(e.request, copy); });
        return r;
    }).catch(function() { return caches.match(e.request); }));
});
