"""
benchmark.py – Externe Benchmarkreferenzwerte.

Editierbare Referenzwerte nach VDI 3807, GEFMA 124, BAFA und DIN V 18599.
Ermöglicht den Vergleich eigener EnPI-Werte mit Branchenstandards.
"""

from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class BenchmarkReference(Base, UUIDMixin, TimestampMixin):
    """
    Externer Benchmarkwert für einen Gebäudetyp und Energieträger.

    Enthält drei Bewertungsstufen (gut / mittel / schlecht) analog
    zum Energieausweis-System. Quellen: VDI 3807, GEFMA 124, BAFA.
    """
    __tablename__ = "benchmark_references"

    building_type: Mapped[str] = mapped_column(String(100))
    # office, school, hospital, residential, retail, warehouse,
    # production, hotel, sports_hall, data_center, public_building

    energy_type: Mapped[str] = mapped_column(String(50))
    # electricity, natural_gas, district_heating, district_cooling, oil, total

    source: Mapped[str] = mapped_column(String(50), default="VDI_3807")
    # VDI_3807, GEFMA_124, BAFA, DIN_18599, custom

    unit: Mapped[str] = mapped_column(String(30), default="kwh_per_m2_a")
    # kwh_per_m2_a, kwh_per_person_a, kwh_per_bed_a, kwh_per_unit_a

    # Bewertungsschwellen (Einheit je nach unit)
    value_good: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    value_medium: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    value_poor: Mapped[Decimal] = mapped_column(Numeric(10, 2))

    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
