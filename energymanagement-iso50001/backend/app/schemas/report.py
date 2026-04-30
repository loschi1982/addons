"""
report.py – Schemas für Energieberichte / Audit-Reports.

Energieberichte werden als PDF generiert und enthalten einen
eingefrorenen Daten-Snapshot, CO₂-Bilanz, Handlungsempfehlungen
und optional Witterungskorrektur-Ergebnisse.
"""

import uuid
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field, model_validator
from typing import Self

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


class ReportCreate(BaseModel):
    """Neuen Bericht erstellen."""
    title: str = Field(..., max_length=255)
    report_type: str = Field(..., max_length=50)
    # Perioden-Felder: Entweder year/quarter/month ODER period_start/period_end (custom)
    period_start: date | None = None
    period_end: date | None = None
    year: int | None = None
    quarter: int | None = None  # 1-4, nur bei quarterly
    month: int | None = None    # 1-12, nur bei monthly
    # Scope-Filter
    site_id: uuid.UUID | None = None
    building_id: uuid.UUID | None = None
    usage_unit_id: uuid.UUID | None = None
    root_meter_id: uuid.UUID | None = None
    meter_ids: list[uuid.UUID] | None = None
    # Inhalts-Toggles
    include_co2: bool = True
    include_weather_correction: bool = False
    include_benchmarks: bool = False
    include_seu: bool = True
    include_enpi: bool = True
    include_anomalies: bool = True
    # Diagramm-Toggles
    include_meter_tree: bool = False
    include_heatmap: bool = False
    include_sankey: bool = True
    include_cost_flow: bool = False
    include_yoy_comparison: bool = True
    include_cost_overview: bool = False
    sections: list[str] | None = None
    template: str = "default"
    language: str = "de"
    # Bezugsgröße für Energieintensität (z.B. 500 m², 20 Mitarbeiter)
    reference_value: float | None = None
    reference_unit: str | None = "m²"
    # Optionaler Kommentar zur Analyse (z.B. Ursache für Verbrauchsänderung)
    analysis_comment: str | None = None


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
    error_message: str | None = None
    created_at: datetime
    site_id: uuid.UUID | None = None  # aus scope extrahiert

    @model_validator(mode="before")
    @classmethod
    def extract_site_id(cls, data: Self) -> Self:
        """site_id aus scope-JSON extrahieren."""
        if hasattr(data, "scope") and isinstance(data.scope, dict):
            raw = data.scope.get("site_id")
            if raw and not getattr(data, "site_id", None):
                try:
                    object.__setattr__(data, "site_id", uuid.UUID(str(raw)))
                except (ValueError, AttributeError):
                    pass
        return data


class ReportDetailResponse(ReportResponse):
    """Bericht mit vollständigem Daten-Snapshot."""
    data_snapshot: dict[str, Any] | None
    co2_summary: dict[str, Any] | None
    summary: str | None = None
    findings: list[dict[str, Any]] | None
    recommendations: list[dict[str, Any]] | None


class ReportGenerateRequest(BaseModel):
    """Anfrage zur PDF-Generierung eines bestehenden Berichts."""
    template: str = "default"
    language: str = "de"


class ReportStatusResponse(BaseModel):
    """Status der PDF-Generierung."""
    report_id: uuid.UUID
    status: str
    error_message: str | None = None
    pdf_path: str | None = None
