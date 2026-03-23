"""
database.py – Datenbank-Verbindungsmanagement.

Dieses Modul stellt die Verbindung zur TimescaleDB/PostgreSQL-Datenbank her
und verwaltet die Sitzungen (Sessions). Eine Session ist wie ein Gespräch
mit der Datenbank – sie wird für jede API-Anfrage geöffnet und danach
wieder geschlossen.

Warum async? FastAPI ist ein asynchrones Framework. Wenn wir synchrone
Datenbankzugriffe verwenden würden, würde der Server bei jeder DB-Abfrage
blockieren und könnte in der Zwischenzeit keine anderen Anfragen bearbeiten.
Mit async kann der Server während einer DB-Abfrage weiterarbeiten.
"""

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings


class Base(DeclarativeBase):
    """
    Basisklasse für alle Datenbankmodelle.

    Jedes Modell (z.B. Meter, User, Reading) erbt von dieser Klasse.
    SQLAlchemy erkennt dadurch automatisch, welche Klassen Datenbanktabellen
    repräsentieren, und kann sie erstellen/migrieren.
    """
    pass


# ── Globale Variablen für Engine und Session-Factory ──
# Werden beim Start der App initialisiert (siehe init_db)
_engine = None
_async_session_factory = None


async def init_db():
    """
    Initialisiert die Datenbankverbindung.

    Erstellt:
    1. Engine: Die Verbindung zur Datenbank (Connection Pool)
    2. Session-Factory: Erstellt neue Sessions für jede Anfrage

    Wird einmal beim Start der App aufgerufen (siehe main.py → lifespan).
    """
    global _engine, _async_session_factory

    settings = get_settings()

    # Engine erstellen – verwaltet einen Pool von Datenbankverbindungen
    _engine = create_async_engine(
        settings.database_url,
        echo=settings.debug,  # SQL-Queries im Log anzeigen (nur in Entwicklung)
        pool_size=10,         # Max. 10 gleichzeitige Verbindungen
        max_overflow=20,      # Bis zu 20 weitere bei Bedarf
        pool_recycle=3600,    # Verbindungen nach 1 Stunde erneuern
    )

    # Session-Factory: Erzeugt eine neue Session pro Anfrage
    _async_session_factory = async_sessionmaker(
        _engine,
        class_=AsyncSession,
        expire_on_commit=False,  # Objekte bleiben nach commit() lesbar
    )

    # Tabellen erstellen, falls sie noch nicht existieren
    # In der Produktion macht das Alembic (Migrationen), aber für
    # die erste Einrichtung ist das hier als Fallback nützlich.
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def close_db():
    """
    Schließt die Datenbankverbindung sauber.
    Wird beim Beenden der App aufgerufen.
    """
    global _engine
    if _engine:
        await _engine.dispose()
        _engine = None


def async_session_factory():
    """
    Gibt die Session-Factory zurück (für Celery-Tasks und andere Nicht-FastAPI-Kontexte).

    Falls die DB noch nicht initialisiert wurde (z.B. im Celery-Worker),
    wird eine eigene Engine + Session-Factory erstellt.
    """
    global _engine, _async_session_factory

    if _async_session_factory is None:
        # Lazy-Init für Celery-Worker und andere Nicht-FastAPI-Kontexte
        settings = get_settings()
        _engine = create_async_engine(
            settings.database_url,
            echo=False,
            pool_size=5,
            max_overflow=10,
            pool_recycle=3600,
        )
        _async_session_factory = async_sessionmaker(
            _engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )

    return _async_session_factory()


async def get_db() -> AsyncSession:
    """
    FastAPI-Dependency: Stellt eine Datenbank-Session bereit.

    Wird in API-Routen als Dependency verwendet:
        @router.get("/meters")
        async def list_meters(db: AsyncSession = Depends(get_db)):
            ...

    Die Session wird automatisch nach der Anfrage geschlossen.
    Bei einem Fehler wird die Transaktion zurückgerollt.
    """
    if _async_session_factory is None:
        raise RuntimeError("Datenbank wurde noch nicht initialisiert. Bitte init_db() aufrufen.")

    async with _async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
