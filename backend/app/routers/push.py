"""Push subscription router.

POST /api/push/subscribe — stores a PushSubscription, upserting by endpoint.
GET  /api/push/vapid-public — returns the public VAPID key for the frontend.
"""

import json

import aiosqlite

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from app.config import settings
from app.db import get_db
from app.models import PushSubscription, SubscriptionIdResponse, VapidPublicKeyResponse

router = APIRouter(prefix="/api/push", tags=["push"])


@router.get("/vapid-public", response_model=VapidPublicKeyResponse)
async def get_vapid_public_key() -> VapidPublicKeyResponse:
    """Return the public VAPID key for frontend push subscription."""
    if not settings.vapid_public_key:
        raise HTTPException(status_code=503, detail="VAPID keys not configured")
    return VapidPublicKeyResponse(publicKey=settings.vapid_public_key)


@router.post("/subscribe", response_model=SubscriptionIdResponse)
async def subscribe(
    sub: PushSubscription, db: aiosqlite.Connection = Depends(get_db)
) -> JSONResponse:
    """Store a PushSubscription, upserting by endpoint URL.

    If the endpoint already exists, update the subscription JSON
    (keys may have changed). Return the subscription row ID.
    """
    sub_json = json.dumps(sub.model_dump())

    # Try upsert: INSERT ... ON CONFLICT(endpoint) DO UPDATE
    cursor = await db.execute(
        """
        INSERT INTO push_subscriptions (endpoint, subscription_json)
        VALUES (?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET
            subscription_json = excluded.subscription_json
        RETURNING id
        """,
        (sub.endpoint, sub_json),
    )
    row = await cursor.fetchone()
    await db.commit()
    await cursor.close()

    if row is None:
        raise HTTPException(status_code=500, detail="Failed to store subscription")

    return JSONResponse(
        status_code=200,
        content={"id": row["id"], "endpoint": sub.endpoint},
    )
