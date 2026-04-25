const CACHE = 'fotoperiodo-v2';
const ASSETS = ['/', '/index.html', '/css/app.css',
  '/js/db.js', '/js/gps.js', '/js/app.js',
  '/js/data_bloques.json', '/js/data_variedades.json', '/js/data_plan.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match('/index.html'))));
});
