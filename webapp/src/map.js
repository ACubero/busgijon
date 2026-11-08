/**
 * map.js — Gestión del mapa Leaflet con iconos SVG
 */

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-rotate";

let map = null;
let userMarker = null;
let stopMarkers = [];
let stopMarkersLayer = null;
let busMarkersLayer = null;
let routesLayer = null;
let routesRenderer = null;
const ROUTE_STOP_COLOR = "#ffd400";
const ROUTE_STOP_BORDER = "#111";

// Elimina caracteres fuera del rango latino (corrupción en BD de EMTUSA)
// Mantiene: ASCII imprimible + Latin-1 Supplement + Latin Extended (acentos, ñ, etc.)
function fixText(str) {
  if (!str) return str;
  return str.replace(/[^\x20-\x7E\u00A0-\u024F]/g, "").trim();
}

// ============================================
// SVG Icons
// ============================================

const STOP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 44" width="36" height="44">
  <defs>
    <filter id="ds" x="-20%" y="-10%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.4"/>
    </filter>
  </defs>
  <g filter="url(#ds)">
    <path d="M18 42 C18 42 4 28 4 16 A14 14 0 1 1 32 16 C32 28 18 42 18 42Z" fill="#e63946" stroke="#fff" stroke-width="1.5"/>
    <rect x="11" y="8" width="14" height="18" rx="2" fill="#fff"/>
    <rect x="13" y="10" width="10" height="6" rx="1" fill="#e63946"/>
    <rect x="13" y="18" width="4" height="3" rx="0.5" fill="#94a3b8"/>
    <rect x="19" y="18" width="4" height="3" rx="0.5" fill="#94a3b8"/>
    <circle cx="14.5" cy="24" r="1.3" fill="#334155"/>
    <circle cx="21.5" cy="24" r="1.3" fill="#334155"/>
  </g>
</svg>`;

function createBusSvg(lineCode, color) {
  const textColor = getLuminance(color) > 0.5 ? "#111" : "#fff";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="32" height="32">
    <defs>
      <filter id="bds" x="-20%" y="-10%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#000" flood-opacity="0.5"/>
      </filter>
    </defs>
    <g filter="url(#bds)">
      <circle cx="20" cy="20" r="17" fill="${color}" stroke="#fff" stroke-width="2"/>
      <text x="20" y="21" text-anchor="middle" dominant-baseline="central" font-family="Inter,system-ui,sans-serif" font-size="${lineCode.length > 2 ? "9" : "11"}" font-weight="800" fill="${textColor}">${lineCode}</text>
      <!-- Small bus icon at bottom -->
      <rect x="13" y="29" width="14" height="6" rx="1.5" fill="rgba(255,255,255,0.3)"/>
      <circle cx="16" cy="35" r="1" fill="rgba(255,255,255,0.5)"/>
      <circle cx="24" cy="35" r="1" fill="rgba(255,255,255,0.5)"/>
    </g>
  </svg>`;
}

