import csv
import io
import math
import re
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone
from datetime import time as dtime
from decimal import Decimal
from pathlib import Path

import pandas as pd
from sqlalchemy import (
    BigInteger, Boolean, Column, Date, DateTime, Double, Integer, MetaData,
    String, Table, Text, func, inspect, select,
)
from sqlalchemy import types as sqltypes
from sqlalchemy.engine import Engine

from app.core.config import settings
from app.services.connections import friendly_error

UPLOAD_DIR = Path(tempfile.gettempdir()) / "dbforge_uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
TTL_SECONDS = 3600
MAX_ERRORS = 100
BATCH = 1000
IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")


class ImportInputError(ValueError):
    pass


# ---------- upload registry (in memory, single worker) ----------

@dataclass
class ImportMeta:
    id: str
    user_id: int
    path: Path
    filename: str
    kind: str  # "csv" | "xlsx"
    created: float


_imports: dict[str, ImportMeta] = {}
_lock = threading.Lock()


def _purge_expired() -> None:
    now = time.time()
    with _lock:
        for iid in [i for i, m in _imports.items() if now - m.created > TTL_SECONDS]:
            _imports.pop(iid).path.unlink(missing_ok=True)


def save_upload(user_id: int, filename: str, data: bytes) -> ImportMeta:
    _purge_expired()
    name = filename.lower()
    if name.endswith((".csv", ".tsv", ".txt")):
        kind, ext = "csv", "csv"
    elif name.endswith(".xlsx"):
        if not data.startswith(b"PK"):
            raise ImportInputError("This is not a valid .xlsx file")
        kind, ext = "xlsx", "xlsx"
    else:
        raise ImportInputError("Only .csv, .tsv, .txt and .xlsx files are supported")
    iid = uuid.uuid4().hex
    path = UPLOAD_DIR / f"{iid}.{ext}"
    path.write_bytes(data)
    meta = ImportMeta(iid, user_id, path, Path(filename).name[:120], kind, time.time())
    with _lock:
        _imports[iid] = meta
    return meta


def get_meta(import_id: str, user_id: int) -> ImportMeta | None:
    with _lock:
        meta = _imports.get(import_id)
    return meta if meta and meta.user_id == user_id and meta.path.exists() else None


def delete_import(import_id: str, user_id: int) -> bool:
    meta = get_meta(import_id, user_id)
    if meta is None:
        return False
    with _lock:
        _imports.pop(import_id, None)
    meta.path.unlink(missing_ok=True)
    return True


# ---------- reading ----------

def _detect_encoding(data: bytes) -> str:
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return "utf-16"
    for enc in ("utf-8-sig", "cp1252"):
        try:
            data.decode(enc)
            return enc
        except UnicodeDecodeError:
            continue
    return "latin-1"


def load_frame(meta: ImportMeta, sheet: str | None = None) -> tuple[pd.DataFrame, dict]:
    info: dict = {"encoding": None, "delimiter": None, "sheets": [], "sheet": None}
    try:
        if meta.kind == "csv":
            data = meta.path.read_bytes()
            enc = _detect_encoding(data)
            text = data.decode(enc)
            try:
                delim = csv.Sniffer().sniff(text[:20000], delimiters=",;\t|").delimiter
            except csv.Error:
                delim = ","
            df = pd.read_csv(io.StringIO(text), sep=delim, dtype=str, keep_default_na=False,
                             nrows=settings.max_import_rows + 1)
            info.update(encoding=enc, delimiter=delim)
        else:
            with pd.ExcelFile(meta.path, engine="openpyxl") as xl:
                info["sheets"] = list(xl.sheet_names)
                chosen = sheet if sheet in xl.sheet_names else xl.sheet_names[0]
                df = xl.parse(chosen, dtype=str, keep_default_na=False)
                info["sheet"] = chosen
    except Exception as exc:
        raise ImportInputError(f"Could not read the file: {str(exc)[:200]}") from exc
    if len(df) > settings.max_import_rows:
        raise ImportInputError(f"The file has more than {settings.max_import_rows} rows. Split it and import in parts.")
    if df.shape[1] == 0 or len(df) == 0:
        raise ImportInputError("The file has no data rows")
    return df, info


# ---------- profiling ----------

