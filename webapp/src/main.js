/**
 * main.js — Bus Gijón v3
 * Lista unificada + buses en mapa + buscador
 */

import "./style.css";
import { buildContext, askAI, getAIConfig, saveAIConfig, startVoiceRecognition } from "./ai.js";
import {
  authenticate,
  getAllStops,
  getStopDetail,
  getAllLines,
  getBusRealTime,
  getStopLines,
  getLineDetail,
  getRouteStops,
} from "./api.js";

import { getUserLocation, getNearbyStops } from "./geo.js";
import {
  initMap,
  setUserMarker,
  setStopMarkers,
  setBusMarkers,
  setMapTheme,
  invalidateMapSize,
  flyTo,
} from "./map.js";
import {
  renderArrivals,
  showLoading,
  updateRefreshBadge,
  showFilterChip,
  clearFilterChip,
  renderTransferResults,
  renderTransferDashboard,
} from "./ui.js";

// ============================================
// Estado
// ============================================

const state = {
  allStops: [],
  nearbyStops: [],
  linesMap: {}, // Cache de info de líneas
  userLocation: null,
  allArrivals: [],
  refreshCountdown: null,
  refreshSeconds: parseInt(localStorage.getItem("bus_refresh_interval") || "30"),
  refreshPaused: false,
  isLoading: false,
  sortMode: "time-asc",
  radiusMeters: parseInt(localStorage.getItem("bus_radius") || "1000"),
  searchQuery: "",
  stopFilter: null,
  mapTheme: localStorage.getItem("bus_map_theme") || "dark",

  // Favoritos
  favorites: new Set(JSON.parse(localStorage.getItem("bus_favorites") || "[]")),
  showFavoritesOnly: false,

  // Recorridos de líneas (cargados en background para contexto IA)
  linesDetailMap: {},

  // Transbordo
  transferMode: false,
  transferConfig: JSON.parse(
    localStorage.getItem("bus_transfer_config") || "null",
  ),
  transferArrivals1: [],
  transferArrivals2: [],
  allLines: [],
};

const MAX_STOPS = 25;
const CONCURRENCY = 3;

// ============================================
// Init
// ============================================

async function init() {
  const splashStatus = document.getElementById("splash-status");

  try {
    splashStatus.textContent = "Conectando con EMTUSA...";
    await authenticate();

    splashStatus.textContent = "Obteniendo tu ubicación...";
    state.userLocation = await getUserLocation();

    splashStatus.textContent = "Cargando mapa...";
    initMap(state.userLocation.lat, state.userLocation.lng, state.mapTheme);
    setUserMarker(state.userLocation.lat, state.userLocation.lng);

    splashStatus.textContent = "Cargando paradas y líneas...";
    const [stops, linesFn] = await Promise.all([getAllStops(), getAllLines()]);
    state.allStops = stops;
    state.allLines = linesFn;
    console.log(
      `Init: Loaded ${state.allStops.length} stops and ${state.allLines.length} lines.`,
    );
    processLines(linesFn);

    state.nearbyStops = getNearbyStops(
      state.allStops,
      state.userLocation.lat,
      state.userLocation.lng,
      MAX_STOPS,
      state.radiusMeters,
    );

    setStopMarkers(state.nearbyStops, handleStopClick);

    hideSplash();
    setupEvents();

    await loadAllArrivals();
    loadBusPositions();    // Non-blocking, best-effort
    loadLinesDetail();     // Non-blocking, para contexto IA

    startAutoRefresh();

    // Aplicar tamaño de letra guardado
    const savedFontSize = localStorage.getItem("bus_font_size") || "18";
    document.documentElement.style.setProperty(
      "--base-font-size",
      savedFontSize + "px",
    );
  } catch (err) {
    console.error("Error inicializando:", err);
    splashStatus.textContent = "Error al conectar. Recarga la página.";
    document.querySelector(".splash-spinner").style.display = "none";
  }
}

// ============================================
// Cargar tiempos
// ============================================

async function loadAllArrivals() {
  if (state.isLoading) return;

  // Si estamos en modo Transfer, cargar vista especial
  if (state.transferMode && state.transferConfig) {
    return loadTransferArrivals();
  }

  state.isLoading = true;

  const stops = state.nearbyStops;
  if (stops.length === 0) {
    if (state.stopFilter) {
      // Si hay filtro pero no nearby (ej: clic en mapa lejano), deberíamos cargar esa parada
      // Pero handleStopClick ya hace cosas. Por ahora dejamos así.
    }
    renderArrivals([], null);
    state.isLoading = false;
    return;
  }

  showLoading(0, stops.length);

  const allArrivals = [];
  let loaded = 0;

  for (let i = 0; i < stops.length; i += CONCURRENCY) {
    const batch = stops.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((stop) => getStopDetail(stop.idparada)),
    );

    results.forEach((result, j) => {
      const stop = batch[j];
      if (result.status === "fulfilled" && result.value) {
        allArrivals.push(...extractArrivals(result.value, stop));
      }
    });

    loaded += batch.length;
    showLoading(loaded, stops.length);
  }

  state.allArrivals = allArrivals;
  sortAndRender();
  state.isLoading = false;
}

// ============================================
// Datos
// ============================================

function processLines(linesData) {
  // linesData ya es un array gracias a api.js
  const list = linesData;

  list.forEach((l) => {
    const code = l.codigo || l.idlinea;
    state.linesMap[code] = {
      name: l.descripcion,
      color: l.colorhex ? `#${l.colorhex}` : null,
      id: l.idlinea,
    };
  });
}

