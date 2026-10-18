from alembic import context
from sqlalchemy import create_engine, pool

from app.core.config import settings
from app.core.db import Base
from app.domain import models  # noqa: F401  (registers every table)

target_metadata = Base.metadata


def _run(connection) -> None:
    context.configure(
        connection=connection, target_metadata=target_metadata,
        render_as_batch=True,  # lets SQLite alter tables
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    shared = context.config.attributes.get("connection")  # the app passes its own connection
    if shared is not None:
        _run(shared)
        return
    engine = create_engine(settings.database_url, poolclass=pool.NullPool)  # the alembic command line
    with engine.connect() as connection:
        _run(connection)
    engine.dispose()


if context.is_offline_mode():
    raise RuntimeError("Offline mode is not supported")
run_migrations_online()
