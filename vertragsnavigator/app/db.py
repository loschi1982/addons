"""SQLite-Zugriff und Schema-Initialisierung.

Eine einzige Datei im persistenten Add-on-Verzeichnis (``/data``). Das Schema
entspricht exakt Abschnitt 3.1 der Spezifikation.
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from typing import Iterator

from .config import get_settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS themen (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL UNIQUE,
    erstellt_am  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dokumente (
    id              INTEGER PRIMARY KEY,   -- = Paperless document ID
    titel           TEXT NOT NULL,
    eltern_id       INTEGER,               -- Hauptvertrag, NULL wenn keiner
    FOREIGN KEY (eltern_id) REFERENCES dokumente(id)
);

CREATE TABLE IF NOT EXISTS markierungen (
    id           INTEGER PRIMARY KEY,
    dokument_id  INTEGER NOT NULL,
    thema_id     INTEGER,
    seite        INTEGER NOT NULL,
    textauszug   TEXT NOT NULL,
    notiz        TEXT,
    erstellt_am  TEXT NOT NULL,
    FOREIGN KEY (dokument_id) REFERENCES dokumente(id),
    FOREIGN KEY (thema_id)    REFERENCES themen(id)
);

CREATE TABLE IF NOT EXISTS verknuepfungen (
    id               INTEGER PRIMARY KEY,
    markierung_a_id  INTEGER NOT NULL,
    markierung_b_id  INTEGER NOT NULL,
    FOREIGN KEY (markierung_a_id) REFERENCES markierungen(id),
    FOREIGN KEY (markierung_b_id) REFERENCES markierungen(id)
);
"""


@contextmanager
def verbindung() -> Iterator[sqlite3.Connection]:
    """Liefert eine Verbindung mit aktiviertem FK-Constraint und Row-Factory.

    Committet bei Erfolg, rollt bei Fehler zurueck und schliesst immer.
    """
    settings = get_settings()
    conn = sqlite3.connect(settings.db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    """Legt das Schema idempotent an (beim App-Start aufgerufen)."""
    db_path = get_settings().db_path
    ordner = os.path.dirname(db_path)
    if ordner:
        os.makedirs(ordner, exist_ok=True)
    with verbindung() as conn:
        conn.executescript(SCHEMA)
