# Pydantic-Schemas für die PlanRadar-Integration.
# Sechs neue Schemas gemäß API-Vertrag v2.1.0.

from pydantic import BaseModel


class PlanRadarProject(BaseModel):
    """Ein PlanRadar-Projekt aus dem Account."""
    id: str       # Hash-String, z.B. "mdaown"
    name: str
    active: bool


class PlanRadarList(BaseModel):
    """Eine Custom-Liste in einem PlanRadar-Projekt, z.B. 'Räume' oder 'Technische Anlagen'."""
    id: str       # PlanRadar-Listen-ID, z.B. "ab12"
    name: str


class PlanRadarListEntry(BaseModel):
    """Ein einzelner Eintrag in einer PlanRadar-Liste, z.B. 'Großer Saal'."""
    uuid: str     # Eindeutige UUID des Eintrags in PlanRadar
    name: str


class PlanRadarProjectRole(BaseModel):
    """Rollenzuordnung für ein PlanRadar-Projekt.
    Legt fest welche AR-Rollen Tickets des Projekts sehen dürfen."""
    project_id: str
    visible_to_roles: list[str]


class PlanRadarMappingCreate(BaseModel):
    """Daten zum Anlegen oder Aktualisieren eines Marker-Mappings."""
    planradar_project_id: str
    planradar_list_id: str
    planradar_entry_uuid: str
    # Gecachter Name für die Anzeige — wird nicht live von PlanRadar geladen
    planradar_entry_name: str
    # QR-Marker-ID im AR-System, z.B. "room:1" oder "object:42"
    ar_marker_id: str
    # Überschreibt die Projekt-Rolleneinstellung für diesen Marker
    visible_to_roles: list[str] = []


class PlanRadarMapping(BaseModel):
    """Gespeichertes Marker-Mapping mit interner ID."""
    id: int
    planradar_project_id: str
    planradar_list_id: str
    planradar_entry_uuid: str
    planradar_entry_name: str
    ar_marker_id: str
    visible_to_roles: list[str]