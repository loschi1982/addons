"""
weather.py – Wetterdaten, Wetterstationen und Gradtagszahlen.

Wetterdaten sind die Grundlage für die Witterungskorrektur:
Aus den Tagesmitteltemperaturen werden Heiz- und Kühlgradtage
berechnet, die den witterungsabhängigen Energieverbrauch quantifizieren.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class WeatherStation(Base, UUIDMixin, TimestampMixin):
    """
    Eine Wetterstation (z.B. DWD-Station "Hamburg-Fuhlsbüttel").

    Jeder Standort wird der nächstgelegenen Wetterstation zugeordnet.
    Die Station liefert die Temperaturdaten für die Gradtagszahlen-Berechnung.
    """
    __tablename__ = "weather_stations"

    name: Mapped[str] = mapped_column(String(255))
    dwd_station_id: Mapped[str | None] = mapped_column(String(20), nullable=True)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    altitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    data_source: Mapped[str] = mapped_column(String(50))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    records = relationship("WeatherRecord", back_populates="station", cascade="all, delete-orphan")
    monthly_degree_days = relationship("MonthlyDegreeDays", back_populates="station")


class WeatherRecord(Base, UUIDMixin):
    """
    Tägliche Wetterdaten einer Station.

    Enthält Temperatur, Niederschlag, Sonnenscheindauer und die
    daraus berechneten Heiz-/Kühlgradtage.
    """
    __tablename__ = "weather_records"

    station_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("weather_stations.id"), index=True
    )
    date: Mapped[date] = mapped_column(Date, index=True)
    temp_avg: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    temp_min: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    temp_max: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    heating_degree_days: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    cooling_degree_days: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    sunshine_hours: Mapped[Decimal | None] = mapped_column(Numeric(4, 1), nullable=True)
    precipitation_mm: Mapped[Decimal | None] = mapped_column(Numeric(6, 1), nullable=True)
    wind_speed_avg: Mapped[Decimal | None] = mapped_column(Numeric(5, 1), nullable=True)
    source: Mapped[str] = mapped_column(String(50))

    station = relationship("WeatherStation", back_populates="records")


class MonthlyDegreeDays(Base, UUIDMixin):
    """
    Vorberechnete monatliche Gradtagszahlen für schnellen Zugriff.

    Gradtagszahlen (Gt20/15) quantifizieren den Heizbedarf eines Monats.
    Das langjährige Mittel dient als Referenz für die Witterungskorrektur.
    """
    __tablename__ = "monthly_degree_days"

    station_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("weather_stations.id"), index=True
    )
    year: Mapped[int] = mapped_column(Integer)
    month: Mapped[int] = mapped_column(Integer)
    heating_degree_days: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    cooling_degree_days: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    avg_temperature: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    heating_days: Mapped[int] = mapped_column(Integer)
    long_term_avg_hdd: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)

    station = relationship("WeatherStation", back_populates="monthly_degree_days")
