"""
report.py – Audit-Berichte.

Ein AuditReport ist ein generierter Energiebericht, der Verbrauchsdaten,
CO₂-Bilanz, Witterungskorrektur und Handlungsempfehlungen enthält.
"""

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, String, Text
from sqlalchemy import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class AuditReport(Base, UUIDMixin, TimestampMixin):
    """
    Ein generierter Energiebericht / Audit-Report.

    Der Bericht enthält einen eingefrorenen Daten-Snapshot zum
    Zeitpunkt der Erstellung, damit sich der Inhalt nicht nachträglich
    ändert, wenn neue Zählerstände eintreffen.
    """
    __tablename__ = "audit_reports"

    title: Mapped[str] = mapped_column(String(255))
    report_type: Mapped[str] = mapped_column(String(50))
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    scope: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="pending")
    data_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    co2_summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    weather_correction_applied: Mapped[bool] = mapped_column(Boolean, default=False)
    findings: Mapped[list | None] = mapped_column(JSON, nullable=True)
    recommendations: Mapped[list | None] = mapped_column(JSON, nullable=True)
    pdf_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    generated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
