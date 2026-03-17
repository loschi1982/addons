"""
consumer.py – Verbraucher und Zähler-Verbraucher-Zuordnung.

Ein Verbraucher ist ein Gerät oder eine Anlage, die Energie nutzt –
z.B. eine Klimaanlage, eine Produktionsmaschine oder die Beleuchtung.
Verbraucher werden Zählern zugeordnet, um den Energiefluss abzubilden.
"""

import uuid
from decimal import Decimal

from sqlalchemy import Boolean, Column, ForeignKey, Integer, Numeric, String, Table, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


# ── Verknüpfungstabelle: Zähler ↔ Verbraucher (n:m) ──
# Ein Zähler kann mehrere Verbraucher messen, ein Verbraucher
# kann von mehreren Zählern erfasst werden.
meter_consumer = Table(
    "meter_consumer",
    Base.metadata,
    Column("meter_id", UUID(as_uuid=True), ForeignKey("meters.id"), primary_key=True),
    Column("consumer_id", UUID(as_uuid=True), ForeignKey("consumers.id"), primary_key=True),
)


class Consumer(Base, UUIDMixin, TimestampMixin):
    """
    Ein Energieverbraucher wie z.B. "Klimaanlage Serverraum".

    Verbraucher haben eine geschätzte Nennleistung und Betriebsstunden,
    woraus sich eine grobe Verbrauchsschätzung ableiten lässt.
    Die priority bestimmt die Relevanz im Energieaudit (ISO 50001):
    Verbraucher mit hoher Priorität werden als "Significant Energy Use" (SEU)
    identifiziert.
    """
    __tablename__ = "consumers"

    name: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(100))
    rated_power: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    operating_hours: Mapped[Decimal | None] = mapped_column(Numeric(8, 1), nullable=True)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    usage_unit_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("usage_units.id"), nullable=True
    )
    priority: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    meters = relationship("Meter", secondary=meter_consumer, back_populates="consumers")
    usage_unit = relationship("UsageUnit", back_populates="consumers")
