/**
 * geo.js — Utilidades de geolocalización
 */

// Coordenadas centro de Gijón (fallback)
const GIJON_CENTER = { lat: 43.5322, lng: -5.6611 };

/**
 * Obtener la posición actual del usuario
 * @returns {Promise<{lat: number, lng: number}>}
 */
export function getUserLocation() {
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
        timeout: 8000,
        maximumAge: 60000,
      },
    );
  });
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
