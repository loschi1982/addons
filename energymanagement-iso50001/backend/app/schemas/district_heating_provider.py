"""
district_heating_provider.py – Schemas für Fernwärmeversorger.
"""

import uuid

from pydantic import BaseModel

from app.schemas.common import BaseSchema


class DistrictHeatingProviderResponse(BaseSchema):
    """Fernwärmeversorger mit FW-309-Kennzahlen."""
    id: uuid.UUID
    name: str
    city: str
    state: str | None = None
    co2_g_per_kwh: float
    primary_energy_factor: float | None = None
    certification_year: int
    renewable_share_pct: float | None = None
    source_url: str | None = None
    notes: str | None = None


class DistrictHeatingProviderCreate(BaseModel):
    """Eigenen Fernwärmeversorger anlegen."""
    name: str
    city: str
    state: str | None = None
    co2_g_per_kwh: float
    primary_energy_factor: float | None = None
    certification_year: int
    renewable_share_pct: float | None = None
    source_url: str | None = None
    notes: str | None = None
