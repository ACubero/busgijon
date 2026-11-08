"""Tests de recorridos de líneas: troceo, ajuste OSRM, fallback y caché."""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app import route_shapes
from app.main import app


def _route(rid: int, n: int = 3, direccion: int = 1) -> dict:
    return {
        "idtrayecto": rid,
        "idlinea": 1,
        "codPublicoLinea": "1",
        "descripcion": "L-1",
        "direccion": direccion,
        "destino": f"DEST{rid}",
        "paradas": [
            {"idParada": 100 + i, "descripcion": f"P{i}", "latitud": f"43.5{i}", "longitud": f"-5.7{i}"}
            for i in range(n)
        ],
    }


def test_chunk_waypoints_overlaps_last_point():
    pts = [(float(i), 0.0) for i in range(30)]
    chunks = route_shapes.chunk_waypoints(pts, size=25)
    assert len(chunks) == 2
    assert chunks[0][-1] == chunks[1][0]
    assert sum(len(c) for c in chunks) == 31


def test_chunk_waypoints_short():
    pts = [(0.0, 0.0), (1.0, 1.0)]
    assert route_shapes.chunk_waypoints(pts) == [pts]


def test_stops_hash_changes_with_stops():
    a = route_shapes.stops_hash([(1.0, 2.0), (3.0, 4.0)])
    b = route_shapes.stops_hash([(1.0, 2.0), (3.0, 5.0)])
    assert a != b


async def test_snap_falls_back_to_straight_on_error():
    pts = [(43.5, -5.7), (43.6, -5.8)]
    with patch.object(route_shapes, "_osrm_route", AsyncMock(side_effect=RuntimeError("x"))):
        coords, snapped = await route_shapes.snap(pts)
    assert coords == [[43.5, -5.7], [43.6, -5.8]]
    assert snapped is False


async def test_snap_joins_chunks_without_duplicates():
    pts = [(float(i), 0.0) for i in range(30)]
    fake = AsyncMock(side_effect=[[[0.0, 0.0], [24.0, 0.0]], [[24.0, 0.0], [29.0, 0.0]]])
    with patch.object(route_shapes, "_osrm_route", fake):
        coords, snapped = await route_shapes.snap(pts)
    assert coords == [[0.0, 0.0], [24.0, 0.0], [29.0, 0.0]]
    assert snapped is True


async def test_get_line_routes_uses_cache(test_db):
    emtusa = AsyncMock()
    emtusa.get = AsyncMock(side_effect=lambda ep: (
        {"trayectos": [{"idtrayecto": 1}]} if ep.startswith("lineas/") else
        (_route(1) if ep.endswith("/1") else {"idtrayecto": 0, "paradas": None})
    ))
    snap = AsyncMock(return_value=([[1.0, 2.0], [3.0, 4.0]], True))
    with patch.object(route_shapes, "emtusa_client", emtusa), patch.object(route_shapes, "snap", snap):
        first = await route_shapes.get_line_routes(1)
        second = await route_shapes.get_line_routes(1)
    assert first == second
    assert len(first) == 1
    r = first[0]
    assert r["idtrayecto"] == 1 and r["destino"] == "DEST1" and r["direccion"] == 1
    assert r["coords"] == [[1.0, 2.0], [3.0, 4.0]]
    assert len(r["stops"]) == 3
    assert snap.await_count == 1


async def test_routes_endpoint(test_db):
    payload = [{"idtrayecto": 1, "coords": [[1.0, 2.0]]}]
    with patch.object(route_shapes, "get_line_routes", AsyncMock(return_value=payload)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            resp = await c.get("/api/routes/1")
    assert resp.status_code == 200
    assert resp.json() == {"idlinea": 1, "trayectos": payload}
