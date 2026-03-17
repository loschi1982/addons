"""
schema.py – Schemas für Energieflussbild (Energieschema).

Das Energieflussbild ist eine visuelle Darstellung der Zählerstruktur.
Zähler werden als Knoten positioniert und mit Verbindungen verknüpft,
um den Energiefluss vom Hauptzähler zu den Unterzählern darzustellen.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.common import BaseSchema


# ---------------------------------------------------------------------------
# Energieschema
# ---------------------------------------------------------------------------

class SchemaBase(BaseModel):
    """Gemeinsame Schema-Felder."""
    name: str = Field(..., max_length=255)
    schema_type: str = Field("sankey", max_length=50)
    description: str | None = None
    is_default: bool = False


class SchemaCreate(SchemaBase):
    """Neues Energieschema anlegen."""
    pass


class SchemaUpdate(BaseModel):
    """Energieschema aktualisieren."""
    name: str | None = None
    schema_type: str | None = None
    description: str | None = None
    is_default: bool | None = None


class SchemaResponse(SchemaBase, BaseSchema):
    """Energieschema in API-Responses."""
    id: uuid.UUID
    created_at: datetime


# ---------------------------------------------------------------------------
# Schema-Positionen (Knoten im Flussbild)
# ---------------------------------------------------------------------------

class SchemaPositionBase(BaseModel):
    """Position eines Zählers im Energieflussbild."""
    schema_id: uuid.UUID
    meter_id: uuid.UUID
    label: str | None = Field(None, max_length=255)
    x: Decimal
    y: Decimal
    width: Decimal = Decimal("150")
    height: Decimal = Decimal("60")
    style_config: dict[str, Any] | None = None
    connections: list[dict[str, Any]] | None = None


class SchemaPositionCreate(SchemaPositionBase):
    """Neue Position im Schema anlegen."""
    pass


class SchemaPositionUpdate(BaseModel):
    """Position aktualisieren (z.B. nach Drag & Drop)."""
    label: str | None = None
    x: Decimal | None = None
    y: Decimal | None = None
    width: Decimal | None = None
    height: Decimal | None = None
    style_config: dict[str, Any] | None = None
    connections: list[dict[str, Any]] | None = None


class SchemaPositionResponse(SchemaPositionBase, BaseSchema):
    """Schema-Position in API-Responses."""
    id: uuid.UUID
    meter_name: str | None = None
    energy_type: str | None = None


class SchemaDetailResponse(SchemaResponse):
    """Komplettes Schema mit allen Positionen."""
    positions: list[SchemaPositionResponse] = []
