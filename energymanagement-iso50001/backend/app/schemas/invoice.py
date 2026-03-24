"""
invoice.py – Schemas für Energieabrechnungen.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.schemas.common import BaseSchema


class EnergyInvoiceCreate(BaseModel):
    """Neue Abrechnung anlegen."""
    period_start: date
    period_end: date
    total_cost_gross: Decimal = Field(..., ge=0)
    total_cost_net: Decimal | None = Field(None, ge=0)
    vat_rate: Decimal | None = Field(None, ge=0, le=100)
    base_fee: Decimal | None = Field(None, ge=0)
    total_consumption: Decimal | None = Field(None, ge=0)
    invoice_number: str | None = Field(None, max_length=100)
    notes: str | None = None


class EnergyInvoiceUpdate(BaseModel):
    """Abrechnung aktualisieren."""
    period_start: date | None = None
    period_end: date | None = None
    total_cost_gross: Decimal | None = Field(None, ge=0)
    total_cost_net: Decimal | None = Field(None, ge=0)
    vat_rate: Decimal | None = Field(None, ge=0, le=100)
    base_fee: Decimal | None = Field(None, ge=0)
    total_consumption: Decimal | None = Field(None, ge=0)
    invoice_number: str | None = None
    notes: str | None = None


class EnergyInvoiceResponse(BaseSchema):
    """Abrechnung in API-Responses."""
    id: uuid.UUID
    meter_id: uuid.UUID
    period_start: date
    period_end: date
    total_cost_gross: Decimal
    total_cost_net: Decimal | None
    vat_rate: Decimal | None
    base_fee: Decimal | None
    total_consumption: Decimal | None
    invoice_number: str | None
    notes: str | None
    effective_price_per_kwh: Decimal | None = None
    created_at: datetime
