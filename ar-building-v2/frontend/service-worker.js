// service-worker.js – PWA Service Worker.
// Cache-First für statische Assets, Network-First für API-Anfragen.
// Ermöglicht Offline-Betrieb für die App-Shell.

const CACHE_NAME = 'ar-building-v2';

// Statische Dateien die beim Install gecacht werden
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/css/main.css',
  '/js/app.js',
  '/js/api.js',
  '/js/auth.js',
  '/js/camera.js',
  '/js/qr-scanner.js',
  '/js/onnx-detector.js',
  '/js/ar-overlay.js',
  '/js/room-view.js',
  '/js/object-view.js',
  '/js/audio-manager.js',
  '/js/video-overlay.js',
  '/js/stats-tracker.js',
  '/manifest.json',
  '/assets/icon-192.png',
];

// ---- Install: statische Assets vorab cachen ----
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Einzelne Fehler beim Pre-Caching nicht den gesamten Install stoppen
      return Promise.allSettled(
        PRECACHE_URLS.map(url => cache.add(url).catch(() => {}))
      );
    })
  );
  // Direkt aktivieren ohne auf bestehende Tabs zu warten
  self.skipWaiting();
});

// ---- Activate: alte Caches löschen ----
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    )
  );
  // Sofort Kontrolle über alle Tabs übernehmen
  self.clients.claim();
});

// ---- Fetch: Anfragen abfangen ----
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API-Anfragen (/api/*): Network-First
  // → immer aktuelle Daten vom Server, Cache als Fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Externe CDN-Anfragen (jsQR, ONNX Runtime): Network-First mit Cache-Fallback
  if (!url.hostname.includes(self.location.hostname)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Alle anderen Anfragen (JS, CSS, HTML, Assets): Cache-First
  // → schnelles Laden aus dem Cache, Netzwerk nur wenn nicht gecacht
  event.respondWith(cacheFirst(event.request));
});

// Cache-First Strategie: Erst Cache prüfen, dann Netzwerk.
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  // Nicht im Cache → vom Netzwerk holen und cachen
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline und nicht gecacht → leere Fehler-Antwort
    return new Response('Offline', { status: 503 });
  }
}

// Network-First Strategie: Erst Netzwerk, dann Cache als Fallback.
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    // Erfolgreiche Antwort im Cache aktualisieren
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Netzwerk nicht erreichbar → aus Cache bedienen
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('Offline', { status: 503 });
  }
}