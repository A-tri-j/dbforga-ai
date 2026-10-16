from sqlalchemy import inspect
from sqlalchemy.engine import Engine

from app.services.introspection import list_tables

MAX_TABLES = 200


def _type_str(t) -> str:
    try:
        return str(t)
    except Exception:
        return "unknown"


def _family(type_str: str) -> str:
    t = type_str.lower()
    if any(k in t for k in ("bigint", "smallint", "tinyint", "mediumint", "integer", "serial")) or t.startswith("int"):
        return "int"
    if "char" in t or "text" in t:
        return "text"
    return t.split("(")[0]


# ---------- capture (live metadata) ----------

def capture_schema(engine: Engine, kind: str, schema: str) -> dict | None:
    names = list_tables(engine, kind, schema)
    if names is None:
        return None
    insp = inspect(engine)
    default_schema = insp.default_schema_name
    tables: dict = {}
    omitted = 0
    for name in names[:MAX_TABLES]:
        pk = insp.get_pk_constraint(name, schema=schema).get("constrained_columns") or []
        columns = [
            {
                "name": c["name"],
                "type": _type_str(c["type"]),
                "nullable": bool(c.get("nullable", True)),
                "default": None if c.get("default") is None else str(c["default"]),
            }
            for c in insp.get_columns(name, schema=schema)
        ]
        fks = []
        for fk in insp.get_foreign_keys(name, schema=schema):
            if (fk.get("referred_schema") or default_schema) != schema:
                omitted += 1  # cross-schema FKs are not drawn or compared
                continue
            fks.append({
                "name": fk.get("name"),
                "columns": fk["constrained_columns"],
                "ref_table": fk["referred_table"],
                "ref_columns": fk["referred_columns"],
            })
        indexes = [
            {
                "name": ix.get("name"),
                "columns": [c for c in ix["column_names"] if c],
                "unique": bool(ix.get("unique")),
            }
            for ix in insp.get_indexes(name, schema=schema)
        ]
        tables[name] = {"columns": columns, "primary_key": pk, "foreign_keys": fks, "indexes": indexes}
    return {"tables": tables, "truncated": len(names) > MAX_TABLES, "omitted_cross_schema_fks": omitted}


# ---------- ER graph ----------

def build_graph(cap: dict, schema: str) -> dict:
    tables = cap["tables"]
    rels: list[dict] = []
    fk_cols: set[tuple[str, str]] = set()

    for tname, t in tables.items():
        for i, fk in enumerate(t["foreign_keys"]):
            if fk["ref_table"] not in tables:
                continue
            rels.append({
                "id": f"fk:{tname}:{fk.get('name') or i}",
                "source_table": tname, "source_columns": fk["columns"],
                "target_table": fk["ref_table"], "target_columns": fk["ref_columns"],
                "kind": "foreign_key", "reason": None,
            })
            fk_cols.update((tname, c) for c in fk["columns"])

    # Inferred (NOT constraints): "<name>_id" matching a table with a single-column PK of the same type family
    for tname, t in tables.items():
        for col in t["columns"]:
            n = col["name"]
            if (tname, n) in fk_cols or t["primary_key"] == [n]:
                continue
            low = n.lower()
            if low.endswith("_id") and len(n) > 3:
                base = low[:-3]
            elif n.endswith("Id") and len(n) > 2:
                base = low[:-2]
            else:
                continue
            for cand in (base, base + "s", base + "es"):
                match = next((x for x in tables if x.lower() == cand), None)
                if match is None:
                    continue
                target_pk = tables[match]["primary_key"]
                if len(target_pk) != 1:
                    continue
                target_col = next(c for c in tables[match]["columns"] if c["name"] == target_pk[0])
                if _family(col["type"]) != _family(target_col["type"]):
                    continue
                rels.append({
                    "id": f"inferred:{tname}:{n}",
                    "source_table": tname, "source_columns": [n],
                    "target_table": match, "target_columns": target_pk,
                    "kind": "inferred",
                    "reason": f'Column name "{n}" matches table "{match}" and its primary key type. No foreign key constraint exists.',
                })
                break

    return {
        "schema_name": schema,
        "tables": [
            {
                "name": name,
                "columns": [
                    {**c, "primary_key": c["name"] in t["primary_key"], "foreign_key": (name, c["name"]) in fk_cols}
                    for c in t["columns"]
                ],
            }
            for name, t in tables.items()
        ],
        "relationships": rels,
        "truncated": cap["truncated"],
        "omitted_cross_schema_fks": cap["omitted_cross_schema_fks"],
    }


