/**
 * ui.js — Renderizado de la lista unificada de próximos buses
 */

// Elimina caracteres fuera del rango latino (corrupción en BD de EMTUSA)
// Exportada para que api.js pueda reutilizarla en getStopArrivalsGrouped sin duplicar la regex.
export function fixText(str) {
  if (!str) return str;
  return str.replace(/[^\x20-\x7E\u00A0-\u024F]/g, "").trim();
}

// Colores fallback por línea
const LINE_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#ec4899",
  "#f43f5e",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#64748b",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
];

export function getLineColor(lineId) {
  const num = parseInt(lineId) || 0;
  return LINE_COLORS[num % LINE_COLORS.length];
}

/**
 * Devuelve '#111' o '#fff' según la luminancia del color de fondo
 */
function getTextColor(hexColor) {
  const hex = hexColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.5 ? "#111" : "#fff";
}

/**
 * Agrupa llegadas por línea+dirección, preservando el orden relativo
 * (ya ordenado por tiempo/distancia) dentro de cada grupo.
 */
export function groupArrivals(arrivals) {
  const map = new Map();
  const groups = [];
  (arrivals || []).forEach((a) => {
    const key = `${a.lineId}|${a.direction}`;
    let group = map.get(key);
    if (!group) {
      group = [];
      map.set(key, group);
      groups.push(group);
    }
    group.push(a);
  });
  return groups;
}

let timeColorThresholds = { green: 5, yellow: 10 };

/**
 * Configura los umbrales (en minutos) que determinan el color del tiempo
 * restante: verde <= green, amarillo <= yellow, rojo > yellow.
 */
export function setTimeColorThresholds(green, yellow) {
  timeColorThresholds = { green, yellow };
}

function timeCellFor(a) {
  let timeClass = "t-later";
  let timeText = "--";
  if (a.busAtStop) {
    timeClass = "t-now";
    timeText = `<svg width="44" height="44" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/></svg>`;
  } else if (a.minutes !== null && a.minutes !== undefined) {
    timeText = String(a.minutes).padStart(2, "0");
    if (a.minutes <= timeColorThresholds.green) timeClass = "t-now";
    else if (a.minutes <= timeColorThresholds.yellow) timeClass = "t-soon";
  }
  return { timeClass, timeText };
}

function distTextFor(a) {
  if (a.userDistance === undefined) return "";
  return a.userDistance >= 1000
    ? `${(a.userDistance / 1000).toFixed(1)} km`
    : `${Math.round(a.userDistance)} m`;
}

/**
 * Renderizar la lista unificada de llegadas, agrupada por línea+dirección.
 * Grupos de una sola parada mantienen el marcado clásico (sin cambios visuales).
 */
