# Plan de implementación — Pestaña PARADAS en barra inferior

**Cambio:** Añadir una quinta pestaña `Paradas` en la barra inferior de navegación
(`.bottom-nav`) que muestre, para una parada seleccionada, los **próximos buses
agrupados por línea y dirección**, con la hora estimada de paso.

**Alcance:** Solo la PWA webapp (`webapp/`). No toca backend.
**Idioma:** Español de España en todo el texto generado (UI, comentarios, docs).
**Arquitectura:** Vanilla JS + estado único en `main.js` (sin librería nueva).
**Fuente de datos por defecto:** predicciones en tiempo real (`getStopDetail`,
mismo endpoint que ya usa la vista `Llegadas`).

> **Nota sobre la fuente de datos:** el plan asume tiempo real (reutiliza lo
> existente). Si en algún momento prefieres horarios teóricos del planning
> oficial de EMTUSA (endpoint de líneas), se documenta como alternativa al
> final — solo cambia la tarea T3 sin afectar al resto.

---

## 0. Contexto previo (ya explorado)

- `webapp/index.html` líneas 680-712: bloque `<nav class="bottom-nav">` con 4 botones
  (Llegadas, Mapa, Ajustes, Alertas). Estructura repetible, mismo SVG inline +
  `<span>`.
- `webapp/src/main.js`: estado global en objeto `state`; las vistas se conmutan
  con `data-view` y clase `.active` sobre el `.nav-btn` correspondiente.
- `webapp/src/api.js` (líneas relevantes):
  - `getAllStops()` → `paradas/todasParadas` (catálogo, ya cacheado).
  - `getStopDetail(stopId)` → `paradas/parada/{id}` → array de llegadas con
    `line`, `route`, `destination`, `bus` y `time` (minutos).
  - `getStopLines(stopId)` → `paradas/lineasParada/{id}` (metadatos de línea).
  - `getStopRoutes(stopId)` → `paradas/trayectosParada/{id}` (direcciones).
- `webapp/src/ui.js`: ya existe un render de llegadas (`.arrival-row`) y
  agrupación en "modo transbordo" — base visual a reutilizar.
- `webapp/src/style.css`: variable `--bottom-nav-height: 68px`; clase
  `.bottom-nav` con `display: flex`; clase `.nav-btn.active` con `color:
  var(--accent)`. Reutilizar convenciones.
- `CLAUDE.md` reglas que aplican:
  - CSS Grid 4×3 para `.arrival-row` (reutilizar patrón).
  - Tiempo siempre 2 dígitos con `padStart(2,"0")`.
  - `fixText()` obligatorio en `destination` y `stopName`.
  - Tipografía mínima 16px, alto contraste en ambos temas.
  - Nada por debajo de `--bottom-nav-height` debe quedar tapado.

---

## 1. Descomposición de tareas

Las tareas están numeradas para mantener dependencias explícitas. Cada una
termina con un **criterio de aceptación** verificable.

### T1 · Añadir botón PARADAS al DOM de la barra inferior
**Tipo:** HTML estático. **Estimación:** XS.
**Dependencias:** ninguna.
**Archivos:** `webapp/index.html` (insertar entre el botón Mapa y Ajustes, o
después de Alertas — ver decisión D1).

Pasos:
1. Copiar la estructura exacta de un `<button class="nav-btn" data-view="...">`
   existente (mismo SVG inline + `<span>`).
2. `data-view="stops"`, `id="nav-stops"`.
3. Etiqueta visible: `Paradas` (español de España, sin artículos).
4. Icono SVG: una chincheta/marker tipo `M12 2C8 2 5 5 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-4-3-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z`
   (mapa-pin estándar, coherente con el icono "Mapa" pero diferenciado).
5. No añadir JS aquí: el handler de conmutación de vista ya recorre los
   `data-view` existentes, pero hay que verificar que el switch lo coge
   automáticamente (ver T2).

**Criterio de aceptación:** el botón aparece visualmente en la barra inferior
con el icono y la etiqueta `Paradas`, en la misma fila que los otros 4.

---

### T2 · Registrar la vista `stops` en el conmutador de main.js
**Tipo:** JS estado + handler. **Estimación:** S.
**Dependencias:** T1.
**Archivos:** `webapp/src/main.js`.

