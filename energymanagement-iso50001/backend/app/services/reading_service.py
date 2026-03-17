"""
reading_service.py – Zählerstand-Verwaltung und Verbrauchsberechnung.

Zählerstände werden erfasst und der Verbrauch als Differenz
aufeinanderfolgender Stände berechnet. Plausibilitätsprüfungen
warnen bei ungewöhnlichen Werten.
"""

import uuid
from datetime import date
from decimal import Decimal

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.reading import MeterReading

logger = structlog.get_logger()


class ReadingService:
    """Service für Zählerstände und Verbrauchsberechnung."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_readings(self, **filters) -> dict:
        """Zählerstände auflisten mit Filtern."""
        raise NotImplementedError

    async def create_reading(self, data: dict) -> MeterReading:
        """
        Zählerstand erfassen und Verbrauch berechnen.

        1. Wert validieren
        2. Plausibilitätsprüfung (nicht negativ, nicht zu hoch)
        3. Verbrauch als Differenz zum Vorgänger berechnen
        4. Speichern und zurückgeben
        """
        raise NotImplementedError

    async def create_readings_bulk(self, readings: list[dict]) -> list[MeterReading]:
        """Mehrere Zählerstände auf einmal erfassen."""
        raise NotImplementedError

    async def update_reading(self, reading_id: uuid.UUID, data: dict) -> MeterReading:
        """Zählerstand korrigieren und Verbrauch neu berechnen."""
        raise NotImplementedError

    async def delete_reading(self, reading_id: uuid.UUID) -> None:
        """Zählerstand löschen und Folgeverbrauch neu berechnen."""
        raise NotImplementedError

    async def get_consumption_summary(
        self,
        meter_ids: list[uuid.UUID],
        start_date: date,
        end_date: date,
        granularity: str = "monthly",
    ) -> list[dict]:
        """Verbrauchszusammenfassung für Zeitraum berechnen."""
        raise NotImplementedError

    async def _check_plausibility(
        self, meter_id: uuid.UUID, value: Decimal, timestamp: date
    ) -> list[dict]:
        """Plausibilitätsprüfung: Rückgang, Ausreißer, Lücken."""
        raise NotImplementedError
