"""
report_service.py – Berichterstellung und PDF-Generierung.

Erstellt Energieberichte mit eingefrorenem Daten-Snapshot und
generiert PDF-Dokumente via WeasyPrint.
"""

import uuid

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger()


class ReportService:
    """Service für Energieberichte."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_reports(self, **filters) -> dict:
        """Berichte auflisten."""
        raise NotImplementedError

    async def create_report(self, data: dict) -> dict:
        """
        Neuen Bericht anlegen und Daten-Snapshot erstellen.

        Der Snapshot friert die aktuellen Verbrauchsdaten ein,
        damit sich der Bericht nicht nachträglich ändert.
        """
        raise NotImplementedError

    async def get_report(self, report_id: uuid.UUID) -> dict:
        """Bericht mit Details laden."""
        raise NotImplementedError

    async def update_report(self, report_id: uuid.UUID, data: dict) -> dict:
        """Bericht aktualisieren."""
        raise NotImplementedError

    async def delete_report(self, report_id: uuid.UUID) -> None:
        """Bericht löschen."""
        raise NotImplementedError

    async def generate_pdf(self, report_id: uuid.UUID, template: str = "default") -> str:
        """
        PDF-Bericht generieren.

        Nutzt Jinja2-Templates und WeasyPrint für die Konvertierung.
        Gibt den Dateipfad des generierten PDFs zurück.
        """
        raise NotImplementedError