function extractArrivals(stopData, stopInfo) {
  const arrivals = [];
  const llegadas = stopData.llegadas || [];
  const stopName = stopInfo.descripcion || stopData.descripcion || "";
  const stopId = stopInfo.idparada || stopData.idparada || "";

  llegadas.forEach((item) => {
    const linea = item.linea || {};
    const trayecto = item.trayecto || {};

    arrivals.push({
      lineId: linea.codigo || linea.idlinea || "",
      lineName: linea.descripcion || "",
      lineColor: linea.colorhex ? `#${linea.colorhex}` : null,
      direction: trayecto.destino || trayecto.descripcion || "",
      stopName,
      stopId,
      stopLat: parseFloat(stopInfo.latitud),
      stopLng: parseFloat(stopInfo.longitud),
      minutes: item.minutos ?? null,
      distance: item.distancia ?? null, // Distancia bus -> parada
      userDistance: stopInfo.distance, // Distancia usuario -> parada
      busAtStop: item.minutos === 0,
    });
  });

  return arrivals;
}

// ============================================
// Cargar posiciones de buses en tiempo real
// ============================================

async function loadBusPositions() {
  try {
    const data = await getBusRealTime();

    // Unificar respuesta
    const rawList = Array.isArray(data) ? data : data.autobuses || [];

    // Si viene vacio o null
    if (!rawList || rawList.length === 0) return;

    const buses = rawList
      .filter((b) => b.latitud && b.longitud)
      .map((b) => {
        // Intentar obtener código de línea
        const code = b.linea?.codigo || b.codigo || b.idlinea || "?";

        // Buscar metadatos en cache
        const meta = state.linesMap[code] || {};

        let color = "#3b82f6";
        if (b.linea?.colorhex) color = `#${b.linea.colorhex}`;
        else if (b.colorhex) color = `#${b.colorhex}`;
        else if (meta.color) color = meta.color;

        // Nombre de Línea: Prioridad API > Cache > Fallback
        let name = b.linea?.descripcion || b.descripcion || meta.name;
        if (!name && code !== "?") name = `Línea ${code}`;

        // Destino: Buscar en trayecto o propiedades directas
        let dest =
          b.trayecto?.destino ||
          b.trayecto?.descripcion ||
          b.destino ||
          b.direccion;
        if (!dest) dest = "Sin destino";

        return {
          lat: parseFloat(b.latitud),
          lng: parseFloat(b.longitud),
          lineCode: code,
          lineColor: color,
          lineName: name || "",
          destination: dest,
        };
      });

    if (buses.length > 0) {
      setBusMarkers(buses);
    }
  } catch (err) {
    console.warn("No se pudieron cargar posiciones de buses:", err.message);
  }
}

// ============================================
// Cargar recorridos de líneas (para contexto IA)
// ============================================

async function loadLinesDetail() {
  const codes = [...new Set(state.allArrivals.map(a => a.lineId))];
  for (const code of codes) {
    if (state.linesDetailMap[code]) continue;
    const meta = state.linesMap[code];
    if (!meta?.id) continue;
    try {
      const detail = await getLineDetail(meta.id);
      const trayectos = await Promise.allSettled(
        (detail.trayectos || []).map(async t => {
          let paradas = [];
          try {
            const raw = await getRouteStops(meta.id, t.idtrayecto);
            const arr = Array.isArray(raw) ? raw : (raw.paradas || []);
            paradas = arr.map(s => s.descripcion).filter(Boolean);
          } catch {}
          return { destino: t.destino || t.descripcion || '', paradas };
        })
      );
      state.linesDetailMap[code] = {
        trayectos: trayectos
          .filter(r => r.status === 'fulfilled')
          .map(r => r.value),
      };
    } catch {}
  }
}

// ============================================
// Auto-refresco
// ============================================

function startAutoRefresh() {
  stopAutoRefresh();
  if (state.refreshPaused) return;
  let seconds = state.refreshSeconds;
  updateRefreshBadge(seconds, false);

  state.refreshCountdown = setInterval(() => {
    seconds--;
    updateRefreshBadge(seconds, false);
    if (seconds <= 0) {
      seconds = state.refreshSeconds;
      loadAllArrivals();
      loadBusPositions();
    }
  }, 1000);
}

function stopAutoRefresh() {
  if (state.refreshCountdown) {
    clearInterval(state.refreshCountdown);
    state.refreshCountdown = null;
  }
}

function handleTimerToggle() {
  state.refreshPaused = !state.refreshPaused;
  if (state.refreshPaused) {
    stopAutoRefresh();
    updateRefreshBadge(state.refreshSeconds, true);
  } else {
    startAutoRefresh();
  }
}

// ============================================
// Handlers
// ============================================

function handleStopClick(stop) {
  flyTo(parseFloat(stop.latitud), parseFloat(stop.longitud), 17);
  state.stopFilter = { stopId: stop.idparada, stopName: stop.descripcion };
  showFilterChip(stop.descripcion, stop.idparada, clearStopFilter);
  sortAndRender();
  switchToView("list");
}

function clearStopFilter() {
  state.stopFilter = null;
  clearFilterChip();
  sortAndRender();
}

