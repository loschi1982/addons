# Router für alle Statistik- und Tracking-Endpunkte.
# Wird in main.py eingebunden via: app.include_router(statistics.router, prefix="/api/stats", tags=["statistics"])

from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select, func, distinct, text
from sqlalchemy.ext.asyncio import AsyncSession

# WICHTIG: absolute Imports wie in allen anderen Routern.
# Relative Imports (from ..database) führen zu ImportError.
from backend.database import get_db
from backend.auth import require_any_role, require_admin
from backend.models.statistics import StatEvent, Heartbeat
from backend.models.room import Room
from backend.models.object import Object

from backend.schemas.statistics import (
    StatEventCreate,
    HeartbeatCreate,
    DashboardData,
    LoginBreakdown,
    HourlyEvent,
    TimelineEvent,
    TopRoom,
    TopObject,
    LiveData,
    ActiveSessions,
    ActiveRoom,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# POST /api/stats/event
# ---------------------------------------------------------------------------

@router.post("/event", status_code=201)
async def create_stat_event(
    event: StatEventCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_any_role()),
):
    """
    Speichert ein einzelnes Tracking-Event in der Datenbank.
    Das Frontend ruft diesen Endpunkt auf, wenn etwas Relevantes passiert,
    z.B. wenn ein Raum gescannt oder ein Objekt erkannt wurde.
    """
    new_event = StatEvent(
        event_type=event.event_type,
        session_id=event.session_id,
        role=event.role,
        room_id=event.room_id,
        object_id=event.object_id,
        timestamp=event.timestamp,
    )
    db.add(new_event)
    await db.commit()
    return Response(status_code=201)


# ---------------------------------------------------------------------------
# POST /api/stats/heartbeat
# ---------------------------------------------------------------------------

@router.post("/heartbeat", status_code=200)
async def heartbeat(
    data: HeartbeatCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_any_role()),
):
    """
    Aktualisiert den Heartbeat einer aktiven Sitzung.
    Das Frontend sendet diesen Request alle 30 Sekunden.
    Falls die Sitzung noch nicht existiert, wird sie neu angelegt (Upsert).
    Sitzungen ohne Heartbeat seit mehr als 90 Sekunden gelten im Live-View als inaktiv.
    """
    now = datetime.now(timezone.utc)

    # Rolle des aktuell eingeloggten Nutzers aus dem JWT ermitteln.
    role = current_user.get("role") if isinstance(current_user, dict) else getattr(current_user, "role", None)

    # SQLite-Upsert: INSERT wenn neu, UPDATE wenn session_id bereits existiert.
    # ON CONFLICT greift auf den PRIMARY KEY (session_id).
    await db.execute(
        text("""
            INSERT INTO heartbeats (session_id, role, room_id, last_seen)
            VALUES (:session_id, :role, :room_id, :last_seen)
            ON CONFLICT(session_id) DO UPDATE SET
                role=excluded.role,
                room_id=excluded.room_id,
                last_seen=excluded.last_seen
        """),
        {
            "session_id": data.session_id,
            "role": role,
            "room_id": data.room_id,
            "last_seen": now,
        },
    )
    await db.commit()
    return Response(status_code=200)


# ---------------------------------------------------------------------------
# GET /api/stats/dashboard
# ---------------------------------------------------------------------------

@router.get("/dashboard", response_model=DashboardData)
async def get_dashboard(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    """
    Gibt aggregierte KPI-Daten für das Admin-Dashboard zurück.
    Optional können date_from und date_to (Format YYYY-MM-DD) übergeben werden.
    Ohne Parameter wird der aktuelle Tag verwendet.
    Die Zeitachsen-Granularität wird automatisch gewählt:
      - ≤ 1 Tag  → stündlich
      - ≤ 31 Tage → täglich
      - > 31 Tage → monatlich
    """
    now = datetime.now(timezone.utc)

    # --- Zeitraum parsen ---
    if date_from:
        try:
            dt_from = datetime.strptime(date_from, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            dt_from = now.replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        dt_from = now.replace(hour=0, minute=0, second=0, microsecond=0)

    if date_to:
        try:
            dt_to = datetime.strptime(date_to, "%Y-%m-%d").replace(
                hour=23, minute=59, second=59, microsecond=999999, tzinfo=timezone.utc
            )
        except ValueError:
            dt_to = now.replace(hour=23, minute=59, second=59, microsecond=999999)
    else:
        dt_to = now.replace(hour=23, minute=59, second=59, microsecond=999999)

    # --- Granularität bestimmen ---
    span_days = (dt_to - dt_from).days
    if span_days <= 1:
        granularity = "hour"
    elif span_days <= 31:
        granularity = "day"
    else:
        granularity = "month"

    # Basis-Filter für den gewählten Zeitraum.
    def period_filter(query):
        return query.where(StatEvent.timestamp >= dt_from).where(StatEvent.timestamp <= dt_to)

    # Grenzwert für aktive Sitzungen: alles älter als 90 Sekunden gilt als inaktiv.
    cutoff_90s = now - timedelta(seconds=90)

    # --- Gesamtanzahl eindeutiger Sitzungen im Zeitraum ---
    result = await db.execute(
        period_filter(
            select(func.count(distinct(StatEvent.session_id)))
        )
    )
    total_sessions = result.scalar() or 0

    # --- Anzahl Raum-Scans im Zeitraum ---
    result = await db.execute(
        period_filter(
            select(func.count())
            .select_from(StatEvent)
            .where(StatEvent.event_type == "room_scan")
        )
    )
    total_room_scans = result.scalar() or 0

    # --- Anzahl Objekt-Erkennungen im Zeitraum ---
    result = await db.execute(
        period_filter(
            select(func.count())
            .select_from(StatEvent)
            .where(StatEvent.event_type == "object_detected")
        )
    )
    total_object_scans = result.scalar() or 0

    # --- Aktuell aktive Sitzungen (Heartbeat jünger als 90s) – immer live ---
    result = await db.execute(
        select(func.count())
        .select_from(Heartbeat)
        .where(Heartbeat.last_seen >= cutoff_90s)
    )
    active_sessions_now = result.scalar() or 0

    # --- Login-Aufschlüsselung: pin / visitor / failed ---
    result = await db.execute(
        period_filter(
            select(StatEvent.event_type, func.count())
            .where(StatEvent.event_type.in_(["login_pin", "login_visitor", "login_failed"]))
        )
        .group_by(StatEvent.event_type)
    )
    login_counts = {row[0]: row[1] for row in result.fetchall()}
    login_breakdown = LoginBreakdown(
        pin=login_counts.get("login_pin", 0),
        visitor=login_counts.get("login_visitor", 0),
        failed=login_counts.get("login_failed", 0),
    )

    # --- Zeitachsen-Events (Chart) ---
    if granularity == "hour":
        fmt = "%H"
    elif granularity == "day":
        fmt = "%Y-%m-%d"
    else:
        fmt = "%Y-%m"

    result = await db.execute(
        period_filter(
            select(
                func.strftime(fmt, StatEvent.timestamp).label("label"),
                func.count().label("count"),
            )
        )
        .group_by(func.strftime(fmt, StatEvent.timestamp))
        .order_by(func.strftime(fmt, StatEvent.timestamp))
    )
    timeline_events = [
        TimelineEvent(label=row.label, count=row.count)
        for row in result.fetchall()
    ]

    # --- Top-Räume nach Anzahl Scans ---
    result = await db.execute(
        period_filter(
            select(
                StatEvent.room_id,
                Room.name.label("room_name"),
                func.count().label("scans"),
            )
            .join(Room, Room.id == StatEvent.room_id)
            .where(StatEvent.event_type == "room_scan")
            .where(StatEvent.room_id.isnot(None))
        )
        .group_by(StatEvent.room_id, Room.name)
        .order_by(func.count().desc())
        .limit(10)
    )
    top_rooms = [
        TopRoom(room_id=row.room_id, room_name=row.room_name, scans=row.scans)
        for row in result.fetchall()
    ]

    # --- Top-Objekte nach Anzahl Erkennungen ---
    result = await db.execute(
        period_filter(
            select(
                StatEvent.object_id,
                Object.name.label("object_name"),
                func.count().label("detections"),
            )
            .join(Object, Object.id == StatEvent.object_id)
            .where(StatEvent.event_type == "object_detected")
            .where(StatEvent.object_id.isnot(None))
        )
        .group_by(StatEvent.object_id, Object.name)
        .order_by(func.count().desc())
        .limit(10)
    )
    top_objects = [
        TopObject(object_id=row.object_id, object_name=row.object_name, detections=row.detections)
        for row in result.fetchall()
    ]

    return DashboardData(
        total_sessions=total_sessions,
        total_room_scans=total_room_scans,
        total_object_scans=total_object_scans,
        active_sessions_now=active_sessions_now,
        login_breakdown=login_breakdown,
        timeline_events=timeline_events,
        timeline_granularity=granularity,
        top_rooms=top_rooms,
        top_objects=top_objects,
    )


# ---------------------------------------------------------------------------
# GET /api/stats/live
# ---------------------------------------------------------------------------

@router.get("/live", response_model=LiveData)
async def get_live(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """
    Gibt Echtzeit-Daten zu aktiven Sitzungen und Räumen zurück.
    "Aktiv" bedeutet: Heartbeat wurde in den letzten 90 Sekunden empfangen.
    Der Admin-Dashboard-Live-Block ruft diesen Endpunkt alle 15 Sekunden ab.
    """
    cutoff_90s = datetime.now(timezone.utc) - timedelta(seconds=90)

    # --- Aktive Sitzungen nach Rolle zählen ---
    result = await db.execute(
        select(Heartbeat.role, func.count().label("count"))
        .where(Heartbeat.last_seen >= cutoff_90s)
        .group_by(Heartbeat.role)
    )
    role_counts = {row.role: row.count for row in result.fetchall()}

    # Alle Rollen explizit auf 0 setzen, falls keine Sitzungen vorhanden.
    active_sessions = ActiveSessions(
        visitor=role_counts.get("visitor", 0),
        staff=role_counts.get("staff", 0),
        technician=role_counts.get("technician", 0),
        admin=role_counts.get("admin", 0),
    )

    # --- Aktive Räume: welche Räume werden gerade besucht? ---
    # visitor_count = nur Sitzungen mit Rolle "visitor" (nicht Staff/Admin).
    result = await db.execute(
        select(
            Heartbeat.room_id,
            Room.name.label("room_name"),
            func.count().label("visitor_count"),
        )
        .join(Room, Room.id == Heartbeat.room_id)
        .where(Heartbeat.last_seen >= cutoff_90s)
        .where(Heartbeat.room_id.isnot(None))
        .where(Heartbeat.role == "visitor")
        .group_by(Heartbeat.room_id, Room.name)
        .order_by(func.count().desc())
    )
    active_rooms = [
        ActiveRoom(room_id=row.room_id, room_name=row.room_name, visitor_count=row.visitor_count)
        for row in result.fetchall()
    ]

    return LiveData(
        active_sessions=active_sessions,
        active_rooms=active_rooms,
    )