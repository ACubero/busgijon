/**
 * api.js — Servicio de API EMTUSA Gijón
 * Maneja autenticación OAuth2 y llamadas a endpoints
 *
 * v2: Credentials moved server-side. Routes through backend proxy.
 *     Falls back to direct EMTUSA on 5xx/conn-error (graceful fallback).
 */

import { fixText } from "./ui.js";

const isProd = import.meta.env.PROD;

// Primary: backend proxy (credentials held server-side)
const PROXY_BASE = isProd
  ? "/apps/busgijon/api/emtusa/"
  : "/api/emtusa/"; // Vite dev proxy -> backend at 127.0.0.1:8000

// Fallback: direct EMTUSA (degraded mode when backend is down)
const DIRECT_BASE = "https://emtusasiri.pub.gijon.es/emtusasiri/";

// Fallback credentials (degraded mode safety net — only used if proxy fails)
const FALLBACK_AUTH_BASIC = import.meta.env.VITE_AUTH_BASIC;
const FALLBACK_AUTH_USER = import.meta.env.VITE_AUTH_USER;
const FALLBACK_AUTH_PASS = import.meta.env.VITE_AUTH_PASS;

// Backend base for alert/push endpoints
const BACKEND_BASE = isProd
  ? "/apps/busgijon/api/"
  : "/api/";

let accessToken = null;
let tokenExpiry = 0;

// Track whether proxy is available (avoids repeated fallback attempts)
let proxyAvailable = true;

/**
 * Autenticarse directamente en EMTUSA (solo para fallback)
 */
