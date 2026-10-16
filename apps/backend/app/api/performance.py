from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.schemas import AnalyzeIn, AnalyzeOut, CreateIndexIn, CreateIndexOut
from app.core.db import get_db
from app.domain.models import DbConnection, User
from app.services import introspection, perf_analyzer, query_runner
from app.services.connections import friendly_error, get_engine

router = APIRouter(prefix="/connections/{connection_id}", tags=["performance"])


def _owned(db: Session, user: User, connection_id: int) -> DbConnection:
    row = db.get(DbConnection, connection_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Connection not found")
    return row


@router.post("/analyze", response_model=AnalyzeOut)
def analyze(connection_id: int, body: AnalyzeIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = _owned(db, user, connection_id)
    try:
        stmt, kind = query_runner.analyze(body.sql)
    except query_runner.SqlInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if kind not in perf_analyzer.ALLOWED_KINDS:
        raise HTTPException(status_code=400, detail="Only SELECT, INSERT, UPDATE and DELETE statements can be analyzed")
    if body.execute and kind != "SELECT":
        raise HTTPException(status_code=400, detail="Measuring actual execution is only allowed for SELECT statements")

    base = dict(engine=row.engine, analyzed=body.execute)
    try:
        engine = get_engine(row)
        if body.schema_name not in introspection.list_schemas(engine, row.engine):
            raise HTTPException(status_code=404, detail="Schema not found")
        result = query_runner.run_statement(
            engine=engine, db_kind=row.engine, user_id=user.id, query_id=body.query_id,
            sql=perf_analyzer.explain_sql(row.engine, stmt, body.execute),
            read_only=True, max_rows=100, timeout_s=body.timeout_seconds,
        )
    except HTTPException:
        raise
    except query_runner.SqlInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        return AnalyzeOut(status="error", message=friendly_error(exc), **base)

    if result["status"] != "ok":
        return AnalyzeOut(status=result["status"], message=result["message"], duration_ms=result["duration_ms"], **base)

    try:
        nodes, plan_summary, raw = perf_analyzer.parse_plan(row.engine, result["rows"], body.execute)
        findings, recs, counts = perf_analyzer.build_findings(engine, row.engine, body.schema_name, nodes, body.execute)
    except (KeyError, TypeError, IndexError, ValueError) as exc:
        return AnalyzeOut(status="error", message=f"Could not read the plan returned by the database ({exc.__class__.__name__})", **base)
    except Exception as exc:
        return AnalyzeOut(status="error", message=friendly_error(exc), **base)

    return AnalyzeOut(
        status="ok", plan=nodes, summary={**plan_summary, **counts}, findings=findings,
        recommendations=recs, raw_text=raw, duration_ms=result["duration_ms"], **base,
    )


@router.post("/indexes", response_model=CreateIndexOut)
def create_index(connection_id: int, body: CreateIndexIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not body.confirm:
        raise HTTPException(status_code=400, detail="Confirmation is required before creating an index")
    row = _owned(db, user, connection_id)
    try:
        engine = get_engine(row)
        if body.schema_name not in introspection.list_schemas(engine, row.engine):
            raise HTTPException(status_code=404, detail="Schema not found")
        name, sql = perf_analyzer.create_index(engine, row.engine, body.schema_name, body.table, body.columns)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Index creation failed: {friendly_error(exc)}")
    return CreateIndexOut(created=True, index_name=name, sql=sql)
