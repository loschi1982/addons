"""
base.py – Basisklassen für alle Datenbankmodelle.

Enthält Mixins (wiederverwendbare Bausteine), die von allen Modellen
geerbt werden. Das spart Wiederholung: Statt in jedem Modell id,
created_at und updated_at zu definieren, erbt man einfach von den Mixins.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class UUIDMixin:
    """
    Fügt eine UUID als Primärschlüssel hinzu.

    Warum UUID statt Auto-Increment (1, 2, 3...)?
    - UUIDs sind global eindeutig – auch über Datenbanken hinweg
    - Sie verraten nicht, wie viele Einträge es gibt
    - Sie können im Frontend erzeugt werden, bevor der Eintrag gespeichert wird
    """
    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )


class TimestampMixin:
    """
    Fügt created_at und updated_at Zeitstempel hinzu.

    created_at: Wird automatisch beim Erstellen gesetzt
    updated_at: Wird automatisch bei jeder Änderung aktualisiert

    Beide verwenden UTC – die Umrechnung in lokale Zeit macht das Frontend.
    """
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )
