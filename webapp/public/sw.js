/**
 * sw.js — Service Worker Bus Gijón
 * Estrategias de caché por tipo de recurso:
 *   - Assets estáticos  → Cache First
 *   - Paradas / líneas  → Stale While Revalidate
 *   - Llegadas (tiempo real) → Network First con fallback
 *   - Auth (login)      → Sin caché
 */

const CACHE_VERSION = 'v4';
const STATIC_CACHE  = `busgijon-static-${CACHE_VERSION}`;
const API_CACHE     = `busgijon-api-${CACHE_VERSION}`;

const API_ORIGIN = 'https://emtusasiri.pub.gijon.es';

function isAuthRequest(url)    { return url.includes('/login'); }
function isStaticAsset(url)    { return /\.(js|css|svg|png|ico|woff2?)(\?.*)?$/.test(url); }
function isStopsOrLines(url)   { return url.includes('todasParadas') || url.includes('lineas/lineas'); }
function isApiRequest(url)     { return url.startsWith(API_ORIGIN) || url.includes('/api/'); }

// ── Instalar: activar de inmediato sin esperar a que las pestañas anteriores cierren
self.addEventListener('install', (e) => {
  e.waitUntil(self.skipWaiting());
});

// ── Activar: limpiar caches de versiones anteriores y tomar control de todos los clientes
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k.startsWith('busgijon-') && k !== STATIC_CACHE && k !== API_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Interceptar peticiones de red
self.addEventListener('fetch', (e) => {
  const { url, method } = e.request;

  // En desarrollo (localhost) no interceptar nada
  if (url.includes('localhost') || url.includes('127.0.0.1')) return;

  // Solo GET; nada de auth
  if (method !== 'GET' || isAuthRequest(url)) return;

  if (isStaticAsset(url)) {
    e.respondWith(cacheFirst(e.request, STATIC_CACHE));
    return;
  }

  if (isStopsOrLines(url)) {
    e.respondWith(staleWhileRevalidate(e.request, API_CACHE));
    return;
  }

  if (isApiRequest(url)) {
    e.respondWith(networkFirst(e.request, API_CACHE));
    return;
  }
});

// ── Cache First: sirve desde caché; si no existe, va a red y guarda
async function cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

// ── Stale While Revalidate: sirve caché inmediatamente y actualiza en background
async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });

  if (cached) {
    fetchPromise.catch(() => {}); // actualización en background; errores ignorados
    return cached;
  }

  return fetchPromise;
}

// ── Network First: intenta red; si falla, sirve caché con cabecera X-From-Cache
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      // Inyectar cabecera para que la app sepa que los datos son del caché
      const headers = new Headers(cached.headers);
      headers.set('X-From-Cache', 'true');
      headers.set('X-Cached-At', cached.headers.get('date') || '');
      return new Response(cached.body, { status: cached.status, headers });
    }
    // Sin red y sin caché: dejar que el error llegue a la app
    throw new Error(`[SW] Sin conexión y sin caché para: ${request.url}`);
  }
}

// ── Push: mostrar notificación al recibir un evento push del backend
// El payload JSON incluye: title, body, tag, data (url a abrir al click)
const NOTIF_ICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23e63946' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='3' y='3' width='18' height='14' rx='2'/><path d='M3 9h18M3 13h18'/><circle cx='8' cy='20' r='1.5'/><circle cx='16' cy='20' r='1.5'/><path d='M8 17v-.5M16 17v-.5'/></svg>";

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    // Si el payload no es JSON válido, usar texto plano como body
    payload = { body: event.data ? event.data.text() : 'Nueva alerta de bus' };
  }

  const title = payload.title || 'Bus Gijón — Alerta';
  const options = {
    body: payload.body || 'Tu bus se acerca a la parada',
    icon: NOTIF_ICON,
    badge: NOTIF_ICON,
    tag: payload.tag || 'busgijon-alert',
    data: payload.data || { url: '/apps/busgijon/' },
    requireInteraction: false,
    renotify: true,
    vibrate: [200, 100, 200],
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ── Notification click: cerrar notificación y abrir/enfocar la app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : '/apps/busgijon/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Si ya hay una pestaña abierta de la app, enfocarla
        for (const client of clientList) {
          if (client.url.includes('/apps/busgijon/') && 'focus' in client) {
            return client.focus();
          }
        }
        // Si no hay pestaña abierta, abrir una nueva
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
