from pymongo import MongoClient
from pymongo.errors import PyMongoError
from sqlalchemy.engine import Engine

from app.adapters import mongo as mongo_adapter
from app.adapters.sql_engine import ConnParams, build_engine
from app.core.crypto import decrypt
from app.domain.models import DbConnection

_engines: dict[int, Engine] = {}
_clients: dict[int, MongoClient] = {}


def params_from_row(row: DbConnection) -> ConnParams:
    return ConnParams(
        engine=row.engine, host=row.host, port=row.port, database=row.database,
        username=row.username, password=decrypt(row.password_encrypted), ssl=row.ssl,
    )


def get_engine(row: DbConnection) -> Engine:
    if mongo_adapter.is_mongo(row.engine):
        raise ValueError("This is a MongoDB connection. This feature supports SQL databases only (PostgreSQL, MySQL).")
    engine = _engines.get(row.id)
    if engine is None:
        engine = build_engine(params_from_row(row))
        _engines[row.id] = engine
    return engine


def get_mongo_client(row: DbConnection) -> MongoClient:
    client = _clients.get(row.id)
    if client is None:
        client = mongo_adapter.make_client(params_from_row(row))
        _clients[row.id] = client
    return client


def drop_engine(connection_id: int) -> None:
    engine = _engines.pop(connection_id, None)
    if engine is not None:
        engine.dispose()
    client = _clients.pop(connection_id, None)
    if client is not None:
        client.close()


def friendly_error(exc: Exception) -> str:
    if isinstance(exc, PyMongoError):
        return mongo_adapter.mongo_error(exc)
    if isinstance(exc, ValueError):
        return str(exc)
    orig = getattr(exc, "orig", None) or exc
    text = str(orig).strip()
    return (text.splitlines()[0] if text else "Database error")[:300]
