"""
weather.py – Endpunkte für Wetterdaten und Witterungskorrektur.

Wetterdaten werden vom DWD via Bright Sky API bezogen.
Die Witterungskorrektur normalisiert den Heizenergieverbrauch
auf ein Referenzklima.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.user import User
from app.schemas.weather import (
    DegreeDaysSummary,
    WeatherCorrectedConsumptionResponse,
    WeatherCorrectionConfigCreate,
    WeatherCorrectionConfigResponse,
    WeatherRecordResponse,
    WeatherStationResponse,
    WeatherStationSearchParams,
)

router = APIRouter()


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
    raise NotImplementedError("WeatherService noch nicht implementiert")


@router.post("/stations/nearest", response_model=WeatherStationResponse)
async def find_nearest_station(
    params: WeatherStationSearchParams,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Nächste Wetterstation zu Koordinaten finden."""
    raise NotImplementedError("WeatherService noch nicht implementiert")


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
    raise NotImplementedError("WeatherService noch nicht implementiert")


@router.get("/degree-days", response_model=DegreeDaysSummary)
async def get_degree_days(
    station_id: uuid.UUID = Query(...),
    start_date: date = Query(...),
    end_date: date = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Gradtagszahlen für Station und Zeitraum abrufen."""
    raise NotImplementedError("WeatherService noch nicht implementiert")


@router.post("/fetch")
async def trigger_weather_fetch(
    station_id: uuid.UUID = Query(...),
    start_date: date = Query(...),
    end_date: date = Query(...),
    current_user: User = Depends(require_permission("weather", "fetch")),
    db: AsyncSession = Depends(get_db),
):
    """Wetterdaten vom DWD abrufen (Bright Sky API)."""
    raise NotImplementedError("WeatherService noch nicht implementiert")


# ---------------------------------------------------------------------------
# Witterungskorrektur
# ---------------------------------------------------------------------------

@router.get("/correction/configs", response_model=list[WeatherCorrectionConfigResponse])
async def list_correction_configs(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle Witterungskorrektur-Konfigurationen auflisten."""
    raise NotImplementedError("CorrectionService noch nicht implementiert")


@router.post("/correction/configs", response_model=WeatherCorrectionConfigResponse, status_code=201)
async def create_correction_config(
    request: WeatherCorrectionConfigCreate,
    current_user: User = Depends(require_permission("weather", "configure")),
    db: AsyncSession = Depends(get_db),
):
    """Witterungskorrektur für einen Zähler konfigurieren."""
    raise NotImplementedError("CorrectionService noch nicht implementiert")


@router.get("/correction/results", response_model=list[WeatherCorrectedConsumptionResponse])
async def get_corrected_consumption(
    meter_id: uuid.UUID = Query(...),
    start_date: date = Query(...),
    end_date: date = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Witterungskorrigierten Verbrauch abrufen."""
    raise NotImplementedError("CorrectionService noch nicht implementiert")


@router.post("/correction/calculate")
async def trigger_correction(
    meter_id: uuid.UUID = Query(...),
    start_date: date = Query(...),
    end_date: date = Query(...),
    current_user: User = Depends(require_permission("weather", "calculate")),
    db: AsyncSession = Depends(get_db),
):
    """Witterungskorrektur für einen Zähler berechnen."""
    raise NotImplementedError("CorrectionService noch nicht implementiert")
