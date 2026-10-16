import json
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.adapters import mongo as mongo_adapter
from app.api.deps import get_current_user
from app.api.schemas import CompareIn, CompareOut, GraphOut, SchemaRef, SnapshotIn, SnapshotOut
from app.core.db import get_db
from app.domain.models import DbConnection, SchemaSnapshot, User
from app.services import mongo_tools, schema_tools
from app.services.connections import friendly_error, get_engine, get_mongo_client

router = APIRouter(tags=["schema"])


def _owned_conn(db: Session, user: User, connection_id: int) -> DbConnection:
    row = db.get(DbConnection, connection_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Connection not found")
    return row


def _capture(row: DbConnection, schema: str) -> dict:
    try:
        cap = schema_tools.capture_schema(get_engine(row), row.engine, schema)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=friendly_error(exc))
    if cap is None:
        raise HTTPException(status_code=404, detail="Schema not found")
    return cap


@router.get("/connections/{connection_id}/graph", response_model=GraphOut)
def graph(connection_id: int, schema: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = _owned_conn(db, user, connection_id)
    if mongo_adapter.is_mongo(row.engine):
        if schema != row.database:
            raise HTTPException(status_code=404, detail="Database not found")
        try:
            cap = mongo_tools.capture_schema(get_mongo_client(row), schema)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=friendly_error(exc))
        return schema_tools.build_graph(cap, schema)
    return schema_tools.build_graph(_capture(row, schema), schema)


@router.post("/connections/{connection_id}/snapshots", response_model=SnapshotOut, status_code=201)
def create_snapshot(connection_id: int, body: SnapshotIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = _owned_conn(db, user, connection_id)
    cap = _capture(row, body.schema_name)
    if cap["truncated"]:
        raise HTTPException(status_code=400, detail=f"Schema has more than {schema_tools.MAX_TABLES} tables. A complete snapshot is not possible.")
    label = body.label.strip() or f"{body.schema_name} @ {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC"
    snap = SchemaSnapshot(
        user_id=user.id, connection_id=row.id, connection_name=row.name, engine=row.engine,
        schema_name=body.schema_name, label=label, table_count=len(cap["tables"]),
        data=json.dumps({"tables": cap["tables"]}),
    )
    db.add(snap)
    db.commit()
    db.refresh(snap)
    return snap


@router.get("/snapshots", response_model=list[SnapshotOut])
def list_snapshots(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stmt = select(SchemaSnapshot).where(SchemaSnapshot.user_id == user.id).order_by(SchemaSnapshot.id.desc())
    return db.scalars(stmt).all()


@router.delete("/snapshots/{snapshot_id}", status_code=204)
def delete_snapshot(snapshot_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    snap = db.get(SchemaSnapshot, snapshot_id)
    if snap is None or snap.user_id != user.id:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    db.delete(snap)
    db.commit()
    return Response(status_code=204)


@dataclass
class _Resolved:
    kind: str
    schema: str
    tables: dict
    label: str


def _resolve(ref: SchemaRef, user: User, db: Session) -> _Resolved:
    if ref.type == "snapshot":
        snap = db.get(SchemaSnapshot, ref.snapshot_id) if ref.snapshot_id else None
        if snap is None or snap.user_id != user.id:
            raise HTTPException(status_code=404, detail="Snapshot not found")
        return _Resolved(snap.engine, snap.schema_name, json.loads(snap.data)["tables"], f"Snapshot: {snap.label}")
    if ref.connection_id is None or not ref.schema_name:
        raise HTTPException(status_code=400, detail="Choose a connection and a schema")
    row = _owned_conn(db, user, ref.connection_id)
    cap = _capture(row, ref.schema_name)
    if cap["truncated"]:
        raise HTTPException(status_code=400, detail=f"{row.name}/{ref.schema_name} has more than {schema_tools.MAX_TABLES} tables. Comparison is unavailable.")
    return _Resolved(row.engine, ref.schema_name, cap["tables"], f"{row.name} / {ref.schema_name}")


@router.post("/schema/compare", response_model=CompareOut)
def compare(body: CompareIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    base = _resolve(body.base, user, db)
    desired = _resolve(body.desired, user, db)
    if base.kind != desired.kind:
        raise HTTPException(status_code=400, detail="Both sides must use the same database engine")
    diff = schema_tools.diff_schemas(base.tables, desired.tables)
    statements, warnings = schema_tools.generate_migration(base.tables, desired.tables, diff, base.kind, base.schema)
    return CompareOut(
        base_label=base.label, desired_label=desired.label, engine=base.kind,
        identical=not (diff["tables_added"] or diff["tables_removed"] or diff["tables_changed"]),
        statements=statements, warnings=warnings, **diff,
    )
