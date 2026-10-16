from sqlalchemy import inspect
from sqlalchemy.engine import Engine

SYSTEM_SCHEMAS = {"information_schema", "pg_catalog", "pg_toast"}


def list_schemas(engine: Engine, kind: str) -> list[str]:
    insp = inspect(engine)
    if kind == "mysql":
        return [insp.default_schema_name]  # MySQL schema == database
    return sorted(
        s for s in insp.get_schema_names()
        if s not in SYSTEM_SCHEMAS and not s.startswith("pg_temp") and not s.startswith("pg_toast")
    )


def list_tables(engine: Engine, kind: str, schema: str) -> list[str] | None:
    if schema not in list_schemas(engine, kind):
        return None
    return sorted(inspect(engine).get_table_names(schema=schema))


def _type_str(col_type) -> str:
    try:
        return str(col_type)
    except Exception:
        return "unknown"


def table_detail(engine: Engine, kind: str, schema: str, table: str) -> dict | None:
    tables = list_tables(engine, kind, schema)
    if tables is None or table not in tables:
        return None
    insp = inspect(engine)
    pk = insp.get_pk_constraint(table, schema=schema).get("constrained_columns") or []
    return {
        "schema": schema,
        "table": table,
        "columns": [
            {
                "name": c["name"],
                "type": _type_str(c["type"]),
                "nullable": bool(c.get("nullable", True)),
                "default": None if c.get("default") is None else str(c["default"]),
                "primary_key": c["name"] in pk,
            }
            for c in insp.get_columns(table, schema=schema)
        ],
        "foreign_keys": [
            {
                "columns": fk["constrained_columns"],
                "ref_schema": fk.get("referred_schema") or insp.default_schema_name,
                "ref_table": fk["referred_table"],
                "ref_columns": fk["referred_columns"],
            }
            for fk in insp.get_foreign_keys(table, schema=schema)
        ],
        "indexes": [
            {"name": ix.get("name") or "", "columns": [c for c in ix["column_names"] if c], "unique": bool(ix.get("unique"))}
            for ix in insp.get_indexes(table, schema=schema)
        ],
    }
