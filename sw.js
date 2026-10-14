/* AVI Field — offline copy of the app (step 2).
   Keeps every app file on the iPad so the home-screen icon opens with no signal.
   With signal, each file is checked against GitHub first (3-second limit), so a new
   version arrives the next time the app is opened. Job files are NOT handled here:
   they live in the app's own storage (IndexedDB) and never come from GitHub. */
const CACHE = 'avi-field-v0.2';
const FILES = ['./', 'index.html', 'app.js', 'sheet.js', 'sheet.css', 'pdf.min.js', 'pdf.worker.min.js',
               'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('avi-field-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const net = fetch(req, {cache: 'no-cache'}).then(r => {
      if (r && r.ok) cache.put(req, r.clone());
      return r;
    });
    const timeout = new Promise(res => setTimeout(() => res(null), 3000));
    try {
      const r = await Promise.race([net, timeout]);
      if (r && r.ok) return r;
    } catch (_) { /* no signal */ }
    const hit = await cache.match(req, {ignoreSearch: true}) ||
                (req.mode === 'navigate' ? await cache.match('index.html') : null);
    if (hit) return hit;
    return net;                       /* nothing cached: let the network answer (or fail) */
  })());
});
