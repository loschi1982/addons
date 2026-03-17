"""
site.py – Standorte, Gebäude und Nutzungseinheiten.

Die dreistufige Hierarchie: Standort → Gebäude → Nutzungseinheit
bildet die physische Struktur ab. Der Standort bestimmt die Wetterdaten
und CO₂-Region, das Gebäude die Flächen, die Nutzungseinheit den
konkreten Bereich (z.B. eine Wohnung oder ein Büro).
"""

import uuid
from decimal import Decimal

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class Site(Base, UUIDMixin, TimestampMixin):
    """
    Standort / Liegenschaft / Campus.

    Oberste Ebene der Gebäudehierarchie. Der Standort bestimmt über
    seine Geo-Koordinaten automatisch die nächste Wetterstation und
    die CO₂-Faktor-Region.
    """
    __tablename__ = "sites"

    name: Mapped[str] = mapped_column(String(255))
    code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Adresse
    street: Mapped[str | None] = mapped_column(String(255), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    city: Mapped[str | None] = mapped_column(String(255), nullable=True)
    state: Mapped[str | None] = mapped_column(String(255), nullable=True)
    country: Mapped[str] = mapped_column(String(5), default="DE")

    # Geo-Koordinaten (bestimmen Wetter und CO₂-Region)
    latitude: Mapped[float | None] = mapped_column(nullable=True)
    longitude: Mapped[float | None] = mapped_column(nullable=True)

    # Automatische Zuordnungen
    weather_station_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("weather_stations.id"), nullable=True
    )
    co2_region: Mapped[str] = mapped_column(String(10), default="DE")
    electricity_maps_zone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    timezone: Mapped[str] = mapped_column(String(50), default="Europe/Berlin")

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    buildings = relationship("Building", back_populates="site", cascade="all, delete-orphan")
    weather_station = relationship("WeatherStation")


class Building(Base, UUIDMixin, TimestampMixin):
    """
    Gebäude innerhalb eines Standorts.

    Enthält die physischen Gebäudedaten wie Fläche, Baujahr und
    Energieausweis-Klasse.
    """
    __tablename__ = "buildings"

    site_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sites.id"))
    name: Mapped[str] = mapped_column(String(255))
    code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    building_type: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Flächen in m²
    gross_floor_area_m2: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    net_floor_area_m2: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    heated_area_m2: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    cooled_area_m2: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)

    # Gebäudedaten
    building_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    floors_above_ground: Mapped[int | None] = mapped_column(Integer, nullable=True)
    floors_below_ground: Mapped[int | None] = mapped_column(Integer, nullable=True)
    energy_certificate_class: Mapped[str | None] = mapped_column(String(5), nullable=True)
    energy_certificate_value: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)

    # Optionale abweichende Adresse
    street: Mapped[str | None] = mapped_column(String(255), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    city: Mapped[str | None] = mapped_column(String(255), nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    site = relationship("Site", back_populates="buildings")
    usage_units = relationship("UsageUnit", back_populates="building", cascade="all, delete-orphan")


class UsageUnit(Base, UUIDMixin, TimestampMixin):
    """
    Nutzungseinheit innerhalb eines Gebäudes.

    Ein abgrenzbarer Bereich mit eigenem Nutzungszweck – z.B. eine
    Mietwohnung, eine Büroetage oder ein Serverraum. Die Fläche der
    Nutzungseinheit fließt in die EnPI-Berechnung ein (kWh/m²).
    """
    __tablename__ = "usage_units"

    building_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("buildings.id"))
    name: Mapped[str] = mapped_column(String(255))
    code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    usage_type: Mapped[str] = mapped_column(String(50))
    floor: Mapped[str | None] = mapped_column(String(20), nullable=True)
    area_m2: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    heated_area_m2: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    occupants: Mapped[int | None] = mapped_column(Integer, nullable=True)
    operating_hours_per_week: Mapped[Decimal | None] = mapped_column(Numeric(5, 1), nullable=True)

    # Mietinformationen (optional)
    tenant_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tenant_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    lease_start: Mapped[Date | None] = mapped_column(Date, nullable=True)
    lease_end: Mapped[Date | None] = mapped_column(Date, nullable=True)

    # Zielwerte für Benchmarking
    target_enpi_kwh_per_m2: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    target_co2_kg_per_m2: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    building = relationship("Building", back_populates="usage_units")
    meters = relationship("Meter", back_populates="usage_unit")
    consumers = relationship("Consumer", back_populates="usage_unit")
    climate_sensors = relationship("ClimateSensor", back_populates="usage_unit")