def sanitize_names(cols) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for i, c in enumerate(cols):
        s = re.sub(r"[^a-z0-9_]+", "_", str(c).strip().lower()).strip("_")
        if not s:
            s = f"column_{i + 1}"
        if s[0].isdigit():
            s = f"c_{s}"
        s = s[:60]
        base, n = s, 2
        while s in seen:
            s = f"{base[:57]}_{n}"
            n += 1
        seen.add(s)
        out.append(s)
    return out


def suggest_table_name(filename: str) -> str:
    s = re.sub(r"[^a-z0-9_]+", "_", Path(filename).stem.lower()).strip("_") or "imported_data"
    return (f"t_{s}" if s[0].isdigit() else s)[:60]


_INT_RE = re.compile(r"^[+-]?\d+$", re.ASCII)
_STRICT_INT_RE = re.compile(r"^[+-]?(0|[1-9]\d*)$", re.ASCII)
_NUM_RE = re.compile(r"^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$", re.ASCII)
_STRICT_NUM_RE = re.compile(r"^[+-]?((0|[1-9]\d*)(\.\d+)?|\.\d+)([eE][+-]?\d+)?$", re.ASCII)
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$", re.ASCII)
_TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?$", re.ASCII)
_BOOL_WORDS = {"true", "false", "t", "f", "yes", "no", "y", "n"}
_TRUE = {"true", "t", "yes", "y", "1"}
_FALSE = {"false", "f", "no", "n", "0"}


def _parse_ts(s: str) -> datetime:
    if not _TS_RE.match(s):
        raise ValueError("not an ISO date-time (YYYY-MM-DD HH:MM[:SS])")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        raise ValueError("invalid date-time")
    if dt.tzinfo is not None:  # stored as UTC without timezone
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _parse_date(s: str) -> date:
    if _DATE_RE.match(s):
        try:
            return date.fromisoformat(s)
        except ValueError:
            raise ValueError("invalid calendar date")
    dt = _parse_ts(s)
    if dt.time() != dtime(0):
        raise ValueError("has a time component, but the column is a date")
    return dt.date()


def infer_type(values: list[str], kind: str) -> str:
    if not values:
        return "text"
    if all(v.lower() in _BOOL_WORDS for v in values):
        return "boolean"
    if all(_STRICT_INT_RE.match(v) for v in values):
        nums = [int(v) for v in values]
        lo, hi = min(nums), max(nums)
        if -(2**31) <= lo and hi < 2**31:
            return "integer"
        if -(2**63) <= lo and hi < 2**63:
            return "bigint"
        return "text"  # beyond bigint: keep exact digits as text
    if all(_STRICT_NUM_RE.match(v) and math.isfinite(float(v)) for v in values):
        return "float"
    try:
        if all(_DATE_RE.match(v) for v in values):
            for v in values:
                date.fromisoformat(v)
            return "date"
        if all(_TS_RE.match(v) for v in values):
            stamps = [_parse_ts(v) for v in values]
            if kind == "xlsx" and all(s.time() == dtime(0) for s in stamps):
                return "date"  # Excel stores date-only cells as midnight timestamps
            return "timestamp"
    except ValueError:
        pass
    return "varchar" if max(len(v) for v in values) <= 255 else "text"


def profile_frame(df: pd.DataFrame, kind: str) -> dict:
    names = sanitize_names(df.columns)
    n = len(df)
    columns: list[dict] = []
    keys: list[str] = []
    for i, name in enumerate(names):
        s = df.iloc[:, i].str.strip()
        nonnull = s[s != ""]
        values = nonnull.tolist()
        distinct = int(nonnull.nunique())
        is_key = len(values) == n and distinct == n
        if is_key:
            keys.append(name)
        columns.append({
            "index": i, "name": name, "original_name": str(df.columns[i]),
            "inferred_type": infer_type(values, kind),
            "null_count": n - len(values), "distinct_count": distinct,
            "max_length": max((len(v) for v in values), default=0),
            "samples": [v[:40] for v in list(dict.fromkeys(values))[:3]],
            "is_key_candidate": is_key,
        })
    suggested_pk = "id" if "id" in keys else next((k for k in keys if k.endswith("_id")), None)
    return {
        "row_count": n,
        "duplicate_row_count": int(df.duplicated().sum()),
        "columns": columns,
        "key_candidates": keys,
        "preview_columns": [str(c) for c in df.columns],
        "preview_rows": df.head(20).values.tolist(),
        "suggested_primary_key": suggested_pk,
    }


