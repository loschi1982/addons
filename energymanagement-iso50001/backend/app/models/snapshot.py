"""
snapshot.py – Vorberechnete Snapshot-Tabellen für Dashboard, Datenqualität,
Analytics und Tarif-Aggregate.

Statt teure Aggregationen bei jedem Seitenaufruf live aus der Datenbank zu
ziehen, werden für eine feste Menge an Standardzeiträumen Snapshots
periodisch per Celery Beat berechnet und hier abgelegt. Die Services lesen
primär aus diesen Tabellen und fallen nur bei freien Custom-Zeiträumen
auf die Live-Berechnung zurück.

Pattern angelehnt an `co2_calculations` (UPSERT, monatliche Vorberechnung).
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import TypeEngine

from app.core.database import Base
from app.models.base import UUIDMixin


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _json_payload() -> TypeEngine:
    """Eigene Instanz pro Spalte – JSONB für Postgres, JSON-Fallback für SQLite (Tests)."""
    return JSON().with_variant(JSONB(), "postgresql")


class DashboardSnapshot(Base, UUIDMixin):
    """Vorberechnete DashboardResponse für (site, period_key, granularity).

    site_id NULL = Gesamt-Ansicht über alle Standorte.
    """
    __tablename__ = "dashboard_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "site_id", "period_key", "granularity",
            name="uq_dashboard_snapshot",
        ),
    )

    site_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sites.id", ondelete="CASCADE"), nullable=True, index=True
    )
    period_key: Mapped[str] = mapped_column(String(32), index=True)
    granularity: Mapped[str] = mapped_column(String(16))
    payload: Mapped[dict] = mapped_column(_json_payload())
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )


class DataQualitySnapshot(Base, UUIDMixin):
    """Vorberechnete Datenqualitätsdaten (Alerts + Plausibilitätswarnungen)
    pro Standort (site_id NULL = Gesamt)."""
    __tablename__ = "data_quality_snapshots"
    __table_args__ = (
        UniqueConstraint("site_id", name="uq_data_quality_snapshot"),
    )

    site_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sites.id", ondelete="CASCADE"), nullable=True, index=True
    )
    payload: Mapped[dict] = mapped_column(_json_payload())
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )


class AnalyticsSnapshot(Base, UUIDMixin):
    """Vorberechnete Analytics-Ergebnisse: timeseries, comparison, sankey,
    weather_corrected. kind unterscheidet die Variante."""
    __tablename__ = "analytics_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "site_id", "period_key", "kind",
            name="uq_analytics_snapshot",
        ),
    )

    site_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sites.id", ondelete="CASCADE"), nullable=True, index=True
    )
    period_key: Mapped[str] = mapped_column(String(32), index=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    payload: Mapped[dict] = mapped_column(_json_payload())
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )


class TariffAggregateSnapshot(Base, UUIDMixin):
    """Vorberechnete Tarif-Aggregate: effektive €/kWh und Basisgebühren je
    Energieart aus `energy_invoices`."""
    __tablename__ = "tariff_aggregate_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "site_id", "period_key",
            name="uq_tariff_aggregate_snapshot",
        ),
    )

    site_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sites.id", ondelete="CASCADE"), nullable=True, index=True
    )
    period_key: Mapped[str] = mapped_column(String(32), index=True)
    payload: Mapped[dict] = mapped_column(_json_payload())
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )
