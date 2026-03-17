"""
climate_service.py – Innenraum-Klimadaten.

Verwaltet Klimasensoren und deren Messwerte (Temperatur, Luftfeuchtigkeit).
Berechnet Komfort-Scores und Zonen-Zusammenfassungen.
"""

import uuid
from datetime import date

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger()


class ClimateService:
    """Service für Klimasensoren und Komfort-Analyse."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_sensors(self, **filters) -> dict:
        """Klimasensoren auflisten."""
        raise NotImplementedError

    async def create_sensor(self, data: dict) -> dict:
        """Neuen Klimasensor anlegen."""
        raise NotImplementedError

    async def get_sensor(self, sensor_id: uuid.UUID) -> dict:
        """Klimasensor abrufen."""
        raise NotImplementedError

    async def update_sensor(self, sensor_id: uuid.UUID, data: dict) -> dict:
        """Klimasensor aktualisieren."""
        raise NotImplementedError

    async def delete_sensor(self, sensor_id: uuid.UUID) -> None:
        """Klimasensor löschen."""
        raise NotImplementedError

    async def create_reading(self, data: dict) -> dict:
        """Klimamesswert erfassen (inkl. Taupunkt-Berechnung)."""
        raise NotImplementedError

    async def list_readings(self, **filters) -> dict:
        """Klimamesswerte auflisten."""
        raise NotImplementedError

    async def get_comfort_dashboard(
        self, period_start: date | None = None, period_end: date | None = None
    ) -> dict:
        """Komfort-Dashboard-Daten berechnen."""
        raise NotImplementedError

    async def get_zone_summaries(self, period_start: date, period_end: date) -> list[dict]:
        """Zonen-Zusammenfassungen berechnen."""
        raise NotImplementedError
