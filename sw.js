const CACHE = "morning-roast-v7"; // Keep in sync with APP_CACHE_VERSION in script.js
const ASSETS = ["./", "./index.html", "./style.css", "./games.js", "./color-names.js", "./script.js", "./assets/logo.png", "./manifest.webmanifest"];
// PATH ROUTING: add "./404.html" to ASSETS when re-enabling GitHub Pages deep links.
// crosshair-converter.js + preview images load on demand when Misc tab is enabled.

function isCacheableRequest(request) {
  const protocol = new URL(request.url).protocol;
  return protocol === "http:" || protocol === "https:";
}

function isMediaRequest(request, url) {
  if (request.headers.has("range")) return true;
  if (request.destination === "video" || request.destination === "audio") return true;
  return /\.(mp4|webm|ogg|mp3|wav|m4a|mov)(\?|$)/i.test(url.pathname);
}

function putInCache(request, response) {
  if (!isCacheableRequest(request) || !response?.ok || response.status === 206) return;
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

  if (isMediaRequest(req, url)) return;

  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          putInCache(req, res.clone());
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => {
            if (cached) return cached;
            if (req.mode === "navigate" || req.destination === "document") {
              return caches.match("./index.html");
            }
            return undefined;
          }),
        ),
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
