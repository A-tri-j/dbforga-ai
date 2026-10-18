from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect
from sqlalchemy.engine import Engine

from app.core.db import engine as app_engine

BACKEND_DIR = Path(__file__).resolve().parents[2]  # apps/backend


def _config() -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    return cfg


def run_migrations(engine: Engine | None = None) -> None:
    """Bring the database to the latest version. Safe to run on every start."""
    cfg = _config()
    with (engine or app_engine).begin() as connection:
        cfg.attributes["connection"] = connection
        tables = set(inspect(connection).get_table_names())
        has_version = False
        if "alembic_version" in tables:
            from sqlalchemy import text
            has_version = connection.execute(text("SELECT version_num FROM alembic_version")).fetchone() is not None
        if not has_version and "users" in tables:
            # Created by an older version without migrations: mark it as the baseline, do not recreate it.
            if "audit_events" in tables:
                command.stamp(cfg, "head")
            else:
                command.stamp(cfg, ScriptDirectory.from_config(cfg).get_bases()[0])
        command.upgrade(cfg, "head")
