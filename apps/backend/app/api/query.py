from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.adapters import mongo as mongo_adapter
from app.api.deps import get_current_user
from app.api.policy import SecurityPolicy, load_policy
from app.api.ratelimit import client_ip, limit_user
from app.api.schemas import CancelIn, CancelOut, ExecuteIn, ExecuteOut
from app.core.db import get_db
from app.domain.models import DbConnection, User
from app.services import audit, history, mongo_runner, query_runner
from app.services.connections import friendly_error, get_engine, get_mongo_client

router = APIRouter(prefix="/connections/{connection_id}/query", tags=["query"])

READ_KINDS = {"SELECT", "SHOW", "EXPLAIN", "DESCRIBE", "DESC", "VALUES", "TABLE"}


def _owned(db: Session, user: User, connection_id: int) -> DbConnection:
    row = db.get(DbConnection, connection_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Connection not found")
    return row


def _blocked(db: Session, user_id: int, kind: str, ip: str) -> None:
    audit.record(db, user_id, "policy.blocked", f"{kind} blocked: destructive statements are off", ip)
    raise HTTPException(status_code=403, detail="Blocked by your security settings: destructive statements are not allowed")


def _audit_write(db: Session, user_id: int, kind: str, destructive: bool, conn_name: str, ip: str) -> None:
    # the statement type and the connection only, never the SQL text
    audit.record(db, user_id, "query.destructive" if destructive else "query.write", f"{kind} on {conn_name}", ip)


def _execute_mongo(row: DbConnection, body: ExecuteIn, user: User, db: Session, policy: SecurityPolicy,
                   read_only: bool, timeout_s: int, max_rows: int, ip: str) -> ExecuteOut:
    conn_name = row.name
    try:
        cmd = mongo_runner.parse_command(body.sql)
    except mongo_runner.MongoInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if policy.block_destructive and cmd.destructive:
        _blocked(db, user.id, cmd.kind, ip)
    if cmd.is_write and not read_only and cmd.destructive and not body.confirm_destructive:
        return ExecuteOut(status="confirmation_required", statement_type=cmd.kind)

    text = body.sql.strip().rstrip(";").strip()
    try:
        result = mongo_runner.run_command(
            client=get_mongo_client(row), db_name=row.database, user_id=user.id, query_id=body.query_id,
            cmd=cmd, read_only=read_only, max_rows=max_rows, timeout_s=timeout_s,
        )
    except mongo_runner.MongoInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        history.record(db, user.id, row, text, cmd.kind, {"status": "error", "duration_ms": 0, "row_count": 0})
        return ExecuteOut(status="error", message=friendly_error(exc), statement_type=cmd.kind)

    response = ExecuteOut(statement_type=cmd.kind, **result)
    history.record(db, user.id, row, text, cmd.kind, result)
    if result["status"] == "ok" and cmd.is_write and not read_only:
        _audit_write(db, user.id, cmd.kind, cmd.destructive, conn_name, ip)
    return response


@router.post("/execute", response_model=ExecuteOut, dependencies=[Depends(limit_user("execute", 120, 60))])
def execute(connection_id: int, body: ExecuteIn, request: Request,
            user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = _owned(db, user, connection_id)
    policy = load_policy(db, user.id)
    # The account's security settings win over what the browser asks for.
    read_only = body.read_only or policy.force_read_only
    timeout_s = min(body.timeout_seconds, policy.query_timeout_seconds)
    max_rows = min(body.max_rows, policy.max_rows)
    ip = client_ip(request)

    if mongo_adapter.is_mongo(row.engine):
        return _execute_mongo(row, body, user, db, policy, read_only, timeout_s, max_rows, ip)

    conn_name = row.name
    try:
        stmt, kind = query_runner.analyze(body.sql)
    except query_runner.SqlInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    destructive = kind in query_runner.DESTRUCTIVE
    if policy.block_destructive and destructive:
        _blocked(db, user.id, kind, ip)
    if not read_only and destructive and not body.confirm_destructive:
        return ExecuteOut(status="confirmation_required", statement_type=kind)

    try:
        engine = get_engine(row)
        result = query_runner.run_statement(
            engine=engine, db_kind=row.engine, user_id=user.id, query_id=body.query_id,
            sql=stmt, read_only=read_only, max_rows=max_rows, timeout_s=timeout_s,
        )
    except query_runner.SqlInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        history.record(db, user.id, row, stmt, kind, {"status": "error", "duration_ms": 0, "row_count": 0})
        return ExecuteOut(status="error", message=friendly_error(exc), statement_type=kind)

    response = ExecuteOut(statement_type=kind, **result)
    history.record(db, user.id, row, stmt, kind, result)
    if result["status"] == "ok" and not read_only and kind not in READ_KINDS:
        _audit_write(db, user.id, kind, destructive, conn_name, ip)
    return response


@router.post("/cancel", response_model=CancelOut)
def cancel(connection_id: int, body: CancelIn,
           user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _owned(db, user, connection_id)
    cancelled = query_runner.cancel(body.query_id, user.id) or mongo_runner.cancel(body.query_id, user.id)
    return CancelOut(cancelled=cancelled)
