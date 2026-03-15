# Importiert alle Modelle damit SQLAlchemy sie beim Erstellen der Tabellen kennt.
from backend.models.room import Room
from backend.models.object import Object, ObjectType
from backend.models.user import User
from backend.models.statistics import StatEvent, Heartbeat
from backend.models.planradar import PlanRadarProjectRole, PlanRadarMapping
from backend.models.cafm import PlantData, PlantDocument, MaintenanceSchedule, MaintenanceLog

__all__ = [
    "Room", "Object", "ObjectType", "User",
    "StatEvent", "Heartbeat",
    "PlanRadarProjectRole", "PlanRadarMapping",
    "PlantData", "PlantDocument", "MaintenanceSchedule", "MaintenanceLog",
]