from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect

from app.core.db import Base, engine
from app.core.migrate import run_migrations
from app.domain import models  # noqa: F401


def test_migrations_created_every_table():
    names = set(inspect(engine).get_table_names())
    assert set(Base.metadata.tables) <= names and "alembic_version" in names


def test_models_and_migrations_agree():
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn, opts={"compare_type": False}), Base.metadata)
    assert diff == [], f"A model changed without a migration. Run: alembic revision --autogenerate -m \"...\"  Pending: {diff}"


def test_running_migrations_twice_is_safe():
    run_migrations()


def test_database_from_an_older_version_is_stamped_not_recreated(tmp_path):
    legacy = create_engine(f"sqlite:///{tmp_path}/legacy.db")
    Base.metadata.create_all(legacy)  # what versions without migrations did
    run_migrations(legacy)            # must not fail with "table already exists"
    assert "alembic_version" in inspect(legacy).get_table_names()
