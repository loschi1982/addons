"""
energy_review.py – Modelle für die Energiebewertung (ISO 50001 Kap. 6.3–6.5).

Wesentliche Energieeinsätze (SEU), Energieleistungskennzahlen (EnPI),
energetische Ausgangsbasis (EnB) und relevante Variablen.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import (
    Boolean, Column, Date, DateTime, ForeignKey,
    Numeric, String, Table, Text,
)
from sqlalchemy import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


# ── Relevante Variablen ──


class RelevantVariable(Base, UUIDMixin, TimestampMixin):
    """
    Einflussfaktor auf den Energieverbrauch (ISO 50001 Kap. 6.3).

    Beispiele: Heizgradtage, Produktionsmenge, Gebäudefläche, Belegung.
    Werden zur Normalisierung von EnPI und Baseline verwendet.
    """
    __tablename__ = "relevant_variables"

    name: Mapped[str] = mapped_column(String(255))
    variable_type: Mapped[str] = mapped_column(String(50))
    # weather_hdd, production, occupancy, operating_hours, area, custom
    unit: Mapped[str] = mapped_column(String(50))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    data_source: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # manual, weather_service, homeassistant
    source_config: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    values = relationship("RelevantVariableValue", back_populates="variable", cascade="all, delete-orphan")


class RelevantVariableValue(Base, UUIDMixin):
    """Einzelner Messwert einer relevanten Variable für einen Zeitraum."""
    __tablename__ = "relevant_variable_values"

    variable_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("relevant_variables.id"))
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    value: Mapped[Decimal] = mapped_column(Numeric(16, 4))
    source: Mapped[str] = mapped_column(String(50), default="manual")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    variable = relationship("RelevantVariable", back_populates="values")


# ── Wesentliche Energieeinsätze (SEU) ──


# n:m Verknüpfung: SEU ↔ Relevante Variablen
seu_relevant_variables = Table(
    "seu_relevant_variables",
    Base.metadata,
    Column("seu_id", ForeignKey("significant_energy_uses.id"), primary_key=True),
    Column("variable_id", ForeignKey("relevant_variables.id"), primary_key=True),
)


class SignificantEnergyUse(Base, UUIDMixin, TimestampMixin):
    """
    Wesentlicher Energieeinsatz (ISO 50001 Kap. 6.3).

    Identifiziert Verbraucher/Prozesse mit signifikantem Anteil am
    Gesamtenergieverbrauch. Basis für EnPI-Bildung und Monitoring.
    """
    __tablename__ = "significant_energy_uses"

    consumer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("consumers.id"), nullable=True, unique=True
    )
    name: Mapped[str] = mapped_column(String(255))
    energy_type: Mapped[str] = mapped_column(String(50))
    determination_method: Mapped[str] = mapped_column(String(50), default="manual")
    # auto_threshold, manual, pareto
    determination_criteria: Mapped[str | None] = mapped_column(Text, nullable=True)
    consumption_share_percent: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    annual_consumption_kwh: Mapped[Decimal | None] = mapped_column(Numeric(16, 4), nullable=True)
    monitoring_requirements: Mapped[list | None] = mapped_column(JSON, nullable=True)
    responsible_person: Mapped[str | None] = mapped_column(String(255), nullable=True)
    review_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    consumer = relationship("Consumer", backref="seu")
    relevant_variables = relationship(
        "RelevantVariable", secondary=seu_relevant_variables
    )


# ── Energieleistungskennzahlen (EnPI) ──


class EnergyPerformanceIndicator(Base, UUIDMixin, TimestampMixin):
    """
    Energieleistungskennzahl (ISO 50001 Kap. 6.4).

    Normierte Kennzahl wie kWh/m², kWh/Stück oder absolute Verbräuche.
    Numerator = Energieverbrauch (aus Zählern), Denominator = Bezugsgröße.
    """
    __tablename__ = "energy_performance_indicators"

    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    formula_type: Mapped[str] = mapped_column(String(50), default="specific")
    # specific (kWh/Bezug), ratio, absolute
    unit: Mapped[str] = mapped_column(String(50))
    numerator_meter_ids: Mapped[list] = mapped_column(JSON, default=list)
    denominator_variable_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("relevant_variables.id"), nullable=True
    )
    denominator_fixed_value: Mapped[Decimal | None] = mapped_column(Numeric(16, 4), nullable=True)
    seu_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("significant_energy_uses.id"), nullable=True
    )
    target_value: Mapped[Decimal | None] = mapped_column(Numeric(16, 4), nullable=True)
    target_direction: Mapped[str] = mapped_column(String(10), default="lower")
    # lower = weniger ist besser, higher = mehr ist besser
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    denominator_variable = relationship("RelevantVariable")
    seu = relationship("SignificantEnergyUse", backref="enpis")
    values = relationship("EnPIValue", back_populates="enpi", cascade="all, delete-orphan")
    baselines = relationship("EnergyBaseline", back_populates="enpi", cascade="all, delete-orphan")


class EnPIValue(Base, UUIDMixin):
    """Berechneter EnPI-Wert für einen Zeitraum."""
    __tablename__ = "enpi_values"

    enpi_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("energy_performance_indicators.id"))
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    numerator_value: Mapped[Decimal] = mapped_column(Numeric(16, 4))
    denominator_value: Mapped[Decimal | None] = mapped_column(Numeric(16, 4), nullable=True)
    enpi_value: Mapped[Decimal] = mapped_column(Numeric(16, 4))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    enpi = relationship("EnergyPerformanceIndicator", back_populates="values")


# ── Energetische Ausgangsbasis (EnB) ──


class EnergyBaseline(Base, UUIDMixin, TimestampMixin):
    """
    Energetische Ausgangsbasis (ISO 50001 Kap. 6.5).

    Referenzwert für den EnPI-Vergleich. Pro EnPI kann es mehrere
    Baselines geben (Revisionshistorie), aber nur eine aktive.
    """
    __tablename__ = "energy_baselines"

    enpi_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("energy_performance_indicators.id"))
    name: Mapped[str] = mapped_column(String(255))
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    baseline_value: Mapped[Decimal] = mapped_column(Numeric(16, 4))
    total_consumption_kwh: Mapped[Decimal | None] = mapped_column(Numeric(16, 4), nullable=True)
    adjustment_factors: Mapped[list | None] = mapped_column(JSON, nullable=True)
    adjusted_baseline_value: Mapped[Decimal | None] = mapped_column(Numeric(16, 4), nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)
    revision_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    superseded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("energy_baselines.id"), nullable=True
    )

    enpi = relationship("EnergyPerformanceIndicator", back_populates="baselines")
