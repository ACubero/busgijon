"""Recorridos de líneas: descubre trayectos en EMTUSA, ajusta a calles con OSRM y cachea en SQLite."""

import asyncio
import hashlib
import json
import time
from datetime import date, timedelta

import aiosqlite
import httpx

from app.config import settings
from app.emtusa_client import emtusa_client

CHUNK_SIZE = 25
CACHE_TTL_S = 7 * 24 * 3600
PROBE_BATCH = 8
PROBE_GAP = 8
PROBE_MIN = 24
PROBE_MAX_ID = 200
OSRM_MIN_INTERVAL_S = 1.0

_line_locks: dict[int, asyncio.Lock] = {}
_osrm_lock = asyncio.Lock()
_osrm_last = 0.0

Point = tuple[float, float]
DAY_TYPES = ("L", "S", "D")
FIXED_HOLIDAYS = {(1, 1), (1, 6), (5, 1), (8, 15), (9, 8), (10, 12), (11, 1), (12, 6), (12, 8), (12, 25)}
_recorded: dict[int, str] = {}


def _easter(year: int) -> date:
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    g = (8 * b + 13) // 25
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 19 * l) // 433
    month = (h + l - 7 * m + 90) // 25
    return date(year, month, (h + l - 7 * m + 33 * month + 19) % 32)


def day_type(day: date) -> str:
    """L = laborable, S = sábado, D = domingo o festivo (nacional/Asturias)."""
    easter = _easter(day.year)
    if day.weekday() == 6 or (day.month, day.day) in FIXED_HOLIDAYS or day in (
        easter - timedelta(days=3), easter - timedelta(days=2)
    ):
        return "D"
    return "S" if day.weekday() == 5 else "L"


def _line_detail(data) -> dict:
    if isinstance(data, list):
        return data[0] if data and isinstance(data[0], dict) else {}
    return data.get("0", data) if isinstance(data, dict) else {}


def chunk_waypoints(pts: list[Point], size: int = CHUNK_SIZE) -> list[list[Point]]:
    if len(pts) <= size:
        return [pts]
    chunks, start = [], 0
    while start < len(pts) - 1:
        chunks.append(pts[start : start + size])
        start += size - 1
    return chunks


def stops_hash(pts: list[Point]) -> str:
    return hashlib.sha1(json.dumps(pts).encode()).hexdigest()


async def _osrm_route(pts: list[Point]) -> list[list[float]]:
    global _osrm_last
    async with _osrm_lock:
        wait = OSRM_MIN_INTERVAL_S - (time.monotonic() - _osrm_last)
        if wait > 0:
            await asyncio.sleep(wait)
        coords = ";".join(f"{lng},{lat}" for lat, lng in pts)
        url = f"{settings.osrm_url.rstrip('/')}/route/v1/driving/{coords}"
        async with httpx.AsyncClient(timeout=20.0, headers={"User-Agent": "busgijon/0.1"}) as client:
            resp = await client.get(url, params={"overview": "full", "geometries": "geojson"})
        _osrm_last = time.monotonic()
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != "Ok" or not data.get("routes"):
        raise RuntimeError(f"OSRM: {data.get('code')}")
    return [[round(lat, 5), round(lng, 5)] for lng, lat in data["routes"][0]["geometry"]["coordinates"]]


async def snap(pts: list[Point]) -> tuple[list[list[float]], bool]:
    try:
        out: list[list[float]] = []
        for chunk in chunk_waypoints(pts):
            part = await _osrm_route(chunk)
            out.extend(part[1:] if out and part and part[0] == out[-1] else part)
        return out, True
    except Exception:
        return [[lat, lng] for lat, lng in pts], False


def _stop_points(route: dict) -> tuple[list[dict], list[Point]]:
    stops, pts = [], []
    for p in route.get("paradas") or []:
        try:
            lat, lng = float(p["latitud"]), float(p["longitud"])
        except (KeyError, TypeError, ValueError):
            continue
        stops.append({"id": p.get("idParada"), "nombre": p.get("descripcion"), "lat": lat, "lng": lng})
        pts.append((lat, lng))
    return stops, pts


async def _fetch_route(line_id: int, route_id: int) -> dict | None:
    try:
        data = await emtusa_client.get(f"trayectos/trayectos/{line_id}/{route_id}")
    except Exception:
        return None
    route = data.get("0", data) if isinstance(data, dict) else None
    if route and route.get("idtrayecto") and route.get("paradas"):
        return route
    return None


async def discover_routes(line_id: int) -> list[dict]:
    known: list[int] = []
    try:
        detail = _line_detail(await emtusa_client.get(f"lineas/lineas/{line_id}"))
        known = [int(t["idtrayecto"]) for t in detail.get("trayectos") or [] if t.get("idtrayecto")]
    except Exception:
        pass
    found: list[dict] = []
    limit = max([PROBE_MIN, *known]) + PROBE_GAP
    start = 1
    while start <= min(limit, PROBE_MAX_ID):
        ids = list(range(start, start + PROBE_BATCH))
        results = await asyncio.gather(*(_fetch_route(line_id, i) for i in ids))
        for rid, route in zip(ids, results):
            if route:
                found.append(route)
                limit = max(limit, rid + PROBE_GAP)
        start += PROBE_BATCH
    return sorted(found, key=lambda r: r["idtrayecto"])


