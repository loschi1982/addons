"""
allocations.py – Endpunkte für Zähler-Nutzungseinheit-Zuordnungen.

Ermöglicht die Zuordnung von Zählern zu mehreren Nutzungseinheiten
mit Add/Subtract-Semantik für Stichleitungen und Querzuordnungen.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.user import User
from app.schemas.common import DeleteResponse, PaginatedResponse
from app.schemas.meter import (
    MeterUnitAllocationCreate,
    MeterUnitAllocationResponse,
    MeterUnitAllocationUpdate,
    UsageUnitConsumption,
)
from app.services.allocation_service import AllocationService

router = APIRouter()


def _allocation_to_response(alloc) -> MeterUnitAllocationResponse:
    """Hilfsfunktion: Allocation-Objekt → Response."""
    return MeterUnitAllocationResponse(
        id=alloc.id,
        meter_id=alloc.meter_id,
        usage_unit_id=alloc.usage_unit_id,
        allocation_type=alloc.allocation_type,
        factor=alloc.factor,
        description=alloc.description,
        created_at=alloc.created_at,
        updated_at=alloc.updated_at,
    )


@router.get("", response_model=PaginatedResponse)
async def list_allocations(
    meter_id: uuid.UUID | None = Query(None),
    usage_unit_id: uuid.UUID | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Zuordnungen auflisten mit optionalen Filtern."""
    service = AllocationService(db)
    result = await service.list_allocations(
        meter_id=meter_id,
        usage_unit_id=usage_unit_id,
        page=page,
        page_size=page_size,
    )
    return {
        "items": [_allocation_to_response(a) for a in result["items"]],
        "total": result["total"],
        "page": result["page"],
        "page_size": result["page_size"],
        "total_pages": -(-result["total"] // result["page_size"]),
    }


@router.post("", response_model=MeterUnitAllocationResponse, status_code=201)
async def create_allocation(
    data: MeterUnitAllocationCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_permission("allocations", "create")),
):
    """Neue Zähler-Nutzungseinheit-Zuordnung anlegen."""
    service = AllocationService(db)
    alloc = await service.create_allocation(data.model_dump())
    return _allocation_to_response(alloc)


@router.get("/unit/{usage_unit_id}/consumption", response_model=UsageUnitConsumption)
async def get_unit_consumption(
    usage_unit_id: uuid.UUID,
    start_date: date = Query(...),
    end_date: date = Query(...),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Verbrauch einer Nutzungseinheit berechnen (mit Zuordnungen)."""
    service = AllocationService(db)
    return await service.calculate_unit_consumption(
        usage_unit_id=usage_unit_id,
        start_date=start_date,
        end_date=end_date,
    )


@router.get("/{allocation_id}", response_model=MeterUnitAllocationResponse)
async def get_allocation(
    allocation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Einzelne Zuordnung abrufen."""
    service = AllocationService(db)
    alloc = await service.get_allocation(allocation_id)
    return _allocation_to_response(alloc)


@router.put("/{allocation_id}", response_model=MeterUnitAllocationResponse)
async def update_allocation(
    allocation_id: uuid.UUID,
    data: MeterUnitAllocationUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_permission("allocations", "update")),
):
    """Zuordnung aktualisieren."""
    service = AllocationService(db)
    alloc = await service.update_allocation(
        allocation_id, data.model_dump(exclude_unset=True)
    )
    return _allocation_to_response(alloc)


@router.delete("/{allocation_id}", response_model=DeleteResponse)
async def delete_allocation(
    allocation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_permission("allocations", "delete")),
):
    """Zuordnung löschen."""
    service = AllocationService(db)
    await service.delete_allocation(allocation_id)
    return DeleteResponse(message="Zuordnung gelöscht", id=allocation_id)
