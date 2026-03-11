# Pydantic-Schemas definieren, welche Daten die API empfängt und zurückgibt.
# Sie prüfen automatisch, ob die eingehenden Daten das richtige Format haben.

from datetime import datetime
from typing import Optional
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Request-Schemas (kommen vom Frontend)
# ---------------------------------------------------------------------------

class StatEventCreate(BaseModel):
    """
    Datenformat für einen eingehenden Tracking-Event vom Frontend.
    Entspricht exakt dem StatEvent-Schema aus dem API-Vertrag.
    """
    # Art des Events – muss einer der erlaubten Werte sein
    event_type: str  # "login_pin"|"login_visitor"|"login_failed"|"room_scan"|"object_detected"|"detail_opened"|"session_end"

    # Eindeutige Sitzungs-ID aus dem Frontend (crypto.randomUUID())
    session_id: str

    # Rolle des Nutzers – optional, da bei fehlgeschlagenem Login unbekannt
    role: Optional[str] = None

    # Optionale Raum-Zuordnung
    room_id: Optional[int] = None

    # Optionale Objekt-Zuordnung
    object_id: Optional[int] = None

    # Zeitpunkt des Events – kommt als ISO-Datetime-String vom Frontend
    timestamp: datetime


class HeartbeatCreate(BaseModel):
    """
    Datenformat für einen Heartbeat-Request vom Frontend.
    Das Frontend sendet diesen Request alle 30 Sekunden, um zu signalisieren,
    dass die Sitzung noch aktiv ist.
    Felder gemäß API-Vertrag (POST /api/stats/heartbeat):
      - session_id: eindeutige Sitzungs-ID aus dem Frontend
      - room_id:    aktueller Raum des Nutzers (optional)
    """
    session_id: str
    room_id: Optional[int] = None


# Alias für Rückwärtskompatibilität – das Backend-Team referenziert
# diesen Namen in schemas/__init__.py.
HeartbeatRequest = HeartbeatCreate


# ---------------------------------------------------------------------------
# Dashboard-Response-Schemas (gehen ans Frontend)
# ---------------------------------------------------------------------------

class LoginBreakdown(BaseModel):
    """Aufschlüsselung der Login-Typen für heute."""
    pin: int
    visitor: int
    failed: int


class HourlyEvent(BaseModel):
    """Anzahl der Events pro Stunde (für das Linien-Chart im Dashboard)."""
    hour: int
    count: int


class TimelineEvent(BaseModel):
    """Ein Datenpunkt in der Zeitachse (Stunde, Tag oder Monat)."""
    label: str
    count: int


class TopRoom(BaseModel):
    """Raum mit den meisten Scans heute."""
    room_id: int
    room_name: str
    scans: int


class TopObject(BaseModel):
    """Objekt mit den meisten Erkennungen heute."""
    object_id: int
    object_name: str
    detections: int


class DashboardData(BaseModel):
    """
    Vollständige Antwort des Dashboard-Endpunkts.
    Enthält alle KPIs und aggregierten Daten für den gewählten Zeitraum.
    """
    total_sessions: int
    total_room_scans: int
    total_object_scans: int
    active_sessions_now: int
    login_breakdown: LoginBreakdown
    timeline_events: list[TimelineEvent]
    timeline_granularity: str   # "hour", "day", "month"
    top_rooms: list[TopRoom]
    top_objects: list[TopObject]


# ---------------------------------------------------------------------------
# Live-Response-Schemas (gehen ans Frontend)
# ---------------------------------------------------------------------------

class ActiveSessions(BaseModel):
    """Anzahl aktiver Sitzungen aufgeschlüsselt nach Rolle."""
    visitor: int
    staff: int
    technician: int
    admin: int


class ActiveRoom(BaseModel):
    """Ein Raum, in dem sich gerade Nutzer befinden."""
    room_id: int
    room_name: str
    visitor_count: int


class LiveData(BaseModel):
    """
    Antwort des Live-Endpunkts.
    Zeigt nur Sitzungen, die in den letzten 90 Sekunden einen Heartbeat geschickt haben.
    """
    active_sessions: ActiveSessions
    active_rooms: list[ActiveRoom]