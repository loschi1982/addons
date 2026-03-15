# Pydantic-Schemas für das CAFM-Modul (Technische Anlagen, Wartung, Dokumente).

from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, computed_field


# ---- VDMA-Vorlagen ---- #

class VDMAChecklistItem(BaseModel):
    id: str
    text: str
    group: str


class VDMATemplate(BaseModel):
    kg: str
    label: str
    gewerk: str
    checklist: list[VDMAChecklistItem]


# ---- Dokumente ---- #

class PlantDocumentRead(BaseModel):
    id: int
    plant_id: int
    category: str
    filename: str
    file_path: str
    uploaded_at: str
    description: str

    model_config = {"from_attributes": True}


# ---- Wartungspläne ---- #

class ScheduleRead(BaseModel):
    id: int
    plant_id: int
    title: str
    interval_months: int
    next_due: str
    last_completed: Optional[str] = None
    checklist: list[dict]
    active: bool

    model_config = {"from_attributes": True}

    @computed_field
    @property
    def is_due(self) -> bool:
        try:
            return date.fromisoformat(self.next_due) <= date.today()
        except Exception:
            return False

    @computed_field
    @property
    def days_until_due(self) -> int:
        try:
            delta = date.fromisoformat(self.next_due) - date.today()
            return delta.days
        except Exception:
            return 0


class ScheduleCreate(BaseModel):
    title: str
    interval_months: int
    next_due: str
    checklist: list[dict] = []
    active: bool = True


# ---- Wartungsprotokolle ---- #

class LogRead(BaseModel):
    id: int
    plant_id: int
    schedule_id: Optional[int] = None
    technician: str
    performed_at: str
    results: list[dict]
    notes: str
    pdf_path: Optional[str] = None

    model_config = {"from_attributes": True}


class LogCreate(BaseModel):
    results: list[dict]
    notes: str = ""


# ---- Anlagenstammdaten ---- #

class PlantDataRead(BaseModel):
    id: int
    object_id: int
    hersteller: Optional[str] = None
    modell: Optional[str] = None
    seriennummer: Optional[str] = None
    baujahr: Optional[int] = None
    einbaudatum: Optional[str] = None
    standort_detail: Optional[str] = None
    garantie_bis: Optional[str] = None
    status: str
    din276_kg: Optional[str] = None
    bemerkungen: str

    documents: list[PlantDocumentRead] = []
    schedules: list[ScheduleRead] = []
    logs: list[LogRead] = []

    model_config = {"from_attributes": True}


class PlantDataCreate(BaseModel):
    hersteller: Optional[str] = None
    modell: Optional[str] = None
    seriennummer: Optional[str] = None
    baujahr: Optional[int] = None
    einbaudatum: Optional[str] = None
    standort_detail: Optional[str] = None
    garantie_bis: Optional[str] = None
    status: str = "aktiv"
    din276_kg: Optional[str] = None
    bemerkungen: str = ""
