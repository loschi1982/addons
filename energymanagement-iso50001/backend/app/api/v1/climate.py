"""
climate.py – Endpunkte für Innenraum-Klimasensoren.

Klimasensoren messen Temperatur und Luftfeuchtigkeit in
verschiedenen Zonen. Die Daten fließen in Komfort-Analysen
und die Witterungskorrektur ein.
"""

import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.user import User
from app.schemas.climate import (
    ClimateComfortDashboard,
    ClimateReadingCreate,
    ClimateReadingResponse,
    ClimateSensorCreate,
    ClimateSensorResponse,
    ClimateSensorUpdate,
    ClimateZoneSummaryResponse,
)
from app.schemas.common import DeleteResponse, PaginatedResponse

router = APIRouter()


@router.get("/sensors", response_model=PaginatedResponse[ClimateSensorResponse])
async def list_sensors(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    zone: str | None = None,
    is_active: bool | None = True,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle Klimasensoren auflisten."""
    raise NotImplementedError("ClimateService noch nicht implementiert")


@router.post("/sensors", response_model=ClimateSensorResponse, status_code=201)
async def create_sensor(
    request: ClimateSensorCreate,
    current_user: User = Depends(require_permission("climate", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Neuen Klimasensor anlegen."""
    raise NotImplementedError("ClimateService noch nicht implementiert")


@router.get("/sensors/{sensor_id}", response_model=ClimateSensorResponse)
async def get_sensor(
    sensor_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Klimasensor abrufen."""
    raise NotImplementedError("ClimateService noch nicht implementiert")


@router.put("/sensors/{sensor_id}", response_model=ClimateSensorResponse)
async def update_sensor(
    sensor_id: uuid.UUID,
    request: ClimateSensorUpdate,
    current_user: User = Depends(require_permission("climate", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Klimasensor aktualisieren."""
    raise NotImplementedError("ClimateService noch nicht implementiert")


@router.delete("/sensors/{sensor_id}", response_model=DeleteResponse)
async def delete_sensor(
    sensor_id: uuid.UUID,
    current_user: User = Depends(require_permission("climate", "delete")),
    db: AsyncSession = Depends(get_db),
):
    """Klimasensor löschen."""
    raise NotImplementedError("ClimateService noch nicht implementiert")


# ---------------------------------------------------------------------------
# Messwerte
# ---------------------------------------------------------------------------

@router.get("/readings", response_model=PaginatedResponse[ClimateReadingResponse])
async def list_readings(
    sensor_id: uuid.UUID | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=1000),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Klimamesswerte auflisten."""
    raise NotImplementedError("ClimateService noch nicht implementiert")


@router.post("/readings", response_model=ClimateReadingResponse, status_code=201)
async def create_reading(
    request: ClimateReadingCreate,
    current_user: User = Depends(require_permission("climate", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Klimamesswert manuell erfassen."""
    raise NotImplementedError("ClimateService noch nicht implementiert")


# ---------------------------------------------------------------------------
# Komfort-Dashboard
# ---------------------------------------------------------------------------

@router.get("/comfort", response_model=ClimateComfortDashboard)
async def get_comfort_dashboard(
    period_start: date | None = None,
    period_end: date | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Klima-Komfort-Dashboard abrufen."""
    raise NotImplementedError("ClimateService noch nicht implementiert")


@router.get("/zones/summary", response_model=list[ClimateZoneSummaryResponse])
async def get_zone_summaries(
    period_start: date = Query(...),
    period_end: date = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Zonen-Zusammenfassungen für einen Zeitraum."""
    raise NotImplementedError("ClimateService noch nicht implementiert")
