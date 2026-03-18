"""
allocation.py – Zähler-Nutzungseinheit-Zuordnung.

Ein Zähler kann mehreren Nutzungseinheiten zugeordnet werden,
mit Vorzeichen (add/subtract) und optionalem Faktor für
anteilige Zuordnungen. Damit lassen sich Stichleitungen und
Querzuordnungen zwischen Nutzungseinheiten abbilden.
"""

import uuid
from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class MeterUnitAllocation(Base, UUIDMixin, TimestampMixin):
    """
    Zuordnung eines Zählers zu einer Nutzungseinheit.

    allocation_type bestimmt, ob der Zählerverbrauch addiert oder
    subtrahiert wird. factor ermöglicht anteilige Zuordnungen
    (z.B. 0.6 für 60% des Verbrauchs).

    Beispiel: Stichleitung Keller wird vom Hauptzähler EG
    subtrahiert und dem Büro OG zugeordnet.
    """
    __tablename__ = "meter_unit_allocations"
    __table_args__ = (
        UniqueConstraint("meter_id", "usage_unit_id", name="uq_meter_unit_allocation"),
    )

    meter_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("meters.id"), index=True
    )
    usage_unit_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("usage_units.id"), index=True
    )

    # "add" oder "subtract"
    allocation_type: Mapped[str] = mapped_column(String(20), default="add")

    # Faktor für anteilige Zuordnung (1.0 = 100%)
    factor: Mapped[Decimal] = mapped_column(Numeric(8, 4), default=Decimal("1.0"))

    # Beschreibung der Zuordnung (z.B. "Stichleitung Keller → Büro OG")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Beziehungen
    meter = relationship("Meter", back_populates="unit_allocations")
    usage_unit = relationship("UsageUnit", back_populates="meter_allocations")
