from dataclasses import dataclass

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, Engine

from app.core.netguard import assert_host_allowed


@dataclass
class ConnParams:
    engine: str  # "postgresql" | "mysql"
    host: str
    port: int
    database: str
    username: str
    password: str
    ssl: bool


def build_engine(p: ConnParams) -> Engine:
    assert_host_allowed(p.host, p.port)
    if p.engine == "postgresql":
        url = URL.create(
            "postgresql+psycopg", username=p.username, password=p.password,
            host=p.host, port=p.port, database=p.database,
            query={"sslmode": "require"} if p.ssl else {},
        )
        connect_args: dict = {"connect_timeout": 10}
    elif p.engine == "mysql":
        url = URL.create(
            "mysql+pymysql", username=p.username, password=p.password,
            host=p.host, port=p.port, database=p.database,
        )
        connect_args = {"connect_timeout": 10}
        if p.ssl:
            connect_args["ssl"] = {"check_hostname": True}
    else:
        raise ValueError("Unsupported database engine")
    return create_engine(
        url, connect_args=connect_args,
        pool_size=2, max_overflow=2, pool_pre_ping=True, pool_recycle=300,
    )


def test_connection(p: ConnParams) -> str:
    if p.engine in ("mongodb", "mongodb+srv"):
        from app.adapters import mongo  # imported lazily to avoid a circular import
        return mongo.test_connection(p)
    engine = build_engine(p)
    try:
        with engine.connect() as conn:
            return str(conn.execute(text("SELECT version()")).scalar())
    finally:
        engine.dispose()
