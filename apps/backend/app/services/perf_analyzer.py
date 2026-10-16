import json
import re
from itertools import count

from sqlalchemy import inspect
from sqlalchemy.engine import Engine
from sqlalchemy.exc import NoSuchTableError

ALLOWED_KINDS = {"SELECT", "INSERT", "UPDATE", "DELETE"}


def quote(db_kind: str, name: str) -> str:
    if db_kind == "postgresql":
        return '"' + name.replace('"', '""') + '"'
    return "`" + name.replace("`", "``") + "`"


def explain_sql(db_kind: str, stmt: str, analyze: bool) -> str:
    if db_kind == "postgresql":
        return f"EXPLAIN ({'ANALYZE, ' if analyze else ''}VERBOSE, FORMAT JSON) {stmt}"
    return f"EXPLAIN ANALYZE {stmt}" if analyze else f"EXPLAIN FORMAT=JSON {stmt}"


def index_ddl(db_kind: str, schema: str, table: str, columns: list[str]) -> tuple[str, str]:
    name = re.sub(r"[^A-Za-z0-9_]", "_", f"dbforge_idx_{table}_{'_'.join(columns)}")[:63]
    q = lambda n: quote(db_kind, n)  # noqa: E731
    tbl = f"{q(schema)}.{q(table)}" if db_kind == "postgresql" else q(table)
    return name, f"CREATE INDEX {q(name)} ON {tbl} ({', '.join(q(c) for c in columns)})"


# ---------- plan parsing (real EXPLAIN output only) ----------

def _num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _pg_node(n: dict, ids) -> dict:
    return {
        "id": next(ids), "node_type": n.get("Node Type"), "relation": n.get("Relation Name"),
        "schema": n.get("Schema"), "index_name": n.get("Index Name"),
        "cost_total": n.get("Total Cost"), "plan_rows": n.get("Plan Rows"),
        "actual_rows": n.get("Actual Rows"), "actual_time_ms": n.get("Actual Total Time"),
        "loops": n.get("Actual Loops"), "filter": n.get("Filter"),
        "condition": n.get("Index Cond") or n.get("Hash Cond") or n.get("Join Filter") or n.get("Recheck Cond"),
        "rows_removed": n.get("Rows Removed by Filter"),
        "is_full_scan": n.get("Node Type") == "Seq Scan",
        "sort_on_disk": n.get("Sort Space Type") == "Disk",
        "children": [_pg_node(c, ids) for c in n.get("Plans", [])],
    }


def _mysql_nodes(obj, ids, out: list) -> None:
    if isinstance(obj, dict):
        t = obj.get("table")
        if isinstance(t, dict):
            access = t.get("access_type")
            out.append({
                "id": next(ids), "node_type": f"Table access ({access})" if access else "Table access",
                "relation": t.get("table_name"), "schema": None, "index_name": t.get("key"),
                "cost_total": _num((t.get("cost_info") or {}).get("prefix_cost")),
                "plan_rows": t.get("rows_examined_per_scan"), "actual_rows": None, "actual_time_ms": None,
                "loops": None, "filter": t.get("attached_condition"), "condition": None, "rows_removed": None,
                "is_full_scan": access == "ALL", "sort_on_disk": False, "children": [],
            })
        for v in obj.values():
            _mysql_nodes(v, ids, out)
    elif isinstance(obj, list):
        for v in obj:
            _mysql_nodes(v, ids, out)


def parse_plan(db_kind: str, rows: list, analyze: bool) -> tuple[list[dict], dict, str | None]:
    if db_kind == "mysql" and analyze:  # MySQL EXPLAIN ANALYZE returns text, shown raw
        return [], {"total_cost": None, "planning_ms": None, "execution_ms": None}, "\n".join(str(r[0]) for r in rows)
    doc = json.loads(rows[0][0])
    ids = count(1)
    if db_kind == "postgresql":
        entry = doc[0]
        return (
            [_pg_node(entry["Plan"], ids)],
            {"total_cost": entry["Plan"].get("Total Cost"), "planning_ms": entry.get("Planning Time"),
             "execution_ms": entry.get("Execution Time")},
            None,
        )
    out: list[dict] = []
    block = doc.get("query_block", {})
    _mysql_nodes(block, ids, out)
    return out, {"total_cost": _num((block.get("cost_info") or {}).get("query_cost")),
                 "planning_ms": None, "execution_ms": None}, None


# ---------- findings and index recommendations ----------

def _walk(nodes):
    for n in nodes:
        yield n
        yield from _walk(n["children"])