# ---------- validation / conversion ----------

@dataclass
class ColSpec:
    index: int
    target: str
    gtype: str
    nullable: bool
    primary_key: bool
    label: str
    max_len: int | None = None


def convert(raw: str, spec: ColSpec):
    if raw.strip() == "":
        if not spec.nullable:
            raise ValueError("empty value in a NOT NULL column")
        return None
    t = spec.gtype
    if t in ("varchar", "text"):
        if "\x00" in raw:
            raise ValueError("contains a NUL character")
        if t == "varchar" and spec.max_len and len(raw) > spec.max_len:
            raise ValueError(f"longer than {spec.max_len} characters")
        return raw
    s = raw.strip()
    if t in ("smallint", "integer", "bigint"):
        if not _INT_RE.match(s):
            raise ValueError("not a whole number")
        v = int(s)
        bits = {"smallint": 15, "integer": 31, "bigint": 63}[t]
        if not -(2**bits) <= v < 2**bits:
            raise ValueError("number out of range")
        return v
    if t in ("float", "decimal"):
        if not _NUM_RE.match(s):
            raise ValueError("not a number")
        if t == "decimal":
            return Decimal(s)
        v = float(s)
        if not math.isfinite(v):
            raise ValueError("number out of range")
        return v
    if t == "boolean":
        low = s.lower()
        if low in _TRUE:
            return True
        if low in _FALSE:
            return False
        raise ValueError("not a boolean (true/false, yes/no, 1/0)")
    if t == "date":
        return _parse_date(s)
    if t == "timestamp":
        if _DATE_RE.match(s):
            return datetime.combine(_parse_date(s), dtime())
        return _parse_ts(s)
    raise ValueError(f"unsupported type {t}")


def _generic_type(t) -> str | None:
    if isinstance(t, sqltypes.Boolean):
        return "boolean"
    if isinstance(t, sqltypes.SmallInteger):
        return "smallint"
    if isinstance(t, sqltypes.BigInteger):
        return "bigint"
    if isinstance(t, sqltypes.Integer):
        return "integer"
    if isinstance(t, sqltypes.Float):
        return "float"
    if isinstance(t, sqltypes.Numeric):
        return "decimal"
    if isinstance(t, sqltypes.DateTime):
        return "timestamp"
    if isinstance(t, sqltypes.Date):
        return "date"
    if isinstance(t, sqltypes.String):
        return "varchar" if getattr(t, "length", None) else "text"
    return None


_SA_TYPES = {
    "integer": Integer, "bigint": BigInteger, "float": Double, "boolean": Boolean,
    "date": Date, "timestamp": DateTime, "varchar": String(255), "text": Text,
}


def _sa_type(gtype: str):
    t = _SA_TYPES[gtype]
    return t() if isinstance(t, type) else t


# ---------- import ----------

def _report(status: str, message: str, **kw) -> dict:
    base = {
        "status": status, "message": message, "rows_read": 0, "rows_valid": 0, "rows_invalid": 0,
        "rows_inserted": 0, "db_rows_before": None, "db_rows_after": None,
        "error_count": 0, "errors": [], "errors_truncated": False,
    }
    base.update(kw)
    return base


