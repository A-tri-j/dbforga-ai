from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.adapters import ai_providers, mongo as mongo_adapter
from app.adapters.ai_providers import PROVIDERS, ProviderError
from app.api.deps import get_current_user
from app.api.schemas import (
    ChatIn, ChatOut, KeyIn, ProviderName, ProviderStatus, ValidateIn, ValidateOut,
)
from app.core.crypto import decrypt, encrypt
from app.core.db import get_db
from app.domain.models import AiProviderKey, DbConnection, User
from app.services import ai_assistant, mongo_tools, schema_tools
from app.services.connections import friendly_error, get_engine, get_mongo_client

router = APIRouter(prefix="/ai", tags=["ai"])

_STATUS = {"invalid_key": 400, "rate_limited": 429, "timeout": 504}


def _http(exc: ProviderError) -> HTTPException:
    return HTTPException(status_code=_STATUS.get(exc.code, 502), detail=exc.message)


def _row(db: Session, user: User, provider: str) -> AiProviderKey | None:
    return db.scalar(select(AiProviderKey).where(AiProviderKey.user_id == user.id, AiProviderKey.provider == provider))


def _status(provider: str, row: AiProviderKey | None) -> ProviderStatus:
    info = PROVIDERS[provider]
    return ProviderStatus(
        provider=provider, label=info.label, suggested_model=info.suggested_model,
        configured=row is not None, model=row.model if row else None,
        key_hint=row.key_hint if row else None, is_default=bool(row and row.is_default),
    )


def _stored_key(row: AiProviderKey) -> str:
    try:
        return decrypt(row.api_key_encrypted)
    except ValueError:
        raise HTTPException(status_code=400, detail="The stored key cannot be decrypted. Enter the key again in Settings.")


@router.get("/providers", response_model=list[ProviderStatus])
def providers(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return [_status(p, _row(db, user, p)) for p in PROVIDERS]


@router.post("/validate", response_model=ValidateOut)
def validate(body: ValidateIn, user: User = Depends(get_current_user)):
    try:
        models = ai_providers.list_models(body.provider, body.api_key.strip())
    except ProviderError as exc:
        if exc.code == "invalid_key":
            return ValidateOut(valid=False, message=exc.message)
        raise _http(exc)
    return ValidateOut(valid=True, models=models[:300])


@router.get("/providers/{provider}/models", response_model=list[str])
def provider_models(provider: ProviderName, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = _row(db, user, provider)
    if row is None:
        raise HTTPException(status_code=404, detail="No key saved for this provider")
    try:
        return ai_providers.list_models(provider, _stored_key(row))[:300]
    except ProviderError as exc:
        raise _http(exc)


@router.put("/keys/{provider}", response_model=ProviderStatus)
def save_key(provider: ProviderName, body: KeyIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    existing = _row(db, user, provider)
    if body.api_key is None:
        if existing is None:
            raise HTTPException(status_code=400, detail="Enter an API key")
        key = _stored_key(existing)
    else:
        key = body.api_key.strip()
    try:
        models = ai_providers.list_models(provider, key)
    except ProviderError as exc:
        raise _http(exc)
    if models and body.model not in models:
        raise HTTPException(status_code=400, detail=f'Model "{body.model}" is not available for this key')

    if existing is None:
        has_any = db.scalar(select(AiProviderKey.id).where(AiProviderKey.user_id == user.id)) is not None
        existing = AiProviderKey(
            user_id=user.id, provider=provider, api_key_encrypted=encrypt(key),
            key_hint="…" + key[-4:], model=body.model, is_default=not has_any,
        )
        db.add(existing)
    else:
        existing.model = body.model
        if body.api_key is not None:
            existing.api_key_encrypted = encrypt(key)
            existing.key_hint = "…" + key[-4:]
    db.commit()
    db.refresh(existing)
    return _status(provider, existing)


@router.post("/keys/{provider}/default", response_model=ProviderStatus)
def make_default(provider: ProviderName, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(AiProviderKey).where(AiProviderKey.user_id == user.id)).all()
    target = next((r for r in rows if r.provider == provider), None)
    if target is None:
        raise HTTPException(status_code=404, detail="No key saved for this provider")
    for r in rows:
        r.is_default = r is target
    db.commit()
    return _status(provider, target)


@router.delete("/keys/{provider}", status_code=204)
def remove_key(provider: ProviderName, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = _row(db, user, provider)
    if row is None:
        raise HTTPException(status_code=404, detail="No key saved for this provider")
    was_default = row.is_default
    db.delete(row)
    db.flush()
    if was_default:
        nxt = db.scalar(select(AiProviderKey).where(AiProviderKey.user_id == user.id).order_by(AiProviderKey.id))
        if nxt:
            nxt.is_default = True
    db.commit()
    return Response(status_code=204)


@router.post("/chat", response_model=ChatOut)
def chat(body: ChatIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.provider:
        row = _row(db, user, body.provider)
    else:
        rows = db.scalars(select(AiProviderKey).where(AiProviderKey.user_id == user.id).order_by(AiProviderKey.id)).all()
        row = next((r for r in rows if r.is_default), rows[0] if rows else None)
    if row is None:
        raise HTTPException(status_code=400, detail="No AI provider configured. Add an API key in Settings.")

    dialect = {"postgresql": "PostgreSQL", "mysql": "MySQL", "mongodb": "MongoDB"}.get(body.dialect or "", "SQL")
    schema_text, tables_sent = "", 0
    if body.connection_id is not None:
        conn = db.get(DbConnection, body.connection_id)
        if conn is None or conn.user_id != user.id:
            raise HTTPException(status_code=404, detail="Connection not found")
        if not body.schema_name:
            raise HTTPException(status_code=400, detail="Choose a schema")
        try:
            if mongo_adapter.is_mongo(conn.engine):
                cap = mongo_tools.capture_schema(get_mongo_client(conn), body.schema_name)
            else:
                cap = schema_tools.capture_schema(get_engine(conn), conn.engine, body.schema_name)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Could not read the schema: {friendly_error(exc)}")
        if cap is None:
            raise HTTPException(status_code=404, detail="Schema not found")
        schema_text, tables_sent = ai_assistant.schema_context(cap)
        dialect = {"postgresql": "PostgreSQL", "mysql": "MySQL"}.get(conn.engine, "MongoDB")

    try:
        prompt = ai_assistant.user_prompt(body.mode, body.message, body.sql, body.error, dialect)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    history = [m.model_dump() for m in body.history] if body.mode == "chat" else []
    messages = ai_assistant.build_messages(dialect, schema_text, history, prompt)
    key = _stored_key(row)
    try:
        reply = ai_providers.chat(row.provider, key, row.model, messages)
    except ProviderError as exc:
        raise _http(exc)
    return ChatOut(
        reply=reply, provider=row.provider, model=row.model,
        suggested_sql=ai_assistant.extract_sql(reply), schema_tables_sent=tables_sent,
    )
