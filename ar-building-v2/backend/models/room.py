# Datenbankmodell für Räume.
# SQLAlchemy bildet diese Klasse auf die Tabelle "rooms" in der SQLite-DB ab.

import json
from sqlalchemy import Integer, String, Float, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database import Base


class Room(Base):
    """Repräsentiert einen Raum im Gebäude."""
    __tablename__ = "rooms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Name des Raums, z.B. "Großer Konzertsaal"
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Eindeutige Marker-ID für den QR-Code, z.B. "room:1"
    marker_id: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)

    # Kurzbeschreibung für die AR-Überlagerung
    short_desc: Mapped[str] = mapped_column(Text, default="")

    # Langer HTML-Text (vom WYSIWYG-Editor), für das Detailfenster
    detail_text: Mapped[str] = mapped_column(Text, default="")

    # Dateipfade – können leer sein (NULL)
    model_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    audio_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    video_path: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Transparenz des Video-Overlays: 0.0 (unsichtbar) bis 1.0 (voll sichtbar)
    video_opacity: Mapped[float] = mapped_column(Float, default=0.8)

    # Home-Assistant-Sensor-IDs als JSON-String, z.B. '["sensor.temp_foyer"]'
    ha_sensor_ids_json: Mapped[str] = mapped_column(Text, default="[]")

    # Beziehung zu Objekten – ein Raum kann viele Objekte haben
    objects: Mapped[list["Object"]] = relationship(  # noqa: F821
        "Object", back_populates="room", lazy="selectin"
    )

    @property
    def ha_sensor_ids(self) -> list[str]:
        """Gibt die HA-Sensor-IDs als Python-Liste zurück."""
        try:
            return json.loads(self.ha_sensor_ids_json or "[]")
        except Exception:
            return []

    @ha_sensor_ids.setter
    def ha_sensor_ids(self, value: list[str]):
        """Speichert die HA-Sensor-IDs als JSON-String."""
        self.ha_sensor_ids_json = json.dumps(value or [])