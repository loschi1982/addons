"""
weather.py – Schemas für Wetterdaten und Gradtagszahlen.

Wetterdaten werden vom DWD (Bright Sky API) bezogen und für die
Witterungskorrektur des Heizenergieverbrauchs verwendet.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.schemas.common import BaseSchema


# ---------------------------------------------------------------------------
# Wetterstation
# ---------------------------------------------------------------------------

class WeatherStationResponse(BaseSchema):
    """Wetterstation in API-Responses."""
    id: uuid.UUID
    name: str
    dwd_station_id: str
    latitude: Decimal
    longitude: Decimal
    altitude: Decimal | None
    distance_km: Decimal | None = None


class WeatherStationSearchParams(BaseModel):
    """Suchparameter für die nächste Wetterstation."""
    latitude: Decimal
    longitude: Decimal
    max_distance_km: int = 50


# ---------------------------------------------------------------------------
# Wetterdaten
# ---------------------------------------------------------------------------

class WeatherRecordResponse(BaseSchema):
    """Tageswetterdaten."""
    id: uuid.UUID
    station_id: uuid.UUID
    date: date
    temp_avg: Decimal
    temp_min: Decimal | None
    temp_max: Decimal | None
    heating_degree_days: Decimal
    cooling_degree_days: Decimal
    sunshine_hours: Decimal | None


class MonthlyDegreeDaysResponse(BaseSchema):
    """Monatliche Gradtagszahlen – wichtig für Witterungskorrektur."""
    id: uuid.UUID
    station_id: uuid.UUID
    year: int
    month: int
    heating_degree_days: Decimal
    cooling_degree_days: Decimal
    avg_temperature: Decimal
    heating_days: int
    long_term_avg_hdd: Decimal | None


class DegreeDaysSummary(BaseModel):
    """Zusammenfassung der Gradtagszahlen für einen Zeitraum."""
    station_id: uuid.UUID
    station_name: str
    period_start: date
    period_end: date
    total_hdd: Decimal
    total_cdd: Decimal
    monthly_data: list[MonthlyDegreeDaysResponse] = []


# ---------------------------------------------------------------------------
# Witterungskorrektur
# ---------------------------------------------------------------------------

class WeatherCorrectionConfigCreate(BaseModel):
    """Witterungskorrektur für einen Zähler konfigurieren."""
    meter_id: uuid.UUID
    station_id: uuid.UUID
    method: str = Field("degree_day", max_length=50)
    indoor_temp: Decimal = Field(Decimal("20.0"))
    heating_limit: Decimal = Field(Decimal("15.0"))
    cooling_limit: Decimal = Field(Decimal("24.0"))
    reference_year: int | None = None
    reference_hdd: Decimal | None = None
    base_load_percent: Decimal | None = None


class WeatherCorrectionConfigResponse(BaseSchema):
    """Witterungskorrektur-Konfiguration in API-Responses."""
    id: uuid.UUID
    meter_id: uuid.UUID
    station_id: uuid.UUID
    method: str
    indoor_temp: Decimal
    heating_limit: Decimal
    cooling_limit: Decimal
    reference_year: int | None
    reference_hdd: Decimal | None
    base_load_percent: Decimal | None
    is_active: bool


class WeatherCorrectedConsumptionResponse(BaseSchema):
    """Witterungskorrigierter Verbrauch."""
    id: uuid.UUID
    meter_id: uuid.UUID
    period_start: date
    period_end: date
    raw_consumption: Decimal
    corrected_consumption: Decimal
    correction_factor: Decimal
    actual_hdd: Decimal
    reference_hdd: Decimal
    method: str
    calculated_at: datetime
