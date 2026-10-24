"""Background asyncio poller for bus alerts.

Runs a loop every ~30 seconds (configurable via POLL_INTERVAL_SECONDS):
  1. Fetch all active alerts from SQLite.
  2. If no active alerts, skip the cycle entirely (poll efficiency).
  3. Group alerts by unique stop_id and fetch EMTUSA stop detail for each.
  4. For each alert, check if a matching line/direction bus is within
     the threshold minutes. If so, send a Web Push notification and
     mark the alert as 'fired' (one-shot).
"""

import asyncio
import json
import logging

import aiosqlite
import httpx
from pywebpush import webpush, WebPushException

from app.config import settings

logger = logging.getLogger("busgijon.poller")

# ── Poller state ────────────────────────────────────────────────────────

_poller_running = False


# ── Helpers ─────────────────────────────────────────────────────────────


def extract_arrivals(stop_data: dict) -> list[dict]:
    """Extract arrival info from an EMTUSA stop-detail response.

    Mirrors the frontend's extractArrivals() in main.js, returning a list
    of dicts with: lineId, lineName, direction, stopId, stopName, minutes.
    """
    arrivals = []
    llegadas = stop_data.get("llegadas", [])
    stop_name = stop_data.get("descripcion", "")
    stop_id = stop_data.get("idparada", "")

    for item in llegadas:
        linea = item.get("linea", {})
        trayecto = item.get("trayecto", {})

        arrivals.append({
            "lineId": str(linea.get("codigo", "") or linea.get("idlinea", "")),
            "lineName": linea.get("descripcion", ""),
            "direction": trayecto.get("destino", "") or trayecto.get("descripcion", ""),
            "stopId": str(stop_id),
            "stopName": stop_name,
            "minutes": item.get("minutos"),
        })

    return arrivals


def find_matching(arrivals: list[dict], alert: dict) -> dict | None:
    """Find the first arrival that matches the alert's line + direction.

    Returns the matching arrival dict, or None if no match.
    """
    for a in arrivals:
        if (
            a["lineId"] == str(alert["line_id"])
            and a["direction"] == alert["direction"]
        ):
            return a
    return None


async def get_active_alerts(db_path: str) -> list[dict]:
    """Fetch all active (unfired) alerts from the database."""
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT a.*, s.subscription_json
            FROM alerts a
            JOIN push_subscriptions s ON a.subscription_id = s.id
            WHERE a.status = 'active'
            """
        )
        rows = await cursor.fetchall()
        await cursor.close()
        return [dict(r) for r in rows]


async def mark_fired(db_path: str, alert_id: int) -> None:
    """Mark an alert as fired (one-shot) in the database."""
    async with aiosqlite.connect(db_path) as db:
        await db.execute(
            "UPDATE alerts SET status = 'fired', fired_at = datetime('now') WHERE id = ?",
            (alert_id,),
        )
        await db.commit()


def send_push(subscription_json: str, payload: dict) -> bool:
    """Send a Web Push notification via pywebpush.

    Returns True on success, False on failure. Errors are logged but
    do not crash the poller.
    """
    try:
        sub = json.loads(subscription_json)
        webpush(
            subscription_info=sub,
            data=json.dumps(payload),
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},
        )
        return True
    except WebPushException as e:
        logger.error("WebPush failed: %s", e)
        return False
    except Exception as e:
        logger.error("Push send error: %s", e)
        return False


def build_payload(alert: dict, arrival: dict) -> dict:
    """Build the Web Push notification payload.

    Format per design spec:
    {
        "title": "L1 - Centro",
        "body": "Llegada en 3 min a parada Uria 33 (#46)",
        "data": { "url": "/apps/busgijon/", "stopId": "46", "lineId": "1" }
    }
    """
    minutes = arrival.get("minutes", "?")
    line_id = alert["line_id"]
    direction = alert["direction"]
    stop_name = alert.get("stop_name", "")
    stop_id = alert["stop_id"]

    return {
        "title": f"L{line_id} - {direction}",
        "body": f"Llegada en {minutes} min a parada {stop_name} (#{stop_id})",
        "data": {
            "url": "/apps/busgijon/",
            "stopId": str(stop_id),
            "lineId": str(line_id),
        },
    }


# ── Main poller loop ────────────────────────────────────────────────────


async def poller_loop(interval: int = 30) -> None:
    """Main polling loop. Runs until _poller_running is set to False."""
    global _poller_running
    _poller_running = True
    db_path = settings.db_path

    logger.info("Poller started (interval=%ds)", interval)

    while _poller_running:
        try:
            await asyncio.sleep(interval)
            if not _poller_running:
                break

            active_alerts = await get_active_alerts(db_path)
            if not active_alerts:
                continue

            # Only poll stops with active alerts (poll efficiency)
            unique_stops: dict[str, list[dict]] = {}
            for alert in active_alerts:
                unique_stops.setdefault(alert["stop_id"], []).append(alert)

            logger.info(
                "Polling %d stops for %d active alerts",
                len(unique_stops),
                len(active_alerts),
            )

            # Import here to avoid circular import at module level
            from app.emtusa_client import emtusa_client, EmtusaError

            for stop_id, stop_alerts in unique_stops.items():
                try:
                    stop_detail = await emtusa_client.get(f"paradas/parada/{stop_id}")
                except EmtusaError as e:
                    logger.warning("EMTUSA error for stop %s: %s", stop_id, e)
                    continue
                except Exception as e:
                    logger.warning("Fetch error for stop %s: %s", stop_id, e)
                    continue

                if not isinstance(stop_detail, dict):
                    logger.warning("Unexpected response type for stop %s", stop_id)
                    continue

                arrivals = extract_arrivals(stop_detail)

                for alert in stop_alerts:
                    matching = find_matching(arrivals, alert)
                    if matching is None:
                        continue

                    minutes = matching.get("minutes")
                    if minutes is None:
                        continue

                    # Bus at stop (minutes=0) or within threshold
                    if minutes <= alert["threshold_minutes"]:
                        payload = build_payload(alert, matching)
                        sent = send_push(alert["subscription_json"], payload)
                        if sent:
                            await mark_fired(db_path, alert["id"])
                            logger.info(
                                "Alert %d fired: L%s %s @ %d min (stop %s)",
                                alert["id"],
                                alert["line_id"],
                                alert["direction"],
                                minutes,
                                stop_id,
                            )
                        else:
                            logger.warning(
                                "Alert %d: push failed, will retry next cycle",
                                alert["id"],
                            )

        except asyncio.CancelledError:
            logger.info("Poller cancelled")
            break
        except Exception as e:
            logger.error("Poller cycle error: %s", e, exc_info=True)

    logger.info("Poller stopped")


async def start_poller(app=None) -> asyncio.Task:
    """Start the background poller task. Returns the asyncio Task."""
    interval = settings.poll_interval_seconds
    task = asyncio.create_task(poller_loop(interval))
    return task


async def stop_poller(task: asyncio.Task) -> None:
    """Stop the background poller task gracefully."""
    global _poller_running
    _poller_running = False
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
