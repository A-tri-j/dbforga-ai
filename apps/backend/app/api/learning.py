import re

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.db import get_db
from app.domain.models import LearningProgress, User

router = APIRouter(prefix="/learn", tags=["learn"])
ITEM_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")


def _check(item_id: str) -> None:
    if not ITEM_RE.match(item_id):
        raise HTTPException(status_code=400, detail="Invalid item id")


@router.get("/progress", response_model=list[str])
def progress(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return list(db.scalars(select(LearningProgress.item_id).where(LearningProgress.user_id == user.id)).all())


@router.put("/progress/{item_id}", status_code=204)
def mark_done(item_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _check(item_id)
    exists = db.scalar(select(LearningProgress.id).where(
        LearningProgress.user_id == user.id, LearningProgress.item_id == item_id))
    if exists is None:
        db.add(LearningProgress(user_id=user.id, item_id=item_id))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()  # a parallel request already stored it
    return Response(status_code=204)


@router.delete("/progress/{item_id}", status_code=204)
def unmark(item_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _check(item_id)
    db.execute(delete(LearningProgress).where(
        LearningProgress.user_id == user.id, LearningProgress.item_id == item_id))
    db.commit()
    return Response(status_code=204)