Pasos:
1. Localizar el handler que cambia `state.view` y aplica `.active` al nav-btn
   (buscar `data-view` y `classList.toggle('active', ...)` en `main.js`).
2. Confirmar que el switch ya cubre cualquier `data-view` (suele ser un
   `if/else` por valor). Si no lo cubre, añadir rama `case "stops"` (o
   `else if` según el patrón actual).
3. Añadir bloque DOM en `index.html` con `id="view-stops" class="view"`
   (mismo patrón que `view-list`, `view-map`, etc.). Dentro, dejar un
   contenedor vacío `<div id="stops-content"></div>` que T4 rellenará.
4. Asegurar que `state.view = "stops"` aplica la clase activa al nav-btn
   correspondiente.
5. Asegurar que el FAB del asistente IA sigue oculto en `stops` (regla
   `CLAUDE.md`: solo visible en `list` y `map`). Comprobar el predicado
   actual y, si es un check explícito, añadir `"stops"` a la lista de
   exclusión o, si es `!== "settings" && !== "alerts"`, dejarlo como está
   y verificar manualmente.
6. Asegurar que la barra inferior y el header no se ocultan al cambiar a
   `stops` (la regla `bottom: var(--bottom-nav-height)` del header debe
   seguir aplicando).

**Criterio de aceptación:** al pulsar el botón Paradas, el contenido de
`#view-stops` se muestra y los otros paneles se ocultan; el botón
`#nav-stops` queda con clase `active`.

---

### T3 · Nuevo método de API: `getStopArrivalsGrouped(stopId)`
**Tipo:** JS wrapper. **Estimación:** S.
**Dependencias:** ninguna (pero se invoca desde T5).
**Archivos:** `webapp/src/api.js`.

Pasos:
1. Crear función exportada `getStopArrivalsGrouped(stopId)` que:
   - Llama a `getStopDetail(stopId)` (mismo endpoint que ya usa Llegadas).
   - La API devuelve `{ idparada, descripcion, llegadas: [{ linea:{codigo,idlinea,descripcion,colorhex}, trayecto:{destino,idtrayecto?}, minutos, distancia }] }` — FORMA REAL, anidada, NO plana como se asumió inicialmente.
   - Agrupa `llegadas` por (line + route): clave = `${line}__${idtrayecto}` si existe, sino `${line}__${destino.toLowerCase()}`.
   - Devuelve un objeto con forma:
     ```js
     {
       stopId,
       stopName,           // tras fixText
       fetchedAt: Date.now(),
       groups: [
         {
           line: "L12",           // id de línea
           lineName: "Línea 12",  // nombre legible, tras fixText
           route: 1,              // id de dirección
           destination: "Centro", // tras fixText
           arrivals: [
             { bus: 4521, minutes: 3, real: true },
             { bus: 4524, minutes: 12, real: true }
           ]
         }
         // … más grupos ordenados por línea, luego por menor tiempo
       ]
     }
     ```
2. Aplicar `fixText` a `destination` y `stopName` antes de devolver.
3. Ordenar `groups` por `line` (numérico si posible, luego lexicográfico) y
   dentro de cada grupo, `arrivals` por `minutes` ascendente.
4. Si `getStopDetail` lanza, propagar el error (el caller T5 decide qué
   mostrar).
5. **No** cachear el resultado aquí: el refresco de la UI ya tiene su
   temporizador global.

**Criterio de aceptación:** una llamada de prueba desde consola
(`getStopArrivalsGrouped("220")`) devuelve la estructura esperada con
`fixText` aplicado.

---

### T4 · Selector de parada (cabecera de la vista Paradas)
**Tipo:** UI + estado. **Estimación:** M.
**Dependencias:** T2, T3.
**Archivos:** `webapp/src/ui.js`, `webapp/src/style.css`, `webapp/src/main.js`.

Pasos:
1. Crear función `renderStopsHeader(container)` que pinta:
   - Etiqueta: `Parada` (sin icono lupa, igual que la barra de búsqueda
     de Llegadas, regla `CLAUDE.md`).
   - `<input id="stops-stop-input">` con `placeholder="Busca por nombre o
     número…"`.
   - Botón `📍 Usar mi ubicación` (mismo componente que ya existe para
     geolocalización en `geo.js`, reutilizar).
2. Debajo, un `<div id="stops-stop-info">` para mostrar el nombre y número
   de la parada seleccionada (cuando exista).
