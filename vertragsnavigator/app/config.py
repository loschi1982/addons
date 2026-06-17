"""Konfiguration des Add-ons.

Im HA-Betrieb liest ``run.sh`` die Add-on-Optionen aus ``/data/options.json``
und reicht sie als Umgebungsvariablen weiter. Fuer die lokale Entwicklung
koennen ``PAPERLESS_URL``/``PAPERLESS_TOKEN``/``VN_DB_PATH`` direkt gesetzt
werden.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    """Laufzeit-Einstellungen."""

    paperless_url: str            # interne API-URL (App -> Paperless)
    paperless_token: str
    paperless_external_url: str   # vom Browser erreichbare URL (Sprungmarken)
    db_path: str
    passwortschutz: bool          # Login mit Paperless-Zugangsdaten erforderlich?


def get_settings() -> Settings:
    """Liest die aktuellen Einstellungen aus der Umgebung.

    Bewusst bei jedem Aufruf frisch gelesen, damit Tests die Umgebung
    veraendern koennen, ohne Importreihenfolge beachten zu muessen.
    """
    schutz = os.environ.get("PASSWORTSCHUTZ", "true").strip().lower()
    return Settings(
        paperless_url=os.environ.get("PAPERLESS_URL", "").rstrip("/"),
        paperless_token=os.environ.get("PAPERLESS_TOKEN", ""),
        paperless_external_url=os.environ.get("PAPERLESS_EXTERNAL_URL", "").rstrip("/"),
        db_path=os.environ.get("VN_DB_PATH", "/data/vertragsnavigator.db"),
        passwortschutz=schutz not in ("0", "false", "no", "off"),
    )
