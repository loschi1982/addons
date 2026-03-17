"""
meters.py – Endpunkte für Zähler-CRUD.

Zähler können hierarchisch organisiert sein (Haupt-/Unterzähler).
Die Baumansicht zeigt die Struktur visuell an.
"""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.user import User
from app.schemas.common import DeleteResponse, PaginatedResponse
from app.schemas.meter import (
    MeterChangeCreate,
    MeterChangeResponse,
    MeterCreate,
    MeterDetailResponse,
    MeterResponse,
    MeterTreeNode,
    MeterUpdate,
)

router = APIRouter()


@router.get("", response_model=PaginatedResponse[MeterResponse])
async def list_meters(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    energy_type: str | None = None,
    data_source: str | None = None,
    usage_unit_id: uuid.UUID | None = None,
    is_active: bool | None = True,
    search: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle Zähler auflisten mit Filtern."""
    raise NotImplementedError("MeterService noch nicht implementiert")


@router.post("", response_model=MeterResponse, status_code=201)
async def create_meter(
    request: MeterCreate,
    current_user: User = Depends(require_permission("meters", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Neuen Zähler anlegen."""
    raise NotImplementedError("MeterService noch nicht implementiert")


@router.get("/tree", response_model=list[MeterTreeNode])
async def get_meter_tree(
    energy_type: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Zählerbaum als hierarchische Struktur abrufen."""
    raise NotImplementedError("MeterService noch nicht implementiert")


@router.get("/{meter_id}", response_model=MeterDetailResponse)
async def get_meter(
    meter_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Einzelnen Zähler mit Details abrufen."""
    raise NotImplementedError("MeterService noch nicht implementiert")


@router.put("/{meter_id}", response_model=MeterResponse)
async def update_meter(
    meter_id: uuid.UUID,
    request: MeterUpdate,
    current_user: User = Depends(require_permission("meters", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Zähler aktualisieren."""
    raise NotImplementedError("MeterService noch nicht implementiert")


@router.delete("/{meter_id}", response_model=DeleteResponse)
async def delete_meter(
    meter_id: uuid.UUID,
    current_user: User = Depends(require_permission("meters", "delete")),
    db: AsyncSession = Depends(get_db),
):
    """Zähler deaktivieren (Soft-Delete)."""
    raise NotImplementedError("MeterService noch nicht implementiert")


# ---------------------------------------------------------------------------
# Zählerwechsel
# ---------------------------------------------------------------------------

@router.post("/{meter_id}/changes", response_model=MeterChangeResponse, status_code=201)
async def create_meter_change(
    meter_id: uuid.UUID,
    request: MeterChangeCreate,
    current_user: User = Depends(require_permission("meters", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Zählerwechsel dokumentieren."""
    raise NotImplementedError("MeterService noch nicht implementiert")


@router.get("/{meter_id}/changes", response_model=list[MeterChangeResponse])
async def list_meter_changes(
    meter_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Zählerwechsel-Historie abrufen."""
    raise NotImplementedError("MeterService noch nicht implementiert")
