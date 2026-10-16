from collections import Counter
from datetime import datetime

from bson import Decimal128, ObjectId
from pymongo import MongoClient
from pymongo.errors import OperationFailure

SAMPLE = 100
MAX_COLLECTIONS = 200
MAX_FIELDS = 40


def list_collections(client: MongoClient, db_name: str) -> list[str]:
    names = client[db_name].list_collection_names(filter={"type": "collection"})
    return sorted(n for n in names if not n.startswith("system."))


def type_name(v) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, int):
        return "int"
    if isinstance(v, float):
        return "double"
    if isinstance(v, str):
        return "string"
    if isinstance(v, ObjectId):
        return "ObjectId"
    if isinstance(v, datetime):
        return "date"
    if isinstance(v, Decimal128):
        return "decimal"
    if isinstance(v, (bytes, bytearray)):
        return "binData"
    if isinstance(v, dict):
        return "object"
    if isinstance(v, list):
        return "array"
    return type(v).__name__


def _walk(doc: dict, prefix: str, depth: int, out: dict[str, Counter]) -> None:
    for key, value in doc.items():
        path = f"{prefix}{key}"
        t = type_name(value)
        if t == "array":
            inner = sorted({type_name(x) for x in value[:5]})
            t = f"array<{'|'.join(inner)}>" if inner else "array"
        out.setdefault(path, Counter())[t] += 1
        if isinstance(value, dict) and depth < 2:
            _walk(value, f"{path}.", depth + 1, out)


def _collection(db, name: str) -> dict:
    """Schema inferred from a sample of documents. Fields can be incomplete."""
    coll = db[name]
    try:
        docs = list(coll.find({}, limit=SAMPLE, max_time_ms=10000))
    except OperationFailure:
        docs = []
    fields: dict[str, Counter] = {}
    for d in docs:
        _walk(d, "", 0, fields)
    n = len(docs)
    columns = []
    for path, counter in list(fields.items())[:MAX_FIELDS]:
        present = sum(counter.values())
        columns.append({
            "name": path, "type": "|".join(t for t, _ in counter.most_common(2)),
            "nullable": present < n or "null" in counter, "default": None,
        })
    if not any(c["name"] == "_id" for c in columns):
        columns.insert(0, {"name": "_id", "type": "ObjectId", "nullable": False, "default": None})
    columns.sort(key=lambda c: c["name"] != "_id")  # stable: _id first
    try:
        info = coll.index_information()
    except OperationFailure:
        info = {}
    indexes = [
        {"name": idx_name, "columns": [k for k, _ in i["key"]], "unique": bool(i.get("unique"))}
        for idx_name, i in info.items() if idx_name != "_id_"
    ]
    return {"columns": columns, "primary_key": ["_id"], "foreign_keys": [], "indexes": indexes}


def capture_schema(client: MongoClient, db_name: str) -> dict:
    """Same shape as the SQL capture, so the ER graph and the AI context work unchanged."""
    db = client[db_name]
    names = list_collections(client, db_name)
    return {
        "tables": {n: _collection(db, n) for n in names[:MAX_COLLECTIONS]},
        "truncated": len(names) > MAX_COLLECTIONS,
        "omitted_cross_schema_fks": 0,
    }


def collection_detail(client: MongoClient, db_name: str, name: str) -> dict | None:
    if name not in list_collections(client, db_name):
        return None
    t = _collection(client[db_name], name)
    pk = set(t["primary_key"])
    return {
        "schema": db_name, "table": name,
        "columns": [{**c, "primary_key": c["name"] in pk} for c in t["columns"]],
        "foreign_keys": [], "indexes": t["indexes"],
    }
