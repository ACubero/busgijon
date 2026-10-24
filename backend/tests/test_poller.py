"""Tests for the background poller matching logic.

Covers:
  - Fires when arrival ≤ threshold minutes
  - Skips when arrival > threshold minutes
  - Only polls stops with active alerts (poll efficiency)
  - Marks alert as fired after notification
  - extract_arrivals parses EMTUSA stop-detail correctly
  - find_matching matches on line + direction
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import aiosqlite

from app.poller import (
    extract_arrivals,
    find_matching,
    build_payload,
    get_active_alerts,
    mark_fired,
)
from tests.conftest import insert_subscription, insert_alert


def test_extract_arrivals_basic():
    """extract_arrivals parses EMTUSA stop-detail format correctly."""
    stop_data = {
        "idparada": 46,
        "descripcion": "Uria 33",
        "llegadas": [
            {
                "minutos": 3,
                "linea": {"codigo": "1", "descripcion": "Línea 1"},
                "trayecto": {"destino": "Centro"},
            },
            {
                "minutos": 8,
                "linea": {"codigo": "2", "descripcion": "Línea 2"},
                "trayecto": {"destino": "Hospital"},
            },
        ],
    }

    arrivals = extract_arrivals(stop_data)
    assert len(arrivals) == 2
    assert arrivals[0]["lineId"] == "1"
    assert arrivals[0]["direction"] == "Centro"
    assert arrivals[0]["minutes"] == 3
    assert arrivals[0]["stopId"] == "46"
    assert arrivals[0]["stopName"] == "Uria 33"


def test_extract_arrivals_empty():
    """extract_arrivals handles no llegadas gracefully."""
    stop_data = {"idparada": 46, "descripcion": "Uria 33", "llegadas": []}
    arrivals = extract_arrivals(stop_data)
    assert arrivals == []


def test_find_matching_found():
    """find_matching returns the arrival matching line + direction."""
    arrivals = [
        {"lineId": "1", "direction": "Centro", "minutes": 3},
        {"lineId": "2", "direction": "Hospital", "minutes": 8},
    ]
    alert = {"line_id": "2", "direction": "Hospital"}

    result = find_matching(arrivals, alert)
    assert result is not None
    assert result["lineId"] == "2"
    assert result["minutes"] == 8


def test_find_matching_not_found():
    """find_matching returns None when no arrival matches."""
    arrivals = [
        {"lineId": "1", "direction": "Centro", "minutes": 3},
    ]
    alert = {"line_id": "99", "direction": "NoMatch"}

    result = find_matching(arrivals, alert)
    assert result is None


def test_find_matching_line_matches_but_direction_differs():
    """find_matching does not match if direction differs."""
    arrivals = [
        {"lineId": "1", "direction": "Centro", "minutes": 3},
    ]
    alert = {"line_id": "1", "direction": "Hospital"}

    result = find_matching(arrivals, alert)
    assert result is None


def test_build_payload_format():
    """build_payload produces the expected notification format."""
    alert = {
        "line_id": "1",
        "direction": "Centro",
        "stop_name": "Uria 33",
        "stop_id": "46",
    }
    arrival = {"minutes": 3, "lineId": "1", "direction": "Centro"}

    payload = build_payload(alert, arrival)

    assert payload["title"] == "L1 - Centro"
    assert "Llegada en 3 min" in payload["body"]
    assert "Uria 33" in payload["body"]
    assert payload["data"]["stopId"] == "46"
    assert payload["data"]["lineId"] == "1"
    assert payload["data"]["url"] == "/apps/busgijon/"


@pytest.mark.asyncio
async def test_get_active_alerts_only_returns_active(test_db, db_connection):
    """get_active_alerts returns only alerts with status='active'."""
    sub_id = await insert_subscription(db_connection)
    await insert_alert(db_connection, sub_id, status="active")
    await insert_alert(db_connection, sub_id, status="fired")

    alerts = await get_active_alerts(test_db)
    assert len(alerts) == 1
    assert alerts[0]["status"] == "active"


@pytest.mark.asyncio
async def test_get_active_alerts_empty(test_db):
    """get_active_alerts returns empty list when no active alerts."""
    alerts = await get_active_alerts(test_db)
    assert alerts == []


@pytest.mark.asyncio
async def test_mark_fired_changes_status(test_db, db_connection):
    """mark_fired sets status to 'fired' and records fired_at."""
    sub_id = await insert_subscription(db_connection)
    alert_id = await insert_alert(db_connection, sub_id, status="active")

    await mark_fired(test_db, alert_id)

    cursor = await db_connection.execute(
        "SELECT status, fired_at FROM alerts WHERE id = ?", (alert_id,)
    )
    row = await cursor.fetchone()
    await cursor.close()
    assert row["status"] == "fired"
    assert row["fired_at"] is not None


@pytest.mark.asyncio
async def test_poll_efficiency_only_active_stops_queried(test_db, db_connection):
    """When alerts span 2 unique stops, only 2 stop-detail calls are made."""
    sub_id = await insert_subscription(db_connection)
    # 3 alerts across 2 unique stops
    await insert_alert(db_connection, sub_id, stop_id="46", line_id="1")
    await insert_alert(db_connection, sub_id, stop_id="46", line_id="2")
    await insert_alert(db_connection, sub_id, stop_id="49", line_id="3")

    alerts = await get_active_alerts(test_db)
    unique_stops = {a["stop_id"] for a in alerts}
    assert len(unique_stops) == 2
    assert unique_stops == {"46", "49"}


@pytest.mark.asyncio
async def test_poller_fires_when_within_threshold(test_db, db_connection):
    """Poller fires alert when bus is ≤ threshold minutes away."""
    sub_id = await insert_subscription(db_connection)
    alert_id = await insert_alert(
        db_connection, sub_id,
        line_id="1", direction="Centro", stop_id="46",
        threshold_minutes=5,
    )

    # Mock the emtusa_client.get to return an arrival at 3 min
    mock_stop_detail = {
        "idparada": "46",
        "descripcion": "Uria 33",
        "llegadas": [
            {
                "minutos": 3,
                "linea": {"codigo": "1", "descripcion": "Línea 1"},
                "trayecto": {"destino": "Centro"},
            },
        ],
    }

    # Mock send_push to succeed
    with patch("app.poller.send_push", return_value=True) as mock_push, \
         patch("app.emtusa_client.emtusa_client") as mock_client:

        mock_client.get = AsyncMock(return_value=mock_stop_detail)

        # Run one cycle manually
        from app.poller import get_active_alerts, extract_arrivals, find_matching, mark_fired, send_push, build_payload

        active = await get_active_alerts(test_db)
        assert len(active) == 1

        stop_detail = await mock_client.get(f"paradas/parada/46")
        arrivals = extract_arrivals(stop_detail)
        matching = find_matching(arrivals, active[0])

        assert matching is not None
        assert matching["minutes"] == 3
        assert matching["minutes"] <= active[0]["threshold_minutes"]

        # Simulate sending push
        payload = build_payload(active[0], matching)
        sent = send_push(active[0]["subscription_json"], payload)
        assert sent is True

        await mark_fired(test_db, active[0]["id"])

        # Verify alert is now fired
        cursor = await db_connection.execute(
            "SELECT status FROM alerts WHERE id = ?", (active[0]["id"],)
        )
        row = await cursor.fetchone()
        await cursor.close()
        assert row["status"] == "fired"


@pytest.mark.asyncio
async def test_poller_skips_when_above_threshold(test_db, db_connection):
    """Poller does not fire when bus is > threshold minutes away."""
    sub_id = await insert_subscription(db_connection)
    alert_id = await insert_alert(
        db_connection, sub_id,
        line_id="1", direction="Centro", stop_id="46",
        threshold_minutes=5,
    )

    mock_stop_detail = {
        "idparada": "46",
        "descripcion": "Uria 33",
        "llegadas": [
            {
                "minutos": 10,  # Above threshold of 5
                "linea": {"codigo": "1", "descripcion": "Línea 1"},
                "trayecto": {"destino": "Centro"},
            },
        ],
    }

    with patch("app.poller.send_push", return_value=True) as mock_push, \
         patch("app.emtusa_client.emtusa_client") as mock_client:

        mock_client.get = AsyncMock(return_value=mock_stop_detail)

        from app.poller import get_active_alerts, extract_arrivals, find_matching

        active = await get_active_alerts(test_db)
        stop_detail = await mock_client.get(f"paradas/parada/46")
        arrivals = extract_arrivals(stop_detail)
        matching = find_matching(arrivals, active[0])

        assert matching is not None
        assert matching["minutes"] == 10
        # 10 > 5 threshold → should NOT fire
        assert matching["minutes"] > active[0]["threshold_minutes"]
        mock_push.assert_not_called()

        # Verify alert is still active
        cursor = await db_connection.execute(
            "SELECT status FROM alerts WHERE id = ?", (active[0]["id"],)
        )
        row = await cursor.fetchone()
        await cursor.close()
        assert row["status"] == "active"
