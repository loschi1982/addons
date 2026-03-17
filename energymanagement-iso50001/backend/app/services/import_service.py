"""
import_service.py – CSV/Excel-Datenimport.

Der Import läuft in drei Schritten:
1. Datei hochladen und Spalten erkennen
2. Spaltenzuordnung bestätigen
3. Daten importieren mit Duplikat-Erkennung
"""

import uuid
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger()


class ImportService:
    """Service für CSV/Excel-Import von Zählerständen."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def upload_file(self, filename: str, content: bytes) -> dict:
        """
        Datei analysieren und Spalten erkennen.

        Unterstützte Formate: CSV, XLSX, XLS.
        Erkennt automatisch: Trennzeichen, Dezimalformat, Datumsformat.
        """
        raise NotImplementedError

    async def process_import(self, batch_id: uuid.UUID, mapping: dict) -> dict:
        """
        Import mit bestätigter Spaltenzuordnung durchführen.

        Validiert jede Zeile, prüft auf Duplikate,
        berechnet Verbrauch und protokolliert Fehler.
        """
        raise NotImplementedError

    async def get_import_result(self, batch_id: uuid.UUID) -> dict:
        """Import-Ergebnis abrufen."""
        raise NotImplementedError

    async def list_mapping_profiles(self) -> list[dict]:
        """Gespeicherte Import-Profile auflisten."""
        raise NotImplementedError

    async def delete_mapping_profile(self, profile_id: uuid.UUID) -> None:
        """Import-Profil löschen."""
        raise NotImplementedError
