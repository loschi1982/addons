"""
emission.py – CO₂-Emissionsfaktoren und Berechnungsergebnisse.

Das System berechnet automatisch die CO₂-Emissionen aus den
Energieverbräuchen. Dafür braucht es Emissionsfaktoren – also
wie viel Gramm CO₂ pro verbrauchter kWh ausgestoßen werden.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class EmissionFactorSource(Base, UUIDMixin):
    """
    Quelle für Emissionsfaktoren (z.B. BAFA, UBA, Electricity Maps).

    Verschiedene Quellen liefern unterschiedliche Faktoren – das UBA
    veröffentlicht Jahresmittel, Electricity Maps liefert Echtzeit-Werte.
    """
    __tablename__ = "emission_factor_sources"

    name: Mapped[str] = mapped_column(String(255))
    source_type: Mapped[str] = mapped_column(String(50))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    last_updated: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    factors = relationship("EmissionFactor", back_populates="source")


class EmissionFactor(Base, UUIDMixin):
    """
    CO₂-Emissionsfaktor für einen Energieträger und Zeitraum.

    Beispiel: Strom in Deutschland 2024 = 363 g CO₂/kWh (UBA).
    Das bedeutet: Jede verbrauchte kWh Strom verursacht im Durchschnitt
    363 Gramm CO₂-Ausstoß.
    """
    __tablename__ = "emission_factors"

    source_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("emission_factor_sources.id")
    )
    energy_type: Mapped[str] = mapped_column(String(50), index=True)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    month: Mapped[int | None] = mapped_column(Integer, nullable=True)
    region: Mapped[str] = mapped_column(String(10), default="DE")
    co2_g_per_kwh: Mapped[Decimal] = mapped_column(Numeric(10, 4))
    co2eq_g_per_kwh: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    includes_upstream: Mapped[bool] = mapped_column(Boolean, default=False)
    scope: Mapped[str] = mapped_column(String(20), default="scope_2")
    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    source = relationship("EmissionFactorSource", back_populates="factors")


class CO2Calculation(Base, UUIDMixin):
    """
    Berechnete CO₂-Emissionen für einen Zähler und Zeitraum.

    Ergebnis der Formel: Verbrauch (kWh) × Emissionsfaktor (g/kWh) / 1000 = kg CO₂
    """
    __tablename__ = "co2_calculations"

    meter_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("meters.id"), index=True
    )
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    consumption_kwh: Mapped[Decimal] = mapped_column(Numeric(16, 4))
    emission_factor_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("emission_factors.id")
    )
    co2_kg: Mapped[Decimal] = mapped_column(Numeric(12, 4))
    co2eq_kg: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    calculation_method: Mapped[str] = mapped_column(String(50))
    calculated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