function getLuminance(hexColor) {
  const hex = hexColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// ============================================
// Map init
// ============================================

let tileLayer = null;

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export function initMap(lat, lng, theme = "dark") {
  document.documentElement.classList.toggle("light-theme", theme === "light");
  map = L.map("map", {
    center: [lat, lng],
    zoom: 16,
    zoomControl: true,
    attributionControl: false,
    rotate: true,
    bearing: 0,
    touchRotate: true,
    shiftKeyRotate: true,
    rotateControl: { closeOnZeroBearing: false, position: "topleft" },
  });

  tileLayer = L.tileLayer(TILE_URL, {
    maxZoom: 19,
    className: "osm-tiles",
  }).addTo(map);

  L.control
    .attribution({ prefix: false, position: "bottomleft" })
    .addAttribution(
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    )
    .addTo(map);

  routesRenderer = L.canvas({ padding: 0.5 });
  routesLayer = L.layerGroup().addTo(map);
  stopMarkersLayer = L.layerGroup().addTo(map);
  busMarkersLayer = L.layerGroup().addTo(map);

  return map;
}

/**
 * Cambiar el tema del mapa (dark / light)
 */
export function setMapTheme(theme) {
  if (!map || !tileLayer) return;
  document.documentElement.classList.toggle("light-theme", theme === "light");
}

// ============================================
// User marker
// ============================================

export function setUserMarker(lat, lng) {
  if (userMarker) {
    userMarker.setLatLng([lat, lng]);
  } else {
    const icon = L.divIcon({
      className: "custom-user-marker",
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    userMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(map);
  }
}

// ============================================
// Stop markers (SVG pin)
// ============================================

export function setStopMarkers(stops, onStopClick) {
  stopMarkersLayer.clearLayers();
  stopMarkers = [];

  stops.forEach((stop) => {
    const lat = parseFloat(stop.latitud);
    const lng = parseFloat(stop.longitud);
    if (isNaN(lat) || isNaN(lng)) return;

    const icon = L.divIcon({
      className: "stop-marker-icon",
      html: STOP_SVG,
      iconSize: [36, 44],
      iconAnchor: [18, 44],
      popupAnchor: [0, -40],
    });

    const marker = L.marker([lat, lng], { icon }).bindPopup(() => {
      const div = document.createElement("div");
      div.className = "popup-content";
      div.innerHTML = `
          <div class="popup-name">${fixText(stop.descripcion)}</div>
          <div class="popup-id">Parada #${stop.idparada}</div>
        `;
      return div;
    });

    marker.on("click", () => {
      onStopClick(stop);
    });

    marker.stop = stop;
    stopMarkers.push(marker);
    stopMarkersLayer.addLayer(marker);
  });
}

// ============================================
// Bus markers (real-time positions)
// ============================================

/**
 * Mostrar posiciones de buses en el mapa
 * @param {Array} buses - [{lat, lng, lineCode, lineColor, lineName}]
 */
export function setBusMarkers(buses) {
  busMarkersLayer.clearLayers();

  buses.forEach((bus) => {
    if (isNaN(bus.lat) || isNaN(bus.lng)) return;

    const color = bus.lineColor || "#3b82f6";
    const code = bus.lineCode || "?";

    const icon = L.divIcon({
      className: "bus-marker-icon",
      html: createBusSvg(code, color),
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -18],
    });

    const marker = L.marker([bus.lat, bus.lng], { icon, zIndexOffset: 500 })
      .bindPopup(`
        <div class="popup-content">
          <div class="popup-header">
            <span class="popup-badge" style="background:${color}">L${code}</span>
          </div>
          <div class="popup-dest">
            <span class="popup-label">Hacia</span>
            <span class="popup-dest-value">${fixText(bus.destination) || "Sin destino"}</span>
          </div>
          ${bus.lineName ? `
          <div class="popup-route">
            <span class="popup-label">Línea</span>
            <span class="popup-route-value">${fixText(bus.lineName)}</span>
          </div>` : ""}
        </div>
      `);

    marker.on("click", () => {
      // Opcional: Centrar o algo al pulsar bus
    });

    busMarkersLayer.addLayer(marker);
  });
}

// ============================================
// Route lines (recorridos)
// ============================================

/**
 * Dibuja los recorridos de las líneas seleccionadas.
 * @param {Array<{code:string,color:string,routes:Array}>} lines
 */
export function setRouteLines(lines) {
  if (!routesLayer) return;
  routesLayer.clearLayers();
  const base = { renderer: routesRenderer, lineJoin: "round", lineCap: "round" };
  const all = lines.flatMap(({ code, color, routes }) =>
    routes.filter((r) => r.coords?.length > 1).map((r) => ({ code, color, r })),
  );
  all.forEach(({ r }) => {
    routesLayer.addLayer(L.polyline(r.coords, { ...base, color: "#fff", weight: 10, opacity: 0.85, interactive: false }));
  });
  all.forEach(({ code, color, r }) => {
    L.polyline(r.coords, {
      ...base,
      color,
      weight: 6,
      opacity: 1,
      dashArray: Number(r.direccion) === 2 ? "12 10" : null,
    })
      .bindTooltip(`L${code} → ${fixText(r.destino) || ""}`, { sticky: true, className: "route-tooltip" })
      .addTo(routesLayer);
  });
  const stops = new Map();
  all.forEach(({ code, color, r }) => {
    const list = r.stops || [];
    list.forEach((st, i) => {
      if (!Number.isFinite(st.lat) || !Number.isFinite(st.lng)) return;
      const key = `${st.id ?? `${st.lat},${st.lng}`}`;
      const entry = stops.get(key) || { st, color, lines: new Set(), terminal: false };
      entry.lines.add(code);
      entry.terminal ||= i === 0 || i === list.length - 1;
      stops.set(key, entry);
    });
  });
  stops.forEach(({ st, lines: codes, terminal }) => {
    L.circleMarker([st.lat, st.lng], {
      renderer: routesRenderer,
      radius: terminal ? 10 : 7,
      color: terminal ? ROUTE_STOP_COLOR : ROUTE_STOP_BORDER,
      weight: terminal ? 4 : 2.5,
      fillColor: terminal ? ROUTE_STOP_BORDER : ROUTE_STOP_COLOR,
      fillOpacity: 1,
    })
      .bindTooltip(
        `<b>${fixText(st.nombre) || "Parada"}</b>${st.id != null ? ` · #${st.id}` : ""}<br>${[...codes].map((c) => `L${c}`).join(" · ")}${terminal ? " · cabecera" : ""}`,
        { className: "route-tooltip", direction: "top", offset: [0, -6] },
      )
      .addTo(routesLayer);
  });
}

/** Botón flotante «Líneas» en el mapa. Devuelve el elemento para actualizar el contador. */
export function addRoutesControl(onClick) {
  if (!map) return null;
  let btn = null;
  const Ctrl = L.Control.extend({
    onAdd() {
      btn = L.DomUtil.create("button", "routes-ctrl-btn");
      btn.type = "button";
      btn.setAttribute("aria-label", "Elegir recorridos de líneas");
      btn.textContent = "Líneas";
      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.on(btn, "click", (e) => {
        L.DomEvent.stop(e);
        onClick();
      });
      return btn;
    },
  });
  new Ctrl({ position: "topright" }).addTo(map);
  return btn;
}

// ============================================
// Navigation
// ============================================

export function invalidateMapSize() {
  if (map) map.invalidateSize();
}

export function flyTo(lat, lng, zoom = 16) {
  if (!map) return;
  map.flyTo([lat, lng], zoom, { duration: 1 });
}

export function highlightStop(stopId) {
  const marker = stopMarkers.find((m) => m.stop.idparada === stopId);
  if (marker) {
    const lat = parseFloat(marker.stop.latitud);
    const lng = parseFloat(marker.stop.longitud);
    flyTo(lat, lng, 17);
    marker.openPopup();
  }
}

export function getMap() {
  return map;
}
