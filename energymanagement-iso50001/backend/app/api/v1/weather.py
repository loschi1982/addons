"""
weather.py – Endpunkte für Wetterdaten und Witterungskorrektur.

Wetterdaten werden vom DWD via Bright Sky API bezogen.
Die Witterungskorrektur normalisiert den Heizenergieverbrauch
auf ein Referenzklima.
"""

import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.user import User
from app.schemas.weather import (
    DegreeDaysSummary,
    MonthlyDegreeDaysResponse,
    WeatherCorrectedConsumptionResponse,
    WeatherCorrectionConfigCreate,
    WeatherCorrectionConfigResponse,
    WeatherRecordResponse,
    WeatherStationResponse,
    WeatherStationSearchParams,
)
from app.services.weather_service import WeatherCorrectionService, WeatherService

router = APIRouter()


def _station_to_response(s, distance_km: Decimal | None = None) -> dict:
    """WeatherStation → Response-Dict."""
    return {
        "id": s.id,
        "name": s.name,
        "dwd_station_id": s.dwd_station_id or "",
        "latitude": Decimal(str(s.latitude)),
        "longitude": Decimal(str(s.longitude)),
        "altitude": Decimal(str(s.altitude)) if s.altitude else None,
        "distance_km": distance_km,
    }


# ---------------------------------------------------------------------------
# Wetterstationen
# ---------------------------------------------------------------------------

@router.get("/stations", response_model=list[WeatherStationResponse])
async def list_stations(
    search: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle Wetterstationen auflisten."""
    service = WeatherService(db)
    stations = await service.list_stations(search=search)
    return [_station_to_response(s) for s in stations]


@router.post("/stations/nearest", response_model=WeatherStationResponse)
async def find_nearest_station(
    params: WeatherStationSearchParams,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Nächste Wetterstation zu Koordinaten finden."""
    service = WeatherService(db)
    station = await service.find_nearest_station(
        params.latitude, params.longitude, params.max_distance_km
    )
    if not station:
        raise HTTPException(404, "Keine Wetterstation in Reichweite gefunden")
    return _station_to_response(station)


# ---------------------------------------------------------------------------
# Wetterdaten und Gradtagszahlen
# ---------------------------------------------------------------------------

@router.get("/stations/{station_id}/data", response_model=list[WeatherRecordResponse])
async def get_weather_data(
    station_id: uuid.UUID,
    start_date: date = Query(...),
    end_date: date = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Wetterdaten für eine Station und Zeitraum abrufen."""
    service = WeatherService(db)
    records = await service.get_weather_data(station_id, start_date, end_date)
    return records


@router.get("/degree-days", response_model=DegreeDaysSummary)
async def get_degree_days(
    station_id: uuid.UUID = Query(...),
    start_date: date = Query(...),
    end_date: date = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Gradtagszahlen für Station und Zeitraum abrufen."""
    service = WeatherService(db)
    return await service.get_degree_days(station_id, start_date, end_date)


@router.post("/fetch")
async def trigger_weather_fetch(
    station_id: uuid.UUID = Query(...),
    start_date: date = Query(...),
    end_date: date = Query(...),
    current_user: User = Depends(require_permission("weather", "fetch")),
    db: AsyncSession = Depends(get_db),
):
    """Wetterdaten vom DWD abrufen (Bright Sky API)."""
    service = WeatherService(db)
    count = await service.fetch_from_dwd(station_id, start_date, end_date)
    return {"message": f"{count} Tageswerte abgerufen und gespeichert", "days_saved": count}


# ---------------------------------------------------------------------------
# Witterungskorrektur
# ---------------------------------------------------------------------------

@router.get("/correction/configs", response_model=list[WeatherCorrectionConfigResponse])
async def list_correction_configs(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle Witterungskorrektur-Konfigurationen auflisten."""
    service = WeatherCorrectionService(db)
    return await service.list_configs()


@router.post("/correction/configs", response_model=WeatherCorrectionConfigResponse, status_code=201)
async def create_correction_config(
    request: WeatherCorrectionConfigCreate,
    current_user: User = Depends(require_permission("weather", "configure")),
    db: AsyncSession = Depends(get_db),
):
    """Witterungskorrektur für einen Zähler konfigurieren."""
    service = WeatherCorrectionService(db)
    config = await service.create_config(request.model_dump())
    return config


@router.get("/correction/results", response_model=list[WeatherCorrectedConsumptionResponse])
async def get_corrected_consumption(
    meter_id: uuid.UUID = Query(...),
    start_date: date = Query(...),
    end_date: date = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Witterungskorrigierten Verbrauch abrufen."""
    service = WeatherCorrectionService(db)
    return await service.get_corrected_consumption(meter_id, start_date, end_date)


@router.post("/correction/calculate")
async def trigger_correction(
    meter_id: uuid.UUID = Query(...),
    start_date: date = Query(...),
    end_date: date = Query(...),
    current_user: User = Depends(require_permission("weather", "calculate")),
    db: AsyncSession = Depends(get_db),
):
    """Witterungskorrektur für einen Zähler berechnen."""
    service = WeatherCorrectionService(db)
    results = await service.calculate_correction(meter_id, start_date, end_date)
    return {"message": f"{len(results)} Monate korrigiert", "count": len(results)}
