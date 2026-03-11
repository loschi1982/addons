# Router für Objekte (Exponate).
# Objekttypen haben einen eigenen Router in object_types.py

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from backend.database import get_db
from backend.auth import require_any_role, require_admin
from backend.models.object import Object, ObjectType
from backend.schemas.object import (
    ObjectSummary, ObjectDetail, ObjectCreate,
)

router = APIRouter(redirect_slashes=False)


def obj_to_detail(obj: Object) -> ObjectDetail:
    """Wandelt ein ORM-Objekt in das ObjectDetail-Schema um."""
    return ObjectDetail(
        id=obj.id,
        name=obj.name,
        marker_id=obj.marker_id,
        short_desc=obj.short_desc,
        detail_text=obj.detail_text,
        type_id=obj.type_id,
        type_name=obj.object_type.name if obj.object_type else "",
        room_id=obj.room_id,
        video_path=obj.video_path,
        video_opacity=obj.video_opacity,
        audio_path=obj.audio_path,
        ha_sensor_ids=obj.ha_sensor_ids,
        onnx_class_id=obj.onnx_class_id,
    )


def obj_to_summary(obj: Object) -> ObjectSummary:
    """Wandelt ein ORM-Objekt in das ObjectSummary-Schema um."""
    return ObjectSummary(
        id=obj.id,
        name=obj.name,
        marker_id=obj.marker_id,
        short_desc=obj.short_desc,
        type_id=obj.type_id,
        type_name=obj.object_type.name if obj.object_type else "",
        room_id=obj.room_id,
    )


async def load_object(db: AsyncSession, object_id: int) -> Object | None:
    """Lädt ein Objekt mit allen Beziehungen in einer einzigen async-Abfrage.
    selectinload stellt sicher dass object_type geladen ist bevor die Session
    geschlossen wird – verhindert MissingGreenlet-Fehler."""
    result = await db.execute(
        select(Object)
        .options(selectinload(Object.object_type))
        .where(Object.id == object_id)
    )
    return result.scalar_one_or_none()


# ─── Objekte ───────────────────────────────────────────────────────────────────

@router.get("", response_model=list[ObjectSummary])
async def list_objects(
    room_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_any_role()),
):
    """Gibt alle Objekte zurück. Optional gefiltert nach room_id."""
    query = (
        select(Object)
        .options(selectinload(Object.object_type))
    )
    if room_id is not None:
        query = query.where(Object.room_id == room_id)
    result = await db.execute(query)
    objects = result.scalars().all()
    return [obj_to_summary(o) for o in objects]


@router.get("/by-marker/{marker_id}", response_model=ObjectDetail)
async def get_object_by_marker(
    marker_id: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_any_role()),
):
    """Lädt ein Objekt anhand seiner Marker-ID (z.B. 'object:42').
    Wird vom Frontend beim QR-Scan verwendet."""
    result = await db.execute(
        select(Object)
        .options(selectinload(Object.object_type))
        .where(Object.marker_id == marker_id)
    )
    obj = result.scalar_one_or_none()
    if obj is None:
        raise HTTPException(status_code=404, detail="Object not found")
    return obj_to_detail(obj)


@router.get("/{object_id}", response_model=ObjectDetail)
async def get_object(
    object_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_any_role()),
):
    """Lädt ein einzelnes Objekt mit allen Details."""
    obj = await load_object(db, object_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Object not found")
    return obj_to_detail(obj)


@router.post("", response_model=ObjectDetail, status_code=201)
async def create_object(
    body: ObjectCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """Legt ein neues Objekt an. Nur Admins dürfen das."""
    obj = Object(
        name=body.name,
        marker_id=body.marker_id,
        short_desc=body.short_desc,
        detail_text=body.detail_text,
        type_id=body.type_id,
        room_id=body.room_id,
        video_path=body.video_path,
        video_opacity=body.video_opacity,
        audio_path=body.audio_path,
        onnx_class_id=body.onnx_class_id,
    )
    obj.ha_sensor_ids = body.ha_sensor_ids
    db.add(obj)
    await db.commit()
    # Nach commit explizit neu laden mit selectinload – lazy load ist async-unsafe.
    obj = await load_object(db, obj.id)
    return obj_to_detail(obj)


@router.put("/{object_id}", response_model=ObjectDetail)
async def update_object(
    object_id: int,
    body: ObjectCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """Bearbeitet ein bestehendes Objekt. Nur Admins dürfen das."""
    obj = await load_object(db, object_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Object not found")

    obj.name = body.name
    obj.marker_id = body.marker_id
    obj.short_desc = body.short_desc
    obj.detail_text = body.detail_text
    obj.type_id = body.type_id
    obj.room_id = body.room_id
    obj.video_path = body.video_path
    obj.video_opacity = body.video_opacity
    obj.audio_path = body.audio_path
    obj.onnx_class_id = body.onnx_class_id
    obj.ha_sensor_ids = body.ha_sensor_ids

    await db.commit()
    # Erneut laden damit type_name nach dem commit aktuell ist.
    obj = await load_object(db, object_id)
    return obj_to_detail(obj)


@router.delete("/{object_id}", status_code=204)
async def delete_object(
    object_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """Löscht ein Objekt. Nur Admins dürfen das."""
    result = await db.execute(select(Object).where(Object.id == object_id))
    obj = result.scalar_one_or_none()
    if obj is None:
        raise HTTPException(status_code=404, detail="Object not found")
    await db.delete(obj)
    await db.commit()