def run_import(*, engine: Engine, kind: str, sa_schema: str | None, display_table: str, table_name: str,
               mode: str, df: pd.DataFrame, maps: list, on_error: str) -> dict:
    insp = inspect(engine)
    exists = insp.has_table(table_name, schema=sa_schema)
    specs: list[ColSpec] = []

    if mode == "create":
        if not IDENT_RE.match(table_name):
            raise ImportInputError("Table name must start with a letter or underscore and use only letters, digits and underscores (max 63)")
        if exists:
            raise ImportInputError(f'Table "{table_name}" already exists. Use append mode or choose another name.')
        for m in maps:
            if not IDENT_RE.match(m.target):
                raise ImportInputError(f'Invalid column name "{m.target}"')
            specs.append(ColSpec(m.source_index, m.target, m.type, False if m.primary_key else m.nullable,
                                 m.primary_key, str(df.columns[m.source_index]),
                                 255 if m.type == "varchar" else None))
        table = Table(
            table_name, MetaData(),
            *[Column(s.target, _sa_type(s.gtype), primary_key=s.primary_key, nullable=s.nullable,
                     autoincrement=False if s.primary_key else "auto") for s in specs],
            schema=sa_schema,
        )
    else:
        if not exists:
            raise ImportInputError(f'Table "{table_name}" does not exist. Use create mode.')
        table = Table(table_name, MetaData(), autoload_with=engine, schema=sa_schema)
        mapped = {m.target for m in maps}
        for m in maps:
            col = table.columns.get(m.target)
            if col is None:
                raise ImportInputError(f'Column "{m.target}" does not exist in table "{table_name}"')
            gtype = _generic_type(col.type)
            if gtype is None:
                raise ImportInputError(f'Column "{m.target}" has type {col.type}, which import does not support')
            specs.append(ColSpec(m.source_index, m.target, gtype, bool(col.nullable), False,
                                 str(df.columns[m.source_index]), getattr(col.type, "length", None)))
        for col in table.columns:
            if col.name in mapped or col.nullable or col.server_default is not None or col.default is not None:
                continue
            if col.primary_key and isinstance(col.type, sqltypes.Integer):
                continue
            raise ImportInputError(f'Column "{col.name}" is NOT NULL without a default and is not mapped')

    # ----- validate every row before touching the database -----
    n = len(df)
    data = [df.iloc[:, s.index].tolist() for s in specs]
    pk_specs = [s for s in specs if s.primary_key]
    errors: list[dict] = []
    error_count = invalid_rows = 0
    pk_seen: set = set()
    valid: list[dict] = []

    def add_error(row: int, column: str, value: str, message: str) -> None:
        nonlocal error_count
        error_count += 1
        if len(errors) < MAX_ERRORS:
            errors.append({"row": row, "column": column, "value": value[:80], "message": message})

    for r in range(n):
        row_ok = True
        out: dict = {}
        for s, col in zip(specs, data):
            try:
                out[s.target] = convert(col[r], s)
            except ValueError as exc:
                row_ok = False
                add_error(r + 2, s.label, col[r], str(exc))
        if row_ok and pk_specs:
            key = tuple(out[s.target] for s in pk_specs)
            if key in pk_seen:
                row_ok = False
                add_error(r + 2, ", ".join(s.label for s in pk_specs), str(key[0]), "duplicate primary key value in the file")
            else:
                pk_seen.add(key)
        if row_ok:
            valid.append(out)
        else:
            invalid_rows += 1

    common = dict(rows_read=n, rows_valid=len(valid), rows_invalid=invalid_rows,
                  error_count=error_count, errors=errors, errors_truncated=error_count > len(errors))
    if invalid_rows and on_error == "abort":
        return _report("failed", f"{invalid_rows} row(s) failed validation. Nothing was imported. Fix the file or choose to skip invalid rows.", **common)
    if not valid:
        return _report("failed", "There are no valid rows to import.", **common)

    # ----- one transaction: DDL (if create) + all inserts + row-count check -----
    created = False
    try:
        with engine.begin() as conn:
            if mode == "create":
                table.create(conn)
                created = True
                before = 0
            else:
                before = conn.scalar(select(func.count()).select_from(table)) or 0
            for i in range(0, len(valid), BATCH):
                conn.execute(table.insert(), valid[i:i + BATCH])
            after = conn.scalar(select(func.count()).select_from(table)) or 0
            if after - before != len(valid):
                raise RuntimeError(f"row count check failed: expected {len(valid)} new rows, the database reports {after - before}")
    except Exception as exc:
        note = ""
        if created and kind == "mysql":  # MySQL commits DDL immediately
            try:
                table.drop(engine, checkfirst=True)
                note = " The new table was removed again."
            except Exception:
                note = " MySQL cannot roll back table creation. Check for a leftover table and drop it manually."
        return _report("failed", f"Import failed and was rolled back: {friendly_error(exc)}.{note}", **common)

    skipped = f" {invalid_rows} invalid row(s) were skipped." if invalid_rows else ""
    return _report("ok", f"Imported {len(valid)} row(s) into {display_table}.{skipped}",
                   rows_inserted=len(valid), db_rows_before=before, db_rows_after=after, **common)
