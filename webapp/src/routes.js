/**
 * routes.js — Selector de recorridos de líneas en el mapa (una, varias, todas o ninguna).
 * Persiste la selección (idlinea) en localStorage `bus_map_lines`.
 */

import { getLineRoutes } from "./api.js";
import { addRoutesControl, setRouteLines } from "./map.js";

const STORAGE_KEY = "bus_map_lines";
const CONCURRENCY = 3;

let lines = [];
let selected = new Set();
let ctrlBtn = null;
let panel = null;
let renderToken = 0;

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
  const num = parseInt(code.replace(/\D/g, ""), 10) || 0;
  return [/^\d/.test(code) ? 0 : 1, num, code];
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...selected]));
}

function updateCounter() {
  if (ctrlBtn) ctrlBtn.textContent = selected.size ? `Líneas (${selected.size})` : "Líneas";
  panel?.querySelectorAll(".route-chip").forEach((chip) => {
    const on = selected.has(chip.dataset.id);
    chip.classList.toggle("active", on);
    chip.setAttribute("aria-pressed", String(on));
  });
}

function setChipLoading(id, loading) {
  panel?.querySelector(`.route-chip[data-id="${id}"]`)?.classList.toggle("loading", loading);
}

async function render() {
  const token = ++renderToken;
  const chosen = lines.filter((l) => selected.has(String(l.idlinea)));
  const results = new Map();
  const queue = [...chosen];
  const draw = () => {
    if (token !== renderToken) return;
    setRouteLines(
      chosen
        .filter((l) => results.has(String(l.idlinea)))
        .map((l) => ({ code: lineCode(l), color: lineColor(l), routes: results.get(String(l.idlinea)) })),
    );
  };
  draw();
  const worker = async () => {
    while (queue.length) {
      const l = queue.shift();
      const id = String(l.idlinea);
      setChipLoading(id, true);
      try {
        results.set(id, await getLineRoutes(id));
      } catch (e) {
        console.warn(`[Recorridos] L${lineCode(l)}`, e);
      }
      setChipLoading(id, false);
      draw();
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

function apply() {
  persist();
  updateCounter();
  render();
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
    <div class="routes-chips"></div>`;
  const chips = panel.querySelector(".routes-chips");
  lines.forEach((l) => {
    const color = lineColor(l);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "route-chip";
    chip.dataset.id = String(l.idlinea);
    chip.title = l.descripcion || "";
    chip.style.setProperty("--chip-color", color);
    chip.style.setProperty("--chip-text", textOn(color));
    chip.textContent = lineCode(l);
    chips.appendChild(chip);
  });
  panel.addEventListener("click", (e) => {
    const chip = e.target.closest(".route-chip");
    if (chip) {
      const id = chip.dataset.id;
      selected.has(id) ? selected.delete(id) : selected.add(id);
      return apply();
    }
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "all") selected = new Set(lines.map((l) => String(l.idlinea)));
    else if (act === "none") selected = new Set();
    else if (act === "close") return togglePanel(false);
    else return;
    apply();
  });
  document.body.appendChild(panel);
}

export function togglePanel(force) {
  if (!panel) return;
  const show = force ?? panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !show);
}

export function initRouteSelector(allLines) {
  lines = (allLines || []).filter((l) => l?.idlinea != null).sort((a, b) => {
    const ka = sortKey(a), kb = sortKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
  });
  const valid = new Set(lines.map((l) => String(l.idlinea)));
  try {
    selected = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]").map(String).filter((id) => valid.has(id)));
  } catch {
    selected = new Set();
  }
  ctrlBtn = addRoutesControl(() => togglePanel());
  buildPanel();
  updateCounter();
  if (selected.size) render();
}
