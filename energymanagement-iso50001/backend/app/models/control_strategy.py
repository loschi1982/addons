"""
control_strategy.py – BMS-Regelstrategien und Sollwert-Tracking.

Speichert Regelstrategien (Soll-Temperaturen, Betriebszeiten, Setpoints)
für Gebäudeautomation (BMS/HA) und ermöglicht den Vergleich mit
tatsächlichen Messwerten aus den Klimasensoren.
"""

import uuid
from datetime import date, time
from decimal import Decimal

from sqlalchemy import Boolean, Date, ForeignKey, JSON, Numeric, String, Text, Time
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class ControlStrategy(Base, UUIDMixin, TimestampMixin):
    """
    Regelstrategie für ein Gebäude / eine Zone.

    Enthält Sollwerte für Heizung/Kühlung und Betriebszeiten.
    Wird mit tatsächlichen Klimasensor-Messwerten verglichen.
    """
    __tablename__ = "control_strategies"

    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    strategy_type: Mapped[str] = mapped_column(String(50), default="heating")
    # heating, cooling, ventilation, lighting, mixed

    # Gebäudezuordnung (optional)
    building_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("buildings.id"), nullable=True
    )
    usage_unit_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("usage_units.id"), nullable=True
    )

    # Home Assistant / BMS-Entitäts-ID (für automatischen Abgleich)
    ha_entity_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True,
        comment="HA entity_id des Thermostats / Reglers"
    )

    # Sollwerte
    setpoint_heating: Mapped[Decimal | None] = mapped_column(
        Numeric(5, 1), nullable=True,
        comment="Heiz-Solltemperatur in °C"
    )
    setpoint_cooling: Mapped[Decimal | None] = mapped_column(
        Numeric(5, 1), nullable=True,
        comment="Kühl-Solltemperatur in °C"
    )
    setpoint_night_reduction: Mapped[Decimal | None] = mapped_column(
        Numeric(5, 1), nullable=True,
        comment="Nachtabsenkung in Kelvin"
    )
    max_co2_ppm: Mapped[Decimal | None] = mapped_column(
        Numeric(7, 1), nullable=True,
        comment="CO₂-Grenzwert für Lüftungssteuerung (ppm)"
    )

    # Betriebszeiten
    operating_days: Mapped[list] = mapped_column(
        JSON, default=list,
        comment="Betriebstage als Liste, z.B. [1,2,3,4,5] (Mo=1)"
    )
    operating_time_start: Mapped[time | None] = mapped_column(Time, nullable=True)
    operating_time_end: Mapped[time | None] = mapped_column(Time, nullable=True)

    # Gültigkeit
    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    building = relationship("Building", foreign_keys=[building_id])
    usage_unit = relationship("UsageUnit", foreign_keys=[usage_unit_id])
