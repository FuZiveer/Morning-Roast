const CACHE = "morning-roast-v1"; // Keep in sync with APP_CACHE_VERSION in script.js
const ASSETS = ["./", "./index.html", "./style.css", "./script.js", "./crosshair-converter.js", "./viewmodel-generator.js", "./logo.png", "./manifest.webmanifest", "./assets/crosshair-preview-bg.png", "./assets/crosshair-preview-bg-2.png", "./assets/crosshair-preview-bg-3.png"];
// PATH ROUTING: add "./404.html" to ASSETS when re-enabling GitHub Pages deep links.

function isCacheableRequest(request) {
  const protocol = new URL(request.url).protocol;
  return protocol === "http:" || protocol === "https:";
}

function putInCache(request, response) {
  if (!isCacheableRequest(request) || !response?.ok) return;
  caches
    .open(CACHE)
    .then((cache) => cache.put(request, response))
    .catch(() => {});
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || !isCacheableRequest(req)) return;

  const url = new URL(req.url);

  // Network-first for same-origin navigation/core assets so updates land fast,
  // falling back to cache when offline. Cache-first for everything else.
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          putInCache(req, res.clone());
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("./index.html"))),
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req)
          .then((res) => {
            putInCache(req, res.clone());
            return res;
          })
          .catch(() => cached),
    ),
  );
});
