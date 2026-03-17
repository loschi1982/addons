"""
site.py – Schemas für Standorte, Gebäude und Nutzungseinheiten.

Die Standort-Hierarchie bildet die physische Struktur ab:
Standort → Gebäude → Nutzungseinheit (z.B. Wohnung, Gewerbe).
"""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.schemas.common import BaseSchema


# ---------------------------------------------------------------------------
# Standort (Site)
# ---------------------------------------------------------------------------

class SiteBase(BaseModel):
    """Gemeinsame Standort-Felder."""
    name: str = Field(..., max_length=255)
    street: str | None = Field(None, max_length=255)
    zip_code: str | None = Field(None, max_length=20)
    city: str | None = Field(None, max_length=100)
    country: str = Field("DE", max_length=5)
    latitude: Decimal | None = None
    longitude: Decimal | None = None
    weather_station_id: uuid.UUID | None = None
    co2_region: str | None = Field(None, max_length=50)
    timezone: str = Field("Europe/Berlin", max_length=50)


class SiteCreate(SiteBase):
    """Neuen Standort anlegen."""
    pass


class SiteUpdate(BaseModel):
    """Standort aktualisieren – alle Felder optional."""
    name: str | None = None
    street: str | None = None
    zip_code: str | None = None
    city: str | None = None
    country: str | None = None
    latitude: Decimal | None = None
    longitude: Decimal | None = None
    weather_station_id: uuid.UUID | None = None
    co2_region: str | None = None
    timezone: str | None = None


class SiteResponse(SiteBase, BaseSchema):
    """Standort in API-Responses."""
    id: uuid.UUID
    building_count: int | None = None
    created_at: datetime


class SiteDetailResponse(SiteResponse):
    """Standort mit verschachtelten Gebäuden."""
    buildings: list["BuildingResponse"] = []


# ---------------------------------------------------------------------------
# Gebäude (Building)
# ---------------------------------------------------------------------------

class BuildingBase(BaseModel):
    """Gemeinsame Gebäude-Felder."""
    name: str = Field(..., max_length=255)
    site_id: uuid.UUID
    street: str | None = Field(None, max_length=255)
    building_type: str | None = Field(None, max_length=50)
    building_year: int | None = None
    total_area_m2: Decimal | None = None
    heated_area_m2: Decimal | None = None
    cooled_area_m2: Decimal | None = None
    floors: int | None = None
    energy_certificate_class: str | None = Field(None, max_length=5)
    energy_certificate_value: Decimal | None = None


class BuildingCreate(BuildingBase):
    """Neues Gebäude anlegen."""
    pass


class BuildingUpdate(BaseModel):
    """Gebäude aktualisieren."""
    name: str | None = None
    street: str | None = None
    building_type: str | None = None
    building_year: int | None = None
    total_area_m2: Decimal | None = None
    heated_area_m2: Decimal | None = None
    cooled_area_m2: Decimal | None = None
    floors: int | None = None
    energy_certificate_class: str | None = None
    energy_certificate_value: Decimal | None = None


class BuildingResponse(BuildingBase, BaseSchema):
    """Gebäude in API-Responses."""
    id: uuid.UUID
    usage_unit_count: int | None = None
    created_at: datetime


class BuildingDetailResponse(BuildingResponse):
    """Gebäude mit Nutzungseinheiten."""
    usage_units: list["UsageUnitResponse"] = []


# ---------------------------------------------------------------------------
# Nutzungseinheit (UsageUnit)
# ---------------------------------------------------------------------------

class UsageUnitBase(BaseModel):
    """Gemeinsame Nutzungseinheit-Felder."""
    name: str = Field(..., max_length=255)
    building_id: uuid.UUID
    usage_type: str = Field(..., max_length=50)
    unit_number: str | None = Field(None, max_length=50)
    floor: str | None = Field(None, max_length=20)
    area_m2: Decimal | None = None
    occupants: int | None = None
    tenant_name: str | None = Field(None, max_length=255)
    tenant_since: str | None = None
    target_enpi: Decimal | None = None
    target_enpi_unit: str | None = Field(None, max_length=50)


class UsageUnitCreate(UsageUnitBase):
    """Neue Nutzungseinheit anlegen."""
    pass


class UsageUnitUpdate(BaseModel):
    """Nutzungseinheit aktualisieren."""
    name: str | None = None
    usage_type: str | None = None
    unit_number: str | None = None
    floor: str | None = None
    area_m2: Decimal | None = None
    occupants: int | None = None
    tenant_name: str | None = None
    tenant_since: str | None = None
    target_enpi: Decimal | None = None
    target_enpi_unit: str | None = None


class UsageUnitResponse(UsageUnitBase, BaseSchema):
    """Nutzungseinheit in API-Responses."""
    id: uuid.UUID
    created_at: datetime


# Zirkuläre Referenzen auflösen
SiteDetailResponse.model_rebuild()
BuildingDetailResponse.model_rebuild()
