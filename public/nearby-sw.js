// Bump this name whenever a nearby asset changes. Cache only this offline game.
const CACHE = 'mjav-nearby-v1';
const ASSETS = ['/nearby', '/nearby.css', '/nearby.js', '/nearby-peer.js', '/nearby-game.js', '/styles.css', '/bonk-ui.js', '/game-core.js', '/game-render.js', '/cat.svg', '/fonts/bricolage-grotesque-latin.woff2', '/vendor/qrcode.js', '/vendor/jsQR.js'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('mjav-nearby-') && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !ASSETS.includes(url.pathname)) return;
  event.respondWith((async () => {
    const client = event.clientId ? await self.clients.get(event.clientId) : null;
    // Root scope permits the offline navigation; shared assets stay fresh on other pages.
    if (url.pathname !== '/nearby' && (!client || new URL(client.url).pathname !== '/nearby')) return fetch(event.request);
    const cache = await caches.open(CACHE);
    return (await cache.match(url.pathname)) || fetch(event.request);
  })());
});