function switchToView(view) {
  const app = document.getElementById("app");
  app.dataset.view = view;
  if (view === "map") invalidateMapSize();
  document.querySelectorAll(".nav-btn[data-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  // Cerrar overlay IA si la vista no lo permite
  if (view !== "list" && view !== "map") {
    document.getElementById("ai-overlay")?.classList.add("hidden");
    document.getElementById("btn-ai-fab")?.classList.remove("ai-fab--open");
  }
}

function handleRowClick(arrival) {
  if (arrival.stopLat && arrival.stopLng) {
    switchToView("map");
    flyTo(arrival.stopLat, arrival.stopLng, 17);
  }
}

function handleLocate() {
  if (state.userLocation) {
    switchToView("map");
    flyTo(state.userLocation.lat, state.userLocation.lng, 15);
  }
}

async function handleRefresh() {
  const btn = document.getElementById("btn-refresh");
  btn.classList.add("spinning");
  stopAutoRefresh();
  await loadAllArrivals();
  loadBusPositions();
  startAutoRefresh();
  btn.classList.remove("spinning");
}

// ============================================
// Búsqueda / filtro
// ============================================

function handleSearch(e) {
  state.searchQuery = e.target.value.trim().toLowerCase();
  sortAndRender();
}

function toggleFavorite(stopId) {
  const id = stopId.toString();
  if (state.favorites.has(id)) {
    state.favorites.delete(id);
  } else {
    state.favorites.add(id);
  }
  localStorage.setItem("bus_favorites", JSON.stringify([...state.favorites]));
  sortAndRender();
}

function getFilteredArrivals() {
  let results = [...state.allArrivals];

  // Filtro por favoritos
  if (state.showFavoritesOnly) {
    results = results.filter((a) => state.favorites.has(a.stopId.toString()));
  }

  // Filtro por parada (clic en mapa)
  if (state.stopFilter) {
    results = results.filter(
      (a) => a.stopId.toString() === state.stopFilter.stopId.toString(),
    );
  }

  // Filtro por texto (buscador)
  if (state.searchQuery) {
    const q = state.searchQuery;
    results = results.filter((a) => {
      return (
        a.lineId.toString().toLowerCase().includes(q) ||
        a.stopName.toLowerCase().includes(q) ||
        a.direction.toLowerCase().includes(q) ||
        a.stopId.toString().includes(q)
      );
    });
  }

  return results;
}

// ============================================
// Ordenar y renderizar
// ============================================

function sortAndRender() {
  const sorted = getFilteredArrivals();

  switch (state.sortMode) {
    case "time-asc":
      sorted.sort((a, b) => {
        const ma = a.busAtStop ? -1 : (a.minutes ?? 999);
        const mb = b.busAtStop ? -1 : (b.minutes ?? 999);
        return ma - mb;
      });
      break;
    case "time-desc":
      sorted.sort((a, b) => {
        const ma = a.busAtStop ? -1 : (a.minutes ?? 999);
        const mb = b.busAtStop ? -1 : (b.minutes ?? 999);
        return mb - ma;
      });
      break;
    case "dist-asc":
      sorted.sort((a, b) => (a.distance ?? 999999) - (b.distance ?? 999999));
      break;
    case "dist-desc":
      sorted.sort((a, b) => (b.distance ?? 0) - (a.distance ?? 0));
      break;
  }

  renderArrivals(sorted, handleRowClick, {
    favorites: state.favorites,
    onToggleFav: toggleFavorite,
  });
}

// ============================================
// Vista: lista / mapa
// ============================================

function setupViewToggle() {
  document.querySelectorAll(".nav-btn[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => switchToView(btn.dataset.view));
  });
  switchToView("list");
}

// ============================================
// Events
// ============================================

function setupEvents() {
  document.getElementById("btn-locate").addEventListener("click", handleLocate);
  document.getElementById("btn-refresh").addEventListener("click", handleRefresh);
  document.getElementById("refresh-timer").addEventListener("click", handleTimerToggle);

  // Ordenación (2 botones toggle: tiempo / distancia)
  function updateSortToggles() {
    document.querySelectorAll(".sort-toggle").forEach((b) => {
      const base = b.dataset.sortBase;
      const isActive = state.sortMode.startsWith(base);
      b.classList.toggle("active", isActive);
      const dir = b.querySelector(".sort-dir");
      if (dir) dir.textContent = state.sortMode === `${base}-desc` ? "↓" : "↑";
    });
  }

  document.querySelectorAll(".sort-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const base = btn.dataset.sortBase;
      state.sortMode = state.sortMode === `${base}-asc` ? `${base}-desc` : `${base}-asc`;
      updateSortToggles();
      sortAndRender();
    });
  });

  updateSortToggles();

  // Buscador
  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.addEventListener("input", handleSearch);
    // Limpiar
    document.getElementById("search-clear")?.addEventListener("click", () => {
      searchInput.value = "";
      state.searchQuery = "";
      sortAndRender();
      searchInput.focus();
    });
  }

  // Filtro favoritos
  const btnFavFilter = document.getElementById("btn-fav-filter");
  if (btnFavFilter) {
    btnFavFilter.addEventListener("click", () => {
      state.showFavoritesOnly = !state.showFavoritesOnly;
      btnFavFilter.classList.toggle("active", state.showFavoritesOnly);
      sortAndRender();
    });
  }

  setupViewToggle();
  setupSettings();
  setupTransferUI();
  setupScheduleUI();
  setupAIUI();

  window.addEventListener("resize", () => {
    invalidateMapSize();
  });

  // Banner offline / online
  window.addEventListener("offline", () => showOfflineBanner(true));
  window.addEventListener("online",  () => {
    showOfflineBanner(false);
    handleRefresh();
  });
  if (!navigator.onLine) showOfflineBanner(true);
}

function showOfflineBanner(show) {
  let banner = document.getElementById("offline-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "offline-banner";
    banner.textContent = "Sin conexión — mostrando datos en caché";
    document.body.appendChild(banner);
  }
  banner.classList.toggle("visible", show);
}

// ============================================
// Splash
// ============================================

function hideSplash() {
  const splash = document.getElementById("splash");
  const app = document.getElementById("app");
  splash.style.transition = "opacity 0.5s";
  splash.style.opacity = "0";
  app.classList.remove("hidden");
  setTimeout(() => {
    splash.style.display = "none";
    invalidateMapSize();
  }, 500);
}

// ============================================
// Configuración
// ============================================