# ---------- diff ----------

def _fk_key(fk: dict):
    return (tuple(fk["columns"]), fk["ref_table"], tuple(fk["ref_columns"]))


def _ix_key(ix: dict):
    return (tuple(ix["columns"]), ix["unique"])


def diff_schemas(base: dict, desired: dict) -> dict:
    added = sorted(set(desired) - set(base))
    removed = sorted(set(base) - set(desired))
    changed = []
    for name in sorted(set(base) & set(desired)):
        b, d = base[name], desired[name]
        bcols = {c["name"]: c for c in b["columns"]}
        dcols = {c["name"]: c for c in d["columns"]}
        cols_changed = []
        for n, bc in bcols.items():
            dc = dcols.get(n)
            if dc is None:
                continue
            ch = []
            if bc["type"] != dc["type"]:
                ch.append(f"type: {bc['type']} → {dc['type']}")
            if bc["nullable"] != dc["nullable"]:
                ch.append(f"nullable: {bc['nullable']} → {dc['nullable']}")
            if bc["default"] != dc["default"]:
                ch.append(f"default: {bc['default']} → {dc['default']}")
            if ch:
                cols_changed.append({"name": n, "changes": ch, "base": bc, "desired": dc})
        bfk, dfk = {_fk_key(f) for f in b["foreign_keys"]}, {_fk_key(f) for f in d["foreign_keys"]}
        bix, dix = {_ix_key(i) for i in b["indexes"]}, {_ix_key(i) for i in d["indexes"]}
        entry = {
            "table": name,
            "columns_added": [c for n, c in dcols.items() if n not in bcols],
            "columns_removed": [c for n, c in bcols.items() if n not in dcols],
            "columns_changed": cols_changed,
            "fks_added": [f for f in d["foreign_keys"] if _fk_key(f) not in bfk],
            "fks_removed": [f for f in b["foreign_keys"] if _fk_key(f) not in dfk],
            "indexes_added": [i for i in d["indexes"] if _ix_key(i) not in bix],
            "indexes_removed": [i for i in b["indexes"] if _ix_key(i) not in dix],
            "primary_key_changed": (
                {"from": b["primary_key"], "to": d["primary_key"]}
                if b["primary_key"] != d["primary_key"] else None
            ),
        }
        if any(v for k, v in entry.items() if k != "table"):
            changed.append(entry)
    return {"tables_added": added, "tables_removed": removed, "tables_changed": changed}


# ---------- migration preview (never executed) ----------

