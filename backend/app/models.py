"""Pydantic models for request/response validation.

Defines AlertCreate, AlertResponse, and PushSubscription schemas
used by the alerts and push routers.
"""

from pydantic import BaseModel, Field, field_validator


class PushSubscription(BaseModel):
    """Browser-generated PushSubscription JSON (W3C Push API).

    The `endpoint` is the FCM/Mozilla push server URL.
    `keys` contains auth and p256dh encryption keys.
    """

    endpoint: str
    expirationTime: int | None = None
    keys: dict[str, str] = Field(default_factory=dict)

    model_config = {"extra": "allow"}


class AlertCreate(BaseModel):
    """Payload for creating a new one-shot bus alert."""

    lineId: str
    lineName: str | None = None
    direction: str
    stopId: str
    stopName: str | None = None
    thresholdMinutes: int = Field(ge=1, le=30)
    subscriptionId: int

    @field_validator("lineId", "direction", "stopId")
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Field must not be empty")
        return v


class AlertResponse(BaseModel):
    """Full alert representation returned by GET /api/alerts."""

    id: int
    lineId: str
    lineName: str | None = None
    direction: str
    stopId: str
    stopName: str | None = None
    thresholdMinutes: int
    subscriptionId: int
    status: str = "active"
    createdAt: str | None = None
    firedAt: str | None = None


class VapidPublicKeyResponse(BaseModel):
    """Response for GET /api/push/vapid-public."""

    publicKey: str


class SubscriptionIdResponse(BaseModel):
    """Response for POST /api/push/subscribe (upsert)."""

    id: int
    endpoint: str


class AlertIdResponse(BaseModel):
    """Response for POST /api/alerts (201 Created)."""

    id: int
    status: str = "active"