export function renderArrivals(groups, onRowClick, opts = {}) {
  const { favorites = new Set(), onToggleFav, onCreateAlert } = opts;
  const container = document.getElementById("arrivals-container");

  if (!groups || groups.length === 0) {
    container.innerHTML = `
      <div class="status-msg">
        <div class="status-msg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
        <p>No hay autobuses previstos en las paradas cercanas</p>
      </div>`;
    return;
  }

  const flat = [];

  container.innerHTML = groups
    .map((group) => {
      const first = group[0];
      const color = first.lineColor || getLineColor(first.lineId);
      const textColor = getTextColor(color);

      if (group.length === 1) {
        const a = first;
        const idx = flat.push(a) - 1;
        const { timeClass, timeText } = timeCellFor(a);
        const distText = distTextFor(a);
        const isFav = favorites.has(a.stopId.toString());

        return `
        <div class="arrival-row" data-idx="${idx}">
          <div class="arrival-badge" style="background:${color};color:${textColor}">L${a.lineId}</div>
          <div class="arrival-direction">${fixText(a.direction)}</div>
          <button class="fav-btn${isFav ? " active" : ""}" data-stop-id="${a.stopId}" aria-label="${isFav ? "Quitar de favoritos" : "Añadir a favoritos"}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></button>
          <button class="alert-btn" data-idx="${idx}" aria-label="Crear alerta"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></button>
          <div class="arrival-time-box">
            <div class="arrival-min ${timeClass}">${timeText}</div>
          </div>
          <div class="arrival-meta-row">
            <span class="arrival-stop-badge" style="background:${color};color:${textColor}">${a.stopId}</span>
            ${distText ? `<span class="arrival-dist">(${distText})</span>` : ""}
          </div>
          <div class="arrival-stop-name">${fixText(a.stopName)}</div>
        </div>`;
      }

      // Grupo con varias paradas para la misma línea+dirección
      const n = group.length;
      const items = group
        .map((a, i) => {
          const idx = flat.push(a) - 1;
          const { timeClass, timeText } = timeCellFor(a);
          const distText = distTextFor(a);
          const isFav = favorites.has(a.stopId.toString());
          const metaRow = 2 + i * 2;
          const sep = i > 0 ? " arrival-group-sep" : "";

          return `
          <div class="arrival-meta-row${sep}" style="grid-row:${metaRow}" data-idx="${idx}">
            <span class="arrival-stop-badge" style="background:${color};color:${textColor}">${a.stopId}</span>
            ${distText ? `<span class="arrival-dist">(${distText})</span>` : ""}
            <button class="fav-btn fav-btn-inline${isFav ? " active" : ""}" data-stop-id="${a.stopId}" aria-label="${isFav ? "Quitar de favoritos" : "Añadir a favoritos"}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></button>
            <button class="alert-btn alert-btn-inline" data-idx="${idx}" aria-label="Crear alerta"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></button>
          </div>
          <div class="arrival-stop-name" style="grid-row:${metaRow + 1}" data-idx="${idx}">${fixText(a.stopName)}</div>
          <div class="arrival-time-box" style="grid-row:${metaRow} / ${metaRow + 2}" data-idx="${idx}">
            <div class="arrival-min ${timeClass}">${timeText}</div>
          </div>`;
        })
        .join("");

      return `
        <div class="arrival-row" style="grid-template-rows: auto repeat(${n * 2}, auto)">
          <div class="arrival-badge" style="background:${color};color:${textColor};grid-row:2 / ${2 + n * 2};align-self:center">L${first.lineId}</div>
          <div class="arrival-direction">${fixText(first.direction)}</div>
          ${items}
        </div>`;
    })
    .join("");

  if (onRowClick) {
    container.querySelectorAll(".arrival-row[data-idx], [data-idx]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest(".fav-btn")) return;
        const idx = parseInt(el.dataset.idx);
        if (flat[idx]) onRowClick(flat[idx]);
      });
    });
  }

  if (onToggleFav) {
    container.querySelectorAll(".fav-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onToggleFav(btn.dataset.stopId);
      });
    });
  }

  if (onCreateAlert) {
    container.querySelectorAll(".alert-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        if (flat[idx]) onCreateAlert(flat[idx]);
      });
    });
  }
}

/**
 * Mostrar loading con barra de progreso
 */
export function showLoading(loaded, total) {
  const container = document.getElementById("arrivals-container");
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  container.innerHTML = `
    <div class="loading-progress">
      Consultando paradas cercanas... (${loaded}/${total})
      <div class="loading-progress-bar">
        <div class="loading-progress-fill" style="width:${pct}%"></div>
      </div>
    </div>`;
}

/**
 * Actualizar badge de refresco
 */
export function updateRefreshBadge(seconds, paused = false) {
  const el = document.getElementById("refresh-timer");
  if (!el) return;
  if (paused) {
    el.textContent = "II";
    el.classList.add("paused");
  } else {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    el.textContent = m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${seconds}s`;
    el.classList.remove("paused");
  }
}

/**
 * Mostrar/ocultar filter chip (filtro por parada desde mapa)
 */
export function showFilterChip(stopName, stopId, onClear) {
  const container = document.getElementById("filter-chip-container");
  container.innerHTML = `
    <div class="filter-chip">
      <span class="filter-chip-text"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>Filtrando: <strong>${stopName}</strong> #${stopId}</span>
      <button class="filter-chip-close" aria-label="Quitar filtro"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
    </div>`;
  container
    .querySelector(".filter-chip-close")
    .addEventListener("click", onClear);
}

export function clearFilterChip() {
  const container = document.getElementById("filter-chip-container");
  if (container) container.innerHTML = "";
}

// ============================================
// Transbordo / Transfer
// ============================================

export function renderTransferResults(results, containerId, onSelect) {
  const container = document.getElementById(containerId);
  if (!container) return; // Puede no existir si el modal no esta abierto

  container.innerHTML = "";
  if (results && results.length > 0) {
    container.classList.remove("hidden");

    results.forEach((stop) => {
      const div = document.createElement("div");
      div.className = "search-result-item";
      div.innerHTML = `<strong>#${stop.idparada}</strong> ${stop.descripcion}`;
      div.addEventListener("click", () => {
        onSelect(stop);
        container.classList.add("hidden");
        container.innerHTML = ""; // Limpiar
      });
      container.appendChild(div);
    });
  } else {
    container.classList.add("hidden");
  }
}

