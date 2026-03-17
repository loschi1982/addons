"""
meter_service.py – Zähler-Verwaltung.

CRUD für Zähler, Baumansicht, Zählerwechsel.
Zähler können hierarchisch organisiert sein (Haupt-/Unterzähler).
"""

import uuid

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meter import Meter

logger = structlog.get_logger()


class MeterService:
    """Service für Zähler-CRUD und Hierarchie."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_meters(self, **filters) -> dict:
        """Zähler auflisten mit Filtern und Pagination."""
        raise NotImplementedError

    async def create_meter(self, data: dict) -> Meter:
        """Neuen Zähler anlegen."""
        raise NotImplementedError

    async def get_meter(self, meter_id: uuid.UUID) -> Meter:
        """Zähler mit Details laden."""
        raise NotImplementedError

    async def update_meter(self, meter_id: uuid.UUID, data: dict) -> Meter:
        """Zähler aktualisieren."""
        raise NotImplementedError

    async def delete_meter(self, meter_id: uuid.UUID) -> None:
        """Zähler deaktivieren (Soft-Delete)."""
        raise NotImplementedError

    async def get_meter_tree(self, energy_type: str | None = None) -> list[dict]:
        """Zählerbaum als hierarchische Struktur aufbauen."""
        raise NotImplementedError

    async def create_meter_change(self, meter_id: uuid.UUID, data: dict) -> dict:
        """Zählerwechsel dokumentieren."""
        raise NotImplementedError

    async def list_meter_changes(self, meter_id: uuid.UUID) -> list[dict]:
        """Zählerwechsel-Historie abrufen."""
        raise NotImplementedError
