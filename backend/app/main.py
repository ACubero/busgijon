"""FastAPI application entrypoint.

Creates the app, initializes the database on startup, starts the background
poller task, and includes the three routers (proxy, alerts, push).
Shuts down the poller and closes the EMTUSA client on exit.
"""

import asyncio
import contextlib

from fastapi import FastAPI

from app.config import settings
from app.db import init_db
from app.emtusa_client import emtusa_client
from app.routers import alerts, proxy, push


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: init DB, start poller, cleanup on exit."""
    # ── Startup ──
    await init_db()

    # Start background poller
    from app.poller import start_poller, stop_poller

    poller_task = await start_poller(app)

    yield

    # ── Shutdown ──
    await stop_poller(poller_task)
    await emtusa_client.close()


app = FastAPI(
    title="BusGijon Backend",
    description="EMTUSA proxy, push alerts, and background polling",
    version="0.1.0",
    lifespan=lifespan,
)

# Include routers
app.include_router(proxy.router)
app.include_router(alerts.router)
app.include_router(push.router)


@app.get("/health")
@app.get("/api/health")
async def health() -> dict:
    """Health check endpoint for systemd / monitoring."""
    return {"status": "ok"}
