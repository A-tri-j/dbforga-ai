from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.domain.models import DbConnection, QueryHistory

MAX_HISTORY_PER_USER = 500


def record(db: Session, user_id: int, conn: DbConnection, sql: str, kind: str, result: dict) -> None:
    """Best-effort: a history failure must never break query execution."""
    try:
        db.add(QueryHistory(
            user_id=user_id, connection_id=conn.id, connection_name=conn.name, sql=sql,
            statement_type=kind[:30], status=result.get("status", "error"),
            duration_ms=result.get("duration_ms", 0), row_count=result.get("row_count", 0),
        ))
        db.flush()
        old_ids = db.scalars(
            select(QueryHistory.id)
            .where(QueryHistory.user_id == user_id)
            .order_by(QueryHistory.id.desc())
            .offset(MAX_HISTORY_PER_USER)
        ).all()
        if old_ids:
            db.execute(delete(QueryHistory).where(QueryHistory.id.in_(old_ids)))
        db.commit()
    except Exception:
        db.rollback()
