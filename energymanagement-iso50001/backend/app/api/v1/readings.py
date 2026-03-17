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

router = APIRouter()


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
    raise NotImplementedError("ReadingService noch nicht implementiert")


@router.post("", response_model=ReadingResponse, status_code=201)
async def create_reading(
    request: ReadingCreate,
    current_user: User = Depends(require_permission("readings", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Einzelnen Zählerstand erfassen."""
    raise NotImplementedError("ReadingService noch nicht implementiert")


@router.post("/bulk", response_model=list[ReadingResponse], status_code=201)
async def create_readings_bulk(
    request: ReadingBulkCreate,
    current_user: User = Depends(require_permission("readings", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Mehrere Zählerstände auf einmal erfassen."""
    raise NotImplementedError("ReadingService noch nicht implementiert")


@router.get("/{reading_id}", response_model=ReadingResponse)
async def get_reading(
    reading_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Einzelnen Zählerstand abrufen."""
    raise NotImplementedError("ReadingService noch nicht implementiert")


@router.put("/{reading_id}", response_model=ReadingResponse)
async def update_reading(
    reading_id: uuid.UUID,
    request: ReadingUpdate,
    current_user: User = Depends(require_permission("readings", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Zählerstand korrigieren."""
    raise NotImplementedError("ReadingService noch nicht implementiert")


@router.delete("/{reading_id}", response_model=DeleteResponse)
async def delete_reading(
    reading_id: uuid.UUID,
    current_user: User = Depends(require_permission("readings", "delete")),
    db: AsyncSession = Depends(get_db),
):
    """Zählerstand löschen."""
    raise NotImplementedError("ReadingService noch nicht implementiert")


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
    raise NotImplementedError("ConsumptionService noch nicht implementiert")
