# Datenbankmodelle für Objekte (Exponate) und Objekttypen.

import json
from sqlalchemy import Integer, String, Float, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database import Base


class ObjectType(Base):
    """Repräsentiert einen Objekttyp, z.B. 'Exponat' oder 'Technische Anlage'.
    Jeder Typ kann für bestimmte Rollen sichtbar gemacht werden."""
    __tablename__ = "object_types"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Name des Typs, z.B. "Exponat"
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)

    # JSON-Array der Rollen die diesen Typ sehen dürfen, z.B. '["visitor","staff"]'
    visible_to_roles_json: Mapped[str] = mapped_column(Text, default='["visitor","staff","technician","admin"]')

    # Objekte dieses Typs
    objects: Mapped[list["Object"]] = relationship("Object", back_populates="object_type", lazy="selectin")

    @property
    def visible_to_roles(self) -> list[str]:
        """Gibt die erlaubten Rollen als Python-Liste zurück."""
        try:
            return json.loads(self.visible_to_roles_json or "[]")
        except Exception:
            return []

    @visible_to_roles.setter
    def visible_to_roles(self, value: list[str]):
        """Speichert die erlaubten Rollen als JSON-String."""
        self.visible_to_roles_json = json.dumps(value or [])


class Object(Base):
    """Repräsentiert ein einzelnes Objekt / Exponat in einem Raum."""
    __tablename__ = "objects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Name des Objekts, z.B. "Steinway-Konzertflügel"
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Eindeutige Marker-ID für den QR-Code, z.B. "object:42"
    marker_id: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)

    # Kurzbeschreibung für das AR-Overlay
    short_desc: Mapped[str] = mapped_column(Text, default="")

    # HTML-Detailtext (vom WYSIWYG-Editor)
    detail_text: Mapped[str] = mapped_column(Text, default="")

    # Fremdschlüssel: welchem Typ und welchem Raum gehört das Objekt
    type_id: Mapped[int] = mapped_column(Integer, ForeignKey("object_types.id"), nullable=False)
    room_id: Mapped[int] = mapped_column(Integer, ForeignKey("rooms.id"), nullable=False)

    # Dateipfade – können leer sein
    video_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    audio_path: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Transparenz des Video-Overlays
    video_opacity: Mapped[float] = mapped_column(Float, default=0.8)

    # ONNX-Klassen-ID: welche Klasse im Raummodell entspricht diesem Objekt
    onnx_class_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # HA-Sensor-IDs als JSON-String
    ha_sensor_ids_json: Mapped[str] = mapped_column(Text, default="[]")

    # Beziehungen
    object_type: Mapped["ObjectType"] = relationship("ObjectType", back_populates="objects")
    room: Mapped["Room"] = relationship("Room", back_populates="objects")  # noqa: F821
    plant_data = relationship("PlantData", back_populates="object", uselist=False, lazy="selectin")

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