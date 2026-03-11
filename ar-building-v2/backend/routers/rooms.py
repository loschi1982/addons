# Router für alle Raum-Endpunkte.
# WICHTIG: Reihenfolge der Routen ist entscheidend für korrektes FastAPI-Matching.
# Statische Pfade ("", "/by-marker/...") müssen VOR dynamischen ("/{room_id}") stehen.

import os
import re
import shutil

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from backend.database import get_db
from backend.auth import require_any_role, require_admin
from backend.models.room import Room
from backend.models.object import Object
from backend.schemas.room import RoomSummary, RoomDetail, RoomCreate
from backend.schemas.object import ObjectSummary

# redirect_slashes=False verhindert interne Weiterleitungen die zu 405 führen können.
router = APIRouter(redirect_slashes=False)

UPLOAD_BASE = "/data/uploads"

# Erlaubte Dateiendungen je file_type.
_ALLOWED_EXTENSIONS = {
    "model": {".onnx"},
    "audio": {".mp3", ".wav", ".ogg", ".m4a"},
    "video": {".mp4", ".webm", ".mov"},
}
# Maximale Dateigrößen in Bytes je file_type.
_MAX_SIZE = {
    "model": 50 * 1024 * 1024,   # 50 MB
    "audio": 20 * 1024 * 1024,   # 20 MB
    "video": 200 * 1024 * 1024,  # 200 MB
}
# Nur alphanumerische Zeichen, Bindestriche, Unterstriche und Punkte erlaubt.
_SAFE_FILENAME = re.compile(r"^[\w\-. ]+$")


def room_to_detail(room: Room) -> RoomDetail:
    """Wandelt ein Room-ORM-Objekt in ein RoomDetail-Schema um."""
    objects = [
        ObjectSummary(
            id=obj.id,
            name=obj.name,
            marker_id=obj.marker_id,
            short_desc=obj.short_desc,
            type_id=obj.type_id,
            type_name=obj.object_type.name if obj.object_type else "",
            room_id=obj.room_id,
        )
        for obj in (room.objects or [])
    ]
    return RoomDetail(
        id=room.id,
        name=room.name,
        marker_id=room.marker_id,
        short_desc=room.short_desc,
        detail_text=room.detail_text,
        model_path=room.model_path,
        audio_path=room.audio_path,
        video_path=room.video_path,
        video_opacity=room.video_opacity,
        ha_sensor_ids=room.ha_sensor_ids,
        objects=objects,
    )


async def load_room(db: AsyncSession, room_id: int) -> Room | None:
    """Lädt einen Raum mit allen Beziehungen in einer einzigen async-Abfrage."""
    result = await db.execute(
        select(Room)
        .options(selectinload(Room.objects).selectinload(Object.object_type))
        .where(Room.id == room_id)
    )
    return result.scalar_one_or_none()


# ── 1. Liste aller Räume (GET "") ─────────────────────────────────────────────
# Muss als ERSTE Route registriert werden.

@router.get("", response_model=list[RoomSummary])
async def list_rooms(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_any_role()),
):
    """Gibt eine Liste aller Räume zurück (Kurzform)."""
    result = await db.execute(select(Room))
    rooms = result.scalars().all()
    return [
        RoomSummary(id=r.id, name=r.name, marker_id=r.marker_id, short_desc=r.short_desc)
        for r in rooms
    ]


# ── 2. Neuen Raum anlegen (POST "") ──────────────────────────────────────────

@router.post("", response_model=RoomDetail, status_code=201)
async def create_room(
    body: RoomCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """Legt einen neuen Raum an. Nur Admins dürfen das."""
    room = Room(
        name=body.name,
        marker_id=body.marker_id,
        short_desc=body.short_desc,
        detail_text=body.detail_text,
        video_opacity=body.video_opacity,
    )
    room.ha_sensor_ids = body.ha_sensor_ids
    db.add(room)
    await db.commit()
    room = await load_room(db, room.id)
    return room_to_detail(room)


# ── 3. Raum per Marker-ID laden (statischer Pfad vor /{room_id}) ──────────────

@router.get("/by-marker/{marker_id}", response_model=RoomDetail)
async def get_room_by_marker(
    marker_id: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_any_role()),
):
    """Lädt einen Raum anhand seiner Marker-ID (z.B. 'room:1')."""
    result = await db.execute(
        select(Room)
        .options(selectinload(Room.objects).selectinload(Object.object_type))
        .where(Room.marker_id == marker_id)
    )
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    return room_to_detail(room)


