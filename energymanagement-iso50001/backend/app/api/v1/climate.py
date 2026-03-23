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
from app.services.climate_service import ClimateService

router = APIRouter()


def _sensor_to_response(s) -> ClimateSensorResponse:
    """ClimateSensor → ClimateSensorResponse."""
    return ClimateSensorResponse(
        id=s.id,
        name=s.name,
        sensor_type=s.sensor_type,
        location=s.location,
        zone=s.zone,
        usage_unit_id=s.usage_unit_id,
        ha_entity_id_temp=s.ha_entity_id_temp,
        ha_entity_id_humidity=s.ha_entity_id_humidity,
        data_source=s.data_source,
        source_config=s.source_config,
        target_temp_min=s.target_temp_min,
        target_temp_max=s.target_temp_max,
        target_humidity_min=s.target_humidity_min,
        target_humidity_max=s.target_humidity_max,
        associated_meter_ids=s.associated_meter_ids,
        is_active=s.is_active,
        created_at=s.created_at,
    )


def _reading_to_response(r) -> ClimateReadingResponse:
    """ClimateReading → ClimateReadingResponse."""
    return ClimateReadingResponse(
        id=r.id,
        sensor_id=r.sensor_id,
        timestamp=r.timestamp,
        temperature=r.temperature,
        humidity=r.humidity,
        dew_point=r.dew_point,
        source=r.source,
        quality=r.quality,
    )


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
    service = ClimateService(db)
    result = await service.list_sensors(
        zone=zone, is_active=is_active, page=page, page_size=page_size
    )
    total = result["total"]
    return PaginatedResponse(
        items=[_sensor_to_response(s) for s in result["items"]],
        total=total,
        page=result["page"],
        page_size=result["page_size"],
        total_pages=(total + page_size - 1) // page_size if total > 0 else 0,
    )


@router.post("/sensors", response_model=ClimateSensorResponse, status_code=201)
async def create_sensor(
    request: ClimateSensorCreate,
    current_user: User = Depends(require_permission("climate", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Neuen Klimasensor anlegen."""
    service = ClimateService(db)
    sensor = await service.create_sensor(request.model_dump())
    return _sensor_to_response(sensor)


@router.post("/sensors/from-discovery", response_model=ClimateSensorResponse, status_code=201)
async def create_sensor_from_discovery(
    request: dict,
    current_user: User = Depends(require_permission("climate", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Klimasensor aus Discovery-Daten anlegen (vereinfachte Anlage)."""
    integration = request.get("integration", "homeassistant")

    sensor_data = {
        "name": request.get("name", "Sensor"),
        "sensor_type": "temperature_humidity" if request.get("entity_id_humidity") else "temperature",
        "zone": request.get("zone"),
        "data_source": integration,
        "ha_entity_id_temp": request.get("entity_id_temp"),
        "ha_entity_id_humidity": request.get("entity_id_humidity"),
        "target_temp_min": request.get("target_temp_min", 20),
        "target_temp_max": request.get("target_temp_max", 24),
        "target_humidity_min": request.get("target_humidity_min", 40),
        "target_humidity_max": request.get("target_humidity_max", 60),
    }

    service = ClimateService(db)
    sensor = await service.create_sensor(sensor_data)
    return _sensor_to_response(sensor)


@router.get("/sensors/{sensor_id}", response_model=ClimateSensorResponse)
async def get_sensor(
    sensor_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Klimasensor abrufen."""
    service = ClimateService(db)
    sensor = await service.get_sensor(sensor_id)
    return _sensor_to_response(sensor)


@router.put("/sensors/{sensor_id}", response_model=ClimateSensorResponse)
async def update_sensor(
    sensor_id: uuid.UUID,
    request: ClimateSensorUpdate,
    current_user: User = Depends(require_permission("climate", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Klimasensor aktualisieren."""
    service = ClimateService(db)
    sensor = await service.update_sensor(sensor_id, request.model_dump(exclude_unset=True))
    return _sensor_to_response(sensor)


@router.delete("/sensors/{sensor_id}", response_model=DeleteResponse)
async def delete_sensor(
    sensor_id: uuid.UUID,
    current_user: User = Depends(require_permission("climate", "delete")),
    db: AsyncSession = Depends(get_db),
):
    """Klimasensor löschen."""
    service = ClimateService(db)
    await service.delete_sensor(sensor_id)
    return DeleteResponse(id=sensor_id)


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
    service = ClimateService(db)
    result = await service.list_readings(
        sensor_id=sensor_id, start=start, end=end, page=page, page_size=page_size
    )
    total = result["total"]
    return PaginatedResponse(
        items=[_reading_to_response(r) for r in result["items"]],
        total=total,
        page=result["page"],
        page_size=result["page_size"],
        total_pages=(total + page_size - 1) // page_size if total > 0 else 0,
    )


@router.post("/readings", response_model=ClimateReadingResponse, status_code=201)
async def create_reading(
    request: ClimateReadingCreate,
    current_user: User = Depends(require_permission("climate", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Klimamesswert manuell erfassen."""
    service = ClimateService(db)
    reading = await service.create_reading(request.model_dump())
    return _reading_to_response(reading)


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
    service = ClimateService(db)
    data = await service.get_comfort_dashboard(period_start, period_end)
    return ClimateComfortDashboard(
        zones=data["zones"],
        current_readings=[_reading_to_response(r) for r in data["current_readings"]],
        alerts=data["alerts"],
    )


@router.get("/zones/summary", response_model=list[ClimateZoneSummaryResponse])
async def get_zone_summaries(
    period_start: date = Query(...),
    period_end: date = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Zonen-Zusammenfassungen für einen Zeitraum."""
    service = ClimateService(db)
    return await service.get_zone_summaries(period_start, period_end)
