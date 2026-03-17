"""
env.py – Alembic-Umgebung für async SQLAlchemy.

Diese Datei konfiguriert Alembic für die Verwendung mit asyncpg
(asynchronem PostgreSQL-Treiber). Alembic erkennt Änderungen an den
SQLAlchemy-Modellen und erstellt automatisch Migrationsskripte.
"""

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import create_async_engine

# Alembic-Konfigurationsobjekt (liest alembic.ini)
config = context.config

# Logging-Konfiguration aus alembic.ini laden
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# ── Alle Modelle importieren, damit Alembic sie kennt ──
# Ohne diesen Import weiß Alembic nicht, welche Tabellen existieren sollen.
import sys
from pathlib import Path

# Backend-Verzeichnis zum Python-Pfad hinzufügen
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.core.database import Base
from app.models import *  # noqa: F401, F403 – Importiert alle Modelle

target_metadata = Base.metadata


def get_database_url() -> str:
    """Liest die Datenbank-URL aus der Umgebung oder App-Konfiguration."""
    import os
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        try:
            from app.config import get_settings
            url = get_settings().database_url
        except Exception:
            url = "postgresql+asyncpg://energy:energy@localhost:5432/energy_management"
    return url


def run_migrations_offline() -> None:
    """
    Migrations im 'Offline'-Modus ausführen.

    Generiert SQL-Skripte, ohne eine Datenbankverbindung zu benötigen.
    Nützlich für Code-Review oder manuelle Ausführung der Migrationen.
    """
    url = get_database_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection):
    """Führt die Migrationen mit einer bestehenden Verbindung aus."""
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """
    Migrations im 'Online'-Modus mit async Engine ausführen.

    Stellt eine Verbindung zur Datenbank her und führt alle
    ausstehenden Migrationen aus.
    """
    url = get_database_url()
    connectable = create_async_engine(url, poolclass=pool.NullPool)

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Online-Migrations-Modus starten."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