function setupSettings() {
  const settingsPage = document.getElementById("settings-page");
  const range = document.getElementById("range-radius");
  const valueLabel = document.getElementById("range-value");

  // Intervalo de refresco
  const refreshSelect = document.getElementById("refresh-interval");
  if (refreshSelect) {
    refreshSelect.value = String(state.refreshSeconds);
    refreshSelect.addEventListener("change", () => {
      const secs = parseInt(refreshSelect.value);
      state.refreshSeconds = secs;
      localStorage.setItem("bus_refresh_interval", String(secs));
      if (!state.refreshPaused) startAutoRefresh();
    });
  }

  // Inputs test location
  const testLat = document.getElementById("test-lat");
  const testLng = document.getElementById("test-lng");
  const btnTestLoc = document.getElementById("btn-test-loc");

  // Rellenar con ubicación actual
  if (state.userLocation) {
    testLat.value = state.userLocation.lat.toFixed(6);
    testLng.value = state.userLocation.lng.toFixed(6);
  }

  // Btn ubicación test rápida (ej: Plaza Mayor)
  btnTestLoc.addEventListener("click", () => {
    testLat.value = "43.5452";
    testLng.value = "-5.6627";
  });

  range.value = state.radiusMeters;
  updateRangeLabel(state.radiusMeters, valueLabel);

  range.addEventListener("input", () => {
    updateRangeLabel(parseInt(range.value), valueLabel);
  });

  // Toggle tema mapa
  const themeBtns = settingsPage.querySelectorAll(".settings-toggle-btn[data-theme]");
  themeBtns.forEach((btn) => {
    if (btn.dataset.theme === state.mapTheme) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
    btn.addEventListener("click", () => {
      themeBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  // Font size slider
  const fontSizeRange = document.getElementById("range-font-size");
  const fontSizeValue = document.getElementById("font-size-value");
  const currentFontSize = localStorage.getItem("bus_font_size") || "18";
  fontSizeRange.value = currentFontSize;
  fontSizeValue.textContent = currentFontSize + "px";

  fontSizeRange.addEventListener("input", () => {
    fontSizeValue.textContent = fontSizeRange.value + "px";
  });

  document
    .getElementById("btn-apply-settings")
    .addEventListener("click", () => {
      const newRadius = parseInt(range.value);
      state.radiusMeters = newRadius;
      localStorage.setItem("bus_radius", String(newRadius));

      const newFontSize = fontSizeRange.value;
      localStorage.setItem("bus_font_size", newFontSize);
      document.documentElement.style.setProperty(
        "--base-font-size",
        newFontSize + "px",
      );

      // Test location override
      const tLat = parseFloat(document.getElementById("test-lat").value);
      const tLng = parseFloat(document.getElementById("test-lng").value);
      if (
        !isNaN(tLat) &&
        !isNaN(tLng) &&
        (tLat !== state.userLocation?.lat || tLng !== state.userLocation?.lng)
      ) {
        state.userLocation = { lat: tLat, lng: tLng };
        setUserMarker(tLat, tLng);
      }

      // Tema
      const activeTheme = settingsPage.querySelector(
        ".settings-toggle-btn[data-theme].active",
      );
      if (activeTheme) {
        state.mapTheme = activeTheme.dataset.theme;
        localStorage.setItem("bus_map_theme", state.mapTheme);
        setMapTheme(state.mapTheme);
      }

      switchToView("list");
      reloadWithNewRadius();
    });
}

function updateRangeLabel(meters, label) {
  label.textContent =
    meters >= 1000
      ? `${(meters / 1000).toFixed(2).replace(/\.?0+$/, "")} km`
      : `${meters} m`;
}

async function reloadWithNewRadius() {
  stopAutoRefresh();

  state.nearbyStops = getNearbyStops(
    state.allStops,
    state.userLocation.lat,
    state.userLocation.lng,
    MAX_STOPS,
    state.radiusMeters,
  );

  setStopMarkers(state.nearbyStops, handleStopClick);
  await loadAllArrivals();
  loadBusPositions();
  startAutoRefresh();
}

// ============================================
// IA — Renderizado de respuesta
// ============================================

function _contrastColor(hex) {
  if (!hex || hex.length < 7) return '#fff';
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return (r*299 + g*587 + b*114) / 1000 > 145 ? '#111' : '#fff';
}

function renderAIResponse(text) {
  // 1. Escapar HTML
  let s = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // 2. Bloques por párrafo (doble salto de línea)
  const blocks = s.split(/\n{2,}/);
  let html = blocks.map(block => {
    const lines = block.split('\n').filter(l => l.trim());
    if (!lines.length) return '';

    // Lista con guión/asterisco
    if (lines.every(l => /^[\*\-]\s/.test(l))) {
      const items = lines.map(l => `<li>${l.replace(/^[\*\-]\s+/,'')}</li>`).join('');
      return `<ul>${items}</ul>`;
    }
    // Lista numerada
    if (lines.every(l => /^\d+[.)]\s/.test(l))) {
      const items = lines.map(l => `<li>${l.replace(/^\d+[.)]\s+/,'')}</li>`).join('');
      return `<ol>${items}</ol>`;
    }
    // Cabecera
    if (lines.length === 1 && /^#{1,3}\s/.test(lines[0])) {
      return `<strong>${lines[0].replace(/^#+\s*/,'')}</strong>`;
    }
    // Párrafo normal (saltos simples → <br>)
    return `<p>${lines.join('<br>')}</p>`;
  }).join('');

  // 3. Inline: negrita, cursiva
  html = html
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>')
    .replace(/\*([^*\n]+?)\*/g,    '<em>$1</em>');

  // 4. Colorizar referencias a líneas
  function _badge(code) {
    const meta = state.linesMap[code];
    if (!meta?.color) return null;
    const fg = _contrastColor(meta.color);
    return `<span class="ai-line-badge" style="background:${meta.color};color:${fg}">${code}</span>`;
  }
  // "Línea/línea X" (con o sin tilde)
  html = html.replace(/([Ll][íi]nea\s+)(\w+)/g, (m, pre, code) => {
    const b = _badge(code); return b ? pre + b : m;
  });
  // Números en paréntesis: "(12, 2, 20)"
  html = html.replace(/\((\d+(?:[,\s]+\d+)+)\)/g, (m, nums) => {
    const colored = nums.replace(/\b(\d+)\b/g, (n, code) => _badge(code) || n);
    return colored !== nums ? `(${colored})` : m;
  });
  // "L2", "L12" suelto (no precedido de letra)
  html = html.replace(/(?<![a-zA-Záéíóúñ])L(\d+[A-Za-z]?)\b/g, (m, code) => {
    const b = _badge(code); return b ? 'L' + b : m;
  });

  return html;
}

// ============================================
// IA — FAB + Chat Overlay
// ============================================

function setupAIUI() {
  const fab      = document.getElementById('btn-ai-fab');
  const overlay  = document.getElementById('ai-overlay');
  const closeBtn = document.getElementById('btn-ai-close');
  const input    = document.getElementById('ai-input');
  const sendBtn  = document.getElementById('btn-ai-send');
  const micBtn   = document.getElementById('btn-ai-mic');
  const chatArea = document.getElementById('ai-chat');

  let longPressTimer = null;
  let chatHistory = []; // [{role:'user'|'assistant', content: string}]
  let wizardMode = null; // { type: 'horarios'|'transbordos', step: number, data: {} }

  function openOverlay() {
    overlay.classList.remove('hidden');
    fab.classList.add('ai-fab--open');
    input.focus();
    chatArea.scrollTop = chatArea.scrollHeight;
  }

  function closeOverlay() {
    overlay.classList.add('hidden');
    fab.classList.remove('ai-fab--open');
    wizardMode = null;
  }

  closeBtn.addEventListener('click', closeOverlay);

  // Limpiar historial
  document.getElementById('btn-ai-clear').addEventListener('click', () => {
    chatHistory = [];
    wizardMode = null;
    chatArea.innerHTML = '<div class="ai-message assistant">Hola. Pregúntame sobre líneas, paradas o llegadas cerca de ti.</div>';
  });

  // FAB: tap corto = voz, pulsación larga = chat
  fab.addEventListener('touchstart', (e) => {
    e.preventDefault();
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      openOverlay();
    }, 400);
  }, { passive: false });

  fab.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      startVoice();
    }
  }, { passive: false });

  fab.addEventListener('touchcancel', () => {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  });

  fab.addEventListener('click', openOverlay);

  // ── Mensajes ──

  function addMessage(text, role) {
    const el = document.createElement('div');
    el.className = `ai-message ${role}`;
    if (role === 'assistant' || role === 'loading') {
      el.innerHTML = renderAIResponse(text);
    } else {
      el.textContent = text;
    }
    chatArea.appendChild(el);
    chatArea.scrollTop = chatArea.scrollHeight;
    return el;
  }

  async function sendQuestion(question) {
    if (!question.trim()) return;
    openOverlay();
    addMessage(question, 'user');
    input.value = '';
    const loadEl = addMessage('Pensando...', 'loading');
    try {
      const answer = await askAI(question, buildContext(state), getAIConfig(), chatHistory);
      loadEl.remove();
      addMessage(answer, 'assistant');
      chatHistory.push({ role: 'user', content: question });
      chatHistory.push({ role: 'assistant', content: answer });
    } catch (err) {
      loadEl.remove();
      addMessage('Error: ' + err.message, 'assistant');
    }
  }

  // ── Wizard interactivo ──

  function processWizardStep(text) {
    if (!wizardMode) return;
    const { type, step, data } = wizardMode;

    if (type === 'horarios') {
      if (step === 0) {
        // Extraer código de línea: "2", "línea 2", "L2", "la 12"
        const m = text.match(/(?:[Ll]i?n[eé]a\s+|[Ll])(\w+)/) || text.match(/\b(\d+[A-Za-z]?)\b/);
        const code = m ? m[1] : text.trim();
        data.linea = code;

        const detail = state.linesDetailMap[code];
        if (detail?.trayectos?.length) {
          data.trayectos = detail.trayectos;
          wizardMode.step = 1;
          const opts = detail.trayectos.map((t, i) => `**${i + 1}.** ${t.destino}`).join('\n');
          addMessage(`Línea ${code} — sentidos disponibles:\n\n${opts}\n\n¿Cuál te interesa? (escribe el número o "todos")`, 'assistant');
        } else {
          // Datos no cargados aún, preguntar texto libre
          wizardMode.step = 1;
          addMessage(`¿En qué dirección o sentido de la línea ${code}? (o escribe **"todos"** para todos los sentidos)`, 'assistant');
        }
      } else if (step === 1) {
        const t = text.trim().toLowerCase();
        let dir;
        if (/todos|todas|ambas|cualquiera/i.test(t)) {
          dir = null; // todos los trayectos
        } else if (data.trayectos) {
          const idx = parseInt(t) - 1;
          dir = (!isNaN(idx) && data.trayectos[idx]) ? data.trayectos[idx].destino : text;
        } else {
          dir = text;
        }
        const query = dir
          ? `Dame el recorrido de paradas de la línea ${data.linea} en dirección "${dir}".`
          : `Dame el recorrido de paradas de la línea ${data.linea} en todos sus trayectos.`;
        wizardMode = null;
        sendQuestion(query);
      }
      return;
    }

    if (type === 'transbordos') {
      if (step === 0) {
        data.destino = text;
        wizardMode.step = 1;
        addMessage(
          `¿Qué quieres saber?\n\n**1.** Cómo llegar a "${text}" haciendo transbordo desde aquí\n**2.** Información general sobre qué líneas están conectadas (paradas en común)`,
          'assistant'
        );
      } else if (step === 1) {
        const op = text.trim();
        let query;
        if (op === '1' || /llegar|ruta|cómo|como|viaje/i.test(op)) {
          query = `¿Cómo puedo llegar a "${data.destino}" desde mi ubicación usando las líneas cercanas? Si necesito transbordo indica en qué parada cambiar y qué líneas coger.`;
        } else {
          query = `¿Qué líneas cercanas tienen paradas en común y permiten hacer transbordos entre ellas? Indica las paradas donde coinciden.`;
        }
        wizardMode = null;
        sendQuestion(query);
      }
      return;
    }
  }

  function handleSubmit() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    if (wizardMode) {
      addMessage(text, 'user');
      processWizardStep(text);
    } else {
      sendQuestion(text);
    }
  }

  sendBtn.addEventListener('click', handleSubmit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSubmit(); });

  // ── Voz ──

  function startVoice() {
    fab.classList.add('listening');
    micBtn.classList.add('listening');
    startVoiceRecognition(
      (text) => {
        fab.classList.remove('listening');
        micBtn.classList.remove('listening');
        if (wizardMode) { input.value = text; handleSubmit(); }
        else sendQuestion(text);
      },
      (err) => {
        fab.classList.remove('listening');
        micBtn.classList.remove('listening');
        openOverlay();
        addMessage('Error de voz: ' + err, 'assistant');
      }
    );
  }

  micBtn.addEventListener('click', startVoice);

  // ── Acciones rápidas ──

  document.querySelectorAll('.ai-quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      openOverlay();
      wizardMode = null;
      const action = btn.dataset.action;
      if (action === 'proximo') {
        sendQuestion('¿Cuál es el próximo autobús que pasa cerca de mí ahora mismo?');
      } else if (action === 'horarios') {
        wizardMode = { type: 'horarios', step: 0, data: {} };
        addMessage('¿De qué línea quieres información? (ej: "2", "12", "20"...)', 'assistant');
      } else if (action === 'transbordos') {
        wizardMode = { type: 'transbordos', step: 0, data: {} };
        addMessage('¿Cuál es tu destino final? (ej: "Hospital Cabueñes", "Plaza Mayor"...)', 'assistant');
      }
    });
  });

  // Configuración IA en Ajustes
  const providerSel = document.getElementById('ai-provider');
  const apiKeyInput = document.getElementById('ai-api-key');
  const modelInput  = document.getElementById('ai-model');
  const saveAIBtn   = document.getElementById('btn-save-ai');

  const promptTA = document.getElementById('ai-system-prompt');

  const cfg = getAIConfig();
  if (providerSel) providerSel.value = cfg.provider;
  if (apiKeyInput) apiKeyInput.value = cfg.apiKey;
  if (modelInput)  modelInput.value  = cfg.model;
  if (promptTA)    promptTA.value    = cfg.systemPrompt;

  saveAIBtn?.addEventListener('click', () => {
    saveAIConfig({
      provider:     providerSel?.value || '',
      apiKey:       apiKeyInput?.value || '',
      model:        modelInput?.value  || '',
      systemPrompt: promptTA?.value    || '',
    });
    saveAIBtn.textContent = '✓ Guardado';
    setTimeout(() => { saveAIBtn.textContent = 'Guardar configuración IA'; }, 2000);
  });
}

