# Plan — Recorridos de líneas en el mapa

**Objetivo:** dibujar en el mapa el recorrido de las líneas; selector multi (una, varias, todas, ninguna).
**Alcance:** `webapp/` + `backend/` (solo si D1=B).

## 0. Contexto
- API EMTUSA NO da geometría. `trayectos/trayectos/{linea}/{trayecto}` → `paradas[]` ordenadas con `latitud/longitud`, `direccion`, `destino`.
- `getLineDetail(lineId)` (`api.js:242`) ya lista todos los trayectos (incl. `noCirculaHoy`); `getRouteStops()` (`api.js:260`) da paradas.
- Colores: `lineas/lineas` → `colorhex`; `buildLineColorMap()` en `main.js:535`.
- `map.js`: capas `stopMarkersLayer`, `busMarkersLayer`; leaflet-rotate activo.

## Decisiones pendientes
- **D1 Geometría:** A) polilínea recta entre paradas (rápido, corta manzanas) · B) ajustada a calles vía OSRM en backend + caché (recomendado; A como fallback) · C) `shapes.txt` de GTFS oficial si existe (ver T0).
- **D2** ¿Filtrar buses/paradas del mapa por líneas seleccionadas? (def: no).
- **D3** Selección por defecto: ninguna.
- **D4** Selector: control flotante en el mapa (def) vs Ajustes.

## Tareas
- **T0** Verificar si EMTUSA publica GTFS con `shapes.txt` (datos abiertos Gijón / NAP). Si sí → D1=C, T1 lee GTFS.
- **T1 (backend, TDD)** `GET /api/routes/{idlinea}` → `[{idtrayecto, direccion, destino, coords:[[lat,lng]], stops:[{id,lat,lng,nombre}]}]`.
  - Trayectos vía `emtusa_client` (misma lógica de descubrimiento de ids que `getLineDetail`).
  - Snapping OSRM `route/v1/driving` por tramos (≤25 waypoints, `overview=full`, `geometries=polyline`); fallo → rectas.
  - Caché SQLite `route_shapes(idlinea, idtrayecto, stops_hash, coords, updated_at)`, TTL 7 d; invalida si cambia `stops_hash`.
  - `GET /api/routes` (todas) desde caché; precálculo en arranque/diario en `poller.py`.
  - Tests pytest: parseo, troceo, fallback, caché.
- **T2 (api.js)** `getLineRoutes(idlinea)` / `getAllRoutes()`; caché en memoria + `localStorage` (`bus_route_shapes`, versionada).
- **T3 (map.js)** `routesLayer` en pane propio (zIndex bajo paradas), renderer `L.canvas()`.
  - `setRouteLines(routesByLine, colorMap)`: polilínea color de línea, `weight 6` + contorno blanco/negro (contraste exterior); vuelta (`direccion 2`) discontinua; tooltip `L{código} → destino`.
  - `clearRouteLines()`, `fitToRoutes()` opcional.
- **T4 (UI)** Botón control Leaflet `Líneas` → bottom-sheet con chips por línea (color + código, ≥21px, área táctil ≥44px), toggle multi; botones `Todas` / `Ninguna`; contador en el botón.
- **T5 (estado, main.js)** `state.map.visibleLines: Set`; persistir `bus_map_lines`; carga perezosa al seleccionar; `Todas` en lotes de 3; indicador de carga por chip.
- **T6** D2 si aplica: filtrar `setBusMarkers`/`setStopMarkers` por `visibleLines`.
- **T7** Tema claro/oscuro y rotación: verificar visibilidad y que polilíneas rotan con el mapa.
- **T8** Docs: `CLAUDE.md` (módulos/endpoint), `LEARNING_LOG.md`; `npm run build`; deploy (`/home/hermes/scripts/busgijon-deploy`); commit.

## Orden
T0 → (D1) → T1 → T2 → T3 → T5 → T4 → T6 → T7 → T8. Con D1=A: saltar T1, T2 usa `getRouteStops`.
