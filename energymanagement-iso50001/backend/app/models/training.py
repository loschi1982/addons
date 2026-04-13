"""
training.py – Schulungsdokumentation (ISO 50001 Kap. 7.2 / 7.3).

Erfasst Schulungen, Unterweisungen und Bewusstseinsmassnahmen nach
ISO 50001. Dient als Nachweis für Kompetenz und Bewusstsein der
Mitarbeitenden bezüglich Energiemanagement.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class TrainingRecord(Base, UUIDMixin, TimestampMixin):
    """
    Schulungsdatensatz für eine Energiemanagement-Schulung.

    Dokumentiert Schulungen, die nach ISO 50001 Kap. 7.2 (Kompetenz)
    und Kap. 7.3 (Bewusstsein) erforderlich sind.
    """
    __tablename__ = "training_records"

    title: Mapped[str] = mapped_column(String(500))
    training_type: Mapped[str] = mapped_column(String(50), default="internal")
    # internal, external, e_learning, on_the_job

    iso_clause: Mapped[str | None] = mapped_column(
        String(20), nullable=True,
        comment="ISO 50001-Klausel, z.B. '7.2', '7.3', '8.1'"
    )
    topic: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Termin
    training_date: Mapped[date] = mapped_column(Date)
    duration_hours: Mapped[Decimal | None] = mapped_column(Numeric(5, 1), nullable=True)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Trainer / Organisation
    trainer: Mapped[str] = mapped_column(String(255))
    external_provider: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Teilnehmer
    participants: Mapped[list] = mapped_column(
        JSON, default=list,
        comment="Liste von Namen oder User-IDs"
    )
    participant_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Nachweise
    materials_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    certificate_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    attendance_list_path: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Status
    status: Mapped[str] = mapped_column(String(50), default="completed")
    # planned, completed, cancelled

    # Wirksamkeitsprüfung (Kap. 7.2)
    effectiveness_check: Mapped[str | None] = mapped_column(Text, nullable=True)
    effectiveness_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    effectiveness_result: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # passed, failed, pending

    # Wiederholung
    next_training_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    recurrence_months: Mapped[int | None] = mapped_column(
        Integer, nullable=True,
        comment="Wiederholungsintervall in Monaten (0 = einmalig)"
    )

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
