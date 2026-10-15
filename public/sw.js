const CACHE_NAME = 'togethr-v1';
const OFFLINE_URL = '/offline.html';

// Assets to cache immediately on install
const PRECACHE_ASSETS = [
  '/',
  '/offline.html',
  '/manifest.json',
  '/icons/togethr-icon-blue.png',
  '/icons/togethr-icon-orange.png',
];

// Install event - cache critical assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip API requests - always go to network
  if (url.pathname.startsWith('/api/')) return;

  // Skip admin routes from caching
  if (url.pathname.startsWith('/admin')) return;

  // For navigation requests, use network-first strategy
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful responses
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Fallback to cache, then offline page
          return caches.match(request).then((cachedResponse) => {
            return cachedResponse || caches.match(OFFLINE_URL);
          });
        })
    );
    return;
  }

  // For static assets, use cache-first strategy
  if (
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js')
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          // Return cache but also update in background
          fetch(request).then((response) => {
            if (response.ok) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, response);
              });
            }
          });
          return cachedResponse;
        }
        // Not in cache, fetch and cache
        return fetch(request).then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // Default: network first
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// Push notification handling
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch (e) {
    data = { body: event.data.text() };
  }

  // Different notification types have different urgency levels
  const isUrgent = data.type === 'sos' || data.type === 'emergency' || data.type === 'geofence' || data.priority === 'high';
  
  const options = {
    body: data.body || 'New notification from Togethr',
    icon: '/icons/togethr-icon-blue.png',
    badge: '/icons/togethr-icon-blue.png',
    vibrate: isUrgent ? [200, 100, 200, 100, 200] : [100, 50, 100],
    data: {
      url: data.url || '/',
      type: data.type,
      ...data,
    },
    actions: data.actions || getDefaultActions(data.type),
    tag: data.tag || `togethr-${data.type || 'notification'}`,
    renotify: true,
    requireInteraction: isUrgent,
    silent: data.silent || false,
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Togethr', options)
  );
});

// Get default actions based on notification type
function getDefaultActions(type) {
  switch (type) {
    case 'emergency':
      return [
        { action: 'ok', title: "I'm OK" },
        { action: 'call', title: 'Call back' }
      ];
    case 'sos':
      return [
        { action: 'view', title: 'View Location' },
        { action: 'call', title: 'Call Now' }
      ];
    case 'geofence':
      return [
        { action: 'view', title: 'View on Map' },
        { action: 'dismiss', title: 'Dismiss' }
      ];
    case 'task':
      return [
        { action: 'view', title: 'View Task' },
        { action: 'complete', title: 'Mark Done' }
      ];
    case 'event':
      return [
        { action: 'view', title: 'View Event' },
        { action: 'dismiss', title: 'Dismiss' }
      ];
    default:
      return [];
  }
}

// Notification click handling
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';

  // "I'm OK" on an emergency alert: tell the parent right away, without
  // opening the app. If the 15-minute access cookie has expired (401), refresh
  // the session from the 7-day refresh cookie and retry once. Falls back to
  // opening the app if anything still fails.
  if (event.action === 'ok' && event.notification.data?.type === 'emergency' && event.notification.data?.alertId) {
    const ack = () => fetch('/api/location/emergency-alert/ack', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alertId: event.notification.data.alertId }),
    });
    const openApp = () => (clients.openWindow ? clients.openWindow(url) : undefined);

    event.waitUntil(
      ack()
        .then(async (res) => {
          if (res.ok) return;
          if (res.status === 401) {
            const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
            if (r.ok) {
              const retry = await ack();
              if (retry.ok) return;
            }
          }
          return openApp();
        })
        .catch(() => openApp())
    );
    return;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if there's already a window open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Open new window
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-events') {
    event.waitUntil(syncPendingEvents());
  }
});

async function syncPendingEvents() {
  // Implementation for syncing offline-created events
  // This would read from IndexedDB and POST to API
  console.log('Background sync triggered');
}
