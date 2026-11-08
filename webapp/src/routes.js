/**
 * routes.js — Selector de recorridos de líneas en el mapa.
 * Por línea: sentido (ida/vuelta), tipo de día (hoy/laborables/sábados/domingos/todos)
 * y variantes de trayecto individuales. Persiste en localStorage `bus_map_lines_v2`.
 */

import { getLineRoutes } from "./api.js";
import { addRoutesControl, setRouteLines } from "./map.js";

const STORAGE_KEY = "bus_map_lines_v2";
const LEGACY_KEY = "bus_map_lines";
const CONCURRENCY = 3;
const DAY_OPTIONS = [
  ["hoy", "Hoy"],
  ["L", "Laborables"],
  ["S", "Sábados"],
  ["D", "Dom./Fest."],
  ["todos", "Todos"],
];

let lines = [];
let config = {}; // idlinea -> { dirs:number[], day:string, custom:number[]|null }
let focused = null;
let ctrlBtn = null;
let panel = null;
let renderToken = 0;
const loaded = new Map(); // idlinea -> routes[]

const defaultConfig = () => ({ dirs: [1, 2], day: "hoy", custom: null });

function lineCode(l) {
  return String(l.codigo ?? l.idlinea);
}

function lineColor(l) {
  const c = l.colorhex ? `#${String(l.colorhex).replace("#", "")}` : "";
  return /^#[0-9A-Fa-f]{6}$/.test(c) ? c : "#3b82f6";
}

function textOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.5 ? "#111" : "#fff";
}

