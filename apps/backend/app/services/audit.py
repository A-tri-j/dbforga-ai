import re

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.domain.models import AuditEvent

MAX_EVENTS_PER_USER = 1000

# Requests recorded by the middleware: (method, path pattern, event). Only the path is stored, never a body.
RULES = [
    ("POST", re.compile(r"^/api/connections$"), "connection.create"),
    ("PUT", re.compile(r"^/api/connections/\d+$"), "connection.update"),
    ("DELETE", re.compile(r"^/api/connections/\d+$"), "connection.delete"),
    ("PUT", re.compile(r"^/api/ai/keys/\w+$"), "ai_key.save"),
    ("DELETE", re.compile(r"^/api/ai/keys/\w+$"), "ai_key.remove"),
    ("POST", re.compile(r"^/api/imports/[0-9a-f]+/execute$"), "import.run"),
    ("POST", re.compile(r"^/api/pdf/confirm$"), "pdf_import.run"),
    ("POST", re.compile(r"^/api/connections/\d+/indexes$"), "index.create"),
    ("GET", re.compile(r"^/api/account/export$"), "data.export"),
    ("DELETE", re.compile(r"^/api/history$"), "history.clear"),
]


def match_event(method: str, path: str) -> str | None:
    for rule_method, pattern, event in RULES:
        if rule_method == method and pattern.match(path):
            return event
    return None


def record(db: Session, user_id: int, event: str, detail: str = "", ip: str | None = None) -> None:
    """Best effort: a failed audit write must never break the request."""
    try:
        db.add(AuditEvent(user_id=user_id, event=event[:40], detail=detail[:255], ip=ip))
        db.flush()
        old = db.scalars(
            select(AuditEvent.id).where(AuditEvent.user_id == user_id)
            .order_by(AuditEvent.id.desc()).offset(MAX_EVENTS_PER_USER)
        ).all()
        if old:
            db.execute(delete(AuditEvent).where(AuditEvent.id.in_(old)))
        db.commit()
    except Exception:
        db.rollback()
