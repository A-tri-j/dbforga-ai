import socket

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.adapters.sql_engine import ConnParams, test_connection
from app.api.deps import get_current_user
from app.api.schemas import (
    ConnectionIn, ConnectionOut, ConnectionTestIn, ConnectionUpdate, DetectOut, LocalDb, TableDetail, TestResult,
)
from app.core.config import settings
from app.core.crypto import decrypt, encrypt
from app.core.db import get_db
from app.domain.models import DbConnection, QueryHistory, SavedQuery, SchemaSnapshot, User
from app.adapters import mongo as mongo_adapter
from app.services import introspection, mongo_tools
from app.services.connections import drop_engine, friendly_error, get_engine, get_mongo_client, params_from_row

router = APIRouter(prefix="/connections", tags=["connections"])


def _params(body: ConnectionIn) -> ConnParams:
    return ConnParams(
        engine=body.engine, host=body.host.strip(), port=body.port, database=body.database,
        username=body.username, password=body.password, ssl=body.ssl,
    )


def _owned(db: Session, user: User, connection_id: int) -> DbConnection:
    row = db.get(DbConnection, connection_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Connection not found")
    return row


@router.post("/test", response_model=TestResult)
def test(body: ConnectionTestIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    password = body.password
    if not password and body.connection_id is not None:
        saved = _owned(db, user, body.connection_id)
        try:
            password = decrypt(saved.password_encrypted)
        except ValueError as exc:
            return TestResult(ok=False, message=str(exc))
    params = _params(body)
    params.password = password
    try:
        version = test_connection(params)
    except Exception as exc:
        return TestResult(ok=False, message=friendly_error(exc))
    return TestResult(ok=True, message="Connection successful", server_version=version)


@router.get("/detect-local", response_model=DetectOut)
def detect_local(user: User = Depends(get_current_user)):
    """Only checks whether a database port is open on this computer. It does not try any login."""
    if not settings.allow_private_hosts:
        return DetectOut(available=False, found=[])
    found: list[LocalDb] = []
    for engine, label, port in (("postgresql", "PostgreSQL", 5432), ("mysql", "MySQL / MariaDB", 3306), ("mongodb", "MongoDB", 27017)):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.4):
                found.append(LocalDb(engine=engine, label=label, host="localhost", port=port))
        except OSError:
            pass
    return DetectOut(available=True, found=found)


@router.post("/{connection_id}/test", response_model=TestResult)
def test_saved(connection_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = _owned(db, user, connection_id)
    try:
        version = test_connection(params_from_row(row))
    except Exception as exc:
        return TestResult(ok=False, message=friendly_error(exc))
    return TestResult(ok=True, message="Connection successful", server_version=version)


@router.put("/{connection_id}", response_model=ConnectionOut)
def update_connection(connection_id: int, body: ConnectionUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = _owned(db, user, connection_id)
    try:
        password = body.password if body.password is not None else decrypt(row.password_encrypted)
    except ValueError:
        raise HTTPException(status_code=400, detail="The saved password cannot be read. Enter the password again.")
    params = ConnParams(
        engine=body.engine, host=body.host.strip(), port=body.port, database=body.database,
        username=body.username, password=password, ssl=body.ssl,
    )
    try:
        test_connection(params)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Connection failed: {friendly_error(exc)}")
    row.name, row.engine, row.host, row.port = body.name.strip(), body.engine, params.host, body.port
    row.database, row.username, row.ssl = body.database, body.username, body.ssl
    if body.password is not None:
        row.password_encrypted = encrypt(body.password)
    db.commit()
    drop_engine(row.id)  # rebuild the connection pool with the new settings
    db.refresh(row)
    return row


@router.get("", response_model=list[ConnectionOut])
def list_connections(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stmt = select(DbConnection).where(DbConnection.user_id == user.id).order_by(DbConnection.created_at.desc())
    return db.scalars(stmt).all()


@router.post("", response_model=ConnectionOut, status_code=201)
def create_connection(body: ConnectionIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        test_connection(_params(body))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Connection failed: {friendly_error(exc)}")
    row = DbConnection(
        user_id=user.id, name=body.name.strip(), engine=body.engine, host=body.host.strip(),
        port=body.port, database=body.database, username=body.username,
        password_encrypted=encrypt(body.password), ssl=body.ssl,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{connection_id}", status_code=204)
def delete_connection(connection_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = _owned(db, user, connection_id)
    drop_engine(row.id)
    db.execute(update(QueryHistory).where(QueryHistory.connection_id == row.id).values(connection_id=None))
    db.execute(update(SavedQuery).where(SavedQuery.connection_id == row.id).values(connection_id=None))
    db.execute(update(SchemaSnapshot).where(SchemaSnapshot.connection_id == row.id).values(connection_id=None))
    db.delete(row)
    db.commit()
    return Response(status_code=204)


@router.get("/{connection_id}/schemas", response_model=list[str])
def schemas(connection_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = _owned(db, user, connection_id)
    if mongo_adapter.is_mongo(row.engine):
        return [row.database]  # work in the database this connection was created for
    try:
        return introspection.list_schemas(get_engine(row), row.engine)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=friendly_error(exc))


@router.get("/{connection_id}/tables", response_model=list[str])
def tables(connection_id: int, schema: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = _owned(db, user, connection_id)
    if mongo_adapter.is_mongo(row.engine):
        if schema != row.database:
            raise HTTPException(status_code=404, detail="Database not found")
        try:
            return mongo_tools.list_collections(get_mongo_client(row), schema)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=friendly_error(exc))
    try:
        result = introspection.list_tables(get_engine(row), row.engine, schema)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=friendly_error(exc))
    if result is None:
        raise HTTPException(status_code=404, detail="Schema not found")
    return result


@router.get("/{connection_id}/tables/{table}", response_model=TableDetail, response_model_by_alias=False)
def table(connection_id: int, table: str, schema: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = _owned(db, user, connection_id)
    try:
        if mongo_adapter.is_mongo(row.engine):
            if schema != row.database:
                raise HTTPException(status_code=404, detail="Database not found")
            result = mongo_tools.collection_detail(get_mongo_client(row), schema, table)
        else:
            result = introspection.table_detail(get_engine(row), row.engine, schema, table)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=friendly_error(exc))
    if result is None:
        raise HTTPException(status_code=404, detail="Table not found")
    return result
