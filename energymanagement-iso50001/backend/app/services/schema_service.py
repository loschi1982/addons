"""
schema_service.py – Energieflussbild-Verwaltung.

CRUD für Energieschemata und deren Positionen (Knoten im Flussbild).
"""

import uuid

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.meter import Meter
from app.models.schema import EnergySchema, SchemaPosition

logger = structlog.get_logger()


class SchemaService:
    """Service für Energieflussbilder."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_schemas(self) -> list[EnergySchema]:
        """Alle Energieschemata auflisten."""
        result = await self.db.execute(
            select(EnergySchema).order_by(EnergySchema.name)
        )
        return list(result.scalars().all())

    async def create_schema(self, data: dict) -> EnergySchema:
        """Neues Energieschema anlegen."""
        # Falls is_default gesetzt, andere Default-Markierungen entfernen
        if data.get("is_default"):
            await self._clear_default()

        schema = EnergySchema(**data)
        self.db.add(schema)
        await self.db.commit()
        await self.db.refresh(schema)
        return schema

    async def get_schema(self, schema_id: uuid.UUID) -> EnergySchema | None:
        """Schema mit Positionen und Zähler-Infos laden."""
        result = await self.db.execute(
            select(EnergySchema)
            .where(EnergySchema.id == schema_id)
            .options(
                selectinload(EnergySchema.positions).selectinload(SchemaPosition.meter)
            )
        )
        return result.scalar_one_or_none()

    async def update_schema(self, schema_id: uuid.UUID, data: dict) -> EnergySchema | None:
        """Schema aktualisieren."""
        schema = await self.db.get(EnergySchema, schema_id)
        if not schema:
            return None

        if data.get("is_default"):
            await self._clear_default()

        for key, value in data.items():
            if value is not None:
                setattr(schema, key, value)

        await self.db.commit()
        await self.db.refresh(schema)
        return schema

    async def delete_schema(self, schema_id: uuid.UUID) -> bool:
        """Schema mit allen Positionen löschen."""
        schema = await self.db.get(EnergySchema, schema_id)
        if not schema:
            return False
        await self.db.delete(schema)
        await self.db.commit()
        return True

    # ── Positionen ──

    async def create_position(self, schema_id: uuid.UUID, data: dict) -> SchemaPosition:
        """Neue Position im Schema anlegen."""
        data["schema_id"] = schema_id
        position = SchemaPosition(**data)
        self.db.add(position)
        await self.db.commit()
        await self.db.refresh(position, ["meter"])
        return position

    async def update_position(
        self, position_id: uuid.UUID, data: dict
    ) -> SchemaPosition | None:
        """Position aktualisieren (z.B. nach Drag & Drop)."""
        position = await self.db.get(SchemaPosition, position_id)
        if not position:
            return None

        for key, value in data.items():
            if value is not None:
                setattr(position, key, value)

        await self.db.commit()
        await self.db.refresh(position, ["meter"])
        return position

    async def delete_position(self, position_id: uuid.UUID) -> bool:
        """Position aus Schema entfernen."""
        position = await self.db.get(SchemaPosition, position_id)
        if not position:
            return False
        await self.db.delete(position)
        await self.db.commit()
        return True

    # ── Hilfsmethoden ──

    async def _clear_default(self):
        """Alle bestehenden Default-Markierungen entfernen."""
        result = await self.db.execute(
            select(EnergySchema).where(EnergySchema.is_default == True)  # noqa: E712
        )
        for schema in result.scalars().all():
            schema.is_default = False
