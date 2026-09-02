/**
 * geo.js — Utilidades de geolocalización
 */

// Coordenadas centro de Gijón (fallback)
const GIJON_CENTER = { lat: 43.5322, lng: -5.6611 };

/**
 * Obtener la posición actual del usuario.
 *
 * Por defecto usa `maximumAge: 60000` (1 min de caché del navegador) para
 * evitar lecturas GPS innecesarias en llamadas frecuentes. Pasar `force: true`
 * para saltarse esa caché y forzar una lectura nueva — útil cuando la app
 * vuelve a primer plano y el usuario puede haberse movido.
 *
 * @param {object} [options]
 * @param {boolean} [options.force=false] - Si true, ignora la caché del
 *   navegador (`maximumAge: 0`) y fuerza una nueva lectura GPS.
 * @param {number} [options.timeout=8000] - Timeout (ms) para la lectura.
 * @returns {Promise<{lat: number, lng: number}>}
 */
export function getUserLocation(options = {}) {
  const { force = false, timeout = 8000 } = options;
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      console.warn("Geolocalización no soportada, usando centro de Gijón");
      resolve(GIJON_CENTER);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      (err) => {
        console.warn(
          "Error de geolocalización:",
          err.message,
          "→ usando centro de Gijón",
        );
        resolve(GIJON_CENTER);
      },
      {
        enableHighAccuracy: true,
        timeout,
        maximumAge: force ? 0 : 60000,
      },
    );
  });
}

/**
 * Vigila la posición del usuario continuamente y llama a `onUpdate(coords)`
 * cada vez que cambia (con throttling por distancia para no spamear).
 *
 * @param {(coords: {lat:number, lng:number}) => void} onUpdate
 * @param {object} [options]
 * @param {number} [options.minDistanceM=20] - Distancia mínima (m) entre
 *   updates para considerar que el usuario se "ha movido". Evita spam de
 *   actualizaciones GPS con variaciones de < 20m.
 * @param {number} [options.maxAge=60000] - Máxima edad (ms) de una lectura
 *   cacheada que el navegador puede devolver. Compromiso entre batería y
 *   precisión.
 * @returns {() => void} Función para detener el watch (cleanup).
 *
 * Comportamiento:
 * - Si navigator.geolocation no está disponible → no hace nada, devuelve noop
 * - Si el watch falla o el usuario revoca el permiso → console.warn, no rompe
 * - No llama a onUpdate si la nueva posición está a < minDistanceM de la última
 * - La primera llamada a onUpdate es inmediata (con la primera lectura válida)
 */
export function watchUserLocation(onUpdate, options = {}) {
  const { minDistanceM = 20, maxAge = 60000 } = options;
  if (!navigator.geolocation) {
    console.warn("[geo] watchUserLocation: geolocalización no soportada");
    return () => {};
  }
  let lastCoords = null;
  let stopped = false;
  const id = navigator.geolocation.watchPosition(
    (pos) => {
      if (stopped) return;
      const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (lastCoords) {
        const d = getDistance(lastCoords.lat, lastCoords.lng, coords.lat, coords.lng);
        if (d < minDistanceM) return; // No se ha movido lo suficiente
      }
      lastCoords = coords;
      try {
        onUpdate(coords);
      } catch (e) {
        console.warn("[geo] Error en onUpdate:", e);
      }
    },
    (err) => {
      console.warn("[geo] watchUserLocation error:", err.message);
    },
    { enableHighAccuracy: true, maximumAge: maxAge, timeout: 15000 },
  );
  return () => {
    stopped = true;
    if (id != null) navigator.geolocation.clearWatch(id);
  };
}

/**
 * Calcular distancia entre dos puntos (Haversine) en metros
 */
export function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Radio de la Tierra en metros
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Formatear distancia para mostrar
 */
export function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Ordenar paradas por cercanía al usuario y devolver las N más cercanas
 */
export function getNearbyStops(
  stops,
  userLat,
  userLng,
  maxCount = 20,
  maxRadius = 2000,
) {
  return stops
    .map((stop) => ({
      ...stop,
      distance: getDistance(
        userLat,
        userLng,
        parseFloat(stop.latitud),
        parseFloat(stop.longitud),
      ),
    }))
    .filter((stop) => stop.distance <= maxRadius)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxCount);
}

export { GIJON_CENTER };