// Helper para hora actual + minutos
function formatTime(minutes) {
  if (minutes === null || minutes === undefined) return "--:--";
  const d = new Date();
  d.setMinutes(d.getMinutes() + minutes);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Helper para convertir HH:MM input a minutos desde ahora
function getMinutesFromNow(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(":").map(Number);
  const now = new Date();
  const target = new Date();
  target.setHours(h, m, 0, 0);

  // Si la hora es menor a la actual, asumimos mañana? No, usuario probablemente se equivocó o quiere ver pasado.
  // Pero para filtrado real-time, tiempos pasados son negativos.

  const diffMs = target - now;
  return Math.floor(diffMs / 60000); // minutos
}

export function renderTransferDashboard(arrivals1, arrivals2, config, onExit) {
  const container = document.getElementById("arrivals-container");
  if (!container) return;

  const travelTime = config.travelTime || 20;
  const walkTime = config.walkTime || 0;
  const minDepMinutes = getMinutesFromNow(config.departureTime);

  const renderSection = (list, lineFilter, title, isOrigin) => {
    let content = "";

    // Filtros
    let filtered = list || [];
    if (lineFilter) {
      filtered = filtered.filter(
        (a) => a.lineId.toString() === lineFilter.toString(),
      );
    }

    // Filtrado por hora de salida (Solo para Origen)
    if (isOrigin && minDepMinutes !== null) {
      // Filter buses arriving AFTER minDepMinutes
      // a.minutes is "minutes from now".
      filtered = filtered.filter((a) => a.minutes >= minDepMinutes);
    }

    if (!list || list.length === 0) {
      content = `<div class="status-msg small">Sin datos (API)</div>`;
    } else if (filtered.length === 0) {
      if (isOrigin && minDepMinutes !== null) {
        content = `<div class="status-msg small">No hay buses después de ${config.departureTime} (aún)</div>`;
      } else {
        content = `<div class="status-msg small">Sin buses de L${lineFilter}</div>`;
      }
    } else {
      content = filtered
        .map((a) => {
          const color = a.lineColor || "#3b82f6";
          const textColor = "#fff";

          const min = a.minutes ?? 0;
          const departTime = formatTime(min);
          const arrivePickupTime = formatTime(min + travelTime + walkTime);

          let timeBadge = `<div class="arrival-min ${min <= 5 ? "t-soon" : "t-later"}">${min} min</div>`;
          if (min === 0)
            timeBadge = `<div class="arrival-min t-soon">Ahora</div>`;

          let extraInfo = "";
          if (isOrigin) {
            extraInfo = `
              <div class="connection-info" style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px; padding-top:4px; border-top:1px dashed var(--border);">
                <div>Salida: <strong>${departTime}</strong></div>
                <div style="color: var(--accent-light)">
                   Llegada 2ª parada: <strong>${arrivePickupTime}</strong>
                   <span style="font-size:0.75em; opacity:0.8">(+${travelTime + walkTime}min)</span>
                </div>
              </div>
            `;
          } else {
            extraInfo = `
              <div class="connection-info" style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px;">
                Paso prev.: <strong>${departTime}</strong>
              </div>
            `;
          }

          return `
          <div class="arrival-row compact" style="display:flex; flex-direction:column; align-items:stretch;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div class="arrival-badges">
                <div class="arrival-badge" style="background:${color};color:${textColor}">L${a.lineId}</div>
                <span style="font-size:0.9rem; margin-left:8px;">${a.direction}</span>
              </div>
              <div class="arrival-time-box" style="text-align:right;">
                ${timeBadge}
              </div>
            </div>
            ${extraInfo}
          </div>`;
        })
        .join("");
    }

    return `
      <div class="transfer-section">
        <h4 class="transfer-section-title">${title}</h4>
        <div class="transfer-list">${content}</div>
      </div>
    `;
  };

  const html = `
    <div class="transfer-dash">
      <div class="transfer-dash-header">
        <div class="transfer-route-summ">
          <div class="route-step">1. ${config.stop1.descripcion || "Origen"}</div>
          <div class="route-arrow"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M12 5v14M19 12l-7 7-7-7"/></svg> <span style="font-size:0.7em">${travelTime}m (Bus) + ${walkTime}m (Pie)</span></div>
          <div class="route-step">2. ${config.stop2.descripcion || "Destino"}</div>
        </div>
        <button id="btn-exit-transfer" class="btn-xs btn-outline">Salir</button>
      </div>
      
      ${renderSection(arrivals1, config.line1, `ORIGEN: ${config.stop1.descripcion || config.stop1.idparada}`, true)}
      ${renderSection(arrivals2, config.line2, `DESTINO: ${config.stop2.descripcion || config.stop2.idparada}`, false)}
    </div>
  `;

  container.innerHTML = html;
  document
    .getElementById("btn-exit-transfer")
    .addEventListener("click", onExit);
}

// ============================================
// Alertas — Diálogo de creación y lista de alertas
// ============================================

/**
 * Mostrar un diálogo modal para crear una alerta de bus.
 * Pre-rellena con los datos de la llegada seleccionada.
 *
 * @param {Object} arrival - Datos de la llegada { lineId, lineName, direction, stopId, stopName }
 * @param {Function} onConfirm - Callback(thresholdMinutes) cuando se confirma
 */
export function showAlertDialog(arrival, onConfirm) {
  // Remove any existing dialog
  document.getElementById("alert-dialog")?.remove();

  const dialog = document.createElement("div");
  dialog.id = "alert-dialog";
  dialog.className = "alert-dialog-overlay";

  const color = arrival.lineColor || getLineColor(arrival.lineId);
  const textColor = getTextColor(color);

  dialog.innerHTML = `
    <div class="alert-dialog-content">
      <div class="alert-dialog-header">
        <span class="arrival-badge" style="background:${color};color:${textColor}">L${arrival.lineId}</span>
        <span class="alert-dialog-direction">${fixText(arrival.direction)}</span>
        <button class="alert-dialog-close" aria-label="Cerrar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </div>
      <div class="alert-dialog-body">
        <p class="alert-dialog-stop">Parada: <strong>${fixText(arrival.stopName)}</strong> (#${arrival.stopId})</p>
        <label class="settings-label">Avisarme cuando el bus esté a</label>
        <div class="alert-threshold-row">
          <input type="range" id="alert-threshold" class="settings-range" min="1" max="30" step="1" value="5" />
          <span id="alert-threshold-value" class="settings-range-value">5 min</span>
        </div>
        <p class="alert-dialog-hint">Recibirás una notificación push una sola vez cuando el bus esté a este número de minutos o menos.</p>
      </div>
      <button id="btn-confirm-alert" class="settings-apply">Crear alerta</button>
    </div>
  `;

  document.body.appendChild(dialog);

  // Wire up interactions
  const thresholdInput = dialog.querySelector("#alert-threshold");
  const thresholdValue = dialog.querySelector("#alert-threshold-value");

  thresholdInput.addEventListener("input", () => {
    thresholdValue.textContent = `${thresholdInput.value} min`;
  });

  dialog.querySelector(".alert-dialog-close").addEventListener("click", () => {
    dialog.remove();
  });

  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.remove();
  });

  dialog.querySelector("#btn-confirm-alert").addEventListener("click", () => {
    const threshold = parseInt(thresholdInput.value);
    dialog.remove();
    onConfirm(threshold);
  });
}

