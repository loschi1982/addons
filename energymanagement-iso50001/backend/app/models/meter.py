"""
meter.py – Zähler-Modell.

Ein Zähler ist das zentrale Objekt des Systems. Er repräsentiert einen
physischen oder virtuellen Energiezähler (Stromzähler, Gaszähler, etc.)
und speichert die Konfiguration für Datenquelle, Tarif, Witterungskorrektur
und CO₂-Faktor.
"""

import uuid
from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class Meter(Base, UUIDMixin, TimestampMixin):
    """
    Ein Energiezähler im System.

    Beispiel: "Hauptstromzähler EG" – misst den Gesamtstromverbrauch
    des Erdgeschosses, Daten kommen per Shelly Smart Plug,
    Abrechnungspreis: 0,32 €/kWh.
    """
    __tablename__ = "meters"

    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    meter_number: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Was wird gemessen? (Strom, Gas, Wasser, etc.)
    energy_type: Mapped[str] = mapped_column(String(50))

    # In welcher Einheit? (kWh, m³, MWh, etc.)
    unit: Mapped[str] = mapped_column(String(20))

    # Woher kommen die Daten? (Shelly, Modbus, manuell, etc.)
    data_source: Mapped[str] = mapped_column(String(50))

    # Verbindungsparameter je nach Datenquelle (als JSON gespeichert)
    # Beispiel Shelly: {"ip": "192.168.1.42", "channel": 0}
    # Beispiel Modbus: {"host": "10.0.0.1", "port": 502, "register": 100}
    source_config: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Hierarchie: Welchem Hauptzähler ist dieser Zähler untergeordnet?
    parent_meter_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meters.id"), nullable=True
    )

    # Zuordnung zur Nutzungseinheit (Standort → Gebäude → Einheit)
    usage_unit_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("usage_units.id"), nullable=True
    )

    # Standort (Freitext, für schnelle Filterung)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cost_center: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Tarif-Informationen (Preis, Grundgebühr, etc.)
    tariff_info: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Soll für diesen Zähler eine Witterungskorrektur durchgeführt werden?
    # Nur sinnvoll bei Heizung/Kühlung, nicht bei Strom/Wasser.
    is_weather_corrected: Mapped[bool] = mapped_column(Boolean, default=False)

    # Manueller CO₂-Faktor (überschreibt den automatischen Wert)
    # z.B. für Ökostrom-Tarife mit 0 g CO₂/kWh
    co2_factor_override: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Beziehungen
    readings = relationship("MeterReading", back_populates="meter", cascade="all, delete-orphan")
    parent_meter = relationship("Meter", remote_side="Meter.id", backref="sub_meters")
    usage_unit = relationship("UsageUnit", back_populates="meters")
    schema_position = relationship("SchemaPosition", uselist=False, back_populates="meter")
    consumers = relationship("Consumer", secondary="meter_consumer", back_populates="meters")