def generate_migration(base: dict, desired: dict, diff: dict, kind: str, schema: str):
    pg = kind == "postgresql"
    warnings: list[str] = []

    def q(n: str) -> str:
        return '"' + n.replace('"', '""') + '"' if pg else "`" + n.replace("`", "``") + "`"

    def tbl(n: str) -> str:
        return f"{q(schema)}.{q(n)}" if pg else q(n)

    def col_def(table: str, c: dict) -> str:
        parts = [q(c["name"]), c["type"]]
        if not c["nullable"]:
            parts.append("NOT NULL")
        d = c["default"]
        if d is not None:
            if "nextval(" in d.lower():
                warnings.append(f"{table}.{c['name']}: sequence default not copied. Create the sequence or use SERIAL/IDENTITY manually.")
            else:
                parts.append(f"DEFAULT {d}")
        return " ".join(parts)

    create: list[tuple[str, bool]] = []
    alter: list[tuple[str, bool]] = []
    drop_constraints: list[tuple[str, bool]] = []
    add_constraints: list[tuple[str, bool]] = []
    destructive: list[tuple[str, bool]] = []

    def add_fk(table: str, fk: dict):
        add_constraints.append((
            f"ALTER TABLE {tbl(table)} ADD FOREIGN KEY ({', '.join(q(c) for c in fk['columns'])}) "
            f"REFERENCES {tbl(fk['ref_table'])} ({', '.join(q(c) for c in fk['ref_columns'])});", False))

    def add_ix(table: str, ix: dict):
        if not ix["columns"]:
            warnings.append(f"{table}: index {ix['name']} has no plain columns (expression index?) and was not generated.")
            return
        name = ix["name"] or f"idx_{table}_{'_'.join(ix['columns'])}"
        add_constraints.append((
            f"CREATE {'UNIQUE ' if ix['unique'] else ''}INDEX {q(name)} ON {tbl(table)} "
            f"({', '.join(q(c) for c in ix['columns'])});", False))

    for name in diff["tables_added"]:
        t = desired[name]
        defs = [col_def(name, c) for c in t["columns"]]
        if t["primary_key"]:
            defs.append("PRIMARY KEY (" + ", ".join(q(c) for c in t["primary_key"]) + ")")
        create.append((f"CREATE TABLE {tbl(name)} (\n  " + ",\n  ".join(defs) + "\n);", False))
        for fk in t["foreign_keys"]:
            add_fk(name, fk)
        for ix in t["indexes"]:
            add_ix(name, ix)

    for name in diff["tables_removed"]:
        destructive.append((f"DROP TABLE {tbl(name)};", True))

    for td in diff["tables_changed"]:
        name = td["table"]
        for c in td["columns_added"]:
            alter.append((f"ALTER TABLE {tbl(name)} ADD COLUMN {col_def(name, c)};", False))
            if not c["nullable"] and c["default"] is None:
                warnings.append(f"{name}.{c['name']}: NOT NULL column without a default fails if the table already has rows.")
        for ch in td["columns_changed"]:
            b, d, n = ch["base"], ch["desired"], ch["name"]
            if pg:
                if b["type"] != d["type"]:
                    alter.append((f"ALTER TABLE {tbl(name)} ALTER COLUMN {q(n)} TYPE {d['type']};", True))
                    warnings.append(f"{name}.{n}: type change may need a USING clause and can lose data.")
                if b["nullable"] != d["nullable"]:
                    alter.append((f"ALTER TABLE {tbl(name)} ALTER COLUMN {q(n)} {'DROP' if d['nullable'] else 'SET'} NOT NULL;", False))
                if b["default"] != d["default"]:
                    if d["default"] is None:
                        alter.append((f"ALTER TABLE {tbl(name)} ALTER COLUMN {q(n)} DROP DEFAULT;", False))
                    elif "nextval(" in d["default"].lower():
                        warnings.append(f"{name}.{n}: sequence default change not generated.")
                    else:
                        alter.append((f"ALTER TABLE {tbl(name)} ALTER COLUMN {q(n)} SET DEFAULT {d['default']};", False))
            else:
                alter.append((f"ALTER TABLE {tbl(name)} MODIFY COLUMN {col_def(name, d)};", b["type"] != d["type"]))
        for fk in td["fks_removed"]:
            if not fk["name"]:
                warnings.append(f"{name}: a foreign key without a name could not be dropped automatically.")
                continue
            drop = f"DROP CONSTRAINT {q(fk['name'])}" if pg else f"DROP FOREIGN KEY {q(fk['name'])}"
            drop_constraints.append((f"ALTER TABLE {tbl(name)} {drop};", False))
        for ix in td["indexes_removed"]:
            if not ix["name"]:
                continue
            sql = f"DROP INDEX {q(schema)}.{q(ix['name'])};" if pg else f"DROP INDEX {q(ix['name'])} ON {tbl(name)};"
            drop_constraints.append((sql, False))
        for fk in td["fks_added"]:
            add_fk(name, fk)
        for ix in td["indexes_added"]:
            add_ix(name, ix)
        for c in td["columns_removed"]:
            destructive.append((f"ALTER TABLE {tbl(name)} DROP COLUMN {q(c['name'])};", True))
        if td["primary_key_changed"]:
            warnings.append(f"{name}: primary key change is not generated. Handle it manually.")

    ordered = create + alter + drop_constraints + add_constraints + destructive
    if ordered:
        warnings.append("Types and defaults come from database reflection. Review statement order and dependencies before running anything.")
    return [{"sql": s, "destructive": d} for s, d in ordered], warnings