/**
 * Renderizar la lista de alertas activas en la página de ajustes.
 *
 * @param {Array} alerts - Lista de alertas [{ id, lineId, direction, stopName, stopId, thresholdMinutes, status }]
 * @param {Function} onDelete - Callback(alertId) para eliminar
 */
export function renderAlertsList(alerts, onDelete) {
  const container = document.getElementById("alerts-list");
  if (!container) return;

  if (!alerts || alerts.length === 0) {
    container.innerHTML = '<p class="alerts-empty">No tienes alertas activas.</p>';
    return;
  }

  container.innerHTML = alerts
    .map((alert) => {
      const color = getLineColor(alert.lineId);
      const textColor = getTextColor(color);
      return `
      <div class="alert-item" data-alert-id="${alert.id}">
        <div class="alert-item-badge" style="background:${color};color:${textColor}">L${alert.lineId}</div>
        <div class="alert-item-info">
          <div class="alert-item-direction">${fixText(alert.direction)}</div>
          <div class="alert-item-stop">
            <span class="alert-item-stop-id" style="background:${color};color:${textColor}">${alert.stopId}</span>
            <span class="alert-item-stop-name">${fixText(alert.stopName)}</span>
          </div>
        </div>
        <div class="alert-item-threshold">
          <div class="alert-item-threshold-value">${alert.thresholdMinutes}</div>
          <div class="alert-item-threshold-label">min</div>
        </div>
        <button class="alert-item-delete" data-alert-id="${alert.id}" aria-label="Eliminar alerta">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>`;
    })
    .join("");

  container.querySelectorAll(".alert-item-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onDelete(parseInt(btn.dataset.alertId));
    });
  });
}

