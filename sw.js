const CACHE = "morning-roast-v240"; // Keep in sync with APP_CACHE_VERSION in script.js
const ASSETS = [
  "./index.html",
  "./style.css",
  "./tools/games.js",
  "./tools/color-names.js",
  "./tools/site-assistant.js",
  "./tools/online-presence.js",
  "./tools/community-chat.js",
  "./tools/profile-tags.js",
  "./script.js",
  "./assets/favicon.ico",
  "./assets/logo.png",
  "./assets/crosshair-preview-bg.png",
  "./assets/crosshair-preview-bg-2.png",
  "./assets/crosshair-preview-bg-3.png",
  "./assets/backgrounds/sunset-lake.jpg",
  "./assets/backgrounds/synthwave-peaks.jpg",
  "./assets/backgrounds/neon-city-street.jpg",
  "./assets/backgrounds/purple-stag-lake.jpg",
  "./assets/backgrounds/moon-mountain-stars.jpg",
  "./assets/backgrounds/rustic-coffee-bar.jpg",
  "./assets/backgrounds/prismatic-ridge.jpg",
  "./assets/backgrounds/cosmic-burst.jpg",
  "./assets/backgrounds/dark-wood.jpg",
  "./assets/backgrounds/royal-damask.jpg",
  "./assets/backgrounds/charcoal-slate.jpg",
  "./assets/backgrounds/neon-flame-stream.jpg",
  "./assets/backgrounds/magenta-paper-glow.jpg",
  "./assets/backgrounds/aged-parchment.jpg",
  "./assets/backgrounds/magenta-fluid-waves.jpg",
  "./assets/backgrounds/crimson-wire-mesh.jpg",
  "./assets/backgrounds/ember-low-poly.jpg",
  "./assets/backgrounds/prismatic-low-poly.jpg",
  "./assets/backgrounds/cyan-magenta-plexus.jpg",
  "./assets/backgrounds/neon-shard-streaks.jpg",
  "./assets/backgrounds/magenta-light-trails.jpg",
  "./assets/backgrounds/blue-crystal-poly.jpg",
  "./assets/backgrounds/diagonal-prism-streaks.jpg",
  "./assets/backgrounds/purple-nebula.jpg",
  "./assets/backgrounds/neon-crystal-shards.jpg",
  "./assets/backgrounds/violet-tree-canopy.jpg",
  "./assets/backgrounds/japanese-maple-autumn.jpg",
  "./assets/backgrounds/dark-ferns.jpg",
  "./manifest.webmanifest",
];
// PATH ROUTING: add "./404.html" to ASSETS when re-enabling GitHub Pages deep links.
// tools/crosshair-converter.js + preview images load on demand when Misc tab is enabled.

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

async function respondForRequest(request) {
  const response = await networkFirst(request);
  if (response) return response;
  return Response.error();
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        await Promise.allSettled(ASSETS.map((asset) => cache.add(asset)));
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