async def _load_cached(line_id: int) -> tuple[list[dict], float] | None:
    async with aiosqlite.connect(settings.db_path) as db:
        cur = await db.execute("SELECT data, updated_at FROM route_shapes WHERE line_id = ?", (line_id,))
        row = await cur.fetchone()
    return (json.loads(row[0]), row[1]) if row else None


async def _store(line_id: int, routes: list[dict]) -> None:
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute(
            "INSERT OR REPLACE INTO route_shapes (line_id, data, updated_at) VALUES (?, ?, ?)",
            (line_id, json.dumps(routes), time.time()),
        )
        await db.commit()


async def get_line_routes(line_id: int, force: bool = False) -> list[dict]:
    lock = _line_locks.setdefault(line_id, asyncio.Lock())
    async with lock:
        cached = await _load_cached(line_id)
        if cached and not force and time.time() - cached[1] < CACHE_TTL_S:
            return cached[0]
        previous = {r["hash"]: r for r in (cached[0] if cached else []) if r.get("snapped")}
        out = []
        for route in await discover_routes(line_id):
            stops, pts = _stop_points(route)
            if len(pts) < 2:
                continue
            h = stops_hash(pts)
            if h in previous:
                coords, snapped = previous[h]["coords"], True
            else:
                coords, snapped = await snap(pts)
            out.append({
                "idtrayecto": route["idtrayecto"],
                "codigo": route.get("codPublicoLinea"),
                "descripcion": route.get("descripcion"),
                "direccion": route.get("direccion"),
                "destino": route.get("destino"),
                "hash": h,
                "snapped": snapped,
                "coords": coords,
                "stops": stops,
            })
        if out:
            await _store(line_id, out)
        elif cached:
            return cached[0]
        return out


async def record_today(line_id: int, today: date | None = None) -> None:
    """Registra qué trayectos circulan hoy (la API solo da los del día) por tipo de día."""
    today = today or date.today()
    iso = today.isoformat()
    if _recorded.get(line_id) == iso:
        return
    detail = _line_detail(await emtusa_client.get(f"lineas/lineas/{line_id}"))
    ids = {int(t["idtrayecto"]) for t in detail.get("trayectos") or [] if t.get("idtrayecto")}
    async with aiosqlite.connect(settings.db_path) as db:
        await db.executemany(
            "INSERT OR REPLACE INTO route_days (line_id, route_id, day_type, last_seen) VALUES (?, ?, ?, ?)",
            [(line_id, rid, day_type(today), iso) for rid in ids],
        )
        await db.commit()
    _recorded[line_id] = iso


async def attach_days(line_id: int, routes: list[dict], today: date | None = None) -> list[dict]:
    """Copia de `routes` con `dias` (tipos de día observados) y `hoy`."""
    iso = (today or date.today()).isoformat()
    async with aiosqlite.connect(settings.db_path) as db:
        cur = await db.execute(
            "SELECT route_id, day_type, last_seen FROM route_days WHERE line_id = ?", (line_id,)
        )
        rows = await cur.fetchall()
    days: dict[int, set[str]] = {}
    seen_today: set[int] = set()
    for rid, dt, last in rows:
        days.setdefault(rid, set()).add(dt)
        if last == iso:
            seen_today.add(rid)
    return [
        {
            **r,
            "dias": [d for d in DAY_TYPES if d in days.get(int(r["idtrayecto"]), set())],
            "hoy": int(r["idtrayecto"]) in seen_today,
        }
        for r in routes
    ]


async def get_line_routes_with_days(line_id: int) -> list[dict]:
    try:
        await record_today(line_id)
    except Exception as e:
        print(f"[routes] días L{line_id}: {e}")
    return await attach_days(line_id, await get_line_routes(line_id))


async def get_all_cached() -> dict[str, list[dict]]:
    async with aiosqlite.connect(settings.db_path) as db:
        cur = await db.execute("SELECT line_id, data FROM route_shapes")
        rows = await cur.fetchall()
    return {str(r[0]): json.loads(r[1]) for r in rows}


async def _line_ids() -> list[int]:
    data = await emtusa_client.get("lineas/lineas")
    lines = data.get("lineas", data) if isinstance(data, dict) else data
    items = lines.values() if isinstance(lines, dict) else lines
    return sorted({int(l["idlinea"]) for l in items if isinstance(l, dict) and l.get("idlinea")})


async def prefetch_loop() -> None:
    """Cada 3 h: registra trayectos del día y recalcula recorridos caducados."""
    while True:
        try:
            for line_id in await _line_ids():
                try:
                    await record_today(line_id)
                    await get_line_routes(line_id)
                except Exception as e:
                    print(f"[routes] línea {line_id}: {e}")
        except Exception as e:
            print(f"[routes] prefetch: {e}")
        await asyncio.sleep(3 * 3600)