3. Estado nuevo en `main.js`:
   - `state.stops.selectedStopId` (string, persiste en `localStorage`
     clave `bus_selected_stop`).
   - `state.stops.selectedStopName` (string cacheado, se actualiza al
     seleccionar).
4. Lógica de selección:
   - Si hay `state.stops.selectedStopId` al entrar en la vista → recargar
     llegadas automáticamente.
   - Si no hay ninguno y hay geolocalización → proponer la parada más
     cercana.
   - El input tiene `input` event con debounce 250 ms que filtra la lista
     de paradas (reutilizar `state.allStops` que ya existe) y muestra un
     `<datalist>` o lista de sugerencias debajo (patrón idéntico al de la
     búsqueda de Llegadas — extraer a helper si todavía no lo es).
5. CSS: la cabecera debe respetar la regla
   `top: var(--header-height); bottom: var(--bottom-nav-height);` para que
   nada quede tapado.

**Criterio de aceptación:** al entrar por primera vez en Paradas con
geolocalización activa, se autoselecciona la parada más cercana; el
selector permite cambiarla; la selección persiste tras recargar.

---

### T5 · Render de llegadas agrupadas por línea/dirección
**Tipo:** UI render. **Estimación:** M.
**Dependencias:** T3, T4.
**Archivos:** `webapp/src/ui.js`, `webapp/src/style.css`.

Pasos:
1. Crear función `renderStopsArrivals(container, data)` que pinta los
   `groups` como tarjetas:
   - Cabecera de grupo: badge cuadrado de línea (mismas reglas CSS que
     `.arrival-row` col1: `aspect-ratio:1`, color de línea,
     `min-width: 58px`, `font-size: 21px/24px`) + nombre de la línea +
     destino entre guiones (ej. `L12 — Centro`).
   - Lista de próximas llegadas de esa línea, en horizontal (chips de
     tiempo): `08`, `23`, `…` con el mismo formato `padStart(2,"0")` que
     ya usa Llegadas.
   - Color del chip de tiempo según reglas existentes (`--success`,
     `--warning`, `--accent`) — el slider de Ajustes ya las controla.
2. Si una línea tiene 0 llegadas, mostrar el grupo con un texto
   `Sin buses próximos` (no ocultar la línea, el usuario quiere saber
   que esa línea existe en esa parada).
3. Si no hay parada seleccionada, mostrar estado vacío: ilustración
   mínima (solo texto: `Selecciona una parada para ver los próximos
   buses.`) — sin emojis decorativos (regla `CLAUDE.md` implícita:
   minimal visual noise para uso exterior con luz intensa).
4. Si la llamada a T3 falla, mostrar mensaje de error con botón
   `Reintentar` (mismo patrón de error que ya hay en Llegadas).
5. **Reutilizar `.arrival-row`** solo donde tenga sentido; la nueva
   tarjeta es distinta (no es una sola fila, es un grupo) → crear
   `.stop-group` y `.stop-group__time-chips` en `style.css`. Mantener
   coherencia visual con el resto (mismo `var(--bg-secondary)`, mismo
   `border-radius`, mismo `padding`).
6. Respetar el slider de tamaño de fuente (16-22px) — usar `rem` o
   `var(--font-size-base, 16px)` igual que el resto.

**Criterio de aceptación:** con una parada seleccionada, la vista
muestra un grupo por cada línea/dirección con los próximos tiempos en
chips, ordenados por menor tiempo dentro de cada grupo.

---

### T6 · Integrar con el ciclo de refresco global
**Tipo:** JS orquestación. **Estimación:** S.
**Dependencias:** T2, T5.
**Archivos:** `webapp/src/main.js`.

Pasos:
1. Localizar el temporizador global que ya llama a `loadAllArrivals()`
   cada N segundos (regla `CLAUDE.md`: configurable 30s – 30min).
2. Dentro del mismo tick, **solo si** `state.view === "stops"` y
   `state.stops.selectedStopId` existe, llamar a
   `getStopArrivalsGrouped(state.stops.selectedStopId)` y repintar
   `#stops-content` con el resultado.
3. Cuando el usuario entra a la vista `stops` por primera vez con una
   parada seleccionada, forzar un fetch inmediato (no esperar al
   próximo tick).
