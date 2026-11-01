// Service worker voor de spelers-app (schema/).
// Eigen scope (alleen de map schema/), dus de WL-app (wl.html + ../sw.js) wordt niet geraakt.
// Wedstrijddata uit Supabase wordt NOOIT gecachet — die komt altijd live van de server.

const CACHE = 'kb-schema-v39';   // ophogen (v2, v3, ...) als iedereen de app-bestanden opnieuw moet ophalen
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-180.png', 'icons/favicon-48.png'];
const shellUrls = SHELL.map(p => new URL(p, self.registration.scope).pathname);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('kb-schema-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Supabase: gewoon doorlaten, nooit cachen
  if (!shellUrls.includes(url.pathname)) return;

  // Netwerk eerst: altijd de nieuwste versie; alleen zonder internet uit de cache.
  // cache:'no-cache' = altijd bij GitHub navragen of er een nieuwere versie is, i.p.v. tot 10 minuten
  // een oude kopie uit de browsercache te gebruiken (GitHub Pages stuurt max-age=600 mee).
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) { const kopie = res.clone(); caches.open(CACHE).then(c => c.put(req, kopie)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});

// ── Pushmeldingen (verstuurd door de Edge Function 'push') ──
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { tekst: e.data ? e.data.text() : '' }; }
  const titel = d.titel || 'De Kaale Bull';
  e.waitUntil(self.registration.showNotification(titel, {
    body: d.tekst || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: d.soort || 'kb',
    data: { url: d.url || './?view=mijn' },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const doel = new URL((e.notification.data && e.notification.data.url) || './?view=mijn', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lijst => {
    for (const c of lijst) { if (c.url.startsWith(self.registration.scope) && 'focus' in c) { c.navigate(doel).catch(()=>{}); return c.focus(); } }
    return self.clients.openWindow(doel);
  }));
});
