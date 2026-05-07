"""
district_heating_provider.py – Fernwärmeversorger mit zertifizierten Kennzahlen.

Deutsche Fernwärmeversorger müssen nach AGFW FW 309 ihren CO₂-Emissionsfaktor
und Primärenergiefaktor veröffentlichen. Diese Tabelle enthält die zertifizierten
Werte der größten deutschen Versorger.
"""

import uuid
from decimal import Decimal

from sqlalchemy import Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class DistrictHeatingProvider(Base, UUIDMixin, TimestampMixin):
    """
    Fernwärmeversorger mit FW-309-zertifizierten Kennzahlen.

    Die Werte stammen aus den offiziellen AGFW-Zertifikaten (FW 309-1)
    und werden auf district-energy-systems.info veröffentlicht.
    """
    __tablename__ = "district_heating_providers"

    name: Mapped[str] = mapped_column(String(255))
    city: Mapped[str] = mapped_column(String(255))
    state: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # CO₂-Emissionsfaktor in g CO₂/kWh (FW 309)
    co2_g_per_kwh: Mapped[Decimal] = mapped_column(Numeric(10, 2))

    # Primärenergiefaktor fp (FW 309)
    primary_energy_factor: Mapped[Decimal | None] = mapped_column(Numeric(5, 3), nullable=True)

    # Zertifizierungsjahr
    certification_year: Mapped[int] = mapped_column(Integer)

    # Anteil erneuerbarer Energien in %
    renewable_share_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 1), nullable=True)

    # Quellenverweis
    source_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