// ============================================
// Vista Paradas — Cabecera con selector de parada (T4)
// ============================================

/**
 * Renderizar la cabecera del selector de parada dentro de `#stops-header`.
 *
 * Estructura:
 *   - Etiqueta visible "Parada" (sin icono lupa, igual que la search bar de Llegadas
 *     según la regla de CLAUDE.md).
 *   - Input con placeholder "Busca por nombre o número…".
 *   - Botón "Usar mi ubicación" (mismo icono SVG de chincheta que ya usa el código
 *     para geolocalización, reutilizando el patrón del marker-pin).
 *   - Bloque `#stops-stop-info` para mostrar el nombre y número de la parada
 *     seleccionada cuando exista.
 *   - Lista `#stops-suggestions` (oculta por defecto) donde se pintan hasta 8
 *     sugerencias al teclear.
 *
 * Esta función NO cablea los listeners: lo hace `setupStopsSelector` en main.js,
 * para mantener el patrón del proyecto (estado único en main.js, ui.js sólo pinta).
 *
 * @param {string|null} selectedName - Nombre de la parada seleccionada (o null)
 * @param {string|null} selectedId   - ID de la parada seleccionada (o null)
 */
export function renderStopsHeader(selectedName, selectedId) {
  const container = document.getElementById("stops-header");
  if (!container) return;

  const value = selectedName ? `${selectedName}${selectedId ? ` (#${selectedId})` : ""}` : "";

  container.innerHTML = `
    <div class="stops-header-row">
      <label class="stops-header-label" for="stops-stop-input">Parada</label>
    </div>
    <div class="stops-header-controls">
      <div class="stops-input-wrap">
        <input
          type="text"
          id="stops-stop-input"
          class="search-input search-input--prominent stops-stop-input"
          placeholder="Busca por nombre o número…"
          autocomplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="false"
          aria-controls="stops-suggestions"
          value="${escapeAttr(value)}"
        />
        <button
          id="stops-stop-clear"
          type="button"
          class="search-clear"
          aria-label="Limpiar selección"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <button
        id="stops-geo-btn"
        type="button"
        class="stops-geo-btn"
        aria-label="Usar mi ubicación"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C8 2 5 5 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-4-3-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>
        <span>Usar mi ubicación</span>
      </button>
    </div>
    <div id="stops-stop-info" class="stops-stop-info"></div>
    <div
      id="stops-suggestions"
      class="stops-suggestions hidden"
      role="listbox"
      aria-label="Resultados de búsqueda de paradas"
    ></div>
  `;

  // Estado inicial del info (placeholder si no hay selección).
  updateStopsStopInfo(selectedName, selectedId);
}

/**
 * Actualiza el texto bajo el input con el nombre+número de la parada
 * seleccionada, o un mensaje informativo cuando no hay selección.
 */
export function updateStopsStopInfo(selectedName, selectedId, transientMsg) {
  const el = document.getElementById("stops-stop-info");
  if (!el) return;
  if (transientMsg) {
    el.textContent = transientMsg;
    el.dataset.mode = "msg";
    return;
  }
  if (selectedName && selectedId != null) {
    el.textContent = `Parada #${selectedId} — ${fixText(selectedName)}`;
    el.dataset.mode = "selected";
  } else if (selectedName) {
    el.textContent = `Parada — ${fixText(selectedName)}`;
    el.dataset.mode = "selected";
  } else {
    el.textContent = "Selecciona una parada para ver los próximos buses.";
    el.dataset.mode = "empty";
  }
}

/**
 * Renderizar la lista de sugerencias de paradas debajo del input.
 *
 * @param {Array<{idparada:string,descripcion:string}>} stops
 * @param {(stop)=>void} onPick - Callback al pulsar una sugerencia
 */
export function renderStopsSuggestions(stops, onPick) {
  const list = document.getElementById("stops-suggestions");
  const input = document.getElementById("stops-stop-input");
  if (!list) return;

  if (!stops || stops.length === 0) {
    list.classList.add("hidden");
    list.innerHTML = "";
    if (input) input.setAttribute("aria-expanded", "false");
    return;
  }

  list.innerHTML = stops
    .map(
      (s) => `
      <div class="stops-suggestion-item" role="option" data-stop-id="${escapeAttr(String(s.idparada))}">
        <span class="stops-suggestion-id">${escapeHtml(String(s.idparada))}</span>
        <span class="stops-suggestion-name">${escapeHtml(fixText(s.descripcion) || "")}</span>
      </div>`,
    )
    .join("");

  list.classList.remove("hidden");
  if (input) input.setAttribute("aria-expanded", "true");

  list.querySelectorAll(".stops-suggestion-item").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.stopId;
      const stop = stops.find((s) => String(s.idparada) === id);
      if (stop) onPick(stop);
    });
  });
}