// GO
init();

// ============================================
// Transfer Logic
// ============================================

async function loadTransferArrivals() {
  state.isLoading = true;
  const container = document.getElementById("arrivals-container");
  container.innerHTML =
    '<div class="loading-progress">Cargando datos de transbordo...</div>';

  try {
    const { stop1, stop2, line1, line2 } = state.transferConfig;

    // Cargar detalles de ambas paradas en paralelo
    const [p1, p2] = await Promise.all([
      getStopDetail(stop1.idparada),
      getStopDetail(stop2.idparada),
    ]);

    // Extraer llegadas. Usamos un objeto dummy para stopInfo ya que solo necesitamos lat/lng para distancia,
    // y aquí la distancia no es crítica o usamos la de la parada almacenada.
    const arr1 = extractArrivals(p1, stop1);
    const arr2 = extractArrivals(p2, stop2);

    renderTransferDashboard(arr1, arr2, state.transferConfig, () => {
      // onExit
      state.transferMode = false;
      loadAllArrivals(); // Volver a modo normal
    });
  } catch (err) {
    console.error(err);
    container.innerHTML =
      '<div class="status-msg"><p>Error cargando datos de transbordo.</p></div>';
  } finally {
    state.isLoading = false;
  }
}

function setupTransferUI() {
  const btnSave = document.getElementById("btn-save-transfer");

  // Elements Step 1
  const s1Input = document.getElementById("transfer-stop1-input");
  const s1List = document.getElementById("transfer-stop1-list");
  const s1Sel = document.getElementById("transfer-stop1-selected");
  const l1Sel = document.getElementById("transfer-line1-select");

  // Elements Step 2
  const s2Input = document.getElementById("transfer-stop2-input");
  const s2List = document.getElementById("transfer-stop2-list");
  const s2Sel = document.getElementById("transfer-stop2-selected");
  const l2Sel = document.getElementById("transfer-line2-select");

  // Local config state
  let config = {
    stop1: null,
    line1: null,
    stop2: null,
    line2: null,
    travelTime: 20, // default minutes
    walkTime: 0,
    departureTime: "", // HH:MM
  };

  const checkReady = () => {
    // Solo requerimos paradas. Las líneas son opcionales (o se pueden dejar en "Cualquiera")
    if (config.stop1 && config.stop2) {
      btnSave.disabled = false;
      btnSave.textContent = "Ver Ruta";
    } else {
      btnSave.disabled = true;
      btnSave.textContent = "Selecciona paradas...";
    }
  };

  const populateAllLines = (select) => {
    select.innerHTML = '<option value="">Cualquiera (Todas)</option>';
    const lines = Object.keys(state.linesMap).sort((a, b) => {
      const na = parseInt(a),
        nb = parseInt(b);
      return isNaN(na) ? a.localeCompare(b) : na - nb;
    });

    lines.forEach((code) => {
      const l = state.linesMap[code];
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = `L${code} - ${l.name}`;
      select.appendChild(opt);
    });
  };

  const populateLines = async (select, stopId) => {
    select.innerHTML = '<option value="">Cargando líneas...</option>';
    select.disabled = true;

    try {
      const data = await getStopLines(stopId);
      const lines = Array.isArray(data) ? data : data.lineas || [];

      select.innerHTML = '<option value="">Cualquiera</option>';

      if (lines && lines.length > 0) {
        const codes = [...new Set(lines.map((l) => l.codigo || l.idlinea))];
        codes.sort((a, b) => {
          const na = parseInt(a),
            nb = parseInt(b);
          return isNaN(na) ? a.localeCompare(b) : na - nb;
        });

        codes.forEach((code) => {
          const l = state.linesMap[code] || {};
          let name = l.name;
          if (!name) {
            const found = lines.find((x) => (x.codigo || x.idlinea) == code);
            if (found) name = found.descripcion || found.nombre || "";
          }

          const opt = document.createElement("option");
          opt.value = code;
          opt.textContent = `L${code} - ${name}`;
          select.appendChild(opt);
        });

        // Add option to show all if needed?
        // For now, specialized lines + "Cualquiera" is enough.
      } else {
        populateAllLines(select);
      }
    } catch (err) {
      console.error("Error cargando líneas:", err);
      populateAllLines(select);
    } finally {
      select.disabled = false;
    }
  };

  const handleStopSelect = (num, stop) => {
    config[`stop${num}`] = stop;
    const selDiv = num === 1 ? s1Sel : s2Sel;
    const input = num === 1 ? s1Input : s2Input;
    const select = num === 1 ? l1Sel : l2Sel;

    input.parentElement.classList.add("hidden");
    selDiv.classList.remove("hidden");
    selDiv.querySelector(".stop-tag").textContent = `#${stop.idparada}`;
    selDiv.querySelector(".stop-name").textContent = stop.descripcion;

    populateLines(select, stop.idparada);
    checkReady();
  };

  const handleStopRemove = (num) => {
    config[`stop${num}`] = null;
    config[`line${num}`] = null;
    const selDiv = num === 1 ? s1Sel : s2Sel;
    const input = num === 1 ? s1Input : s2Input;
    const select = num === 1 ? l1Sel : l2Sel;

    selDiv.classList.add("hidden");
    input.parentElement.classList.remove("hidden");
    input.value = "";
    select.innerHTML = '<option value="">Selecciona parada...</option>';
    select.disabled = true;
    checkReady();
  };

  // Search 1
  s1Input.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (q.length < 2) {
      s1List.classList.add("hidden");
      return;
    }
    const res = state.allStops
      .filter((s) => {
        const id = (s.idParada || s.idparada || "").toString();
        const desc = (s.descripcion || "").toLowerCase();
        return id.includes(q) || desc.includes(q);
      })
      .slice(0, 10);
    renderTransferResults(res, "transfer-stop1-list", (s) =>
      handleStopSelect(1, s),
    );
  });

  // Search 2
  s2Input.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (q.length < 2) {
      s2List.classList.add("hidden");
      return;
    }
    const res = state.allStops
      .filter((s) => {
        const id = (s.idParada || s.idparada || "").toString();
        const desc = (s.descripcion || "").toLowerCase();
        return id.includes(q) || desc.includes(q);
      })
      .slice(0, 10);
    renderTransferResults(res, "transfer-stop2-list", (s) =>
      handleStopSelect(2, s),
    );
  });

  // Removes
  s1Sel
    .querySelector(".remove-stop")
    .addEventListener("click", () => handleStopRemove(1));
  s2Sel
    .querySelector(".remove-stop")
    .addEventListener("click", () => handleStopRemove(2));

  // Lines
  l1Sel.addEventListener("change", (e) => (config.line1 = e.target.value));
  l2Sel.addEventListener("change", (e) => (config.line2 = e.target.value));

  // Travel Time
  const tInput = document.getElementById("transfer-travel-time");
  if (tInput) {
    tInput.addEventListener("input", (e) => {
      const val = parseInt(e.target.value);
      if (val > 0) config.travelTime = val;
    });
  }

  // Walk Time
  const wInput = document.getElementById("transfer-walk-time");
  if (wInput) {
    wInput.addEventListener("input", (e) => {
      const val = parseInt(e.target.value);
      if (val >= 0) config.walkTime = val;
    });
  }

  // Departure Time
  const dInput = document.getElementById("transfer-departure-time");
  if (dInput) {
    dInput.addEventListener("input", (e) => {
      config.departureTime = e.target.value;
    });
  }

  // Save
  btnSave.addEventListener("click", () => {
    state.transferConfig = config;
    localStorage.setItem("bus_transfer_config", JSON.stringify(config));

    state.transferMode = true;
    switchToView("list");
    loadAllArrivals(); // Start transfer view
  });
}

