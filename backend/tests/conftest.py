"""Shared test fixtures for backend tests.

Provides a fresh in-memory SQLite database for each test, and overrides
the FastAPI dependency to use it.
"""

import asyncio
import tempfile
from pathlib import Path

import aiosqlite
import pytest
import pytest_asyncio

from app.db import init_db
from app.config import settings


@pytest_asyncio.fixture
async def test_db(tmp_path):
    """Create a fresh test database in tmp_path. Returns the db file path."""
    db_path = str(tmp_path / "test_busgijon.db")
    await init_db(db_path)

    # Override the global settings.db_path so poller/db code uses the test DB
    original_db_path = settings.db_path
    settings.db_path = db_path

    yield db_path

    # Restore
    settings.db_path = original_db_path


@pytest_asyncio.fixture
async def db_connection(test_db):
    """Yield an aiosqlite connection to the test database."""
    db = await aiosqlite.connect(test_db)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA foreign_keys=ON;")
    try:
        yield db
    finally:
        await db.close()


async def insert_subscription(db: aiosqlite.Connection, endpoint: str = "https://fcm.test/sub1") -> int:
    """Insert a test push subscription and return its ID."""
    import json
    sub_json = json.dumps({
        "endpoint": endpoint,
        "keys": {"auth": "test-auth", "p256dh": "test-p256dh"},
    })
    cursor = await db.execute(
        "INSERT INTO push_subscriptions (endpoint, subscription_json) VALUES (?, ?) RETURNING id",
        (endpoint, sub_json),
    )
    row = await cursor.fetchone()
    await db.commit()
    await cursor.close()
    return row["id"]


async def insert_alert(
    db: aiosqlite.Connection,
    subscription_id: int,
    line_id: str = "1",
    direction: str = "Centro",
    stop_id: str = "46",
    threshold_minutes: int = 5,
    status: str = "active",
) -> int:
    """Insert a test alert and return its ID."""
    cursor = await db.execute(
        """
        INSERT INTO alerts
            (line_id, line_name, direction, stop_id, stop_name,
             threshold_minutes, subscription_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
        """,
        (line_id, "Línea 1", direction, stop_id, "Uria 33", threshold_minutes, subscription_id, status),
    )
    row = await cursor.fetchone()
    await db.commit()
    await cursor.close()
    return row["id"]
