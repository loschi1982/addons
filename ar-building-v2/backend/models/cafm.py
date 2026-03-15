# Datenbankmodelle für das CAFM-Modul (Technische Anlagen, Wartung, Dokumente).

import json
from sqlalchemy import Integer, String, Float, Text, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database import Base


class PlantData(Base):
    """Anlagenstammdaten — erweitert ein Object vom Typ 'Technische Anlagen' (1:1)."""
    __tablename__ = "plant_data"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    object_id: Mapped[int] = mapped_column(Integer, ForeignKey("objects.id"), unique=True, nullable=False)

    hersteller: Mapped[str | None] = mapped_column(String(255), nullable=True)
    modell: Mapped[str | None] = mapped_column(String(255), nullable=True)
    seriennummer: Mapped[str | None] = mapped_column(String(255), nullable=True)
    baujahr: Mapped[int | None] = mapped_column(Integer, nullable=True)
    einbaudatum: Mapped[str | None] = mapped_column(String(10), nullable=True)
    standort_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    garantie_bis: Mapped[str | None] = mapped_column(String(10), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="aktiv", nullable=False)
    din276_kg: Mapped[str | None] = mapped_column(String(10), nullable=True)
    anlagen_variante: Mapped[str | None] = mapped_column(String(100), nullable=True)
    bemerkungen: Mapped[str] = mapped_column(Text, default="")

    # Beziehungen
    object = relationship("Object", back_populates="plant_data")
    documents: Mapped[list["PlantDocument"]] = relationship(
        "PlantDocument", back_populates="plant", cascade="all, delete-orphan", lazy="selectin"
    )
    schedules: Mapped[list["MaintenanceSchedule"]] = relationship(
        "MaintenanceSchedule", back_populates="plant", cascade="all, delete-orphan", lazy="selectin"
    )
    logs: Mapped[list["MaintenanceLog"]] = relationship(
        "MaintenanceLog", back_populates="plant", cascade="all, delete-orphan", lazy="selectin"
    )


class PlantDocument(Base):
    """Dokument einer technischen Anlage (Anlagendoku oder Wartungsunterlage)."""
    __tablename__ = "plant_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plant_id: Mapped[int] = mapped_column(Integer, ForeignKey("plant_data.id"), nullable=False)
    category: Mapped[str] = mapped_column(String(50), nullable=False)  # "anlagendoku" | "wartung"
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    uploaded_at: Mapped[str] = mapped_column(String(30), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")

    plant = relationship("PlantData", back_populates="documents")


class MaintenanceSchedule(Base):
    """Wiederkehrender Wartungsplan für eine Anlage."""
    __tablename__ = "maintenance_schedules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plant_id: Mapped[int] = mapped_column(Integer, ForeignKey("plant_data.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    interval_months: Mapped[int] = mapped_column(Integer, nullable=False)
    next_due: Mapped[str] = mapped_column(String(10), nullable=False)  # YYYY-MM-DD
    last_completed: Mapped[str | None] = mapped_column(String(10), nullable=True)
    checklist_json: Mapped[str] = mapped_column(Text, default="[]")
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    plant = relationship("PlantData", back_populates="schedules")
    logs: Mapped[list["MaintenanceLog"]] = relationship(
        "MaintenanceLog", back_populates="schedule", lazy="selectin"
    )

    @property
    def checklist(self) -> list[dict]:
        try:
            return json.loads(self.checklist_json or "[]")
        except Exception:
            return []

    @checklist.setter
    def checklist(self, value: list[dict]):
        self.checklist_json = json.dumps(value or [])


class MaintenanceLog(Base):
    """Abgeschlossenes Wartungsprotokoll."""
    __tablename__ = "maintenance_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plant_id: Mapped[int] = mapped_column(Integer, ForeignKey("plant_data.id"), nullable=False)
    schedule_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("maintenance_schedules.id"), nullable=True
    )
    technician: Mapped[str] = mapped_column(String(255), nullable=False)
    performed_at: Mapped[str] = mapped_column(String(30), nullable=False)
    results_json: Mapped[str] = mapped_column(Text, default="[]")
    notes: Mapped[str] = mapped_column(Text, default="")
    pdf_path: Mapped[str | None] = mapped_column(String(500), nullable=True)

    plant = relationship("PlantData", back_populates="logs")
    schedule = relationship("MaintenanceSchedule", back_populates="logs")

    @property
    def results(self) -> list[dict]:
        try:
            return json.loads(self.results_json or "[]")
        except Exception:
            return []

    @results.setter
    def results(self, value: list[dict]):
        self.results_json = json.dumps(value or [])
