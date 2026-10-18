from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.domain.models import UserSecurity
from app.services import audit


@dataclass(frozen=True)
class SecurityPolicy:
    force_read_only: bool = False
    block_destructive: bool = False
    query_timeout_seconds: int = 30
    max_rows: int = 5000


def load_policy(db: Session, user_id: int) -> SecurityPolicy:
    row = db.get(UserSecurity, user_id)
    if row is None:
        return SecurityPolicy()
    return SecurityPolicy(row.force_read_only, row.block_destructive, row.query_timeout_seconds, row.max_rows)


def require_writable(db: Session, user_id: int, what: str) -> None:
    if load_policy(db, user_id).force_read_only:
        audit.record(db, user_id, "policy.blocked", f"{what} blocked: account is read-only")
        raise HTTPException(status_code=403, detail="Your account is locked to read-only in the security settings")
