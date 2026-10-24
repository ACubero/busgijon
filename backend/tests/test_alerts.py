"""Tests for alert CRUD and push subscription upsert.

Covers:
  - Alert create → 201 with ID
  - Alert list (with/without filters)
  - Alert delete → 204
  - Push subscription upsert (same endpoint → 1 row, not 2)
  - Threshold CHECK constraint (1-30 only)
  - Alert→subscription FK enforcement
"""

import json

import pytest
import pytest_asyncio
import aiosqlite
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.db import get_db
from tests.conftest import insert_subscription, insert_alert


@pytest_asyncio.fixture
async def test_client(test_db):
    """Create an async test client with the test DB dependency override."""
    # Override the get_db dependency to use the test database
    async def override_get_db():
        db = await aiosqlite.connect(test_db)
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys=ON;")
        try:
            yield db
        finally:
            await db.close()

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client

    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_create_alert_returns_201(test_client, db_connection):
    """POST /api/alerts with valid payload → 201 with ID."""
    sub_id = await insert_subscription(db_connection)

    resp = await test_client.post("/api/alerts", json={
        "lineId": "1",
        "lineName": "Línea 1",
        "direction": "Centro",
        "stopId": "46",
        "stopName": "Uria 33",
        "thresholdMinutes": 5,
        "subscriptionId": sub_id,
    })

    assert resp.status_code == 201
    data = resp.json()
    assert "id" in data
    assert data["status"] == "active"


@pytest.mark.asyncio
async def test_list_alerts(test_client, db_connection):
    """GET /api/alerts returns all alerts."""
    sub_id = await insert_subscription(db_connection)
    await insert_alert(db_connection, sub_id, line_id="1", direction="Centro")
    await insert_alert(db_connection, sub_id, line_id="2", direction="Hospital")

    resp = await test_client.get("/api/alerts")
    assert resp.status_code == 200
    alerts = resp.json()
    assert len(alerts) == 2


@pytest.mark.asyncio
async def test_list_alerts_filter_by_subscription(test_client, db_connection):
    """GET /api/alerts?subscriptionId=X returns only that subscription's alerts."""
    sub1 = await insert_subscription(db_connection, endpoint="https://fcm.test/sub1")
    sub2 = await insert_subscription(db_connection, endpoint="https://fcm.test/sub2")
    await insert_alert(db_connection, sub1, line_id="1")
    await insert_alert(db_connection, sub2, line_id="2")

    resp = await test_client.get(f"/api/alerts?subscriptionId={sub1}")
    assert resp.status_code == 200
    alerts = resp.json()
    assert len(alerts) == 1
    assert alerts[0]["lineId"] == "1"


@pytest.mark.asyncio
async def test_list_alerts_filter_by_status(test_client, db_connection):
    """GET /api/alerts?status=active returns only active alerts."""
    sub_id = await insert_subscription(db_connection)
    await insert_alert(db_connection, sub_id, status="active")
    await insert_alert(db_connection, sub_id, status="fired")

    resp = await test_client.get("/api/alerts?status=active")
    assert resp.status_code == 200
    alerts = resp.json()
    assert len(alerts) == 1
    assert alerts[0]["status"] == "active"


@pytest.mark.asyncio
async def test_delete_alert_returns_204(test_client, db_connection):
    """DELETE /api/alerts/{id} → 204 No Content."""
    sub_id = await insert_subscription(db_connection)
    alert_id = await insert_alert(db_connection, sub_id)

    resp = await test_client.delete(f"/api/alerts/{alert_id}")
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_nonexistent_alert_returns_404(test_client):
    """DELETE /api/alerts/9999 → 404."""
    resp = await test_client.delete("/api/alerts/9999")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_create_alert_invalid_threshold(test_client, db_connection):
    """POST /api/alerts with thresholdMinutes=0 → 422 validation error."""
    sub_id = await insert_subscription(db_connection)

    resp = await test_client.post("/api/alerts", json={
        "lineId": "1",
        "direction": "Centro",
        "stopId": "46",
        "thresholdMinutes": 0,  # Below minimum of 1
        "subscriptionId": sub_id,
    })

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_alert_threshold_above_max(test_client, db_connection):
    """POST /api/alerts with thresholdMinutes=31 → 422 validation error."""
    sub_id = await insert_subscription(db_connection)

    resp = await test_client.post("/api/alerts", json={
        "lineId": "1",
        "direction": "Centro",
        "stopId": "46",
        "thresholdMinutes": 31,  # Above maximum of 30
        "subscriptionId": sub_id,
    })

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_alert_nonexistent_subscription(test_client):
    """POST /api/alerts with invalid subscriptionId → 404."""
    resp = await test_client.post("/api/alerts", json={
        "lineId": "1",
        "direction": "Centro",
        "stopId": "46",
        "thresholdMinutes": 5,
        "subscriptionId": 9999,
    })

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_push_subscribe_upsert(test_client, db_connection):
    """POST /api/push/subscribe with same endpoint → upserts (1 row, not 2)."""
    sub_payload = {
        "endpoint": "https://fcm.test/endpoint123",
        "expirationTime": None,
        "keys": {"auth": "abc", "p256dh": "def"},
    }

    # First subscription
    resp1 = await test_client.post("/api/push/subscribe", json=sub_payload)
    assert resp1.status_code == 200
    id1 = resp1.json()["id"]

    # Same endpoint again → should upsert, return same ID
    resp2 = await test_client.post("/api/push/subscribe", json=sub_payload)
    assert resp2.status_code == 200
    id2 = resp2.json()["id"]

    assert id1 == id2, "Upsert should return the same ID for same endpoint"

    # Verify only 1 row in DB
    cursor = await db_connection.execute(
        "SELECT COUNT(*) as cnt FROM push_subscriptions WHERE endpoint = ?",
        ("https://fcm.test/endpoint123",),
    )
    row = await cursor.fetchone()
    await cursor.close()
    assert row["cnt"] == 1, "Should have exactly 1 row after upsert"


@pytest.mark.asyncio
async def test_push_subscribe_different_endpoints(test_client, db_connection):
    """POST /api/push/subscribe with different endpoints → 2 separate rows."""
    sub1 = {"endpoint": "https://fcm.test/ep1", "keys": {"auth": "a", "p256dh": "b"}}
    sub2 = {"endpoint": "https://fcm.test/ep2", "keys": {"auth": "c", "p256dh": "d"}}

    resp1 = await test_client.post("/api/push/subscribe", json=sub1)
    resp2 = await test_client.post("/api/push/subscribe", json=sub2)

    assert resp1.json()["id"] != resp2.json()["id"]
