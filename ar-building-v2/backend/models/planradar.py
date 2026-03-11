# Datenbankmodelle für die PlanRadar-Integration.
# Zwei neue Tabellen:
#   planradar_project_roles  – welche AR-Rollen dürfen Tickets eines Projekts sehen
#   planradar_mappings       – verknüpft PlanRadar-Listeneinträge mit AR-QR-Markern

import json
from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.database import Base


class PlanRadarProjectRole(Base):
    """
    Speichert pro PlanRadar-Projekt welche AR-Rollen die Tickets sehen dürfen.
    Ein Eintrag pro Projekt (planradar_project_id ist unique).
    """
    __tablename__ = "planradar_project_roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Hash-String der PlanRadar-Projekt-ID, z.B. "mdaown" — eindeutig pro Eintrag
    planradar_project_id: Mapped[str] = mapped_column(String, unique=True, nullable=False)

    # Erlaubte AR-Rollen als JSON-String, z.B. '["staff", "technician"]'
    visible_to_roles: Mapped[str] = mapped_column(String, default="[]")

    @property
    def roles_list(self) -> list[str]:
        """Gibt die erlaubten Rollen als Python-Liste zurück."""
        try:
            return json.loads(self.visible_to_roles or "[]")
        except Exception:
            return []

    @roles_list.setter
    def roles_list(self, value: list[str]):
        """Speichert die erlaubten Rollen als JSON-String."""
        self.visible_to_roles = json.dumps(value or [])


class PlanRadarMapping(Base):
    """
    Verknüpft einen PlanRadar-Listeneintrag mit einem AR-QR-Marker.
    Ein Marker kann nur einem Eintrag zugeordnet sein (ar_marker_id ist unique).
    Beim Scan eines Markers wird dieses Mapping genutzt um die richtigen Tickets zu laden.
    """
    __tablename__ = "planradar_mappings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # PlanRadar-Projekt-ID, z.B. "mdaown"
    planradar_project_id: Mapped[str] = mapped_column(String, nullable=False)

    # PlanRadar-Listen-ID, z.B. "ab12"
    planradar_list_id: Mapped[str] = mapped_column(String, nullable=False)

    # UUID des Listeneintrags in PlanRadar, z.B. "abc-123-def"
    planradar_entry_uuid: Mapped[str] = mapped_column(String, nullable=False)

    # Gecachter Name des Eintrags für die Anzeige — wird nicht live von PlanRadar geladen
    planradar_entry_name: Mapped[str] = mapped_column(String, nullable=False)

    # AR-QR-Marker-ID, z.B. "room:1" oder "object:42" — eindeutig (Upsert-Key)
    ar_marker_id: Mapped[str] = mapped_column(String, nullable=False, unique=True)

    # Erlaubte AR-Rollen als JSON-String — überschreibt Projekt-Rolleneinstellung
    visible_to_roles: Mapped[str] = mapped_column(String, default="[]")

    @property
    def roles_list(self) -> list[str]:
        """Gibt die erlaubten Rollen als Python-Liste zurück."""
        try:
            return json.loads(self.visible_to_roles or "[]")
        except Exception:
            return []

    @roles_list.setter
    def roles_list(self, value: list[str]):
        """Speichert die erlaubten Rollen als JSON-String."""
        self.visible_to_roles = json.dumps(value or [])