async function authenticateDirect() {
  if (!FALLBACK_AUTH_BASIC || !FALLBACK_AUTH_USER) {
    throw new Error("No fallback credentials available");
  }
  const params = new URLSearchParams({
    grant_type: "password",
    username: FALLBACK_AUTH_USER,
    password: FALLBACK_AUTH_PASS,
  });
  const url = `${DIRECT_BASE}login?${params.toString()}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: FALLBACK_AUTH_BASIC,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
  const data = await res.json();
  accessToken = data.access_token;
  tokenExpiry =
    Date.now() + (data.expires_in ? (data.expires_in - 60) * 1000 : 3500000);
  return accessToken;
}

/**
 * Obtener headers autenticados para fallback directo
 */
async function getDirectHeaders() {
  if (!accessToken || Date.now() > tokenExpiry) {
    await authenticateDirect();
  }
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
}

/**
 * Petición GET vía proxy (sin credenciales en el cliente)
 */
async function apiGetViaProxy(endpoint) {
  const res = await fetch(`${PROXY_BASE}${endpoint}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const err = new Error(`Proxy error ${res.status}: ${endpoint}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Petición GET directa a EMTUSA (fallback)
 */
async function apiGetDirect(endpoint) {
  const headers = await getDirectHeaders();
  const res = await fetch(`${DIRECT_BASE}${endpoint}`, { headers });
  if (!res.ok) throw new Error(`API error ${res.status}: ${endpoint}`);
  return res.json();
}

/**
 * Petición GET autenticada con fallback graceful
 * Intenta proxy primero; si falla (5xx/conn-error), usa directo EMTUSA
 */
async function apiGet(endpoint) {
  // Try proxy first (primary path — credentials are server-side)
  if (proxyAvailable) {
    try {
      return await apiGetViaProxy(endpoint);
    } catch (e) {
      // Fallback on connection error (TypeError) or 5xx
      if (e instanceof TypeError || (e.status && e.status >= 500)) {
        console.warn("[API] Proxy unavailable, falling back to direct EMTUSA", e.message);
        proxyAvailable = false;
        // Reset proxy availability after 60s to retry
        setTimeout(() => { proxyAvailable = true; }, 60000);
      } else {
        throw e; // Re-throw non-fallback errors (404, etc.)
      }
    }
  }

  // Fallback: direct EMTUSA with embedded credentials
  return await apiGetDirect(endpoint);
}

// ============================================
// Authentication (now just a health-check for the proxy)
// ============================================

/**
 * Check that the backend proxy is reachable.
 * In the new architecture, authentication happens server-side.
 * This function is kept for backward compatibility with main.js init().
 */
export async function authenticate() {
  // In dev mode with Vite proxy, the backend handles auth.
  // Just verify the proxy is up with a lightweight check.
  // If it fails, the fallback in apiGet will handle it.
  try {
    // Quick health check — if proxy is up, auth is handled server-side
    const healthUrl = isProd ? "/apps/busgijon/api/health" : "/api/health";
    await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
  } catch {
    // Proxy not reachable — fallback will kick in on first apiGet
    console.warn("[API] Backend proxy not reachable, using direct EMTUSA fallback");
  }
  return true;
}

// ============================================
// Endpoints públicos (sin cambios para consumidores)
// ============================================

/** Obtener todas las paradas */
export async function getAllStops() {
  return apiGet("paradas/todasParadas");
}

/** Obtener detalle de una parada (incluye tiempos de llegada) */
export async function getStopDetail(stopId) {
  return apiGet(`paradas/parada/${stopId}`);
}

/** Obtener líneas que pasan por una parada */
export async function getStopLines(stopId) {
  return apiGet(`paradas/lineasParada/${stopId}`);
}

/** Obtener trayectos de una parada */
export async function getStopRoutes(stopId) {
  return apiGet(`paradas/trayectosParada/${stopId}`);
}

/** Obtener todas las líneas */
let linesCache = null;
export async function getAllLines() {
  if (linesCache) return linesCache;
  const data = await apiGet("lineas/lineas");
  let list = [];
  if (Array.isArray(data)) {
    list = data;
  } else if (data && data.lineas) {
    if (Array.isArray(data.lineas)) {
      list = data.lineas;
    } else if (typeof data.lineas === "object") {
      list = Object.values(data.lineas);
    }
  }
  linesCache = list;
  return linesCache;
}

/** Obtener detalle de una línea */
export async function getLineDetail(lineId) {
  const data = await apiGet(`lineas/lineas/${lineId}`);
  return data["0"] || data;
}

/** Obtener paradas de un trayecto */
export async function getRouteStops(lineId, routeId) {
  const data = await apiGet(`trayectos/trayectos/${lineId}/${routeId}`);
  return data["0"] || data;
}

/** Obtener coordenadas de buses en tiempo real */
export async function getBusRealTime() {
  return apiGet("autobuses/coordenadas");
}

/** Obtener posición de bus en una línea/trayecto */
export async function getBusPosition(lineId, routeId) {
  return apiGet(`autobuses/posicion/${lineId}/${routeId}`);
}

// ============================================
// Helpers de agrupación (vista Paradas)
// ============================================

/**
 * Obtener las próximas llegadas de una parada agrupadas por (línea + trayecto).
 *
 * Reutiliza `getStopDetail` (mismo endpoint que la vista Llegadas) y agrupa el
 * array crudo `llegadas` por línea + dirección (trayecto). El resultado está
 * pensado para que T5 lo consuma directamente como modelo de render.
 *
 * Forma del array crudo que devuelve la API EMTUSA
 * (verificada contra `extractArrivals` en main.js):
 * ```
 * {
 *   idparada: string,
 *   descripcion: string,         // nombre de la parada
 *   llegadas: [
 *     {
 *       linea:   { codigo, idlinea, descripcion, colorhex },
 *       trayecto:{ destino, descripcion, idtrayecto? },
 *       minutos: number,
 *       distancia: number
 *     },
 *     ...
 *   ]
 * }
 * ```
 *
 * NOTA: el plan original asumía un objeto plano por llegada con campos
 * `line`, `route`, `destination`, `bus`, `minutes`. La forma real es la
 * anidada de arriba; esta función se adapta a la realidad y expone la forma
 * normalizada que la vista Paradas espera (descrita en el JSDoc del return).
 *
 * @param {string|number} stopId Identificador de la parada.
 * @returns {Promise<{
 *   stopId: string,
 *   stopName: string,
 *   fetchedAt: number,
 *   groups: Array<{
 *     line: string,
 *     lineName: string,
 *     route: string|number,
 *     destination: string,
 *     arrivals: Array<{ bus: string|number|null, minutes: number, real: boolean }>
 *   }>
 * }>}
 *  - `bus` es el identificador del vehículo si la API lo proporcionara;
 *    actualmente la API EMTUSA no lo incluye por llegada, así que se deja `null`.
 *  - `real` se mantiene a `true` porque esta fuente es la predicción en vivo.
 *  - `groups` ordenado por línea (numérico ascendente si es posible, si no
 *    lexicográfico) y dentro de cada grupo `arrivals` por `minutes` ascendente.
 *
 * No cachea: el refresco lo gestiona el ciclo global de la UI.
 * Propaga el error si `getStopDetail` lanza (la vista decide cómo mostrarlo).
 */
export async function getStopArrivalsGrouped(stopId) {
  const stopData = await getStopDetail(stopId);

  const stopName = fixText(stopData?.descripcion || "") || "";
  const stopIdOut = String(stopData?.idparada ?? stopId);
  const llegadas = Array.isArray(stopData?.llegadas) ? stopData.llegadas : [];

  // Agrupación por (line + route)
  const groupsMap = new Map();

  for (const item of llegadas) {
    const linea = item.linea || {};
    const trayecto = item.trayecto || {};

    // Identificador de línea: preferimos `codigo` (humano, ej. "L12") y si no,
    // el `idlinea` interno. Lo conservamos tal cual viene para no perder
    // precisión (puede ser string o number).
    const line = linea.codigo ?? linea.idlinea ?? "";

    // Identificador de trayecto/dirección: la API puede exponer `idtrayecto`
    // en algunos casos; si no, sintetizamos un id a partir de su posición
    // dentro de cada línea para mantener grupos estables dentro de la misma
    // petición (la combinación line + destino sigue siendo única por grupo).
    const route =
      trayecto.idtrayecto ??
      trayecto.codigo ??
      groupsMap.size; // fallback defensivo; se reasigna por (line+destino) abajo

    const destination = trayecto.destino || trayecto.descripcion || "";
    const lineName = linea.descripcion || "";

    // Clave compuesta: si no tenemos idtrayecto real, usamos el destino como
    // discriminante del grupo dentro de la misma línea.
    const groupKey = trayecto.idtrayecto != null
      ? `${line}__${trayecto.idtrayecto}`
      : `${line}__${(destination || "").toLowerCase()}`;

    const minutes = typeof item.minutos === "number" ? item.minutos : null;

    if (!groupsMap.has(groupKey)) {
      groupsMap.set(groupKey, {
        line,
        lineName: fixText(lineName),
        route,
        destination: fixText(destination),
        arrivals: [],
      });
    }

    if (minutes == null) {
      // Sin minutos válidos no aportamos a la lista (no podemos mostrar "en N min").
      continue;
    }

    groupsMap.get(groupKey).arrivals.push({
      bus: item.bus ?? item.idbus ?? null,
      minutes,
      real: true,
    });
  }

  // Orden interno de cada grupo por minutos ascendente
  for (const g of groupsMap.values()) {
    g.arrivals.sort((a, b) => a.minutes - b.minutes);
  }

  // Orden externo por línea: numérico ascendente si todas son numéricas;
  // si no, lexicográfico.
  const groups = Array.from(groupsMap.values());
  const allNumeric = groups.every((g) => !isNaN(Number(g.line)) && g.line !== "");
  groups.sort((a, b) => {
    if (allNumeric) return Number(a.line) - Number(b.line);
    return String(a.line).localeCompare(String(b.line), "es");
  });

  return {
    stopId: stopIdOut,
    stopName,
    fetchedAt: Date.now(),
    groups,
  };
}
