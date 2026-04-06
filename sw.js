const CACHE_NAME = 'equalpath-v1';
const ASSETS = [
  '/EqualPath/',
  '/EqualPath/index.html',
  '/EqualPath/style.css',
  '/EqualPath/js/utils.js',
  '/EqualPath/js/constants.js',
  '/EqualPath/js/map.js',
  '/EqualPath/js/geocoding.js',
  '/EqualPath/js/routing.js',
  '/EqualPath/js/obstacles.js',
  '/EqualPath/js/auth.js',
  '/EqualPath/js/account.js',
  '/EqualPath/js/history.js',
  '/EqualPath/js/pickers.js',
  '/EqualPath/js/init.js',
  '/EqualPath/js/buddy.js',
  '/EqualPath/js/capacitor-bridge.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Network first, fallback to cache
  e.respondWith(
    fetch(e.request).then(resp => {
      if (resp.ok) {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return resp;
    }).catch(() => caches.match(e.request))
  );
});
