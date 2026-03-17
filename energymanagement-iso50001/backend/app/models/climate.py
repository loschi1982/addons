"""
climate.py – Klimasensoren (Temperatur & Luftfeuchtigkeit).

Innenraum-Klimadaten ergänzen die externen Wetterdaten und ermöglichen
eine präzisere Witterungskorrektur sowie Behaglichkeitsanalysen.
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class ClimateSensor(Base, UUIDMixin, TimestampMixin):
    """Ein Klimasensor für Temperatur und/oder Luftfeuchtigkeit."""
    __tablename__ = "climate_sensors"

    name: Mapped[str] = mapped_column(String(255))
    sensor_type: Mapped[str] = mapped_column(String(50))
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    zone: Mapped[str | None] = mapped_column(String(100), nullable=True)
    usage_unit_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("usage_units.id"), nullable=True
    )
    ha_entity_id_temp: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ha_entity_id_humidity: Mapped[str | None] = mapped_column(String(255), nullable=True)
    data_source: Mapped[str] = mapped_column(String(50))
    source_config: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    target_temp_min: Mapped[Decimal | None] = mapped_column(Numeric(4, 1), nullable=True)
    target_temp_max: Mapped[Decimal | None] = mapped_column(Numeric(4, 1), nullable=True)
    target_humidity_min: Mapped[Decimal | None] = mapped_column(Numeric(5, 1), nullable=True)
    target_humidity_max: Mapped[Decimal | None] = mapped_column(Numeric(5, 1), nullable=True)
    associated_meter_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    usage_unit = relationship("UsageUnit", back_populates="climate_sensors")
    readings = relationship("ClimateReading", back_populates="sensor", cascade="all, delete-orphan")


class ClimateReading(Base, UUIDMixin):
    """Ein einzelner Klimamesswert (Temperatur, Feuchte, Taupunkt)."""
    __tablename__ = "climate_readings"

    sensor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("climate_sensors.id"), index=True
    )
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    temperature: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    humidity: Mapped[Decimal | None] = mapped_column(Numeric(5, 1), nullable=True)
    dew_point: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    source: Mapped[str] = mapped_column(String(50))
    quality: Mapped[str] = mapped_column(String(50), default="measured")

    sensor = relationship("ClimateSensor", back_populates="readings")


class ClimateZoneSummary(Base, UUIDMixin):
    """Aggregierte Klimadaten pro Zone und Zeitraum."""
    __tablename__ = "climate_zone_summaries"

    zone: Mapped[str] = mapped_column(String(100))
    period_start: Mapped[datetime] = mapped_column(Date)
    period_end: Mapped[datetime] = mapped_column(Date)
    avg_temperature: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    min_temperature: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    max_temperature: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    avg_humidity: Mapped[Decimal] = mapped_column(Numeric(5, 1))
    min_humidity: Mapped[Decimal] = mapped_column(Numeric(5, 1))
    max_humidity: Mapped[Decimal] = mapped_column(Numeric(5, 1))
    hours_below_target_temp: Mapped[Decimal] = mapped_column(Numeric(8, 1))
    hours_above_target_temp: Mapped[Decimal] = mapped_column(Numeric(8, 1))
    hours_outside_target_humidity: Mapped[Decimal] = mapped_column(Numeric(8, 1))
    comfort_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 1), nullable=True)
