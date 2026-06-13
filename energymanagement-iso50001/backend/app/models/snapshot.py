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
from decimal import Decimal

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint
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


class MeterConsumptionStat(Base, UUIDMixin):
    """Vorberechnete Verbrauchsstatistik je Zähler (Median des Verbrauchs).

    Dient der schnellen Ausreißererkennung: Der teure percentile_cont-Median
    über die gesamte Reading-Historie wird periodisch per Celery berechnet,
    damit der /readings/outliers-Endpunkt nur noch gegen diese kleine Tabelle
    joinen muss statt live über Millionen Readings zu sortieren.
    """
    __tablename__ = "meter_consumption_stats"
    __table_args__ = (
        UniqueConstraint("meter_id", name="uq_meter_consumption_stat"),
    )

    meter_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("meters.id", ondelete="CASCADE"), index=True
    )
    median_consumption: Mapped[Decimal | None] = mapped_column(Numeric(20, 4), nullable=True)
    reading_count: Mapped[int] = mapped_column(Integer, default=0)
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )


class MeterLatestReading(Base, UUIDMixin):
    """Vorberechneter letzter Messwert (Stand + Zeitpunkt) je Zähler.

    Die Zählerliste (z. B. unter "Ablesungen") braucht je Zähler den letzten
    Stand und das Datum für die Status-Anzeige (aktuell/fällig/überfällig).
    Live über die meter_readings-Hypertable (ein LATERAL je Zähler) dauert das
    für hunderte Zähler viele Sekunden; daher periodisch per Celery vorberechnet
    und bei manuellen Korrekturen gezielt je Zähler aktualisiert.
    """
    __tablename__ = "meter_latest_readings"
    __table_args__ = (
        UniqueConstraint("meter_id", name="uq_meter_latest_reading"),
    )

    meter_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("meters.id", ondelete="CASCADE"), index=True
    )
    value: Mapped[Decimal | None] = mapped_column(Numeric(20, 4), nullable=True)
    timestamp: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )


class MeterMonthlyConsumption(Base, UUIDMixin):
    """Vorberechneter Verbrauch + Kosten je (Zähler, Jahr, Monat).

    Macht Monatsvergleich, Energiebilanz UND die Per-Monat-Auswahl der
    maßgeblichen Zähler (meter_ids_with_data_by_month → Dashboard/CO₂/Analyse)
    schnell: statt bei jedem Aufruf über die meter_readings-Hypertable zu
    aggregieren, wird hier periodisch per Celery vorberechnet. native = Summe in
    der Zähler-Einheit; Umrechnung in kWh erfolgt beim Lesen über CONVERSION_FACTORS.
    """
    __tablename__ = "meter_monthly_consumption"
    __table_args__ = (
        UniqueConstraint("meter_id", "year", "month", name="uq_meter_monthly_consumption"),
    )

    meter_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("meters.id", ondelete="CASCADE"), index=True
    )
    energy_type: Mapped[str] = mapped_column(String(50))
    unit: Mapped[str] = mapped_column(String(20), default="kWh")
    year: Mapped[int] = mapped_column(Integer, index=True)
    month: Mapped[int] = mapped_column(Integer)
    consumption_native: Mapped[Decimal] = mapped_column(Numeric(20, 4), default=0)
    cost_net: Mapped[Decimal | None] = mapped_column(Numeric(20, 4), nullable=True)
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )
