"""
schema.py – Energieschemas (visuelle Darstellung der Zählerstruktur).

Ein Schema ist eine grafische Darstellung der Energieverteilung in einem
Gebäude. Zähler und Verbraucher werden als Knoten auf einem Canvas
positioniert und mit Verbindungslinien verbunden.
"""

import uuid
from decimal import Decimal

from sqlalchemy import Boolean, Float, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class EnergySchema(Base, UUIDMixin, TimestampMixin):
    """
    Ein Energieverteilungsschema (z.B. "Gebäude A – Stromverteilung").

    Mehrere Schemas können gespeichert werden – z.B. eines pro Gebäude
    oder eines pro Energietyp. Eines kann als Standard markiert werden.
    """
    __tablename__ = "energy_schemas"

    name: Mapped[str] = mapped_column(String(255))
    schema_type: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)

    positions = relationship("SchemaPosition", back_populates="schema", cascade="all, delete-orphan")


class SchemaPosition(Base, UUIDMixin):
    """
    Position eines Zählers auf dem Schema-Canvas.

    Speichert X/Y-Koordinaten, Größe und visuelle Konfiguration
    (Farbe, Icon, Label-Position) sowie die Verbindungen zu
    anderen Positionen.
    """
    __tablename__ = "schema_positions"

    schema_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("energy_schemas.id"))
    meter_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("meters.id"))
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    width: Mapped[float] = mapped_column(Float, default=200)
    height: Mapped[float] = mapped_column(Float, default=100)
    style_config: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    connections: Mapped[list | None] = mapped_column(JSON, nullable=True)

    schema = relationship("EnergySchema", back_populates="positions")
    meter = relationship("Meter", back_populates="schema_position")
