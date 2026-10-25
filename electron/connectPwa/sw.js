/* Service worker cache version is substituted when served (see connectPwaServer). */
const CACHE_VERSION = '__PWA_CACHE_VERSION__';
const CACHE = `schwalbe-toolkit-connect-${CACHE_VERSION}`;
const ASSET_PATHS = [
  '/hub.css',
  '/connectPwaMobile.js',
  '/pwaInstallUi.js',
  '/install.js',
  '/manifest.webmanifest',
  '/brand-logo.png',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png'
];

function isHtmlRequest(request) {
  if (request.mode === 'navigate') return true;
  const path = new URL(request.url).pathname;
  return path === '/' || path === '/install' || path.endsWith('.html');
}

async function networkFirstHtml(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error('Offline and hub page is not cached.');
  }
}

async function cacheFirstAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  const path = new URL(request.url).pathname;
  if (response.ok && ASSET_PATHS.includes(path)) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSET_PATHS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then(clients => {
        for (const client of clients) {
          client.postMessage({ type: 'SW_UPDATED' });
        }
      })
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('push', event => {
  let payload = { title: 'Schwalbe ToolKit', body: 'Picker watering update', url: '/' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch { /* use defaults */ }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Schwalbe ToolKit', {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: payload.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;
  if (isHtmlRequest(event.request)) {
    event.respondWith(networkFirstHtml(event.request));
    return;
  }
  event.respondWith(cacheFirstAsset(event.request));
});
