"""
schemas.py – Endpunkte für Energieflussbilder.

Das Energieflussbild visualisiert die Zählerstruktur als
interaktives Diagramm mit Drag & Drop.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
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
from app.services.schema_service import SchemaService

router = APIRouter()


@router.get("", response_model=list[SchemaResponse])
async def list_schemas(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle Energieschemata auflisten."""
    service = SchemaService(db)
    return await service.list_schemas()


@router.post("", response_model=SchemaResponse, status_code=201)
async def create_schema(
    request: SchemaCreate,
    current_user: User = Depends(require_permission("schemas", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Neues Energieschema anlegen."""
    service = SchemaService(db)
    return await service.create_schema(request.model_dump())


@router.get("/{schema_id}", response_model=SchemaDetailResponse)
async def get_schema(
    schema_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Energieschema mit Positionen abrufen."""
    service = SchemaService(db)
    schema = await service.get_schema(schema_id)
    if not schema:
        raise HTTPException(status_code=404, detail="Schema nicht gefunden")
    # Positionen mit Zähler-Infos anreichern
    positions = []
    for pos in schema.positions:
        positions.append(SchemaPositionResponse(
            id=pos.id,
            schema_id=pos.schema_id,
            meter_id=pos.meter_id,
            x=pos.x,
            y=pos.y,
            width=pos.width,
            height=pos.height,
            style_config=pos.style_config,
            connections=pos.connections,
            meter_name=pos.meter.name if pos.meter else None,
            energy_type=pos.meter.energy_type if pos.meter else None,
        ))
    return SchemaDetailResponse(
        id=schema.id,
        name=schema.name,
        schema_type=schema.schema_type,
        description=schema.description,
        is_default=schema.is_default,
        created_at=schema.created_at,
        positions=positions,
    )


@router.put("/{schema_id}", response_model=SchemaResponse)
async def update_schema(
    schema_id: uuid.UUID,
    request: SchemaUpdate,
    current_user: User = Depends(require_permission("schemas", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Energieschema aktualisieren."""
    service = SchemaService(db)
    schema = await service.update_schema(schema_id, request.model_dump(exclude_unset=True))
    if not schema:
        raise HTTPException(status_code=404, detail="Schema nicht gefunden")
    return schema


@router.delete("/{schema_id}", response_model=DeleteResponse)
async def delete_schema(
    schema_id: uuid.UUID,
    current_user: User = Depends(require_permission("schemas", "delete")),
    db: AsyncSession = Depends(get_db),
):
    """Energieschema löschen."""
    service = SchemaService(db)
    deleted = await service.delete_schema(schema_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Schema nicht gefunden")
    return DeleteResponse(message="Schema gelöscht")


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
    service = SchemaService(db)
    pos = await service.create_position(schema_id, request.model_dump(exclude={"schema_id"}))
    return SchemaPositionResponse(
        id=pos.id,
        schema_id=pos.schema_id,
        meter_id=pos.meter_id,
        x=pos.x,
        y=pos.y,
        width=pos.width,
        height=pos.height,
        style_config=pos.style_config,
        connections=pos.connections,
        meter_name=pos.meter.name if pos.meter else None,
        energy_type=pos.meter.energy_type if pos.meter else None,
    )


@router.put("/{schema_id}/positions/{position_id}", response_model=SchemaPositionResponse)
async def update_position(
    schema_id: uuid.UUID,
    position_id: uuid.UUID,
    request: SchemaPositionUpdate,
    current_user: User = Depends(require_permission("schemas", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Zähler-Position aktualisieren (z.B. nach Drag & Drop)."""
    service = SchemaService(db)
    pos = await service.update_position(position_id, request.model_dump(exclude_unset=True))
    if not pos:
        raise HTTPException(status_code=404, detail="Position nicht gefunden")
    return SchemaPositionResponse(
        id=pos.id,
        schema_id=pos.schema_id,
        meter_id=pos.meter_id,
        x=pos.x,
        y=pos.y,
        width=pos.width,
        height=pos.height,
        style_config=pos.style_config,
        connections=pos.connections,
        meter_name=pos.meter.name if pos.meter else None,
        energy_type=pos.meter.energy_type if pos.meter else None,
    )


@router.delete("/{schema_id}/positions/{position_id}", response_model=DeleteResponse)
async def delete_position(
    schema_id: uuid.UUID,
    position_id: uuid.UUID,
    current_user: User = Depends(require_permission("schemas", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Position aus Schema entfernen."""
    service = SchemaService(db)
    deleted = await service.delete_position(position_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Position nicht gefunden")
    return DeleteResponse(message="Position gelöscht")
