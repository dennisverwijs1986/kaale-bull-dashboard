// Service worker voor de WL-app (wl.html).
// Bewust minimaal: alleen de app-bestanden zelf worden bewaard, zodat de app snel opent.
// Wedstrijddata uit Supabase wordt NOOIT gecachet — die komt altijd live van de server.
// Andere pagina's (index.html, tv.html, ...) worden niet aangeraakt.

const CACHE = 'kb-wl-v1';   // ophogen (v2, v3, ...) als je wil dat iedereen de app-bestanden opnieuw ophaalt
const SHELL = [
  'wl.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-180.png',
  'icons/icon-maskable-512.png'
];
const shellUrls = SHELL.map(p => new URL(p, self.registration.scope).pathname);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('kb-wl-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;       // Supabase e.d.: gewoon doorlaten
  if (!shellUrls.includes(url.pathname)) return;           // alleen de app-bestanden zelf

  // Netwerk eerst: altijd de nieuwste versie van GitHub; alleen zonder internet uit de cache.
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const kopie = res.clone(); caches.open(CACHE).then(c => c.put(req, kopie)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
