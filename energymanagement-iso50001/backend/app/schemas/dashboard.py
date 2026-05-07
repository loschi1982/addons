"""
dashboard.py – Schemas für Dashboard-Daten.

Das Dashboard zeigt eine Übersicht über Verbrauch, Kosten, CO₂
und Energiekennzahlen (EnPI). Die Daten werden aggregiert und
für verschiedene Zeiträume und Gruppierungen bereitgestellt.
"""

import uuid
from datetime import date

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Dashboard-Widgets
# ---------------------------------------------------------------------------

class KPICard(BaseModel):
    """Einzelne Kennzahl für KPI-Karten im Dashboard."""
    label: str
    value: float
    unit: str
    energy_type: str | None = None
    trend_percent: float | None = None
    trend_direction: str | None = None  # "up", "down", "stable"
    comparison_value: float | None = None
    comparison_label: str | None = None


class EnergyBreakdown(BaseModel):
    """Verbrauchsaufteilung nach Energieart."""
    energy_type: str
    consumption_kwh: float
    original_value: float | None = None
    original_unit: str | None = None
    cost_eur: float | None = None
    co2_kg: float | None = None
    share_percent: float
    color: str | None = None


class TimeSeriesPoint(BaseModel):
    """Datenpunkt in einer Zeitreihe."""
    label: str
    value: float
    comparison_value: float | None = None


class ConsumptionChart(BaseModel):
    """Verbrauchszeitreihe für Charts."""
    meter_id: str | None = None  # UUID oder energy_type-String bei Aggregation
    meter_name: str | None = None
    energy_type: str
    unit: str
    data: list[TimeSeriesPoint] = []


# ---------------------------------------------------------------------------
# Dashboard-Response
# ---------------------------------------------------------------------------

class DashboardResponse(BaseModel):
    """Komplette Dashboard-Daten."""
    period_start: date
    period_end: date
    kpi_cards: list[KPICard] = []
    energy_breakdown: list[EnergyBreakdown] = []
    consumption_chart: list[ConsumptionChart] = []
    top_consumers: list[dict] = []
    alerts: list[dict] = []
    enpi_overview: list[dict] = []


class EnPIResponse(BaseModel):
    """Energiekennzahl (Energy Performance Indicator)."""
    meter_id: uuid.UUID
    meter_name: str
    energy_type: str
    enpi_value: float
    enpi_unit: str
    target_value: float | None = None
    baseline_value: float | None = None
    period: str
    status: str  # "on_track", "at_risk", "off_track"
