const CACHE = 'fotoperiodo-v2-20260427003338';
const BASE  = '/fotoperiodo-finca-olas';
const ASSETS = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/css/app.css',
  BASE + '/js/db.js',
  BASE + '/js/gps.js',
  BASE + '/js/roles.js',
  BASE + '/js/sheets.js',
  BASE + '/js/dashboard.js',
  BASE + '/js/app.js',
  BASE + '/js/data_bloques.json',
  BASE + '/js/data_variedades.json',
  BASE + '/js/data_plan.json',
  BASE + '/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request)
      .then(r => r || fetch(e.request))
      .catch(() => caches.match(BASE + '/index.html'))
  );
});
