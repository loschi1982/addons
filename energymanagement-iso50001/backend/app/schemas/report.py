"""
report.py – Schemas für Energieberichte / Audit-Reports.

Energieberichte werden als PDF generiert und enthalten einen
eingefrorenen Daten-Snapshot, CO₂-Bilanz, Handlungsempfehlungen
und optional Witterungskorrektur-Ergebnisse.
"""

import uuid
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.common import BaseSchema


# ---------------------------------------------------------------------------
# Bericht
# ---------------------------------------------------------------------------

class ReportBase(BaseModel):
    """Gemeinsame Bericht-Felder."""
    title: str = Field(..., max_length=255)
    report_type: str = Field(..., max_length=50)
    period_start: date
    period_end: date


class ReportCreate(ReportBase):
    """Neuen Bericht erstellen."""
    meter_ids: list[uuid.UUID] | None = None
    include_co2: bool = True
    include_weather_correction: bool = False
    include_benchmarks: bool = False
    template: str | None = None


class ReportUpdate(BaseModel):
    """Bericht aktualisieren (z.B. Status ändern)."""
    title: str | None = None
    status: str | None = None
    findings: list[dict[str, Any]] | None = None
    recommendations: list[dict[str, Any]] | None = None


class ReportResponse(ReportBase, BaseSchema):
    """Bericht in API-Responses."""
    id: uuid.UUID
    status: str
    weather_correction_applied: bool
    pdf_path: str | None
    generated_at: datetime | None
    created_at: datetime


class ReportDetailResponse(ReportResponse):
    """Bericht mit vollständigem Daten-Snapshot."""
    data_snapshot: dict[str, Any] | None
    co2_summary: dict[str, Any] | None
    findings: list[dict[str, Any]] | None
    recommendations: list[dict[str, Any]] | None


class ReportGenerateRequest(BaseModel):
    """Anfrage zur PDF-Generierung eines bestehenden Berichts."""
    report_id: uuid.UUID
    template: str = "default"
    language: str = "de"
