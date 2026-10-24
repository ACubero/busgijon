"""Tests for the EMTUSA proxy router and client.

Covers:
  - Token single-flight refresh (concurrent requests → only one token call)
  - Endpoint parity (proxy returns same schema as upstream)
  - 502 propagation on upstream 5xx
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.emtusa_client import EmtusaClient, EmtusaError


@pytest.fixture
def mock_emtusa():
    """Replace the singleton emtusa_client with a mock."""
    original = app.dependency_overrides

    # We need to patch the module-level singleton used by the proxy router
    with patch("app.routers.proxy.emtusa_client") as mock:
        mock.get = AsyncMock(return_value={"paradas": [{"idparada": 1}]})
        yield mock


@pytest.mark.asyncio
async def test_proxy_returns_200_on_success(mock_emtusa):
    """Proxy forwards and returns JSON from EMTUSA."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/emtusa/paradas/todasParadas")

    assert resp.status_code == 200
    assert resp.json() == {"paradas": [{"idparada": 1}]}
    mock_emtusa.get.assert_called_once_with("paradas/todasParadas")


@pytest.mark.asyncio
async def test_proxy_returns_502_on_emtusa_5xx(mock_emtusa):
    """Proxy returns 502 when EMTUSA upstream returns 5xx."""
    mock_emtusa.get = AsyncMock(side_effect=EmtusaError(502, "Upstream down"))

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/emtusa/paradas/parada/46")

    assert resp.status_code == 502
    assert "error" in resp.json()


@pytest.mark.asyncio
async def test_proxy_returns_401_on_token_refresh_failure(mock_emtusa):
    """Proxy returns 401 when token refresh fails after retry."""
    mock_emtusa.get = AsyncMock(side_effect=EmtusaError(401, "Token refresh failed"))

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/emtusa/paradas/todasParadas")

    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_health_endpoint():
    """Health check returns 200 with ok status."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/health")

    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_token_single_flight_refresh():
    """Two concurrent requests with no cached token → only one token request.

    This tests the asyncio.Lock single-flight pattern in EmtusaClient.
    """
    client = EmtusaClient()

    # Mock the httpx client to count token requests
    token_call_count = 0
    token_response = {"access_token": "test-token", "expires_in": 3600}

    class MockResponse:
        def __init__(self, status_code, json_data=None):
            self.status_code = status_code
            self._json = json_data or {}

        def json(self):
            return self._json

        def raise_for_status(self):
            if self.status_code >= 400:
                raise Exception(f"HTTP {self.status_code}")

    class MockHttpClient:
        is_closed = False

        async def post(self, url, params=None, headers=None):
            nonlocal token_call_count
            token_call_count += 1
            # Simulate small delay to encourage race condition
            await asyncio.sleep(0.05)
            return MockResponse(200, token_response)

        async def get(self, url, headers=None):
            return MockResponse(200, {"data": "ok"})

        async def aclose(self):
            pass

    client._client = MockHttpClient()

    # Launch two concurrent _ensure_token calls
    results = await asyncio.gather(
        client._ensure_token(),
        client._ensure_token(),
    )

    assert results[0] == "test-token"
    assert results[1] == "test-token"
    # Only one token request should have been made despite concurrency
    assert token_call_count == 1, f"Expected 1 token call, got {token_call_count}"
