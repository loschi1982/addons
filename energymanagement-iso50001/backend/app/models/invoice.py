"""
invoice.py – Energieabrechnungen.

Speichert die tatsächlichen Abrechnungen eines Energieversorgers
für einen Zähler. Daraus lässt sich der effektive kWh-Preis berechnen,
wenn kein fixer Tarif hinterlegt ist (z.B. gleitende Preise).
"""

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class EnergyInvoice(Base, UUIDMixin, TimestampMixin):
    """
    Eine Energieabrechnung für einen Zähler.

    Aus total_cost_net, base_fee und total_consumption wird der
    effektive kWh-Preis berechnet:
    effective_price = (total_cost_net - base_fee) / total_consumption
    """
    __tablename__ = "energy_invoices"

    meter_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("meters.id", ondelete="CASCADE")
    )
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)

    # Kosten
    total_cost_gross: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    total_cost_net: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    vat_rate: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    base_fee: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)

    # Verbrauch lt. Rechnung
    total_consumption: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)

    # Rechnungsnummer / Notizen
    invoice_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Beziehung
    meter = relationship("Meter", backref="invoices")

    @property
    def effective_price_per_kwh(self) -> Decimal | None:
        """Effektiver kWh-Preis aus Abrechnungsdaten berechnen."""
        if not self.total_consumption or self.total_consumption <= 0:
            return None
        net = self.total_cost_net
        if net is None and self.total_cost_gross and self.vat_rate:
            net = self.total_cost_gross / (1 + self.vat_rate / 100)
        elif net is None:
            net = self.total_cost_gross
        fee = self.base_fee or Decimal("0")
        return (net - fee) / self.total_consumption
