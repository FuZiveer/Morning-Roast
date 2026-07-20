const CACHE = "morning-roast-v206"; // Keep in sync with APP_CACHE_VERSION in script.js
const CORE_ASSETS = [
  "./index.html",
  "./style.css",
  "./tools/games.js",
  "./script.js",
  "./tools/online-presence.js",
  "./assets/favicon.ico",
  "./assets/logo.png",
  "./manifest.webmanifest",
];
// Backgrounds and misc tools load on demand via cache-first fetch.
// PATH ROUTING: add "./404.html" to CORE_ASSETS when re-enabling GitHub Pages deep links.

function isCacheableRequest(request) {
  const protocol = new URL(request.url).protocol;
  return protocol === "http:" || protocol === "https:";
}

function isMediaRequest(request, url) {
  if (request.headers.has("range")) return true;
  if (request.destination === "video" || request.destination === "audio") return true;
  return /\.(mp4|webm|ogg|mp3|wav|m4a|mov)(\?|$)/i.test(url.pathname);
}

function isStaticAsset(url, request) {
  if (request.destination === "script" || request.destination === "style" || request.destination === "image" || request.destination === "font") {
    return true;
  }
  return /\.(js|css|png|jpe?g|webp|ico|woff2?|webmanifest)(\?|$)/i.test(url.pathname);
}

function putInCache(request, response) {
  if (!isCacheableRequest(request) || !response?.ok || response.status === 206) return;
  caches
    .open(CACHE)
    .then((cache) => cache.put(request, response))
    .catch(() => {});
}

async function cachedFallback(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  if (request.mode === "navigate" || request.destination === "document") {
    return caches.match("./index.html");
  }
  return null;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    putInCache(request, response.clone());
    return response;
  } catch {
    return cachedFallback(request);
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    putInCache(request, response.clone());
    return response;
  } catch {
    return cachedFallback(request);
  }
}

async function respondForRequest(request) {
  const url = new URL(request.url);
  if (request.mode === "navigate" || request.destination === "document" || url.pathname.endsWith(".html")) {
    return networkFirst(request);
  }
  if (isStaticAsset(url, request)) {
    return cacheFirst(request);
  }
  return networkFirst(request);
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        await Promise.allSettled(CORE_ASSETS.map((asset) => cache.add(asset)));
      })
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
  if (url.origin !== self.location.origin) return;

  if (isMediaRequest(req, url)) return;

  if (url.pathname.endsWith("/favicon.ico")) {
    e.respondWith(
      caches.match("./assets/favicon.ico").then((cached) => {
        if (cached) return cached;
        return caches.match("./assets/logo.png").then((logo) => logo || fetch(req).catch(() => Response.error()));
      }),
    );
    return;
  }

  e.respondWith(respondForRequest(req));
});
