from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.schemas import DashboardSummary, HistoryOut
from app.core.db import get_db
from app.domain.models import (
    AiProviderKey, DbConnection, Project, QueryHistory, SavedQuery, SchemaSnapshot, User,
)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _count(db: Session, user: User, model, *extra) -> int:
    stmt = select(func.count()).select_from(model).where(model.user_id == user.id, *extra)
    return db.scalar(stmt) or 0


@router.get("/summary", response_model=DashboardSummary)
def summary(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    recent = db.scalars(
        select(QueryHistory).where(QueryHistory.user_id == user.id).order_by(QueryHistory.id.desc()).limit(5)
    ).all()
    return DashboardSummary(
        projects=_count(db, user, Project),
        connections=_count(db, user, DbConnection),
        queries_24h=_count(db, user, QueryHistory, QueryHistory.created_at >= since),
        queries_total=_count(db, user, QueryHistory),
        saved_queries=_count(db, user, SavedQuery),
        snapshots=_count(db, user, SchemaSnapshot),
        ai_providers=_count(db, user, AiProviderKey),
        recent_queries=[HistoryOut.model_validate(r) for r in recent],
    )