/** Ocultar la lista de sugerencias (sin perder la selección actual). */
export function hideStopsSuggestions() {
  const list = document.getElementById("stops-suggestions");
  const input = document.getElementById("stops-stop-input");
  if (list) {
    list.classList.add("hidden");
    list.innerHTML = "";
  }
  if (input) input.setAttribute("aria-expanded", "false");
}

/**
 * Mostrar mensaje breve en #stops-stop-info (ej. "Sin ubicación") y
 * devolverlo a su estado natural tras `durationMs`.
 */
export function flashStopsStopInfo(msg, durationMs = 3000) {
  const el = document.getElementById("stops-stop-info");
  if (!el) return;
  const previous = { text: el.textContent, mode: el.dataset.mode };
  updateStopsStopInfo(null, null, msg);
  setTimeout(() => {
    // Sólo restaurar si nadie cambió el modo mientras tanto
    if (el.dataset.mode === "msg") {
      el.textContent = previous.text;
      el.dataset.mode = previous.mode || "empty";
    }
  }, durationMs);
}

// ============================================
// Vista Paradas — Render de llegadas agrupadas por línea (T5)
// ============================================

/**
 * Pinta el resultado de `getStopArrivalsGrouped` dentro de `#stops-content`.
 *
 * Estructura esperada (`data`):
 * ```
 * {
 *   stopId, stopName, fetchedAt,
 *   groups: [{ line, lineName, route, destination,
 *              arrivals: [{ bus, minutes, real }] }]
 * }
 * ```
 *
 * Comportamiento:
 * - Si `data` es null o `data.groups` está vacío → estado vacío textual
 *   (sin emojis decorativos, regla CLAUDE.md: mínimo ruido visual).
 * - Si hay grupos → cabecera con marca de frescura (`Actualizado HH:MM:SS`)
 *   y una tarjeta por grupo con badge de línea + chips de tiempo.
 *
 * Esta función NO cablea listeners: solo pinta. La integración con el ciclo
 * de refresco global y la construcción del `lineColorMap` las hace T6 en main.js.
 *
 * @param {HTMLElement} container - Elemento `#stops-content`.
 * @param {{stopId:string, stopName:string, fetchedAt:number, groups:Array}|null} data
 * @param {Map<string,string>|null} lineColorMap - Mapa código de línea (`"L12"`)
 *   → colorhex con `#` delante. Si es null o falta la clave, se usa
 *   `getLineColor()` (paleta fallback ya cacheada en este módulo).
 */