def _table_info(engine: Engine, schema: str, table: str):
    try:
        insp = inspect(engine)
        cols = [c["name"] for c in insp.get_columns(table, schema=schema)]
        indexes = [[c for c in ix["column_names"] if c] for ix in insp.get_indexes(table, schema=schema)]
        pk = insp.get_pk_constraint(table, schema=schema).get("constrained_columns") or []
        if pk:
            indexes.append(pk)
        return cols, indexes
    except NoSuchTableError:
        return None


def build_findings(engine, db_kind: str, schema: str, nodes: list[dict], analyzed: bool):
    findings: list[dict] = []
    recs: list[dict] = []
    seen: set = set()
    cache: dict = {}
    counts = {"node_count": 0, "full_scans": 0, "index_scans": 0}

    def add(severity: str, title: str, detail: str, node: dict) -> None:
        findings.append({"severity": severity, "title": title, "detail": detail, "node_id": node["id"]})

    for n in _walk(nodes):
        counts["node_count"] += 1
        rel = n["relation"]
        kind = n["node_type"] or "Node"
        cost = n["cost_total"] or 0

        if n["index_name"] and not n["is_full_scan"]:
            counts["index_scans"] += 1

        if n["is_full_scan"]:
            counts["full_scans"] += 1
            heavy = cost >= 1000 or (n["rows_removed"] or 0) >= 10000
            detail = f"Reads every row of {rel or 'a table'}"
            detail += f" and filters with {n['filter']}" if n["filter"] else ""
            detail += f" (estimated cost {cost:.0f})."
            add("warning" if (n["filter"] and heavy) else "info", f"Full scan on {rel or 'a table'}", detail, n)

            if n["filter"] and rel:
                sch = n["schema"] or schema
                if (sch, rel) not in cache:
                    cache[(sch, rel)] = _table_info(engine, sch, rel)
                info = cache[(sch, rel)]
                if info:
                    cols, indexes = info
                    tokens = list(dict.fromkeys(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", n["filter"])))
                    picks = [t for t in tokens if t in cols][:3]
                    if picks:
                        covered = next((ix for ix in indexes if ix and ix[0] == picks[0]), None)
                        if covered:
                            add("info", f"An index on {rel} already starts with {picks[0]}",
                                f"The index ({', '.join(covered)}) exists, but the planner still chose a full scan. "
                                "That can be correct for small tables or filters that match many rows.", n)
                        elif (sch, rel, tuple(picks)) not in seen:
                            seen.add((sch, rel, tuple(picks)))
                            _, ddl = index_ddl(db_kind, sch, rel, picks)
                            recs.append({
                                "schema_name": sch, "table": rel, "columns": picks,
                                "reason": f"Full scan on {rel} filtered by {', '.join(picks)}.",
                                "sql": ddl + ";",
                                "caveat": "Heuristic: the columns come from the filter text and their order is a guess. "
                                          "Check how selective the filter is and the cost for writes before creating it.",
                            })

        a, p = n["actual_rows"], n["plan_rows"]
        if analyzed and a is not None and p is not None and max(a, p) >= 100 and (a > p * 10 or p > a * 10):
            add("warning", "Row estimate is far off",
                f"{kind}{' on ' + rel if rel else ''}: the planner expected {p:g} rows per loop but {a:g} came back. "
                "Refreshing table statistics (ANALYZE) may improve the plan.", n)

        if n["sort_on_disk"]:
            add("warning", "Sort spilled to disk",
                "The sort did not fit in memory (work_mem). Fewer rows or a larger work_mem would help.", n)

        if analyzed and n["is_full_scan"] and (n["loops"] or 0) >= 10000:
            add("warning", "Full scan repeated many times",
                f"{rel or 'The table'} was scanned {n['loops']} times (for example the inner side of a nested loop). An index on the join column usually fixes this.", n)

    counts["health"] = "attention" if any(f["severity"] == "warning" for f in findings) else "ok"
    return findings, recs, counts


def create_index(engine: Engine, db_kind: str, schema: str, table: str, columns: list[str]) -> tuple[str, str]:
    info = _table_info(engine, schema, table)
    if info is None:
        raise ValueError("Table not found")
    missing = [c for c in columns if c not in info[0]]
    if missing:
        raise ValueError(f"Unknown column(s): {', '.join(missing)}")
    name, sql = index_ddl(db_kind, schema, table, columns)
    with engine.begin() as conn:
        conn.execution_options(no_parameters=True)
        conn.exec_driver_sql(sql)
    return name, sql