function setupScheduleUI() {
  const lSelect = document.getElementById("schedule-line-select");
  const rSelect = document.getElementById("schedule-route-select");
  const sSelect = document.getElementById("schedule-stop-select");
  const lGroup = document.getElementById("schedule-step-2");
  const sGroup = document.getElementById("schedule-step-3");
  const resultsDiv = document.getElementById("schedule-results");
  const listDiv = document.getElementById("schedule-list");

  let currentLine = null;
  let currentRoute = null;
  let routeStops = [];
  let expeditions = [];

  const populateLines = async () => {
    lSelect.innerHTML = '<option value="">Cargando...</option>';
    try {
      let lines =
        state.allLines && state.allLines.length > 0
          ? state.allLines
          : await getAllLines();

      lSelect.innerHTML = '<option value="">Selecciona Línea</option>';
      if (!lines || lines.length === 0) {
        console.warn("PopulateLines: End result is 0 lines.");
        lSelect.innerHTML =
          '<option value="">No hay líneas disponibles</option>';
        return;
      }

      const sorted = [...lines];
      sorted.sort(
        (a, b) => (parseInt(a.codigo) || 999) - (parseInt(b.codigo) || 999),
      );

      for (let i = 0; i < sorted.length; i++) {
        const l = sorted[i];
        const opt = document.createElement("option");
        opt.value = l.idlinea;
        opt.textContent = `L${l.codigo} - ${l.descripcion || l.nombre || "Sin nombre"}`;
        lSelect.appendChild(opt);
      }
    } catch (e) {
      lSelect.innerHTML = "<option>Error cargando líneas</option>";
      console.error("PopulateLines ERROR:", e);
    }
  };

  // Cargar líneas al iniciar (ya están en state.allLines)
  populateLines();

  // Line Change -> Load Routes
  lSelect.addEventListener("change", async (e) => {
    const lineId = e.target.value;
    lGroup.classList.add("hidden");
    sGroup.classList.add("hidden");
    resultsDiv.classList.add("hidden");

    if (!lineId) return;

    currentLine = lineId;
    rSelect.innerHTML = '<option value="">Cargando trayectos...</option>';
    lGroup.classList.remove("hidden");

    try {
      const detail = await getLineDetail(lineId);
      const trayectos = detail.trayectos || [];
      rSelect.innerHTML = '<option value="">Selecciona Trayecto</option>';
      trayectos.forEach((t) => {
        const opt = document.createElement("option");
        opt.value = t.idtrayecto;
        opt.textContent = t.descripcion || t.destino;
        rSelect.appendChild(opt);
      });
    } catch (err) {
      console.error(err);
      rSelect.innerHTML = "<option>Error</option>";
    }
  });

  // Route Change -> Load Stops
  rSelect.addEventListener("change", async (e) => {
    const routeId = e.target.value;
    sGroup.classList.add("hidden");
    resultsDiv.classList.add("hidden");

    if (!routeId) return;

    currentRoute = routeId;
    sSelect.innerHTML = '<option value="">Cargando paradas...</option>';
    sGroup.classList.remove("hidden");

    try {
      // Fetch Stops & Expeditions
      const detail = await getLineDetail(currentLine);
      const route = detail.trayectos.find((t) => t.idtrayecto == routeId);
      expeditions = route?.expediciones || [];

      const stopsData = await getRouteStops(currentLine, routeId);
      routeStops = Array.isArray(stopsData)
        ? stopsData
        : stopsData.paradas || [];

      sSelect.innerHTML = '<option value="">Selecciona Parada</option>';
      routeStops.forEach((s, idx) => {
        const id = s.idParada || s.idparada || s.id;
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = `${idx + 1}. ${s.descripcion} (#${id})`;
        sSelect.appendChild(opt);
      });
    } catch (err) {
      console.error(err);
      sSelect.innerHTML = "<option>Error</option>";
    }
  });

  // Stop Change -> Calculate
  sSelect.addEventListener("change", (e) => {
    const stopId = e.target.value;
    if (!stopId) {
      resultsDiv.classList.add("hidden");
      return;
    }
    calculateArrivals(stopId);
  });

  const calculateArrivals = (stopId) => {
    const idx = routeStops.findIndex(
      (s) => (s.idParada || s.idparada || s.id) == stopId,
    );
    if (idx === -1) return;

    // Estimate offset: look for 'minutos' property or fallback
    // API might return 'minutos' in 'Llegadas', but here we have static list.
    // Usually static list has distances or minutes from header.
    // Let's check a sample property if exists, else 2 min * index.
    const stopInfo = routeStops[idx];
    let minutesOffset = stopInfo.minutosDesdeCabecera ?? idx * 2;

    const now = new Date();
    const upcoming = [];

    expeditions.forEach((exp) => {
      // exp.horaIni is "YYYY-MM-DD HH:MM:SS"
      // We can parse it.
      const tStr = exp.horaIni.replace(" ", "T");
      const depTime = new Date(tStr);

      // Add offset
      const arrTime = new Date(depTime.getTime() + minutesOffset * 60000);

      if (arrTime > now) {
        upcoming.push(arrTime);
      }
    });

    upcoming.sort((a, b) => a - b);
    const manyArrivals = upcoming.slice(0, 50); // Show up to 50 arrivals

    renderResults(manyArrivals, minutesOffset);
  };

  const renderResults = (times, offset) => {
    resultsDiv.classList.remove("hidden");
    listDiv.innerHTML = "";

    if (times.length === 0) {
      listDiv.innerHTML =
        "<div class='arrival-row'>No hay más servicios hoy.</div>";
      return;
    }

    times.forEach((t) => {
      const row = document.createElement("div");
      row.className = "arrival-row compact";
      row.style.background = "var(--bg-input)";
      row.style.marginBottom = "4px";
      row.innerHTML = `
             <div class="arrival-time-box" style="display:flex; justify-content:space-between; width:100%">
                <span class="arrival-min t-later" style="font-size:1.1rem">${t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                <span style="font-size:0.8rem; color:var(--text-secondary); align-self:center;">(desde cabecera +${offset}min)</span>
             </div>
          `;
      listDiv.appendChild(row);
    });
  };
}
