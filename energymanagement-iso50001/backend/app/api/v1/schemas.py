"""
schemas.py – Endpunkte für Energieflussbilder.

Das Energieflussbild visualisiert die Zählerstruktur als
interaktives Diagramm mit Drag & Drop.
"""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.user import User
from app.schemas.common import DeleteResponse
from app.schemas.schema import (
    SchemaCreate,
    SchemaDetailResponse,
    SchemaPositionCreate,
    SchemaPositionResponse,
    SchemaPositionUpdate,
    SchemaResponse,
    SchemaUpdate,
)

router = APIRouter()


@router.get("", response_model=list[SchemaResponse])
async def list_schemas(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle Energieschemata auflisten."""
    raise NotImplementedError("SchemaService noch nicht implementiert")


@router.post("", response_model=SchemaResponse, status_code=201)
async def create_schema(
    request: SchemaCreate,
    current_user: User = Depends(require_permission("schemas", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Neues Energieschema anlegen."""
    raise NotImplementedError("SchemaService noch nicht implementiert")


@router.get("/{schema_id}", response_model=SchemaDetailResponse)
async def get_schema(
    schema_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Energieschema mit Positionen abrufen."""
    raise NotImplementedError("SchemaService noch nicht implementiert")


@router.put("/{schema_id}", response_model=SchemaResponse)
async def update_schema(
    schema_id: uuid.UUID,
    request: SchemaUpdate,
    current_user: User = Depends(require_permission("schemas", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Energieschema aktualisieren."""
    raise NotImplementedError("SchemaService noch nicht implementiert")


@router.delete("/{schema_id}", response_model=DeleteResponse)
async def delete_schema(
    schema_id: uuid.UUID,
    current_user: User = Depends(require_permission("schemas", "delete")),
    db: AsyncSession = Depends(get_db),
):
    """Energieschema löschen."""
    raise NotImplementedError("SchemaService noch nicht implementiert")


# ---------------------------------------------------------------------------
# Positionen im Schema
# ---------------------------------------------------------------------------

@router.post("/{schema_id}/positions", response_model=SchemaPositionResponse, status_code=201)
async def create_position(
    schema_id: uuid.UUID,
    request: SchemaPositionCreate,
    current_user: User = Depends(require_permission("schemas", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Zähler-Position im Schema anlegen."""
    raise NotImplementedError("SchemaService noch nicht implementiert")


@router.put("/{schema_id}/positions/{position_id}", response_model=SchemaPositionResponse)
async def update_position(
    schema_id: uuid.UUID,
    position_id: uuid.UUID,
    request: SchemaPositionUpdate,
    current_user: User = Depends(require_permission("schemas", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Zähler-Position aktualisieren (z.B. nach Drag & Drop)."""
    raise NotImplementedError("SchemaService noch nicht implementiert")


@router.delete("/{schema_id}/positions/{position_id}", response_model=DeleteResponse)
async def delete_position(
    schema_id: uuid.UUID,
    position_id: uuid.UUID,
    current_user: User = Depends(require_permission("schemas", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Position aus Schema entfernen."""
    raise NotImplementedError("SchemaService noch nicht implementiert")
