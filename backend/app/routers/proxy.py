"""Proxy router — mirrors all EMTUSA SIRI endpoints under /api/emtusa/*.

The proxy holds credentials server-side, caches the OAuth2 token, and
forwards requests transparently. Returns 502 when EMTUSA is unreachable,
401 when token refresh fails.
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.emtusa_client import EmtusaError, emtusa_client

router = APIRouter(prefix="/api/emtusa", tags=["proxy"])


@router.get("/{path:path}")
async def proxy_emtusa(path: str) -> JSONResponse:
    """Proxy any GET request to EMTUSA SIRI API.

    The frontend calls `/api/emtusa/paradas/todasParadas` etc.
    We forward to `paradas/todasParadas` on the upstream EMTUSA API.
    """
    try:
        data = await emtusa_client.get(path)
        return JSONResponse(content=data)
    except EmtusaError as e:
        return JSONResponse(
            status_code=e.status,
            content={"error": e.detail},
        )
    except Exception as e:
        return JSONResponse(
            status_code=502,
            content={"error": f"Proxy error: {e!s}"},
        )
