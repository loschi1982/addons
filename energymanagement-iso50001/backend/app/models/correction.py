"""
correction.py – Witterungskorrektur-Konfiguration und -Ergebnisse.

Die Witterungskorrektur gleicht den Einfluss des Wetters auf den
Heizenergieverbrauch aus, damit verschiedene Jahre fair verglichen
werden können. Ein milder Winter braucht weniger Heizenergie als
ein kalter – ohne Korrektur sieht das fälschlich nach Einsparung aus.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import UUIDMixin


class WeatherCorrectionConfig(Base, UUIDMixin):
    """
    Konfiguration der Witterungskorrektur für einen Heizungszähler.

    Legt fest, welche Wetterstation, welche Methode und welche
    Parameter für die Korrektur verwendet werden.
    """
    __tablename__ = "weather_correction_configs"

    meter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meters.id"), unique=True
    )
    station_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("weather_stations.id")
    )
    method: Mapped[str] = mapped_column(String(50))
    indoor_temp: Mapped[Decimal] = mapped_column(Numeric(4, 1), default=Decimal("20.0"))
    heating_limit: Mapped[Decimal] = mapped_column(Numeric(4, 1), default=Decimal("15.0"))
    cooling_limit: Mapped[Decimal] = mapped_column(Numeric(4, 1), default=Decimal("24.0"))
    reference_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reference_hdd: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    base_load_percent: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class WeatherCorrectedConsumption(Base, UUIDMixin):
    """
    Ergebnis einer Witterungskorrektur für einen Zeitraum.

    Enthält sowohl den gemessenen Rohverbrauch als auch den korrigierten
    Verbrauch, den Korrekturfaktor und die verwendeten Gradtagszahlen.
    """
    __tablename__ = "weather_corrected_consumption"

    meter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meters.id"), index=True
    )
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    raw_consumption: Mapped[Decimal] = mapped_column(Numeric(16, 4))
    corrected_consumption: Mapped[Decimal] = mapped_column(Numeric(16, 4))
    correction_factor: Mapped[Decimal] = mapped_column(Numeric(8, 6))
    actual_hdd: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    reference_hdd: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    method: Mapped[str] = mapped_column(String(50))
    calculated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