# ── 4. Einzelnen Raum laden (GET /{room_id}) ──────────────────────────────────

@router.get("/{room_id}", response_model=RoomDetail)
async def get_room(
    room_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_any_role()),
):
    """Lädt einen einzelnen Raum mit allen Details."""
    room = await load_room(db, room_id)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    return room_to_detail(room)


# ── 5. Raum bearbeiten (PUT /{room_id}) ───────────────────────────────────────

@router.put("/{room_id}", response_model=RoomDetail)
async def update_room(
    room_id: int,
    body: RoomCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """Bearbeitet einen bestehenden Raum. Nur Admins dürfen das."""
    room = await load_room(db, room_id)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")

    room.name = body.name
    room.marker_id = body.marker_id
    room.short_desc = body.short_desc
    room.detail_text = body.detail_text
    room.video_opacity = body.video_opacity
    room.ha_sensor_ids = body.ha_sensor_ids

    await db.commit()
    room = await load_room(db, room_id)
    return room_to_detail(room)


# ── 6. Raum löschen (DELETE /{room_id}) ───────────────────────────────────────

@router.delete("/{room_id}", status_code=204)
async def delete_room(
    room_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """Löscht einen Raum. Nur Admins dürfen das."""
    result = await db.execute(select(Room).where(Room.id == room_id))
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    await db.delete(room)
    await db.commit()


# ── 7. Datei-Upload (POST /{room_id}/files) ───────────────────────────────────

@router.post("/{room_id}/files")
async def upload_room_file(
    room_id: int,
    file: UploadFile = File(...),
    file_type: str = Form(...),
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """Lädt eine Datei für einen Raum hoch (ONNX-Modell, Audio oder Video)."""
    if file_type not in ("model", "audio", "video"):
        raise HTTPException(
            status_code=400, detail="file_type must be 'model', 'audio' or 'video'"
        )

    result = await db.execute(select(Room).where(Room.id == room_id))
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")

    # Dateiname validieren: keine Path-Traversal-Zeichen erlaubt.
    original_name = file.filename or ""
    if not original_name or not _SAFE_FILENAME.match(original_name):
        raise HTTPException(status_code=400, detail="Ungültiger Dateiname")

    # Extension gegen Whitelist prüfen.
    ext = os.path.splitext(original_name)[1].lower()
    if ext not in _ALLOWED_EXTENSIONS[file_type]:
        allowed = ", ".join(_ALLOWED_EXTENSIONS[file_type])
        raise HTTPException(
            status_code=400,
            detail=f"Nicht erlaubte Dateiendung für {file_type}. Erlaubt: {allowed}",
        )

    # Dateigröße prüfen (Inhalt vollständig lesen und Limit durchsetzen).
    max_bytes = _MAX_SIZE[file_type]
    content = await file.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Datei zu groß. Maximum für {file_type}: {max_bytes // 1024 // 1024} MB",
        )

    upload_dir = os.path.join(UPLOAD_BASE, str(room_id))
    os.makedirs(upload_dir, exist_ok=True)

    # Sicheren Pfad ohne Path-Traversal konstruieren.
    safe_name = os.path.basename(original_name)
    file_path = os.path.join(upload_dir, safe_name)
    with open(file_path, "wb") as f:
        f.write(content)

    url_path = f"/uploads/{room_id}/{safe_name}"

    if file_type == "model":
        room.model_path = url_path
    elif file_type == "audio":
        room.audio_path = url_path
    elif file_type == "video":
        room.video_path = url_path

    await db.commit()
    return {"path": url_path}
