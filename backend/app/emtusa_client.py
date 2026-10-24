"""Server-side EMTUSA OAuth2 client with token caching and single-flight refresh.

Holds credentials in env vars (never exposed to the browser). Caches the
OAuth2 access token and auto-refreshes before expiry. Uses an asyncio.Lock
to prevent concurrent token refresh requests (single-flight pattern).
"""

import asyncio
import time

import httpx

from app.config import settings


class EmtusaError(Exception):
    """Raised when EMTUSA returns a non-recoverable error."""

    def __init__(self, status: int, detail: str = ""):
        self.status = status
        self.detail = detail
        super().__init__(f"EMTUSA error {status}: {detail}")


class EmtusaClient:
    """Async EMTUSA API client with OAuth2 token management.

    Token lifecycle:
      1. First request triggers an OAuth2 password grant.
      2. Token is cached with expiry; subsequent requests reuse it.
      3. If two concurrent requests arrive with no/expired token, the
         asyncio.Lock ensures only one token request is made (single-flight).
    """

    def __init__(self) -> None:
        self._token: str | None = None
        self._token_expiry: float = 0.0
        self._lock = asyncio.Lock()
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=settings.emtusa_base_url,
                timeout=httpx.Timeout(30.0),
                headers={"Accept": "application/json"},
            )
        return self._client

    async def _ensure_token(self) -> str:
        """Return a valid access token, refreshing if necessary.

        Uses an asyncio.Lock so that concurrent callers wait while one
        caller performs the OAuth2 token request.
        """
        if self._token and time.time() < self._token_expiry:
            return self._token

        async with self._lock:
            # Double-check after acquiring lock — another caller may have refreshed
            if self._token and time.time() < self._token_expiry:
                return self._token

            await self._refresh_token()
            return self._token  # type: ignore[return-value]

    async def _refresh_token(self) -> None:
        """Perform the OAuth2 password grant and cache the new token."""
        client = await self._get_client()
        params = {
            "grant_type": "password",
            "username": settings.emtusa_auth_user,
            "password": settings.emtusa_auth_pass,
        }
        headers = {"Authorization": settings.emtusa_auth_basic}

        resp = await client.post("login", params=params, headers=headers)

        if resp.status_code == 401:
            raise EmtusaError(401, "Token refresh failed — invalid credentials")
        if resp.status_code >= 500:
            raise EmtusaError(502, "EMTUSA auth endpoint unavailable")

        resp.raise_for_status()
        data = resp.json()

        self._token = data.get("access_token")
        expires_in = data.get("expires_in", 3600)
        # Refresh 60 seconds before expiry
        self._token_expiry = time.time() + max(expires_in - 60, 60)

    async def get(self, endpoint: str) -> dict | list:
        """Make an authenticated GET to an EMTUSA endpoint.

        Returns the parsed JSON response. Raises EmtusaError on 5xx upstream
        or 401 after a token-refresh retry.
        """
        token = await self._ensure_token()
        client = await self._get_client()
        headers = {"Authorization": f"Bearer {token}"}

        resp = await client.get(endpoint, headers=headers)

        # If 401, try refreshing token once and retry
        if resp.status_code == 401:
            self._token = None
            self._token_expiry = 0.0
            token = await self._ensure_token()
            headers = {"Authorization": f"Bearer {token}"}
            resp = await client.get(endpoint, headers=headers)

        if resp.status_code >= 500:
            raise EmtusaError(502, f"EMTUSA returned {resp.status_code}")
        if resp.status_code == 401:
            raise EmtusaError(401, "Token refresh failed after retry")

        resp.raise_for_status()

        # EMTUSA serves JSON with non-UTF-8 bytes (likely Latin-1/ISO-8859-1
        # with Spanish accents). Decode raw bytes then parse JSON manually
        # instead of relying on httpx's default UTF-8 decoding.
        raw = resp.content
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("latin-1")
        import json
        return json.loads(text)

    async def close(self) -> None:
        """Close the underlying httpx client. Call on app shutdown."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None


# Singleton — shared across routers and poller
emtusa_client = EmtusaClient()
