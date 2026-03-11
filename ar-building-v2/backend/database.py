# Richtet die Datenbankverbindung ein und stellt eine Hilfsfunktion bereit,
# mit der jede Route eine eigene Datenbank-Session bekommt.

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

# SQLite-Datei liegt in /data – das ist der persistente HA-Speicher.
# aiosqlite ermöglicht async-Zugriff auf SQLite.
DATABASE_URL = "sqlite+aiosqlite:////data/db/ar_building.db"

# Der Engine verwaltet die Verbindung zur Datenbank.
engine = create_async_engine(
    DATABASE_URL,
    # echo=True würde alle SQL-Befehle ins Log schreiben (gut für Debugging).
    echo=False,
)

# SessionLocal ist eine Fabrik für neue Datenbank-Sessions.
SessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


# Basisklasse für alle Datenbankmodelle.
# Jede Tabelle erbt von dieser Klasse.
class Base(DeclarativeBase):
    pass


# Diese Funktion wird als FastAPI-Dependency genutzt.
# Sie öffnet eine Session, gibt sie an die Route weiter und schließt sie danach.
async def get_db():
    async with SessionLocal() as session:
        yield session