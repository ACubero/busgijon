"""Alert CRUD router — POST/GET/DELETE /api/alerts.

Alerts are one-shot: after a push notification fires, the alert's status
changes from 'active' to 'fired' and it is excluded from future polling.
"""

import aiosqlite

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from app.db import get_db
from app.models import AlertCreate, AlertIdResponse, AlertResponse

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


def _row_to_response(row: aiosqlite.Row) -> dict:
    """Convert a DB row to the AlertResponse dict format (camelCase)."""
    return {
        "id": row["id"],
        "lineId": row["line_id"],
        "lineName": row["line_name"],
        "direction": row["direction"],
        "stopId": row["stop_id"],
        "stopName": row["stop_name"],
        "thresholdMinutes": row["threshold_minutes"],
        "subscriptionId": row["subscription_id"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "firedAt": row["fired_at"],
    }


@router.post("", status_code=201, response_model=AlertIdResponse)
async def create_alert(alert: AlertCreate, db: aiosqlite.Connection = Depends(get_db)) -> JSONResponse:
    """Create a new one-shot alert. Returns 201 with the alert ID."""
    # Verify subscription exists
    cursor = await db.execute(
        "SELECT id FROM push_subscriptions WHERE id = ?", (alert.subscriptionId,)
    )
    if await cursor.fetchone() is None:
        raise HTTPException(status_code=404, detail="Subscription not found")
    await cursor.close()

    cursor = await db.execute(
        """
        INSERT INTO alerts
            (line_id, line_name, direction, stop_id, stop_name,
             threshold_minutes, subscription_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            alert.lineId,
            alert.lineName,
            alert.direction,
            alert.stopId,
            alert.stopName,
            alert.thresholdMinutes,
            alert.subscriptionId,
        ),
    )
    alert_id = cursor.lastrowid
    await db.commit()
    await cursor.close()

    return JSONResponse(
        status_code=201,
        content={"id": alert_id, "status": "active"},
    )


@router.get("", response_model=list[AlertResponse])
async def list_alerts(
    subscriptionId: int | None = Query(None, description="Filter by subscription ID"),
    status: str | None = Query(None, description="Filter by status (active/fired)"),
    db: aiosqlite.Connection = Depends(get_db),
) -> list[dict]:
    """List alerts, optionally filtered by subscriptionId and/or status."""
    query = "SELECT * FROM alerts"
    params: list = []
    conditions: list[str] = []

    if subscriptionId is not None:
        conditions.append("subscription_id = ?")
        params.append(subscriptionId)
    if status is not None:
        conditions.append("status = ?")
        params.append(status)

    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY created_at DESC"

    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    await cursor.close()

    return [_row_to_response(r) for r in rows]


@router.delete("/{alert_id}", status_code=204)
async def delete_alert(alert_id: int, db: aiosqlite.Connection = Depends(get_db)) -> None:
    """Delete an alert by ID. Returns 204 No Content."""
    cursor = await db.execute("DELETE FROM alerts WHERE id = ?", (alert_id,))
    await db.commit()
    if cursor.rowcount == 0:
        await cursor.close()
        raise HTTPException(status_code=404, detail="Alert not found")
    await cursor.close()
