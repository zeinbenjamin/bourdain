// Caches the shell so the app opens without a connection.
// API calls always go to the network: recipe data must never be served stale.
const CACHE = "bourdain-v7";
const SLOW_MS = 3000; // how long to wait for the network before using the cached app
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  // Photos and covers are immutable once written: cache them on first read.
  if (url.pathname.startsWith("/api/photos/") || url.pathname.startsWith("/api/covers/")) {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      })
    );
    return;
  }

  if (url.pathname.startsWith("/api/")) return; // always live

  // Network first, so a new deploy shows up on the next open. But on a slow
  // connection, give the network 3s and then use the cached copy, rather than
  // a white screen. The network response still lands in the cache for next time.
  const fromNet = fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  });
  e.waitUntil(fromNet.catch(() => {}));
  const cached = () => caches.match(e.request).then((hit) => hit || caches.match("/index.html"));
  e.respondWith(
    Promise.race([fromNet, new Promise((r) => setTimeout(r, SLOW_MS))])
      .then((res) => res || cached().then((hit) => hit || fromNet)) // too slow: cache if we have it, else keep waiting
      .catch(() => cached())
  );
});
