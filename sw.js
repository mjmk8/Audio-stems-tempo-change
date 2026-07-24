const CACHE_NAME = 'cinta-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event)=>{
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES)).then(()=> self.skipWaiting())
  );
});

self.addEventListener('activate', (event)=>{
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(()=> self.clients.claim())
  );
});

self.addEventListener('fetch', (event)=>{
  // solo cachear peticiones GET del mismo origen (el audio nunca sale del navegador)
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached=>{
      if (cached) return cached;
      return fetch(event.request).then(resp=>{
        if (resp.ok && event.request.url.startsWith(self.location.origin)){
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return resp;
      }).catch(()=> cached);
    })
  );
});
