# Pydantic-Schemas für Objekte (Exponate) und Objekttypen.

from typing import Optional
from pydantic import BaseModel


class ObjectSummary(BaseModel):
    """Kurzform eines Objekts – für Listen und die Raumdetailansicht."""
    id: int
    name: str
    marker_id: str
    short_desc: str
    type_id: int
    type_name: str
    room_id: int

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_object(cls, obj) -> "ObjectSummary":
        """Erstellt eine ObjectSummary aus einem ORM-Objekt,
        wobei type_name aus der Beziehung object_type geholt wird."""
        return cls(
            id=obj.id,
            name=obj.name,
            marker_id=obj.marker_id,
            short_desc=obj.short_desc,
            type_id=obj.type_id,
            type_name=obj.object_type.name if obj.object_type else "",
            room_id=obj.room_id,
        )


class ObjectDetail(BaseModel):
    """Vollständige Objektinformationen."""
    id: int
    name: str
    marker_id: str
    short_desc: str
    detail_text: str
    type_id: int
    type_name: str
    room_id: int
    video_path: Optional[str] = None
    video_opacity: float
    audio_path: Optional[str] = None
    ha_sensor_ids: list[str]
    onnx_class_id: Optional[int] = None

    model_config = {"from_attributes": True}


class ObjectCreate(BaseModel):
    """Daten zum Anlegen oder Bearbeiten eines Objekts."""
    name: str
    marker_id: str
    short_desc: str = ""
    detail_text: str = ""
    type_id: int
    room_id: int
    video_path: Optional[str] = None
    video_opacity: float = 0.8
    audio_path: Optional[str] = None
    ha_sensor_ids: list[str] = []
    onnx_class_id: Optional[int] = None


class ObjectType(BaseModel):
    """Ein Objekttyp mit Sichtbarkeitsregeln."""
    id: int
    name: str
    visible_to_roles: list[str]

    model_config = {"from_attributes": True}


class ObjectTypeCreate(BaseModel):
    """Daten zum Anlegen oder Bearbeiten eines Objekttyps."""
    name: str
    visible_to_roles: list[str] = ["visitor", "staff", "technician", "admin"]