from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.schemas import HistoryOut, SavedQueryIn, SavedQueryOut
from app.core.db import get_db
from app.domain.models import DbConnection, QueryHistory, SavedQuery, User

router = APIRouter(tags=["history"])


def _escape_like(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@router.get("/history", response_model=list[HistoryOut])
def list_history(
    q: str = "",
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(QueryHistory).where(QueryHistory.user_id == user.id)
    if q.strip():
        stmt = stmt.where(QueryHistory.sql.ilike(f"%{_escape_like(q.strip())}%", escape="\\"))
    stmt = stmt.order_by(QueryHistory.id.desc()).limit(limit).offset(offset)
    return db.scalars(stmt).all()


@router.delete("/history/{item_id}", status_code=204)
def delete_history_item(item_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = db.get(QueryHistory, item_id)
    if item is None or item.user_id != user.id:
        raise HTTPException(status_code=404, detail="History item not found")
    db.delete(item)
    db.commit()
    return Response(status_code=204)


@router.delete("/history", status_code=204)
def clear_history(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.execute(delete(QueryHistory).where(QueryHistory.user_id == user.id))
    db.commit()
    return Response(status_code=204)


@router.get("/saved-queries", response_model=list[SavedQueryOut])
def list_saved(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stmt = select(SavedQuery).where(SavedQuery.user_id == user.id).order_by(SavedQuery.id.desc())
    return db.scalars(stmt).all()


@router.post("/saved-queries", response_model=SavedQueryOut, status_code=201)
def create_saved(body: SavedQueryIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.connection_id is not None:
        conn = db.get(DbConnection, body.connection_id)
        if conn is None or conn.user_id != user.id:
            raise HTTPException(status_code=404, detail="Connection not found")
    item = SavedQuery(user_id=user.id, connection_id=body.connection_id, name=body.name.strip(), sql=body.sql)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/saved-queries/{item_id}", status_code=204)
def delete_saved(item_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = db.get(SavedQuery, item_id)
    if item is None or item.user_id != user.id:
        raise HTTPException(status_code=404, detail="Saved query not found")
    db.delete(item)
    db.commit()
    return Response(status_code=204)
