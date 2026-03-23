"""
readings.py – Endpunkte für Zählerstände und Verbrauchsdaten.

Zählerstände können einzeln oder als Bulk erfasst werden.
Die Verbrauchsberechnung erfolgt automatisch als Differenz
aufeinanderfolgender Stände.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.user import User
from app.schemas.common import DeleteResponse, PaginatedResponse
from app.schemas.reading import (
    ConsumptionSummary,
    ReadingBulkCreate,
    ReadingCreate,
    ReadingResponse,
    ReadingUpdate,
)
from app.services.reading_service import ReadingService

router = APIRouter()


def _reading_to_response(r) -> ReadingResponse:
    """MeterReading → ReadingResponse."""
    return ReadingResponse(
        id=r.id,
        meter_id=r.meter_id,
        timestamp=r.timestamp,
        value=r.value,
        consumption=r.consumption,
        source=r.source,
        quality=r.quality,
        cost_gross=r.cost_gross,
        vat_rate=r.vat_rate,
        cost_net=r.cost_net,
        notes=r.notes,
        import_batch_id=r.import_batch_id,
    )


@router.get("", response_model=PaginatedResponse[ReadingResponse])
async def list_readings(
    meter_id: uuid.UUID | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    source: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Zählerstände auflisten mit Filtern."""
    service = ReadingService(db)
    result = await service.list_readings(
        meter_id=meter_id,
        start_date=start_date,
        end_date=end_date,
        source=source,
        page=page,
        page_size=page_size,
    )

    total = result["total"]
    return PaginatedResponse(
        items=[_reading_to_response(r) for r in result["items"]],
        total=total,
        page=result["page"],
        page_size=result["page_size"],
        total_pages=(total + page_size - 1) // page_size if total > 0 else 0,
    )


@router.post("", response_model=ReadingResponse, status_code=201)
async def create_reading(
    request: ReadingCreate,
    current_user: User = Depends(require_permission("readings", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Einzelnen Zählerstand erfassen."""
    service = ReadingService(db)
    reading = await service.create_reading(request.model_dump())
    return _reading_to_response(reading)


@router.post("/bulk", response_model=list[ReadingResponse], status_code=201)
async def create_readings_bulk(
    request: ReadingBulkCreate,
    current_user: User = Depends(require_permission("readings", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Mehrere Zählerstände auf einmal erfassen."""
    service = ReadingService(db)
    readings = await service.create_readings_bulk(
        [r.model_dump() for r in request.readings]
    )
    return [_reading_to_response(r) for r in readings]


@router.get("/{reading_id}", response_model=ReadingResponse)
async def get_reading(
    reading_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Einzelnen Zählerstand abrufen."""
    service = ReadingService(db)
    reading = await service.get_reading(reading_id)
    return _reading_to_response(reading)


@router.put("/{reading_id}", response_model=ReadingResponse)
async def update_reading(
    reading_id: uuid.UUID,
    request: ReadingUpdate,
    current_user: User = Depends(require_permission("readings", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Zählerstand korrigieren."""
    service = ReadingService(db)
    reading = await service.update_reading(
        reading_id, request.model_dump(exclude_unset=True)
    )
    return _reading_to_response(reading)


@router.delete("/{reading_id}", response_model=DeleteResponse)
async def delete_reading(
    reading_id: uuid.UUID,
    current_user: User = Depends(require_permission("readings", "delete")),
    db: AsyncSession = Depends(get_db),
):
    """Zählerstand löschen."""
    service = ReadingService(db)
    await service.delete_reading(reading_id)
    return DeleteResponse(id=reading_id)


# ---------------------------------------------------------------------------
# Verbrauchsabfragen
# ---------------------------------------------------------------------------

@router.get("/consumption/summary", response_model=list[ConsumptionSummary])
async def get_consumption_summary(
    meter_ids: str | None = Query(None, description="Komma-getrennte Zähler-UUIDs"),
    start_date: date = Query(...),
    end_date: date = Query(...),
    granularity: str = Query("monthly", pattern="^(daily|weekly|monthly|yearly)$"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Verbrauchszusammenfassung für Zeitraum und Zähler."""
    parsed_ids = []
    if meter_ids:
        for mid in meter_ids.split(","):
            parsed_ids.append(uuid.UUID(mid.strip()))

    service = ReadingService(db)
    return await service.get_consumption_summary(
        meter_ids=parsed_ids,
        start_date=start_date,
        end_date=end_date,
        granularity=granularity,
    )