export function renderStopsArrivals(container, data, lineColorMap) {
  if (!container) return;

  // Estado vacío: sin datos o sin grupos → solo texto, sin icono (uso exterior)
  if (!data || !Array.isArray(data.groups) || data.groups.length === 0) {
    container.innerHTML =
      '<p class="stops-empty">Selecciona una parada para ver los próximos buses.</p>';
    return;
  }

  // Marca de frescura (HH:MM:SS en local, coherente con el resto de la app)
  let fetchedLabel = "";
  if (data.fetchedAt) {
    const d = new Date(data.fetchedAt);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    fetchedLabel = `Actualizado ${hh}:${mm}:${ss}`;
  }

  const groupsHtml = data.groups
    .map((group) => renderStopGroup(group, lineColorMap))
    .join("");

  container.innerHTML = `
    <div class="stops-fetched-at" aria-live="polite">${escapeHtml(fetchedLabel)}</div>
    <div class="stop-groups">${groupsHtml}</div>
  `;
}

/**
 * Renderiza un único grupo (línea + dirección) como tarjeta `.stop-group`.
 * Helper privado — no se exporta porque el contrato público es `renderStopsArrivals`.
 */
function renderStopGroup(group, lineColorMap) {
  // Resolución de color: 1) lineColorMap (datos reales de getAllLines),
  // 2) getLineColor() (paleta fallback determinista por lineId).
  const lineKey = String(group.line ?? "");
  const colorFromMap = lineColorMap && lineColorMap.get(lineKey);
  const color = colorFromMap || getLineColor(lineKey);
  const textColor = getTextColor(color);

  // Etiqueta humana: preferimos lineName si viene con texto; si no, line.
  const lineLabel = group.lineName && String(group.lineName).trim()
    ? String(group.lineName).trim()
    : lineKey;
  const destination = fixText(group.destination || "");

  const headerTitle = destination
    ? `${escapeHtml(lineLabel)} — ${escapeHtml(destination)}`
    : escapeHtml(lineLabel);

  const arrivals = Array.isArray(group.arrivals) ? group.arrivals : [];
  let chipsHtml;
  if (arrivals.length === 0) {
    chipsHtml =
      '<span class="stop-group__empty">Sin buses próximos</span>';
  } else {
    chipsHtml = arrivals
      .filter((a) => {
        if (!a) return false;
        // Llegada real: debe tener minutos numéricos válidos
        if (a.real) {
          return (
            a.minutes !== null &&
            a.minutes !== undefined &&
            !isNaN(a.minutes)
          );
        }
        // Estimación cruzada por GPS: debe tener distancia válida en metros
        return (
          typeof a.distance === "number" &&
          Number.isFinite(a.distance) &&
          a.distance >= 0
        );
      })
      .map((a) => renderStopChip(a))
      .join("");
    // Si tras filtrar no queda ningún chip (todos inválidos) caemos al mensaje
    if (!chipsHtml) {
      chipsHtml =
        '<span class="stop-group__empty">Sin buses próximos</span>';
    }
  }

  const ariaLabel = `${lineLabel}${destination ? " con destino a " + destination : ""}`;

  return `
    <section class="stop-group" aria-label="${escapeAttr(ariaLabel)}">
      <header class="stop-group__header">
        <div
          class="stop-group__line-badge"
          style="background:${color};color:${textColor}"
        >${escapeHtml(lineKey || "—")}</div>
        <div class="stop-group__title">${headerTitle}</div>
      </header>
      <div class="stop-group__time-chips">${chipsHtml}</div>
    </section>
  `;
}

