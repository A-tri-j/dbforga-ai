import json
from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.schemas import StorageOut
from app.core.config import settings
from app.core.db import get_db
from app.domain.models import (
    AiProviderKey, DbConnection, LearningProgress, Project, QueryHistory, SavedQuery, SchemaSnapshot, User,
)

router = APIRouter(prefix="/account", tags=["account"])


def _count(db: Session, user: User, model) -> int:
    return db.scalar(select(func.count()).select_from(model).where(model.user_id == user.id)) or 0


@router.get("/storage", response_model=StorageOut)
def storage(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    url = make_url(settings.database_url)
    kind = url.get_backend_name()
    location = size = None
    if kind == "sqlite" and url.database and url.database != ":memory:":
        path = Path(url.database).resolve()
        location = str(path)
        size = path.stat().st_size if path.exists() else None
    return StorageOut(
        app_mode=settings.app_mode, storage_kind=kind, location=location, size_bytes=size,
        session_days=settings.jwt_expire_minutes // (60 * 24),
        counts={
            "projects": _count(db, user, Project),
            "connections": _count(db, user, DbConnection),
            "history": _count(db, user, QueryHistory),
            "saved_queries": _count(db, user, SavedQuery),
            "snapshots": _count(db, user, SchemaSnapshot),
            "ai_providers": _count(db, user, AiProviderKey),
            "learning_progress": _count(db, user, LearningProgress),
        },
    )


@router.get("/export")
def export(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """A backup of your own data. Passwords and API keys are never included."""
    def rows(model):
        return db.scalars(select(model).where(model.user_id == user.id).order_by(model.id)).all()

    data = {
        "app": "DBForge AI",
        "app_mode": settings.app_mode,
        "user": {"email": user.email},
        "projects": [{"name": p.name, "description": p.description, "created_at": p.created_at} for p in rows(Project)],
        "connections": [
            {"name": c.name, "engine": c.engine, "host": c.host, "port": c.port, "database": c.database,
             "username": c.username, "ssl": c.ssl}
            for c in rows(DbConnection)
        ],
        "history": [
            {"connection": h.connection_name, "sql": h.sql, "type": h.statement_type, "status": h.status,
             "duration_ms": h.duration_ms, "row_count": h.row_count, "created_at": h.created_at}
            for h in rows(QueryHistory)
        ],
        "saved_queries": [{"name": s.name, "sql": s.sql, "created_at": s.created_at} for s in rows(SavedQuery)],
        "snapshots": [
            {"label": s.label, "engine": s.engine, "schema": s.schema_name, "created_at": s.created_at,
             "tables": json.loads(s.data)["tables"]}
            for s in rows(SchemaSnapshot)
        ],
        "learning_progress": [p.item_id for p in rows(LearningProgress)],
        "ai_providers": [{"provider": k.provider, "model": k.model, "key_hint": k.key_hint} for k in rows(AiProviderKey)],
    }
    return JSONResponse(
        content=jsonable_encoder(data),
        headers={"Content-Disposition": 'attachment; filename="dbforge-export.json"'},
    )
