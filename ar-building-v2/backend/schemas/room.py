# Pydantic-Schemas für Räume.
# Schemas definieren was die API empfängt (Request) und zurückgibt (Response).
# Sie sind unabhängig von den SQLAlchemy-Modellen.

from typing import Optional
from pydantic import BaseModel

from backend.schemas.object import ObjectSummary


class RoomSummary(BaseModel):
    """Kurzform eines Raums – wird in Listendarstellungen verwendet."""
    id: int
    name: str
    marker_id: str
    short_desc: str

    model_config = {"from_attributes": True}


class RoomDetail(BaseModel):
    """Vollständige Rauminformationen inklusive zugehöriger Objekte."""
    id: int
    name: str
    marker_id: str
    short_desc: str
    detail_text: str
    model_path: Optional[str] = None
    audio_path: Optional[str] = None
    video_path: Optional[str] = None
    video_opacity: float
    ha_sensor_ids: list[str]
    objects: list[ObjectSummary] = []

    model_config = {"from_attributes": True}


class RoomCreate(BaseModel):
    """Daten zum Anlegen oder Bearbeiten eines Raums."""
    name: str
    marker_id: str
    short_desc: str = ""
    detail_text: str = ""
    video_opacity: float = 0.8
    ha_sensor_ids: list[str] = []