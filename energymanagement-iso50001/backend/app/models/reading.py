"""
reading.py – Zählerstände, Import-Batches und Zählerwechsel.

Zählerstände sind die Rohdaten des Systems. Aus ihnen wird der
Verbrauch berechnet (Differenz zum vorherigen Stand), daraus die
CO₂-Emissionen, und daraus die Audit-Berichte.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class MeterReading(Base, UUIDMixin):
    """
    Ein einzelner Zählerstand zu einem bestimmten Zeitpunkt.

    Der Verbrauch (consumption) wird automatisch berechnet als
    Differenz zum vorherigen Zählerstand desselben Zählers.
    """
    __tablename__ = "meter_readings"

    meter_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("meters.id"), index=True
    )
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    value: Mapped[Decimal] = mapped_column(Numeric(16, 4))
    consumption: Mapped[Decimal | None] = mapped_column(Numeric(16, 4), nullable=True)
    source: Mapped[str] = mapped_column(String(50))
    quality: Mapped[str] = mapped_column(String(50), default="measured")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    import_batch_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    meter = relationship("Meter", back_populates="readings")


class ImportBatch(Base, UUIDMixin):
    """
    Ein Datei-Import-Vorgang mit allen Metadaten.

    Jeder Import bekommt eine eigene Batch-ID, damit alle importierten
    Zählerstände zu diesem Import gehören und bei Bedarf als Ganzes
    rückgängig gemacht werden können.
    """
    __tablename__ = "import_batches"

    filename: Mapped[str] = mapped_column(String(500))
    file_type: Mapped[str] = mapped_column(String(20))
    file_size_bytes: Mapped[int] = mapped_column(Integer)
    mapping_profile: Mapped[str | None] = mapped_column(String(255), nullable=True)
    column_mapping: Mapped[dict] = mapped_column(JSON)
    import_settings: Mapped[dict] = mapped_column(JSON)
    meter_mapping: Mapped[dict] = mapped_column(JSON)
    total_rows: Mapped[int] = mapped_column(Integer)
    imported_count: Mapped[int] = mapped_column(Integer, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, default=0)
    error_count: Mapped[int] = mapped_column(Integer, default=0)
    warning_count: Mapped[int] = mapped_column(Integer, default=0)
    meter_changes_detected: Mapped[int] = mapped_column(Integer, default=0)
    period_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    affected_meter_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="pending")
    error_details: Mapped[list | None] = mapped_column(JSON, nullable=True)
    imported_by: Mapped[uuid.UUID] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ImportMappingProfile(Base, UUIDMixin):
    """
    Gespeichertes Spalten-Mapping für wiederkehrende Imports.

    Wenn z.B. die Hausverwaltung jeden Monat eine Excel-Datei im
    gleichen Format schickt, kann das Mapping einmal konfiguriert
    und als Profil gespeichert werden.
    """
    __tablename__ = "import_mapping_profiles"

    name: Mapped[str] = mapped_column(String(255), unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_type: Mapped[str] = mapped_column(String(20))
    column_mapping: Mapped[dict] = mapped_column(JSON)
    import_settings: Mapped[dict] = mapped_column(JSON)
    meter_mapping: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column()
    last_used: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    use_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class MeterChange(Base, UUIDMixin):
    """
    Dokumentation eines Zählerwechsels.

    Wenn ein physischer Zähler ausgetauscht wird (z.B. wegen Defekt
    oder abgelaufener Eichfrist), wird hier der Wechsel festgehalten:
    Letzter Stand des alten Zählers und erster Stand des neuen.
    """
    __tablename__ = "meter_changes"

    meter_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("meters.id"))
    change_date: Mapped[date] = mapped_column(Date)
    old_meter_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    new_meter_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    final_reading_old: Mapped[Decimal | None] = mapped_column(Numeric(16, 4), nullable=True)
    initial_reading_new: Mapped[Decimal | None] = mapped_column(Numeric(16, 4), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    detected_by: Mapped[str] = mapped_column(String(50))
    import_batch_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
