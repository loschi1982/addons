"""
emission.py – Schemas für CO₂-Emissionsfaktoren und -Berechnungen.

Die CO₂-Bilanzierung nutzt Emissionsfaktoren aus verschiedenen Quellen
(BAFA, UBA, Electricity Maps) um den Verbrauch in CO₂-Äquivalente
umzurechnen.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.schemas.common import BaseSchema


# ---------------------------------------------------------------------------
# Emissionsfaktor-Quellen
# ---------------------------------------------------------------------------

class EmissionFactorSourceResponse(BaseSchema):
    """Quelle für Emissionsfaktoren (z.B. BAFA, UBA)."""
    id: uuid.UUID
    name: str
    source_type: str
    description: str | None
    url: str | None
    is_default: bool


# ---------------------------------------------------------------------------
# Emissionsfaktoren
# ---------------------------------------------------------------------------

class EmissionFactorResponse(BaseSchema):
    """Ein einzelner Emissionsfaktor."""
    id: uuid.UUID
    source_id: uuid.UUID
    energy_type: str
    year: int
    month: int | None
    region: str | None
    co2_g_per_kwh: Decimal
    scope: str | None
    source_name: str | None = None


class EmissionFactorCreate(BaseModel):
    """Eigenen Emissionsfaktor anlegen."""
    source_id: uuid.UUID
    energy_type: str
    year: int
    month: int | None = None
    region: str | None = None
    co2_g_per_kwh: Decimal
    scope: str | None = None


# ---------------------------------------------------------------------------
# CO₂-Berechnungen
# ---------------------------------------------------------------------------

class CO2CalculationResponse(BaseSchema):
    """Ergebnis einer CO₂-Berechnung."""
    id: uuid.UUID
    meter_id: uuid.UUID
    period_start: date
    period_end: date
    consumption_kwh: Decimal
    co2_kg: Decimal
    co2_g_per_kwh: Decimal
    calculation_method: str
    emission_factor_id: uuid.UUID | None
    calculated_at: datetime


class CO2Summary(BaseModel):
    """CO₂-Zusammenfassung für einen Zeitraum."""
    period_start: date
    period_end: date
    total_co2_kg: Decimal
    total_consumption_kwh: Decimal
    avg_co2_g_per_kwh: Decimal
    by_energy_type: list[dict] = []
    by_scope: list[dict] = []
    trend_vs_previous: Decimal | None = None


class CO2DashboardData(BaseModel):
    """Daten für das CO₂-Dashboard."""
    current_year: CO2Summary | None = None
    previous_year: CO2Summary | None = None
    monthly_trend: list[dict] = []
    by_building: list[dict] = []
    scope_breakdown: dict = {}
