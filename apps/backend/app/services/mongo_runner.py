import datetime as dt
import json
import math
import re
import threading
import time
from dataclasses import dataclass

import json5
from bson import Decimal128, ObjectId, json_util
from pymongo import MongoClient
from pymongo.errors import ExecutionTimeout

from app.adapters.mongo import mongo_error


class MongoInputError(ValueError):
    pass


READ_METHODS = {"find", "findOne", "countDocuments", "estimatedDocumentCount", "distinct", "aggregate"}
KINDS = {
    "find": "FIND", "findOne": "FIND", "countDocuments": "COUNT", "estimatedDocumentCount": "COUNT",
    "distinct": "DISTINCT", "aggregate": "AGGREGATE", "insertOne": "INSERT", "insertMany": "INSERT",
    "updateOne": "UPDATE", "updateMany": "UPDATE", "replaceOne": "UPDATE", "deleteOne": "DELETE",
    "deleteMany": "DELETE", "createIndex": "CREATE", "createCollection": "CREATE", "dropIndex": "DROP", "drop": "DROP",
}
DESTRUCTIVE_KINDS = {"UPDATE", "DELETE", "DROP"}
FORBIDDEN = {"$where", "$function", "$accumulator"}  # server-side JavaScript
WRITE_STAGES = {"$out", "$merge"}
INDEX_OPTIONS = {"unique", "name", "sparse", "expireAfterSeconds"}

_REWRITES = [
    (re.compile(r'ObjectId\(\s*(["\'])([0-9a-fA-F]{24})\1\s*\)'), r'{"$oid": "\2"}'),
    (re.compile(r'(?:new\s+)?(?:ISODate|Date)\(\s*(["\'])([^"\']+)\1\s*\)'), r'{"$date": "\2"}'),
    (re.compile(r'(?:NumberInt|NumberLong)\(\s*["\']?(-?\d+)["\']?\s*\)'), r"\1"),
    (re.compile(r'NumberDecimal\(\s*["\']([^"\']+)["\']\s*\)'), r'{"$numberDecimal": "\1"}'),
]
_HEAD = re.compile(r'^\s*db\s*\.\s*(?:getCollection\(\s*(["\'])(.+?)\1\s*\)|([A-Za-z_][A-Za-z0-9_]*))\s*\.\s*([A-Za-z]+)\s*\(')
_HEAD_DB = re.compile(r"^\s*db\s*\.\s*(createCollection)\s*\(")
_CHAIN = re.compile(r"\s*\.\s*([A-Za-z]+)\s*\(")
_COMMENTS = re.compile(r"^(?:\s+|//[^\n]*(?:\n|$)|/\*.*?\*/)+", re.DOTALL)


def parse_value(text: str):
    """Relaxed JSON (mongosh style) -> BSON values. No JavaScript is evaluated."""
    t = text.strip()
    for pattern, repl in _REWRITES:
        t = pattern.sub(repl, t)
    try:
        obj = json5.loads(t)
        return json_util.loads(json.dumps(obj))
    except Exception:
        raise MongoInputError("Could not read this value as a JSON document. Use { field: value } syntax.")