4. Cuando cambia a otra vista, **no** abortar el fetch en curso (es
   barato y el resultado se ignora si ya no está en `stops`).
5. La cuenta atrás del badge `#refresh-timer` debe funcionar igual
   (no es específico de vista).

**Criterio de aceptación:** la lista de Paradas se actualiza junto con
el resto cuando el temporizador dispara; pausar el refresco detiene
también esta vista; cambiar de pestaña no pierde la selección.

---

### T7 · Pruebas manuales + captura de evidencia
**Tipo:** QA. **Estimación:** S.
**Dependencias:** T1-T6.
**Archivos:** ninguno (solo ejecución + reporte).

Pasos:
1. Build: `npm run build` desde `webapp/` — sin errores.
2. Dev: `npm run dev` — abrir en navegador.
3. Casos a verificar visualmente:
   - [ ] La pestaña `Paradas` aparece en la barra inferior, en la posición
         acordada (D1).
   - [ ] Al pulsarla, se muestra la vista con el selector de parada.
   - [ ] Geolocalización propone la parada más cercana automáticamente.
   - [ ] Búsqueda por nombre y por número funcionan.
   - [ ] Cada grupo muestra badge de línea con color y nombre de
         destino correctos.
   - [ ] Los chips de tiempo se actualizan en el siguiente tick del
         temporizador.
   - [ ] Tema claro y tema oscuro: contraste correcto (texto mínimo
         16px, sin grises similares sobre fondo).
   - [ ] Slider de tamaño de fuente: las tarjetas escalan correctamente.
   - [ ] El FAB del asistente IA no aparece en Paradas.
   - [ ] El header de refresco sigue visible y clic-pausa funciona.
4. Capturar 2 screenshots (claro + oscuro) con parada seleccionada y
   guardarlos en `screenshots/`.

**Criterio de aceptación:** checklist completa + 2 screenshots en
`screenshots/`.

---

### T8 · Entrada en `LEARNING_LOG.md` y commit
**Tipo:** Docs + Git. **Estimación:** XS.
**Dependencias:** T7.
**Archivos:** `webapp/LEARNING_LOG.md` (o donde esté — buscar antes),
commits separados.

Pasos:
1. Crear entrada siguiendo la plantilla del repo (secciones: Objetivo,
   Razonamiento, Conceptos Clave, según `CLAUDE.md`).
2. Commits siguiendo `work-unit-commits` (tareas grandes separadas):
   - `feat(nav): add Paradas tab to bottom navigation` (T1+T2)
   - `feat(api): add getStopArrivalsGrouped helper` (T3)
   - `feat(stops): add stop selector and arrivals-by-line view` (T4+T5)
   - `feat(refresh): integrate stops view with global refresh cycle` (T6)
   - `docs(stops): add screenshots and learning log entry` (T7+T8)
3. Mensajes en español (regla del repo), conventional commits.

**Criterio de aceptación:** 5 commits limpios, `LEARNING_LOG.md`
actualizado, `git log --oneline` muestra la secuencia.

---

## 2. Decisiones pendientes (marca el camino)

### D1 · Posición del botón Paradas en la barra
Opciones:
- **(a) Entre Mapa y Ajustes** — equilibrio: tras la experiencia de uso
  principal (ver, localizar) viene la consulta profunda.
- **(b) Después de Alertas** — al final, separada de las operativas.
- **(c) Reordenar a: Llegadas / Paradas / Mapa / Alertas / Ajustes** —
  prioriza Paradas sobre Mapa.

**Recomendación por defecto:** (a) — mínimo cambio, máxima coherencia
con el flujo natural del usuario (consulta → ubicación → info detallada).

### D2 · Fuente de datos: real vs teórico
Por defecto **tiempo real** (reutiliza `getStopDetail` y el ciclo de
refresco). Si prefieres **horarios teóricos** del planning oficial:

- Cambiar T3 para que invoque `getLineDetail(lineId)` por cada línea de
  la parada y extraiga el array de horarios programados.
- Eliminar T6 (no hay refresco de tiempo real) → refresco a 1 vez al
  entrar a la vista, o manual con botón.
- T5: en lugar de chips por `minutes`, generar chips para las próximas
  N horas desde `now()` cruzando con la hora actual.

El resto del plan (T1, T2, T4, T7, T8) no cambia.

