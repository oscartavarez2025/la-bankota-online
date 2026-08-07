// sw.js — Service worker mínimo (habilita instalación PWA; no cachea la API)
const CACHE = 'la-bancota-v2-mobile-3';
const ASSETS = ['/', '/css/style.css', '/js/app.js', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || e.request.url.includes('/api/')) return; // no cachear API
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE).then((cache) => cache.put(e.request, responseClone));
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
