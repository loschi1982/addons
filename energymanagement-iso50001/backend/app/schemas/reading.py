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

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.common import BaseSchema


# ---------------------------------------------------------------------------
# Zählerstand (MeterReading)
# ---------------------------------------------------------------------------

class ReadingCreate(BaseModel):
    """Einzelnen Zählerstand manuell erfassen.

    Entweder ``value`` (absoluter Zählerstand) oder ``consumption_direct``
    (nur Verbrauch, z.B. aus Monatsrechnung) muss angegeben sein.
    Bei ``consumption_direct`` wird der Zählerstand aus dem letzten bekannten
    Stand geschätzt und quality auf ``estimated`` gesetzt.
    """
    meter_id: uuid.UUID
    timestamp: datetime
    value: Decimal | None = Field(None, description="Absoluter Zählerstand in der Zählereinheit")
    consumption_direct: Decimal | None = Field(None, description="Nur Verbrauch (ohne Zählerstand), z.B. aus Monatsabrechnung")
    source: str = Field("manual", max_length=50)
    quality: str = Field("measured", max_length=50)
    cost_gross: Decimal | None = Field(None, description="Bruttokosten in €")
    vat_rate: Decimal | None = Field(None, description="MwSt-Satz in % (z.B. 19)")
    notes: str | None = None

    @model_validator(mode="after")
    def check_value_or_consumption(self) -> "ReadingCreate":
        if self.value is None and self.consumption_direct is None:
            raise ValueError(
                "Entweder 'value' (Zählerstand) oder 'consumption_direct' (Verbrauch) muss angegeben sein"
            )
        return self


class ReadingBulkCreate(BaseModel):
    """Mehrere Zählerstände auf einmal erfassen."""
    readings: list[ReadingCreate] = Field(..., min_length=1)


class ReadingUpdate(BaseModel):
    """Zählerstand korrigieren."""
    value: Decimal | None = None
    timestamp: datetime | None = None
    quality: str | None = None
    cost_gross: Decimal | None = None
    vat_rate: Decimal | None = None
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
    cost_gross: Decimal | None = None
    vat_rate: Decimal | None = None
    cost_net: Decimal | None = None
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

class DetectedMeterColumn(BaseModel):
    """Erkannte Zähler-Spalte in einer Multi-Meter CSV."""
    column_index: int
    column_name: str
    matched_meter_id: str | None = None
    matched_meter_name: str | None = None


class ImportUploadResponse(BaseModel):
    """Antwort nach Datei-Upload – zeigt erkannte Spalten."""
    batch_id: uuid.UUID
    filename: str
    detected_columns: list[str]
    preview_rows: list[dict[str, Any]]
    row_count: int
    is_multi_meter: bool = False
    meter_columns: list[DetectedMeterColumn] | None = None


class ImportMappingRequest(BaseModel):
    """Spaltenzuordnung für den Import bestätigen."""
    batch_id: uuid.UUID
    column_mapping: dict[str, str] = Field(
        default_factory=dict,
        description="Zuordnung: Quellspalte → Zielspalte (timestamp, value, meter_id)",
    )
    meter_column_mapping: dict[str, str] | None = Field(
        None,
        description="Multi-Meter: Spalten-Index → Meter-UUID",
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
    meter_details: list[dict[str, Any]] | None = None


class ImportMappingProfileResponse(BaseSchema):
    """Gespeichertes Import-Mapping-Profil."""
    id: uuid.UUID
    name: str
    column_mapping: dict[str, str]
    meter_mapping: dict[str, str] | None = None
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
