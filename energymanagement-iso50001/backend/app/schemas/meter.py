"""
meter.py – Schemas für Zähler und Verbraucher.

Zähler sind die zentrale Datenquelle im Energiemanagement. Jeder Zähler
erfasst eine Energieart (Strom, Gas, Wärme etc.) und kann manuell oder
automatisch (Shelly, Modbus, HA) abgelesen werden.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.common import BaseSchema


# ---------------------------------------------------------------------------
# Zähler (Meter)
# ---------------------------------------------------------------------------

class MeterBase(BaseModel):
    """Gemeinsame Zähler-Felder."""
    name: str = Field(..., max_length=255)
    meter_number: str | None = Field(None, max_length=100)
    energy_type: str = Field(..., max_length=50)
    unit: str = Field("kWh", max_length=20)
    data_source: str = Field("manual", max_length=50)
    source_config: dict[str, Any] | None = None
    location: str | None = Field(None, max_length=255)
    usage_unit_id: uuid.UUID | None = None
    parent_meter_id: uuid.UUID | None = None
    is_submeter: bool = False
    is_virtual: bool = False
    is_feed_in: bool = False
    is_weather_corrected: bool = False
    co2_factor_override: Decimal | None = None
    tariff_info: dict[str, Any] | None = None
    notes: str | None = None


class MeterCreate(MeterBase):
    """Neuen Zähler anlegen."""
    pass


class MeterUpdate(BaseModel):
    """Zähler aktualisieren – alle Felder optional."""
    name: str | None = None
    meter_number: str | None = None
    energy_type: str | None = None
    unit: str | None = None
    data_source: str | None = None
    source_config: dict[str, Any] | None = None
    location: str | None = None
    usage_unit_id: uuid.UUID | None = None
    parent_meter_id: uuid.UUID | None = None
    is_submeter: bool | None = None
    is_virtual: bool | None = None
    is_feed_in: bool | None = None
    is_weather_corrected: bool | None = None
    co2_factor_override: Decimal | None = None
    tariff_info: dict[str, Any] | None = None
    notes: str | None = None
    is_active: bool | None = None


class MeterResponse(MeterBase, BaseSchema):
    """Zähler in API-Responses."""
    id: uuid.UUID
    is_active: bool
    latest_reading: Decimal | None = None
    latest_reading_date: datetime | None = None
    created_at: datetime


class MeterDetailResponse(MeterResponse):
    """Zähler mit Zusatzinfos (Sub-Zähler, Verbraucher, Zuordnungen)."""
    sub_meters: list["MeterResponse"] = []
    consumers: list["ConsumerResponse"] = []
    unit_allocations: list["MeterUnitAllocationResponse"] = []


class MeterTreeNode(BaseSchema):
    """Knoten im Zählerbaum für hierarchische Darstellung."""
    id: uuid.UUID
    name: str
    meter_number: str | None
    energy_type: str
    is_submeter: bool
    children: list["MeterTreeNode"] = []


# ---------------------------------------------------------------------------
# Verbraucher (Consumer)
# ---------------------------------------------------------------------------

class ConsumerBase(BaseModel):
    """Gemeinsame Verbraucher-Felder."""
    name: str = Field(..., max_length=255)
    category: str = Field(..., max_length=100)
    rated_power_kw: Decimal | None = None
    estimated_annual_kwh: Decimal | None = None
    operating_hours_per_year: int | None = None
    priority: str = Field("normal", max_length=20)
    usage_unit_id: uuid.UUID | None = None
    description: str | None = None


class ConsumerCreate(ConsumerBase):
    """Neuen Verbraucher anlegen."""
    meter_ids: list[uuid.UUID] = []


class ConsumerUpdate(BaseModel):
    """Verbraucher aktualisieren."""
    name: str | None = None
    category: str | None = None
    rated_power_kw: Decimal | None = None
    estimated_annual_kwh: Decimal | None = None
    operating_hours_per_year: int | None = None
    priority: str | None = None
    usage_unit_id: uuid.UUID | None = None
    description: str | None = None
    meter_ids: list[uuid.UUID] | None = None


class ConsumerResponse(ConsumerBase, BaseSchema):
    """Verbraucher in API-Responses."""
    id: uuid.UUID
    meter_ids: list[uuid.UUID] = []
    created_at: datetime


# ---------------------------------------------------------------------------
# Zählerwechsel (MeterChange)
# ---------------------------------------------------------------------------

class MeterChangeCreate(BaseModel):
    """Zählerwechsel dokumentieren."""
    meter_id: uuid.UUID
    change_date: date
    old_meter_number: str | None = None
    new_meter_number: str | None = None
    final_reading: Decimal | None = None
    initial_reading: Decimal | None = None
    reason: str | None = None


class MeterChangeResponse(BaseSchema):
    """Zählerwechsel in API-Responses."""
    id: uuid.UUID
    meter_id: uuid.UUID
    change_date: date
    old_meter_number: str | None
    new_meter_number: str | None
    final_reading: Decimal | None
    initial_reading: Decimal | None
    reason: str | None


# ---------------------------------------------------------------------------
# Zähler-Nutzungseinheit-Zuordnung (MeterUnitAllocation)
# ---------------------------------------------------------------------------

class MeterUnitAllocationBase(BaseModel):
    """Gemeinsame Felder für Zähler-Einheit-Zuordnungen."""
    meter_id: uuid.UUID
    usage_unit_id: uuid.UUID
    allocation_type: str = Field("add", pattern=r"^(add|subtract)$")
    factor: Decimal = Field(Decimal("1.0"), ge=Decimal("0"), le=Decimal("9999"))
    description: str | None = None


class MeterUnitAllocationCreate(MeterUnitAllocationBase):
    """Neue Zuordnung anlegen."""
    pass


class MeterUnitAllocationUpdate(BaseModel):
    """Zuordnung aktualisieren – alle Felder optional."""
    allocation_type: str | None = Field(None, pattern=r"^(add|subtract)$")
    factor: Decimal | None = Field(None, ge=Decimal("0"), le=Decimal("9999"))
    description: str | None = None


class MeterUnitAllocationResponse(MeterUnitAllocationBase, BaseSchema):
    """Zuordnung in API-Responses."""
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class UsageUnitConsumption(BaseSchema):
    """Berechneter Verbrauch einer Nutzungseinheit."""
    usage_unit_id: uuid.UUID
    usage_unit_name: str
    total_consumption: Decimal
    unit: str
    period_start: date
    period_end: date
    allocations: list[dict] = []


# Zirkuläre Referenzen
MeterDetailResponse.model_rebuild()
MeterTreeNode.model_rebuild()
