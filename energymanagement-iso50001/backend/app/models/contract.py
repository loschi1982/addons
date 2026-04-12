"""
contract.py – Energielieferverträge.

Speichert Vertragsdaten je Energieträger (Lieferant, Laufzeit,
vereinbartes Jahresvolumen, Preisstruktur). Basis für den
Soll-/Ist-Vergleich Vertrag vs. tatsächlicher Verbrauch.
"""

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, ForeignKey, JSON, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class EnergyContract(Base, UUIDMixin, TimestampMixin):
    """
    Energieliefervertrag mit einem Energieversorger.

    Enthält Vertragslaufzeit, vereinbartes Jahresvolumen und
    Preisstruktur (Arbeitspreis + Grundpreis). Verknüpfung zu
    Zählern ermöglicht den Soll-/Ist-Vergleich.
    """
    __tablename__ = "energy_contracts"

    # Basisdaten
    name: Mapped[str] = mapped_column(String(255))
    contract_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    supplier: Mapped[str] = mapped_column(String(255))
    energy_type: Mapped[str] = mapped_column(String(50))
    # electricity, natural_gas, water, district_heating, district_cooling, oil, pellets

    # Laufzeit
    valid_from: Mapped[date] = mapped_column(Date)
    valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    notice_period_days: Mapped[int | None] = mapped_column(Numeric(6, 0), nullable=True)
    auto_renewal: Mapped[bool] = mapped_column(Boolean, default=False)

    # Vereinbartes Jahresvolumen
    contracted_annual_kwh: Mapped[Decimal | None] = mapped_column(
        Numeric(16, 2), nullable=True,
        comment="Vereinbartes Jahresvolumen in kWh (Arbeitsmenge)"
    )
    contracted_annual_m3: Mapped[Decimal | None] = mapped_column(
        Numeric(16, 4), nullable=True,
        comment="Vereinbartes Jahresvolumen in m³ (Wasser/Gas)"
    )

    # Preisstruktur
    price_per_kwh: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 6), nullable=True,
        comment="Arbeitspreis in €/kWh"
    )
    price_per_m3: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 6), nullable=True,
        comment="Arbeitspreis in €/m³"
    )
    base_fee_monthly: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 2), nullable=True,
        comment="Monatlicher Grundpreis in €"
    )
    peak_demand_fee: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 4), nullable=True,
        comment="Leistungspreis in €/kW (Strom)"
    )
    vat_rate: Mapped[Decimal | None] = mapped_column(
        Numeric(5, 2), nullable=True,
        comment="Mehrwertsteuer in %"
    )

    # Leistungsparameter (Strom)
    max_demand_kw: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 2), nullable=True,
        comment="Vereinbarte Leistungsgrenze in kW"
    )
    voltage_level: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # niederspannung, mittelspannung, hochspannung

    # Zusätzliche Vertragsbedingungen
    renewable_share_percent: Mapped[Decimal | None] = mapped_column(
        Numeric(5, 2), nullable=True,
        comment="Anteil erneuerbarer Energien in %"
    )
    co2_g_per_kwh: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 4), nullable=True,
        comment="Vertraglicher CO₂-Faktor (kann von Standardfaktor abweichen)"
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    document_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    additional_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Zugeordnete Zähler (Liste von UUIDs)
    meter_ids: Mapped[list] = mapped_column(
        JSON, default=list,
        comment="Zähler, die über diesen Vertrag beliefert werden"
    )

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