### D3 · Geolocalización al entrar
¿Forzar la parada más cercana al entrar por primera vez, o mostrar
siempre el selector vacío hasta que el usuario elija? Por defecto:
**forzar si hay permiso de geolocalización**, en caso contrario dejar
el selector vacío. Cambiar este default si quieres otro comportamiento.

### D4 · Persistencia de la selección
Por defecto: `state.stops.selectedStopId` se guarda en `localStorage`
(clave `bus_selected_stop`) y se restaura al recargar. Si prefieres
que se resetee siempre, eliminar la lectura/escritura de
`localStorage` en T4.

---

## 3. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|-----------|
| `getStopDetail` falla intermitente (5xx, timeout) | Media | Medio | T7 ya tiene botón `Reintentar`; además el ciclo de refresco reintenta solo en el próximo tick. |
| Paradas con 10+ líneas distintas saturan la pantalla | Media | Bajo | Plegar/expandir cada grupo si supera 4 grupos visibles; o scroll vertical nativo (ya funciona). |
| El slider de tamaño de fuente rompe la grid de chips | Baja | Medio | Usar `flex-wrap: wrap` en `.stop-group__time-chips` y `min-width` por chip. Verificar en T7. |
| Tema claro con bajo contraste en exterior (luz intensa) | Baja | Alto | T7 incluye revisión de contraste explícita; ajustar `--text-primary` y `--bg-secondary` si hace falta. |
| Geolocalización denegada → usuario perdido sin selección | Media | Bajo | Mostrar estado vacío claro con CTA "Buscar parada por nombre o número". |
| Latencia del API al cambiar de parada (spinner necesario) | Media | Bajo | Añadir spinner skeleton en T5 mientras se carga; el ya existe patrón en Llegadas. |

---

## 4. Resumen de estimación

| Tarea | Tamaño | Acumulado |
|-------|--------|-----------|
| T1 — DOM botón | XS | 0.5 h |
| T2 — Conmutador main.js | S | 1.5 h |
| T3 — getStopArrivalsGrouped | S | 2.5 h |
| T4 — Selector de parada | M | 4 h |
| T5 — Render por línea | M | 6 h |
| T6 — Refresco global | S | 7 h |
| T7 — Pruebas + screenshots | S | 8 h |
| T8 — Docs + commits | XS | 8.5 h |

**Total:** ~8.5 h de trabajo. Encaja en una sesión de @Coder + revisión
de @QA.

---

## 5. Orden de ejecución recomendado

```
T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8
```

T1+T2 pueden ir juntos en un commit (`feat(nav)`). T3 aislada
(`feat(api)`). T4+T5 juntas (`feat(stops)`). T6 aparte (`feat(refresh)`).
T7+T8 al final.

---

## 6. Notas de arquitectura (para el Educator)

- **Por qué estado único en `main.js`:** la app ya lo hace (regla
  `CLAUDE.md`). Añadir un nuevo slice `state.stops.*` mantiene la
  coherencia y evita introducir un store externo (Redux, etc.).
- **Por qué reusar `getStopDetail`:** cero impacto en backend, una
  sola fuente de verdad, y la API EMTUSA ya devuelve datos con la
  granularidad necesaria.
- **Por qué no introducir un componente nuevo (lit, preact, etc.):** la
  app es vanilla JS por diseño. Meter un framework solo para esta
  vista sería sobrediseño.
- **Por qué agrupar por `line + route`:** el modo transbordo existente
  ya agrupa por línea, lo que valida la metáfora para el usuario.
  Añadir `route` (dirección) es lo que diferencia Paradas de Llegadas.

---

## 7. Nota sobre cobertura de UI (sin tests automatizados)

- **No hay test runner** en `webapp/package.json` (solo `dev` / `build` /
  `preview` de Vite). El repo funciona con `npm run build` como única
  verificación de cordura.
- Por tanto, los cambios de layout de las tarjetas de llegadas
  (mover fav/alert a la fila bajo el `arrival-stop-name` y agrandar
  los iconos) **no se prueban de forma automatizada**. La verificación
  es manual en navegador (captura de pantalla) + `npm run build` para
  asegurar que la build de producción sigue compilando.
- Cuando el proyecto añada un test runner (vitest/jsdom sería la
  opción más natural), snapshot tests sobre el HTML que devuelve
  `renderArrivals()` cubrirían la regresión visual a coste bajo.
