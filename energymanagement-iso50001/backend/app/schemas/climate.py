"""
climate.py – Schemas für Klimasensoren und Messwerte.

Innenraum-Klimadaten (Temperatur, Luftfeuchtigkeit) ergänzen die
externen Wetterdaten für präzisere Analysen und Behaglichkeitsbewertung.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.common import BaseSchema


# ---------------------------------------------------------------------------
# Klimasensor
# ---------------------------------------------------------------------------

class ClimateSensorBase(BaseModel):
    """Gemeinsame Sensor-Felder."""
    name: str = Field(..., max_length=255)
    sensor_type: str = Field(..., max_length=50)
    location: str | None = Field(None, max_length=255)
    zone: str | None = Field(None, max_length=100)
    usage_unit_id: uuid.UUID | None = None
    ha_entity_id_temp: str | None = Field(None, max_length=255)
    ha_entity_id_humidity: str | None = Field(None, max_length=255)
    data_source: str = Field("manual", max_length=50)
    source_config: dict[str, Any] | None = None
    target_temp_min: Decimal | None = None
    target_temp_max: Decimal | None = None
    target_humidity_min: Decimal | None = None
    target_humidity_max: Decimal | None = None
    associated_meter_ids: list[uuid.UUID] | None = None


class ClimateSensorCreate(ClimateSensorBase):
    """Neuen Klimasensor anlegen."""
    pass


class ClimateSensorUpdate(BaseModel):
    """Klimasensor aktualisieren."""
    name: str | None = None
    sensor_type: str | None = None
    location: str | None = None
    zone: str | None = None
    usage_unit_id: uuid.UUID | None = None
    ha_entity_id_temp: str | None = None
    ha_entity_id_humidity: str | None = None
    data_source: str | None = None
    source_config: dict[str, Any] | None = None
    target_temp_min: Decimal | None = None
    target_temp_max: Decimal | None = None
    target_humidity_min: Decimal | None = None
    target_humidity_max: Decimal | None = None
    associated_meter_ids: list[uuid.UUID] | None = None
    is_active: bool | None = None


class ClimateSensorResponse(ClimateSensorBase, BaseSchema):
    """Klimasensor in API-Responses."""
    id: uuid.UUID
    is_active: bool
    created_at: datetime


# ---------------------------------------------------------------------------
# Klima-Messwert
# ---------------------------------------------------------------------------

class ClimateReadingCreate(BaseModel):
    """Klimamesswert manuell erfassen."""
    sensor_id: uuid.UUID
    timestamp: datetime
    temperature: Decimal | None = None
    humidity: Decimal | None = None
    source: str = Field("manual", max_length=50)


class ClimateReadingResponse(BaseSchema):
    """Klimamesswert in API-Responses."""
    id: uuid.UUID
    sensor_id: uuid.UUID
    timestamp: datetime
    temperature: Decimal | None
    humidity: Decimal | None
    dew_point: Decimal | None
    source: str
    quality: str


# ---------------------------------------------------------------------------
# Zonen-Zusammenfassung
# ---------------------------------------------------------------------------

class ClimateZoneSummaryResponse(BaseSchema):
    """Aggregierte Klimadaten pro Zone."""
    id: uuid.UUID
    zone: str
    period_start: date
    period_end: date
    avg_temperature: Decimal
    min_temperature: Decimal
    max_temperature: Decimal
    avg_humidity: Decimal
    hours_below_target_temp: Decimal
    hours_above_target_temp: Decimal
    hours_outside_target_humidity: Decimal
    comfort_score: Decimal | None


class ClimateComfortDashboard(BaseModel):
    """Daten für das Klima-Komfort-Dashboard."""
    zones: list[ClimateZoneSummaryResponse] = []
    current_readings: list[ClimateReadingResponse] = []
    alerts: list[dict] = []
