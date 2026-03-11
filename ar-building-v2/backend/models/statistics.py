# Datenbankmodelle für das Statistik- und Tracking-System.
# SQLAlchemy definiert hier die Tabellenstruktur für die SQLite-Datenbank.

from datetime import datetime, timezone
from sqlalchemy import Integer, String, DateTime
from sqlalchemy.orm import Mapped, mapped_column

# WICHTIG: absoluter Import wie in allen anderen Models (room.py, user.py, object.py).
# Relativer Import (from ..database) führt zu ImportError wenn das Paket als
# backend.models.statistics geladen wird.
from backend.database import Base


class StatEvent(Base):
    """
    Speichert einzelne Tracking-Events (z.B. Login, Raum-Scan, Objekt-Erkennung).
    Jede Nutzeraktion, die wir aufzeichnen wollen, landet als eine Zeile hier.
    """
    __tablename__ = "stat_events"

    # Eindeutige ID – wird automatisch vergeben
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Art des Events, z.B. "room_scan" oder "login_pin"
    event_type: Mapped[str] = mapped_column(String, nullable=False)

    # Eindeutige ID der Browser-Sitzung (crypto.randomUUID() aus dem Frontend)
    session_id: Mapped[str] = mapped_column(String, nullable=False)

    # Rolle des Nutzers zum Zeitpunkt des Events (kann leer sein bei fehlgeschlagenem Login)
    role: Mapped[str | None] = mapped_column(String, nullable=True)

    # Optionale Verknüpfung mit einem Raum
    room_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Optionale Verknüpfung mit einem Objekt/Exponat
    object_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Zeitpunkt des Events – standardmäßig die aktuelle UTC-Zeit
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False
    )


class Heartbeat(Base):
    """
    Speichert den letzten Lebenszeichen-Zeitstempel pro Sitzung.
    Das Frontend schickt alle 30 Sekunden einen Heartbeat.
    Sitzungen ohne Heartbeat seit mehr als 90 Sekunden gelten als inaktiv.
    """
    __tablename__ = "heartbeats"

    # session_id ist hier der Primärschlüssel – pro Sitzung gibt es genau einen Eintrag
    session_id: Mapped[str] = mapped_column(String, primary_key=True)

    # Rolle des Nutzers in dieser Sitzung
    role: Mapped[str | None] = mapped_column(String, nullable=True)

    # In welchem Raum befindet sich der Nutzer gerade (kann leer sein)
    room_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Zeitpunkt des letzten Heartbeats – wird bei jedem Heartbeat aktualisiert
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)