function sortKey(l) {
  const code = lineCode(l);
  return [/^\d/.test(code) ? 0 : 1, parseInt(code.replace(/\D/g, ""), 10) || 0, code];
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function cleanText(str) {
  return String(str ?? "").replace(/[^\x20-\x7E -ɏ]/g, "").replace(/\s+/g, " ").trim();
}

function matchesDay(route, day) {
  if (day === "todos") return true;
  if (day === "hoy") return !!route.hoy;
  return (route.dias || []).includes(day);
}

function visibleRoutes(id, routes) {
  const cfg = config[id];
  if (!cfg) return [];
  if (cfg.custom) return routes.filter((r) => cfg.custom.includes(Number(r.idtrayecto)));
  return routes.filter((r) => cfg.dirs.includes(Number(r.direccion)) && matchesDay(r, cfg.day));
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function lineById(id) {
  return lines.find((l) => String(l.idlinea) === id);
}

// ── Dibujo ──────────────────────────────────────────────

function draw() {
  setRouteLines(
    lines
      .filter((l) => config[String(l.idlinea)] && loaded.has(String(l.idlinea)))
      .map((l) => {
        const id = String(l.idlinea);
        return { code: lineCode(l), color: lineColor(l), routes: visibleRoutes(id, loaded.get(id)) };
      }),
  );
}

async function loadSelected() {
  const token = ++renderToken;
  const queue = Object.keys(config).filter((id) => !loaded.has(id));
  draw();
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      setChipLoading(id, true);
      try {
        loaded.set(id, await getLineRoutes(id));
      } catch (e) {
        console.warn(`[Recorridos] L${id}`, e);
      }
      setChipLoading(id, false);
      if (token !== renderToken) continue;
      draw();
      if (id === focused) renderDetail();
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

// ── Panel ───────────────────────────────────────────────

function setChipLoading(id, loading) {
  panel?.querySelector(`.route-chip[data-id="${id}"]`)?.classList.toggle("loading", loading);
}

function updateChips() {
  const n = Object.keys(config).length;
  if (ctrlBtn) ctrlBtn.textContent = n ? `Líneas (${n})` : "Líneas";
  panel?.querySelectorAll(".route-chip").forEach((chip) => {
    const on = !!config[chip.dataset.id];
    chip.classList.toggle("active", on);
    chip.classList.toggle("focused", chip.dataset.id === focused);
    chip.setAttribute("aria-pressed", String(on));
  });
}

function renderDetail() {
  const box = panel?.querySelector(".routes-detail");
  if (!box) return;
  const cfg = focused && config[focused];
  const line = cfg && lineById(focused);
  if (!line) {
    box.innerHTML = Object.keys(config).length
      ? `<p class="routes-hint">Toca una línea marcada para elegir sentido, días y variantes. Tócala otra vez para quitarla.</p>`
      : "";
    return;
  }
  const color = lineColor(line);
  const routes = loaded.get(focused);
  const visible = new Set(routes ? visibleRoutes(focused, routes).map((r) => Number(r.idtrayecto)) : []);
  const anyUnknown = routes?.some((r) => !r.dias?.length);
  const dirBtn = (dir, label) =>
    `<button type="button" class="routes-opt ${cfg.dirs.includes(dir) && !cfg.custom ? "on" : ""}" data-dir="${dir}">${label}</button>`;
  const dayBtns = DAY_OPTIONS.map(
    ([v, label]) => `<button type="button" class="routes-opt ${cfg.day === v && !cfg.custom ? "on" : ""}" data-day="${v}">${label}</button>`,
  ).join("");
  const variants = !routes
    ? `<p class="routes-hint">Cargando recorridos…</p>`
    : routes
        .slice()
        .sort((a, b) => a.direccion - b.direccion || a.idtrayecto - b.idtrayecto)
        .map((r) => {
          const id = Number(r.idtrayecto);
          const isBack = Number(r.direccion) === 2;
          const desc = cleanText(r.descripcion).replace(/^L-?\s*\w+\.\s*/i, "");
          const days = (r.dias || []).map((d) => `<span class="rv-day">${d}</span>`).join("");
          return `<label class="route-variant">
            <input type="checkbox" data-route="${id}" ${visible.has(id) ? "checked" : ""}>
            <span class="rv-line ${isBack ? "dashed" : ""}" style="--chip-color:${color}"></span>
            <span class="rv-body">
              <span class="rv-dest">${isBack ? "Vuelta" : "Ida"} → ${escapeHtml(cleanText(r.destino))}</span>
              <span class="rv-desc">${escapeHtml(desc)}</span>
              <span class="rv-days">${r.hoy ? `<span class="rv-day today">Hoy</span>` : ""}${days || `<span class="rv-day unknown">días sin datos</span>`}</span>
            </span>
          </label>`;
        })
        .join("");
  box.innerHTML = `
    <div class="routes-detail-head">
      <span class="route-badge" style="background:${color};color:${textOn(color)}">${escapeHtml(lineCode(line))}</span>
      <span class="routes-detail-name">${escapeHtml(cleanText(line.descripcion))}</span>
    </div>
    <div class="routes-row"><span class="routes-row-label">Sentido</span>${dirBtn(1, "Ida")}${dirBtn(2, "Vuelta")}</div>
    <div class="routes-row"><span class="routes-row-label">Días</span>${dayBtns}</div>
    ${cfg.custom ? `<button type="button" class="routes-btn routes-reset" data-act="reset">Volver a filtros</button>` : ""}
    ${routes && !visible.size ? `<p class="routes-hint">Ningún trayecto con estos filtros.</p>` : ""}
    <div class="routes-variants">${variants}</div>
    ${anyUnknown ? `<p class="routes-hint">Los días de cada variante se aprenden a diario: la API solo informa de los trayectos del día en curso.</p>` : ""}`;
}

function apply() {
  persist();
  updateChips();
  renderDetail();
  loadSelected();
}

function onChipClick(id) {
  if (!config[id]) {
    config[id] = defaultConfig();
    focused = id;
  } else if (focused !== id) {
    focused = id;
  } else {
    delete config[id];
    focused = null;
  }
  apply();
}

function onDetailClick(e) {
  const cfg = focused && config[focused];
  if (!cfg) return;
  const dirBtn = e.target.closest("[data-dir]");
  const dayBtn = e.target.closest("[data-day]");
  if (dirBtn) {
    const dir = Number(dirBtn.dataset.dir);
    const dirs = cfg.custom ? [dir] : cfg.dirs.includes(dir) ? cfg.dirs.filter((d) => d !== dir) : [...cfg.dirs, dir];
    cfg.dirs = dirs.length ? dirs.sort() : [dir === 1 ? 2 : 1];
    cfg.custom = null;
  } else if (dayBtn) {
    cfg.day = dayBtn.dataset.day;
    cfg.custom = null;
  } else if (e.target.closest('[data-act="reset"]')) {
    cfg.custom = null;
  } else {
    return;
  }
  apply();
}

function onVariantChange(e) {
  const cfg = focused && config[focused];
  if (!e.target.closest("[data-route]") || !cfg) return;
  cfg.custom = [...panel.querySelectorAll(".routes-variants [data-route]")]
    .filter((el) => el.checked)
    .map((el) => Number(el.dataset.route));
  apply();
}

function buildPanel() {
  panel = document.createElement("div");
  panel.className = "routes-panel hidden";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Recorridos de líneas");
  panel.innerHTML = `
    <div class="routes-panel-head">
      <span class="routes-panel-title">Recorridos</span>
      <button type="button" class="routes-btn" data-act="all">Todas</button>
      <button type="button" class="routes-btn" data-act="none">Ninguna</button>
      <button type="button" class="routes-btn routes-close" data-act="close" aria-label="Cerrar">✕</button>
    </div>
    <div class="routes-scroll">
      <div class="routes-chips"></div>
      <div class="routes-detail"></div>
    </div>`;
  const chips = panel.querySelector(".routes-chips");
  lines.forEach((l) => {
    const color = lineColor(l);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "route-chip";
    chip.dataset.id = String(l.idlinea);
    chip.title = cleanText(l.descripcion);
    chip.style.setProperty("--chip-color", color);
    chip.style.setProperty("--chip-text", textOn(color));
    chip.textContent = lineCode(l);
    chips.appendChild(chip);
  });
  panel.querySelector(".routes-panel-head").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "close") return togglePanel(false);
    if (act === "all") lines.forEach((l) => (config[String(l.idlinea)] ??= defaultConfig()));
    else if (act === "none") {
      config = {};
      focused = null;
    } else return;
    apply();
  });
  chips.addEventListener("click", (e) => {
    const chip = e.target.closest(".route-chip");
    if (chip) onChipClick(chip.dataset.id);
  });
  const detail = panel.querySelector(".routes-detail");
  detail.addEventListener("click", onDetailClick);
  detail.addEventListener("change", onVariantChange);
  document.body.appendChild(panel);
}

export function togglePanel(force) {
  if (!panel) return;
  const show = force ?? panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !show);
}

function loadConfig(valid) {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && typeof saved === "object") {
      return Object.fromEntries(Object.entries(saved).filter(([id]) => valid.has(id)));
    }
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]");
    localStorage.removeItem(LEGACY_KEY);
    return Object.fromEntries(legacy.map(String).filter((id) => valid.has(id)).map((id) => [id, defaultConfig()]));
  } catch {
    return {};
  }
}

export function initRouteSelector(allLines) {
  lines = (allLines || []).filter((l) => l?.idlinea != null).sort((a, b) => {
    const ka = sortKey(a), kb = sortKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
  });
  config = loadConfig(new Set(lines.map((l) => String(l.idlinea))));
  ctrlBtn = addRoutesControl(() => togglePanel());
  buildPanel();
  updateChips();
  renderDetail();
  if (Object.keys(config).length) loadSelected();
}
