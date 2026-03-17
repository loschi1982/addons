"""
reading.py – Schemas für Zählerstände und Datenimport.

Zählerstände sind die Rohdaten des Energiemanagements. Sie können
manuell eingegeben, per CSV/Excel importiert oder automatisch von
Sensoren gelesen werden.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import BaseSchema


# ---------------------------------------------------------------------------
# Zählerstand (MeterReading)
# ---------------------------------------------------------------------------

class ReadingCreate(BaseModel):
    """Einzelnen Zählerstand manuell erfassen."""
    meter_id: uuid.UUID
    timestamp: datetime
    value: Decimal = Field(..., description="Zählerstand in der Zählereinheit")
    source: str = Field("manual", max_length=50)
    quality: str = Field("measured", max_length=50)
    notes: str | None = None


class ReadingBulkCreate(BaseModel):
    """Mehrere Zählerstände auf einmal erfassen."""
    readings: list[ReadingCreate] = Field(..., min_length=1)


class ReadingUpdate(BaseModel):
    """Zählerstand korrigieren."""
    value: Decimal | None = None
    timestamp: datetime | None = None
    quality: str | None = None
    notes: str | None = None


class ReadingResponse(BaseSchema):
    """Zählerstand in API-Responses."""
    id: uuid.UUID
    meter_id: uuid.UUID
    timestamp: datetime
    value: Decimal
    consumption: Decimal | None = None
    source: str
    quality: str
    notes: str | None = None
    import_batch_id: uuid.UUID | None = None


class ReadingWithMeterResponse(ReadingResponse):
    """Zählerstand mit Zähler-Kurzinfo."""
    meter_name: str
    meter_number: str | None
    energy_type: str
    unit: str


# ---------------------------------------------------------------------------
# Verbrauchsdaten (aggregiert)
# ---------------------------------------------------------------------------

class ConsumptionDataPoint(BaseModel):
    """Ein Datenpunkt in einer Verbrauchszeitreihe."""
    timestamp: datetime
    value: Decimal
    unit: str = "kWh"


class ConsumptionSummary(BaseModel):
    """Verbrauchszusammenfassung für einen Zeitraum."""
    meter_id: uuid.UUID
    meter_name: str
    energy_type: str
    period_start: date
    period_end: date
    total_consumption: Decimal
    unit: str
    data_points: list[ConsumptionDataPoint] = []
    avg_daily: Decimal | None = None
    min_daily: Decimal | None = None
    max_daily: Decimal | None = None


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------

class ImportUploadResponse(BaseModel):
    """Antwort nach Datei-Upload – zeigt erkannte Spalten."""
    batch_id: uuid.UUID
    filename: str
    detected_columns: list[str]
    preview_rows: list[dict[str, Any]]
    row_count: int


class ImportMappingRequest(BaseModel):
    """Spaltenzuordnung für den Import bestätigen."""
    batch_id: uuid.UUID
    column_mapping: dict[str, str] = Field(
        ..., description="Zuordnung: Quellspalte → Zielspalte (timestamp, value, meter_id)"
    )
    date_format: str | None = Field(None, description="z.B. '%d.%m.%Y %H:%M'")
    decimal_separator: str = Field(",", pattern="^[.,]$")
    skip_duplicates: bool = True
    save_as_profile: str | None = Field(None, description="Profilname zum Speichern")


class ImportResultResponse(BaseModel):
    """Ergebnis eines abgeschlossenen Imports."""
    batch_id: uuid.UUID
    status: str
    total_rows: int
    imported_count: int
    skipped_count: int
    error_count: int
    errors: list[dict[str, Any]] = []


class ImportMappingProfileResponse(BaseSchema):
    """Gespeichertes Import-Mapping-Profil."""
    id: uuid.UUID
    name: str
    column_mapping: dict[str, str]
    date_format: str | None
    decimal_separator: str
    created_at: datetime


# ---------------------------------------------------------------------------
# Plausibilitätsprüfung
# ---------------------------------------------------------------------------

class PlausibilityWarning(BaseModel):
    """Warnung bei unplausiblem Zählerstand."""
    meter_id: uuid.UUID
    meter_name: str
    reading_id: uuid.UUID | None = None
    warning_type: str
    message: str
    value: Decimal
    expected_range: dict[str, Decimal] | None = None
