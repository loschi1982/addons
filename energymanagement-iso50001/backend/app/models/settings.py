"""
settings.py – Anwendungseinstellungen (Key-Value-Speicher).

Speichert konfigurierbare Einstellungen wie Organisationsname,
Branding-Farben, Berichtsvorlagen-Defaults und EnPI-Konfiguration.
"""

from sqlalchemy import String, Text
from sqlalchemy import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class AppSetting(Base, UUIDMixin, TimestampMixin):
    """
    Schlüssel-Wert-Einstellungen der Anwendung.

    Jede Einstellung wird als eigene Zeile gespeichert, damit
    einzelne Werte unabhängig aktualisiert werden können.
    """
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    value: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(String(50), default="general")
