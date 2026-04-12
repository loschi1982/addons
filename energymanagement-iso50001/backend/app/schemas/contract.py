"""
contract.py – Schemas für Energielieferverträge.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.schemas.common import BaseSchema


class EnergyContractCreate(BaseModel):
    """Neuen Energieliefervertrag anlegen."""
    name: str = Field(..., max_length=255)
    contract_number: str | None = Field(None, max_length=100)
    supplier: str = Field(..., max_length=255)
    energy_type: str = Field(..., max_length=50)
    valid_from: date
    valid_until: date | None = None
    notice_period_days: int | None = Field(None, ge=0)
    auto_renewal: bool = False
    contracted_annual_kwh: Decimal | None = Field(None, ge=0)
    contracted_annual_m3: Decimal | None = Field(None, ge=0)
    price_per_kwh: Decimal | None = Field(None, ge=0)
    price_per_m3: Decimal | None = Field(None, ge=0)
    base_fee_monthly: Decimal | None = Field(None, ge=0)
    peak_demand_fee: Decimal | None = Field(None, ge=0)
    vat_rate: Decimal | None = Field(None, ge=0, le=100)
    max_demand_kw: Decimal | None = Field(None, ge=0)
    voltage_level: str | None = Field(None, max_length=50)
    renewable_share_percent: Decimal | None = Field(None, ge=0, le=100)
    co2_g_per_kwh: Decimal | None = Field(None, ge=0)
    notes: str | None = None
    document_path: str | None = Field(None, max_length=500)
    additional_data: dict | None = None
    meter_ids: list[uuid.UUID] = Field(default_factory=list)
    is_active: bool = True


class EnergyContractUpdate(BaseModel):
    """Energieliefervertrag aktualisieren (alle Felder optional)."""
    name: str | None = Field(None, max_length=255)
    contract_number: str | None = Field(None, max_length=100)
    supplier: str | None = Field(None, max_length=255)
    energy_type: str | None = Field(None, max_length=50)
    valid_from: date | None = None
    valid_until: date | None = None
    notice_period_days: int | None = Field(None, ge=0)
    auto_renewal: bool | None = None
    contracted_annual_kwh: Decimal | None = Field(None, ge=0)
    contracted_annual_m3: Decimal | None = Field(None, ge=0)
    price_per_kwh: Decimal | None = Field(None, ge=0)
    price_per_m3: Decimal | None = Field(None, ge=0)
    base_fee_monthly: Decimal | None = Field(None, ge=0)
    peak_demand_fee: Decimal | None = Field(None, ge=0)
    vat_rate: Decimal | None = Field(None, ge=0, le=100)
    max_demand_kw: Decimal | None = Field(None, ge=0)
    voltage_level: str | None = Field(None, max_length=50)
    renewable_share_percent: Decimal | None = Field(None, ge=0, le=100)
    co2_g_per_kwh: Decimal | None = Field(None, ge=0)
    notes: str | None = None
    document_path: str | None = Field(None, max_length=500)
    additional_data: dict | None = None
    meter_ids: list[uuid.UUID] | None = None
    is_active: bool | None = None


class EnergyContractResponse(BaseSchema):
    """Energieliefervertrag in API-Responses."""
    id: uuid.UUID
    name: str
    contract_number: str | None
    supplier: str
    energy_type: str
    valid_from: date
    valid_until: date | None
    notice_period_days: int | None
    auto_renewal: bool
    contracted_annual_kwh: Decimal | None
    contracted_annual_m3: Decimal | None
    price_per_kwh: Decimal | None
    price_per_m3: Decimal | None
    base_fee_monthly: Decimal | None
    peak_demand_fee: Decimal | None
    vat_rate: Decimal | None
    max_demand_kw: Decimal | None
    voltage_level: str | None
    renewable_share_percent: Decimal | None
    co2_g_per_kwh: Decimal | None
    notes: str | None
    document_path: str | None
    additional_data: dict | None
    meter_ids: list[uuid.UUID]
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ContractComparisonResponse(BaseSchema):
    """Soll-/Ist-Vergleich: Vertrag vs. tatsächlicher Verbrauch."""
    contract_id: uuid.UUID
    contract_name: str
    supplier: str
    energy_type: str
    period_start: date
    period_end: date

    # Vertragswerte (Soll)
    contracted_annual_kwh: Decimal | None
    contracted_period_kwh: Decimal | None   # anteilig auf Zeitraum

    # Tatsächlicher Verbrauch (Ist)
    actual_kwh: Decimal
    actual_cost_net: Decimal

    # Abweichung
    deviation_kwh: Decimal | None           # Ist - Soll
    deviation_percent: Decimal | None       # (Ist - Soll) / Soll * 100

    # Hochrechnung auf Jahresende
    projected_annual_kwh: Decimal | None

    # Preisvergleich
    contracted_price_per_kwh: Decimal | None
    actual_price_per_kwh: Decimal | None    # Kosten / kWh aus Readings

    # Status
    days_in_period: int
    days_elapsed: int
    is_expired: bool
    expires_soon: bool                       # Kündigung innerhalb von 90 Tagen fällig
