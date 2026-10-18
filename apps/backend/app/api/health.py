from fastapi import APIRouter, Response
from sqlalchemy import text

from app.core.config import settings
from app.core.db import engine

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    return {"status": "ok", "app": settings.app_name, "mode": settings.app_mode}


@router.get("/ready")
def ready(response: Response):
    """Checks the app database, for hosting health checks."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        response.status_code = 503
        return {"status": "unavailable"}
    return {"status": "ready"}
