/**
 * sw.js — Service Worker Bus Gijón
 * Estrategias de caché por tipo de recurso:
 *   - Assets estáticos  → Cache First
 *   - Paradas / líneas  → Stale While Revalidate
 *   - Llegadas (tiempo real) → Network First con fallback
 *   - Auth (login)      → Sin caché
 */

const CACHE_VERSION = 'v1';
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
