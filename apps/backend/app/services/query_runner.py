import datetime
import json
import math
import threading
import time
from dataclasses import dataclass

import sqlparse
from sqlalchemy.engine import Engine

from app.services.connections import friendly_error

DESTRUCTIVE = {"DROP", "TRUNCATE", "ALTER", "DELETE", "UPDATE"}


class SqlInputError(ValueError):
    pass


class _Aborted(Exception):
    pass


@dataclass
class Running:
    user_id: int
    engine: Engine
    db_kind: str
    backend_id: int | None = None
    reason: str | None = None  # "cancelled" | "timeout"


_running: dict[str, Running] = {}
_lock = threading.Lock()


def analyze(sql: str) -> tuple[str, str]:
    """Return (single statement, statement type). Rejects empty or multi-statement input."""
    parts = []
    for raw in sqlparse.split(sql):
        stmt = raw.strip().rstrip(";").strip()
        if sqlparse.format(stmt, strip_comments=True).strip():
            parts.append(stmt)
    if not parts:
        raise SqlInputError("Enter a SQL statement to run")
    if len(parts) > 1:
        raise SqlInputError("Run one statement at a time. Select the statement and press Run.")
    stmt = parts[0]
    parsed = sqlparse.parse(stmt)[0]
    kind = parsed.get_type()
    if kind == "UNKNOWN":
        first = parsed.token_first(skip_cm=True)
        kind = first.value.upper().split()[0] if first is not None else "UNKNOWN"
    return stmt, kind


def to_jsonable(v):
    if v is None or isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, float):
        return v if math.isfinite(v) else str(v)
    if isinstance(v, (datetime.datetime, datetime.date, datetime.time)):
        return v.isoformat()
    if isinstance(v, (bytes, bytearray, memoryview)):
        return f"<binary {len(bytes(v))} bytes>"
    if isinstance(v, (dict, list)):
        return json.dumps(v, default=str)
    return str(v)  # Decimal, UUID, timedelta, ...


def _cancel(run: Running, reason: str) -> bool:
    run.reason = run.reason or reason
    if run.backend_id is None:
        return True  # not started yet; the runner checks run.reason before executing
    try:
        with run.engine.connect() as conn:
            if run.db_kind == "postgresql":
                conn.exec_driver_sql("SELECT pg_cancel_backend(%(pid)s)", {"pid": run.backend_id})
            else:
                conn.exec_driver_sql(f"KILL QUERY {int(run.backend_id)}")
        return True
    except Exception:
        return False


def cancel(query_id: str, user_id: int) -> bool:
    with _lock:
        run = _running.get(query_id)
    if run is None or run.user_id != user_id:
        return False
    return _cancel(run, "cancelled")


def run_statement(*, engine: Engine, db_kind: str, user_id: int, query_id: str,
                  sql: str, read_only: bool, max_rows: int, timeout_s: int) -> dict:
    started = time.perf_counter()
    run = Running(user_id=user_id, engine=engine, db_kind=db_kind)
    with _lock:
        if query_id in _running:
            raise SqlInputError("Duplicate query id")
        _running[query_id] = run

    timer = threading.Timer(timeout_s, _cancel, args=(run, "timeout"))
    timer.daemon = True
    out: dict = {
        "status": "ok", "message": None, "columns": [], "rows": [],
        "row_count": 0, "rows_affected": None, "truncated": False,
    }
    try:
        with engine.connect() as conn:
            conn.execution_options(no_parameters=True)  # raw SQL: no % or :name interpretation
            if read_only:
                conn.exec_driver_sql("SET TRANSACTION READ ONLY")
            pid_sql = "SELECT pg_backend_pid()" if db_kind == "postgresql" else "SELECT CONNECTION_ID()"
            run.backend_id = int(conn.exec_driver_sql(pid_sql).scalar_one())
            timer.start()
            if run.reason:
                raise _Aborted()

            result = conn.exec_driver_sql(sql)
            if result.returns_rows:
                columns = list(result.keys())
                fetched = result.fetchmany(max_rows + 1)
                out["truncated"] = len(fetched) > max_rows
                out["columns"] = columns
                out["rows"] = [[to_jsonable(v) for v in r] for r in fetched[:max_rows]]
                out["row_count"] = len(out["rows"])
                result.close()
            else:
                out["rows_affected"] = result.rowcount
            if not read_only:
                conn.commit()
    except Exception as exc:
        if run.reason == "timeout":
            out.update(status="timeout", message=f"Stopped: exceeded the {timeout_s}s time limit")
        elif run.reason == "cancelled":
            out.update(status="cancelled", message="Query cancelled")
        else:
            out.update(status="error", message=friendly_error(exc))
        out.update(columns=[], rows=[], row_count=0, rows_affected=None, truncated=False)
    finally:
        timer.cancel()
        with _lock:
            _running.pop(query_id, None)

    out["duration_ms"] = int((time.perf_counter() - started) * 1000)
    return out
