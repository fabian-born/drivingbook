// sw.js – service worker for offline use
//
// Strategies:
//   /api/…            → never cache (always network)
//   own files         → network first, cache when offline
//   CDN (versioned)   → cache first
//
// The git hook (.githooks/pre-commit) sets CACHE to the frontend version
// automatically; add new files to APP_SHELL.

const CACHE = "fahrtenbuch-2026.09.26.17";

const APP_SHELL = [
  "./",
  "index.html", "driving.html", "view.html", "history.html",
  "profile.html", "auto.html", "admin.html", "login.html", "register.html",
  "css/app.css", "js/theme.js", "js/i18n.js", "lang/de.json", "lang/en.json", "js/nav.js", "js/config.js", "js/auth-check.js", "js/footer.js", "js/fahrzeug.js", "js/offline.js",
  "js/dashboard.js", "js/dashboard-history.js", "js/driving-new.js",
  "js/view.js", "js/profile.js", "js/auto.js", "js/sicherung.js", "js/auswertung.js", "js/admin.js", "js/login.js", "js/register.js",
  "drivingbooklogo.png", "manifest.webmanifest", "release.ver",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png",
];

const CDN_ASSETS = [
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css",
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js",
  "https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.min.css",
  "https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js",
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_SHELL);
    // CDN files one by one so a CDN outage doesn't block the installation
    await Promise.all(CDN_ASSETS.map(url =>
      cache.add(new Request(url, { mode: "cors" })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/api/")) return;  // never serve the API from the cache
    event.respondWith(networkFirst(request));
  } else if (url.hostname === "cdn.jsdelivr.net") {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    // Unknown page while offline → offer the entry page
    if (request.mode === "navigate") return cache.match("driving.html");
    throw err;
  }
}

async function cacheFirst(request) {
  const cache  = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}
