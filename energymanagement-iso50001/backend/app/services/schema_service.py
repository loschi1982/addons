"""
schema_service.py – Energieflussbild-Verwaltung.

CRUD für Energieschemata und deren Positionen (Knoten im Flussbild).
"""

import uuid

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger()


class SchemaService:
    """Service für Energieflussbilder."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_schemas(self) -> list[dict]:
        """Alle Energieschemata auflisten."""
        raise NotImplementedError

    async def create_schema(self, data: dict) -> dict:
        """Neues Energieschema anlegen."""
        raise NotImplementedError

    async def get_schema(self, schema_id: uuid.UUID) -> dict:
        """Schema mit Positionen laden."""
        raise NotImplementedError

    async def update_schema(self, schema_id: uuid.UUID, data: dict) -> dict:
        """Schema aktualisieren."""
        raise NotImplementedError

    async def delete_schema(self, schema_id: uuid.UUID) -> None:
        """Schema löschen."""
        raise NotImplementedError

    async def create_position(self, schema_id: uuid.UUID, data: dict) -> dict:
        """Neue Position im Schema anlegen."""
        raise NotImplementedError

    async def update_position(self, position_id: uuid.UUID, data: dict) -> dict:
        """Position aktualisieren (z.B. Drag & Drop)."""
        raise NotImplementedError

    async def delete_position(self, position_id: uuid.UUID) -> None:
        """Position löschen."""
        raise NotImplementedError
