"""Database initialization and connection management via aiosqlite.

Creates tables with WAL mode for concurrent read/write access
(poller writes while API handlers read).
"""

import aiosqlite

from app.config import settings

# ── Schema DDL ──────────────────────────────────────────────────────────

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint          TEXT UNIQUE NOT NULL,
    subscription_json TEXT NOT NULL,
    created_at        TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alerts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    line_id           TEXT NOT NULL,
    line_name         TEXT,
    direction         TEXT NOT NULL,
    stop_id           TEXT NOT NULL,
    stop_name         TEXT,
    threshold_minutes INTEGER NOT NULL CHECK(threshold_minutes BETWEEN 1 AND 30),
    subscription_id   INTEGER NOT NULL REFERENCES push_subscriptions(id),
    status            TEXT DEFAULT 'active',
    created_at        TEXT DEFAULT (datetime('now')),
    fired_at          TEXT
);

CREATE INDEX IF NOT EXISTS idx_alerts_active
    ON alerts(status, stop_id) WHERE status = 'active';
"""


async def init_db(db_path: str | None = None) -> None:
    """Initialize the SQLite database: enable WAL mode and create tables.

    Should be called once at application startup (via lifespan).
    """
    path = db_path or settings.db_path
    async with aiosqlite.connect(path) as db:
        await db.execute("PRAGMA journal_mode=WAL;")
        await db.execute("PRAGMA foreign_keys=ON;")
        await db.executescript(SCHEMA_SQL)
        await db.commit()


async def get_db() -> aiosqlite.Connection:
    """FastAPI dependency: yields an aiosqlite connection.

    The connection is closed when the generator finishes.
    """
    db = await aiosqlite.connect(settings.db_path)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA foreign_keys=ON;")
    try:
        yield db
    finally:
        await db.close()
