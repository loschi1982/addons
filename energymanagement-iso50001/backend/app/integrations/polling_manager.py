"""
polling_manager.py – Zentraler Polling-Manager für automatische Datenerfassung.

Koordiniert das periodische Abrufen von Zählerständen aus
verschiedenen Quellen (Shelly, Modbus, KNX, Home Assistant).
Wird als Celery-Beat-Task im Hintergrund ausgeführt.
"""

import uuid

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meter import Meter

logger = structlog.get_logger()


class PollingManager:
    """Koordiniert das automatische Polling aller konfigurierten Zähler."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def poll_all_meters(self) -> dict:
        """
        Alle aktiven Zähler mit automatischer Datenquelle abfragen.

        Iteriert über alle Zähler mit data_source != 'manual',
        erstellt den passenden Client und liest den aktuellen Stand.

        Returns:
            Dict mit Zusammenfassung: polled, success, errors
        """
        # TODO: Implementierung
        # 1. Alle aktiven Meter mit data_source in (shelly, modbus, knx, ha_entity) laden
        # 2. Für jeden Meter den passenden Client erstellen
        # 3. Wert abrufen und als MeterReading speichern
        # 4. Fehler loggen und weitermachen
        raise NotImplementedError

    async def poll_single_meter(self, meter_id: uuid.UUID) -> dict:
        """Einzelnen Zähler manuell abfragen."""
        raise NotImplementedError

    async def _poll_shelly(self, meter: Meter) -> dict:
        """Shelly-Gerät abfragen."""
        raise NotImplementedError

    async def _poll_modbus(self, meter: Meter) -> dict:
        """Modbus-Gerät abfragen."""
        raise NotImplementedError

    async def _poll_knx(self, meter: Meter) -> dict:
        """KNX-Gruppenadresse abfragen."""
        raise NotImplementedError

    async def _poll_ha_entity(self, meter: Meter) -> dict:
        """Home Assistant Entität abfragen."""
        raise NotImplementedError
