"""Recorridos de líneas ajustados a calles."""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app import route_shapes

router = APIRouter(prefix="/api/routes", tags=["routes"])


@router.get("")
async def all_routes() -> dict:
    return {"lineas": await route_shapes.get_all_cached()}


@router.get("/{line_id}")
async def line_routes(line_id: int) -> JSONResponse:
    try:
        return JSONResponse({"idlinea": line_id, "trayectos": await route_shapes.get_line_routes(line_id)})
    except Exception as e:
        return JSONResponse(status_code=502, content={"error": str(e)})