/**
 * Renderiza un único chip de tiempo (`<button>` no interactivo, solo visual).
 *
 * Reglas (extraídas de CLAUDE.md):
 * - Tiempo siempre 2 dígitos con `padStart(2,"0")`.
 * - Bus en parada (`minutes === 0`) → solo `⬤` sin texto.
 * - Color según `timeColorThresholds` (configurable en Ajustes):
 *   <= verde → success, <= amarillo → warning, > amarillo → accent.
 *
 * Estimaciones por GPS (`real === false`):
 * - No tenemos minutos, sólo distancia en metros.
 * - Mostramos la distancia formateada: < 1000m → "850m"; >= 1000m → "1.2 km"
 *   con 1 decimal.
 * - Clase CSS `stop-group__chip--estimation` para que se distinga visualmente
 *   (borde discontinuo y opacidad reducida — ver style.css).
 * - aria-label describe que es una estimación y la distancia.
 *
 * Si `minutes` es null o no numérico, el caller debería haberlo filtrado;
 * aún así lo cubrimos por defensa.
 */
function renderStopChip(arrival) {
  const minutes = arrival.minutes;

  // ---------------------------------------------------------------
  // Estimación cruzada por GPS (T7): sin minutos, mostramos distancia.
  // ---------------------------------------------------------------
  if (arrival && arrival.real === false) {
    const distance = arrival.distance;
    if (typeof distance !== "number" || !Number.isFinite(distance) || distance < 0) {
      return "";
    }
    const { label, ariaLabel } = formatEstimationDistance(distance);
    return `<span class="stop-group__chip stop-group__chip--estimation" aria-label="${escapeAttr(ariaLabel)}">${escapeHtml(label)}</span>`;
  }

  if (minutes === null || minutes === undefined || isNaN(minutes)) return "";

  // Bus en parada → solo círculo, sin texto (regla CLAUDE.md)
  if (minutes === 0) {
    return `<span class="stop-group__chip stop-group__chip--arrived" aria-label="Bus en la parada"><span class="stop-group__chip-dot" aria-hidden="true">⬤</span></span>`;
  }

  const cls = chipClassForMinutes(minutes);
  const label = String(minutes).padStart(2, "0");
  return `<span class="stop-group__chip ${cls}" aria-label="${minutes} minutos">${label}</span>`;
}

/**
 * Formatea la distancia de una estimación GPS en etiqueta humana para el chip.
 *
 * Reglas (CLARAS y orientadas a presbicia):
 * - < 1000 m → "850m" (sin decimales, metros enteros)
 * - >= 1000 m → "1.2 km" (1 decimal, kilómetros)
 *
 * Para el aria-label damos una versión más descriptiva (en español).
 *
 * @param {number} meters Distancia en metros (>= 0).
 * @returns {{label: string, ariaLabel: string}}
 */
function formatEstimationDistance(meters) {
  if (meters < 1000) {
    const rounded = Math.round(meters);
    return {
      label: `${rounded}m`,
      ariaLabel: `Próximo bus estimado por posición GPS, a ${rounded} metros`,
    };
  }
  const km = meters / 1000;
  const kmStr = km.toFixed(1);
  // En España se usa coma decimal, pero en la UI de la app ya convivimos con
  // números en formato inglés en otras partes (lat/lng, etc.). Mantenemos
  // el punto decimal por consistencia con el resto de la PWA y para que el
  // ancho del chip sea predecible.
  return {
    label: `${kmStr} km`,
    ariaLabel: `Próximo bus estimado por posición GPS, a ${kmStr} kilómetros`,
  };
}

/**
 * Devuelve la clase CSS del chip según los umbrales globales configurados.
 * Helper extraído para que la lógica de thresholds viva en un único sitio
 * (también la usa `timeCellFor` para `.arrival-min`).
 */
function chipClassForMinutes(minutes) {
  if (minutes <= timeColorThresholds.green) return "stop-group__chip--success";
  if (minutes <= timeColorThresholds.yellow) return "stop-group__chip--warning";
  return "stop-group__chip--accent";
}

// --- Helpers locales de escapado HTML (la cabecera se inyecta con innerHTML) ---
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(str) {
  return escapeHtml(str);
}
