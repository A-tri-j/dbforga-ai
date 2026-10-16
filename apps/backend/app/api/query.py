from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.adapters import mongo as mongo_adapter
from app.api.deps import get_current_user
from app.api.schemas import CancelIn, CancelOut, ExecuteIn, ExecuteOut
from app.core.db import get_db
from app.domain.models import DbConnection, User
from app.services import history, mongo_runner, query_runner
from app.services.connections import friendly_error, get_engine, get_mongo_client

router = APIRouter(prefix="/connections/{connection_id}/query", tags=["query"])


def _owned(db: Session, user: User, connection_id: int) -> DbConnection:
    row = db.get(DbConnection, connection_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Connection not found")
    return row


def _execute_mongo(row: DbConnection, body: ExecuteIn, user: User, db: Session) -> ExecuteOut:
    try:
        cmd = mongo_runner.parse_command(body.sql)
    except mongo_runner.MongoInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if cmd.is_write and not body.read_only and cmd.destructive and not body.confirm_destructive:
        return ExecuteOut(status="confirmation_required", statement_type=cmd.kind)

    text = body.sql.strip().rstrip(";").strip()
    try:
        result = mongo_runner.run_command(
            client=get_mongo_client(row), db_name=row.database, user_id=user.id, query_id=body.query_id,
            cmd=cmd, read_only=body.read_only, max_rows=body.max_rows, timeout_s=body.timeout_seconds,
        )
    except mongo_runner.MongoInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        history.record(db, user.id, row, text, cmd.kind, {"status": "error", "duration_ms": 0, "row_count": 0})
        return ExecuteOut(status="error", message=friendly_error(exc), statement_type=cmd.kind)

    response = ExecuteOut(statement_type=cmd.kind, **result)
    history.record(db, user.id, row, text, cmd.kind, result)
    return response


@router.post("/execute", response_model=ExecuteOut)
def execute(connection_id: int, body: ExecuteIn,
            user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = _owned(db, user, connection_id)
    if mongo_adapter.is_mongo(row.engine):
        return _execute_mongo(row, body, user, db)

    try:
        stmt, kind = query_runner.analyze(body.sql)
    except query_runner.SqlInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not body.read_only and kind in query_runner.DESTRUCTIVE and not body.confirm_destructive:
        return ExecuteOut(status="confirmation_required", statement_type=kind)

    try:
        engine = get_engine(row)
        result = query_runner.run_statement(
            engine=engine, db_kind=row.engine, user_id=user.id, query_id=body.query_id,
            sql=stmt, read_only=body.read_only, max_rows=body.max_rows,
            timeout_s=body.timeout_seconds,
        )
    except query_runner.SqlInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        failed = {"status": "error", "duration_ms": 0, "row_count": 0}
        history.record(db, user.id, row, stmt, kind, failed)
        return ExecuteOut(status="error", message=friendly_error(exc), statement_type=kind)

    response = ExecuteOut(statement_type=kind, **result)
    history.record(db, user.id, row, stmt, kind, result)
    return response


@router.post("/cancel", response_model=CancelOut)
def cancel(connection_id: int, body: CancelIn,
           user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _owned(db, user, connection_id)
    cancelled = query_runner.cancel(body.query_id, user.id) or mongo_runner.cancel(body.query_id, user.id)
    return CancelOut(cancelled=cancelled)