def _balanced(s: str, start: int) -> tuple[str, int]:
    """s[start] is '('. Returns (text inside, index after the matching ')')."""
    depth, quote, i = 0, None, start
    while i < len(s):
        c = s[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = None
        elif c in "\"'`":
            quote = c
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth == 0:
                return s[start + 1:i], i + 1
        i += 1
    raise MongoInputError("The brackets in the query are not balanced")


def _split_args(text: str) -> list[str]:
    parts: list[str] = []
    depth, quote, start, i = 0, None, 0, 0
    while i < len(text):
        c = text[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = None
        elif c in "\"'`":
            quote = c
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        elif c == "," and depth == 0:
            parts.append(text[start:i])
            start = i + 1
        i += 1
    parts.append(text[start:])
    return [p for p in parts if p.strip()]


def _scan(obj, found: set[str]) -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(k, str) and (k in FORBIDDEN or k in WRITE_STAGES):
                found.add(k)
            _scan(v, found)
    elif isinstance(obj, list):
        for x in obj:
            _scan(x, found)


@dataclass
class Command:
    coll: str | None
    method: str
    args: list
    sort: dict | None = None
    limit: int | None = None
    skip: int | None = None
    kind: str = "FIND"
    is_write: bool = False
    destructive: bool = False


def parse_command(text: str) -> Command:
    s = _COMMENTS.sub("", text.strip(), count=1).strip()
    m = _HEAD.match(s)
    if m:
        coll, method, open_at = m.group(2) or m.group(3), m.group(4), m.end() - 1
    else:
        m = _HEAD_DB.match(s)
        if not m:
            raise MongoInputError('Write queries like db.collection.find({ ... }). A query starts with "db."')
        coll, method, open_at = None, m.group(1), m.end() - 1
    if method not in KINDS:
        raise MongoInputError(f"{method}() is not supported. Supported: {', '.join(sorted(KINDS))}")

    args_text, pos = _balanced(s, open_at)
    cmd = Command(coll, method, [parse_value(a) for a in _split_args(args_text)])

    while True:
        mm = _CHAIN.match(s, pos)
        if not mm:
            break
        name = mm.group(1)
        inner, pos = _balanced(s, mm.end() - 1)
        if name in ("toArray", "pretty"):
            continue
        if method != "find" or name not in ("sort", "limit", "skip"):
            raise MongoInputError(f".{name}() is not supported here. Supported after find(): sort, limit, skip")
        value = parse_value(inner)
        if name == "sort":
            if not isinstance(value, dict):
                raise MongoInputError("sort() needs an object, like { name: 1 }")
            cmd.sort = value
        else:
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                raise MongoInputError(f"{name}() needs a whole number")
            setattr(cmd, name, value)

    if _COMMENTS.sub("", s[pos:], count=1).strip().rstrip(";").strip():
        raise MongoInputError("Unexpected text after the query. End each query with a semicolon.")

    cmd.kind = KINDS[method]
    cmd.is_write = method not in READ_METHODS
    cmd.destructive = cmd.kind in DESTRUCTIVE_KINDS
    found: set[str] = set()
    _scan(cmd.args, found)
    if found & FORBIDDEN:
        raise MongoInputError("JavaScript execution ($where, $function, $accumulator) is not allowed")
    if found & WRITE_STAGES:
        cmd.is_write = True
        cmd.destructive = True
    return cmd


# ---------- running ----------

@dataclass
class Running:
    user_id: int
    client: MongoClient
    reason: str | None = None


_running: dict[str, Running] = {}
_lock = threading.Lock()


def cancel(query_id: str, user_id: int) -> bool:
    """Best effort: needs permission to run currentOp / killOp."""
    with _lock:
        run = _running.get(query_id)
    if run is None or run.user_id != user_id:
        return False
    run.reason = run.reason or "cancelled"
    try:
        ops = run.client.admin.command("currentOp", 1, **{"command.comment": query_id}).get("inprog", [])
        for op in ops:
            run.client.admin.command("killOp", 1, op=op["opid"])
        return bool(ops)
    except Exception:
        return False


def _cell(v):
    if v is None or isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, float):
        return v if math.isfinite(v) else str(v)
    if isinstance(v, ObjectId):
        return str(v)
    if isinstance(v, dt.datetime):
        return v.isoformat()
    if isinstance(v, Decimal128):
        return str(v.to_decimal())
    if isinstance(v, (bytes, bytearray)):
        return f"<binary {len(v)} bytes>"
    try:
        return json_util.dumps(v, json_options=json_util.RELAXED_JSON_OPTIONS)
    except Exception:
        return str(v)


def _doc(value, what: str) -> dict:
    if not isinstance(value, dict):
        raise MongoInputError(f"The {what} must be an object, like {{ field: value }}")
    return value


def _fill(out: dict, docs: list[dict], truncated: bool) -> None:
    cols: list[str] = []
    for d in docs:
        for k in d.keys():
            if k not in cols and len(cols) < 60:
                cols.append(k)
    out["columns"] = cols
    out["rows"] = [[_cell(d.get(c)) for c in cols] for d in docs]
    out["documents"] = [json.loads(json_util.dumps(d, json_options=json_util.RELAXED_JSON_OPTIONS)) for d in docs[:200]]
    out["row_count"] = len(docs)
    out["truncated"] = truncated


def _info(out: dict, message: str, affected: int | None = None) -> None:
    out.update(columns=["result"], rows=[[message]], documents=[{"result": message}], row_count=1, rows_affected=affected)


def _execute(db, cmd: Command, out: dict, qid: str, ms: int, max_rows: int) -> None:
    a, m = cmd.args, cmd.method

    def arg(i: int, default=None):
        return a[i] if len(a) > i else default

    if m == "createCollection":
        name = arg(0)
        if not isinstance(name, str) or not name:
            raise MongoInputError("createCollection needs a collection name, like db.createCollection(\"students\")")
        db.create_collection(name)
        _info(out, f'Collection "{name}" created', 0)
        return

    coll = db[cmd.coll]

    if m in ("find", "findOne"):
        user_limit = 1 if m == "findOne" else cmd.limit
        eff = max_rows + 1 if not user_limit else min(user_limit, max_rows + 1)
        docs = list(coll.find(
            _doc(arg(0, {}), "filter"), arg(1), skip=cmd.skip or 0, limit=eff,
            sort=list(cmd.sort.items()) if cmd.sort else None, max_time_ms=ms, comment=qid,
        ))
        _fill(out, docs[:max_rows], len(docs) > max_rows)
    elif m == "countDocuments":
        n = coll.count_documents(_doc(arg(0, {}), "filter"), maxTimeMS=ms, comment=qid)
        out.update(columns=["count"], rows=[[n]], documents=[{"count": n}], row_count=1)
    elif m == "estimatedDocumentCount":
        n = coll.estimated_document_count(maxTimeMS=ms, comment=qid)
        out.update(columns=["count"], rows=[[n]], documents=[{"count": n}], row_count=1)
    elif m == "distinct":
        field = arg(0)
        if not isinstance(field, str):
            raise MongoInputError('distinct needs a field name, like distinct("city")')
        values = coll.distinct(field, _doc(arg(1, {}), "filter"), maxTimeMS=ms, comment=qid)
        shown = values[:max_rows]
        out.update(columns=["value"], rows=[[_cell(v)] for v in shown],
                   documents=[{"value": _cell(v)} for v in shown[:200]], row_count=len(shown), truncated=len(values) > max_rows)
    elif m == "aggregate":
        pipeline = arg(0)
        if not isinstance(pipeline, list) or not all(isinstance(s, dict) for s in pipeline):
            raise MongoInputError("aggregate needs a pipeline array, like [ { $match: { ... } } ]")
        if cmd.is_write:
            list(coll.aggregate(pipeline, maxTimeMS=ms, comment=qid))
            _info(out, "Pipeline executed", 0)
        else:
            docs = list(coll.aggregate(pipeline + [{"$limit": max_rows + 1}], maxTimeMS=ms, comment=qid, allowDiskUse=True))
            _fill(out, docs[:max_rows], len(docs) > max_rows)
    elif m == "insertOne":
        r = coll.insert_one(_doc(arg(0), "document"))
        _info(out, f"Inserted 1 document (_id: {r.inserted_id})", 1)
    elif m == "insertMany":
        docs = arg(0)
        if not isinstance(docs, list) or not docs or not all(isinstance(d, dict) for d in docs):
            raise MongoInputError("insertMany needs an array of documents")
        if len(docs) > 1000:
            raise MongoInputError("insertMany is limited to 1000 documents per statement")
        r = coll.insert_many(docs)
        _info(out, f"Inserted {len(r.inserted_ids)} documents", len(r.inserted_ids))
    elif m in ("updateOne", "updateMany"):
        opts = arg(2, {}) if isinstance(arg(2, {}), dict) else {}
        fn = coll.update_one if m == "updateOne" else coll.update_many
        r = fn(_doc(arg(0, {}), "filter"), _doc(arg(1), "update"), upsert=bool(opts.get("upsert")))
        _info(out, f"Matched {r.matched_count}, modified {r.modified_count}" + (f", upserted {r.upserted_id}" if r.upserted_id else ""), r.modified_count)
    elif m == "replaceOne":
        opts = arg(2, {}) if isinstance(arg(2, {}), dict) else {}
        r = coll.replace_one(_doc(arg(0, {}), "filter"), _doc(arg(1), "replacement"), upsert=bool(opts.get("upsert")))
        _info(out, f"Matched {r.matched_count}, modified {r.modified_count}", r.modified_count)
    elif m in ("deleteOne", "deleteMany"):
        fn = coll.delete_one if m == "deleteOne" else coll.delete_many
        r = fn(_doc(arg(0, {}), "filter"))
        _info(out, f"Deleted {r.deleted_count} document(s)", r.deleted_count)
    elif m == "createIndex":
        keys = _doc(arg(0), "index keys")
        opts = {k: v for k, v in (arg(1, {}) if isinstance(arg(1, {}), dict) else {}).items() if k in INDEX_OPTIONS}
        _info(out, f"Index created: {coll.create_index(list(keys.items()), **opts)}", 0)
    elif m == "dropIndex":
        name = arg(0)
        if not isinstance(name, str):
            raise MongoInputError('dropIndex needs the index name, like dropIndex("name_1")')
        coll.drop_index(name)
        _info(out, f'Index "{name}" dropped', 0)
    elif m == "drop":
        coll.drop()
        _info(out, f'Collection "{cmd.coll}" dropped', 0)
    else:
        raise MongoInputError(f"{m}() is not supported")


def run_command(*, client: MongoClient, db_name: str, user_id: int, query_id: str, cmd: Command,
                read_only: bool, max_rows: int, timeout_s: int) -> dict:
    started = time.perf_counter()
    out: dict = {"status": "ok", "message": None, "columns": [], "rows": [], "documents": [],
                 "row_count": 0, "rows_affected": None, "truncated": False}
    if cmd.is_write and read_only:
        out.update(status="error", message="Read-only mode blocks write operations. Turn off Read-only to run this.", duration_ms=0)
        return out

    run = Running(user_id, client)
    with _lock:
        if query_id in _running:
            raise MongoInputError("Duplicate query id")
        _running[query_id] = run
    try:
        _execute(client[db_name], cmd, out, query_id, timeout_s * 1000, max_rows)
    except Exception as exc:
        if run.reason == "cancelled":
            out.update(status="cancelled", message="Query cancelled")
        elif isinstance(exc, ExecutionTimeout):
            out.update(status="timeout", message=f"Stopped: exceeded the {timeout_s}s time limit")
        else:
            out.update(status="error", message=mongo_error(exc))
        out.update(columns=[], rows=[], documents=[], row_count=0, rows_affected=None, truncated=False)
    finally:
        with _lock:
            _running.pop(query_id, None)
    out["duration_ms"] = int((time.perf_counter() - started) * 1000)
    return out
