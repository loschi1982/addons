# Separater Router für Objekttypen.
# Laut API-Vertrag liegen die Objekttyp-Endpunkte unter /api/object-types,
# nicht unter /api/objects. Daher ein eigener Router.

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.database import get_db
from backend.auth import require_any_role, require_admin
from backend.models.object import ObjectType
from backend.schemas.object import ObjectType as ObjectTypeSchema, ObjectTypeCreate

router = APIRouter()


@router.get("", response_model=list[ObjectTypeSchema])
async def list_object_types(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_any_role()),
):
    """Gibt alle konfigurierten Objekttypen zurück."""
    result = await db.execute(select(ObjectType))
    types = result.scalars().all()
    return [
        ObjectTypeSchema(id=t.id, name=t.name, visible_to_roles=t.visible_to_roles)
        for t in types
    ]


@router.post("", response_model=ObjectTypeSchema, status_code=201)
async def create_object_type(
    body: ObjectTypeCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """Legt einen neuen Objekttyp an. Nur Admins."""
    ot = ObjectType(name=body.name)
    ot.visible_to_roles = body.visible_to_roles
    db.add(ot)
    await db.commit()
    await db.refresh(ot)
    return ObjectTypeSchema(id=ot.id, name=ot.name, visible_to_roles=ot.visible_to_roles)


@router.put("/{type_id}", response_model=ObjectTypeSchema)
async def update_object_type(
    type_id: int,
    body: ObjectTypeCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """Bearbeitet einen Objekttyp. Nur Admins."""
    result = await db.execute(select(ObjectType).where(ObjectType.id == type_id))
    ot = result.scalar_one_or_none()
    if ot is None:
        raise HTTPException(status_code=404, detail="ObjectType not found")
    ot.name = body.name
    ot.visible_to_roles = body.visible_to_roles
    await db.commit()
    await db.refresh(ot)
    return ObjectTypeSchema(id=ot.id, name=ot.name, visible_to_roles=ot.visible_to_roles)


@router.delete("/{type_id}", status_code=204)
async def delete_object_type(
    type_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """Löscht einen Objekttyp. Nur Admins."""
    result = await db.execute(select(ObjectType).where(ObjectType.id == type_id))
    ot = result.scalar_one_or_none()
    if ot is None:
        raise HTTPException(status_code=404, detail="ObjectType not found")
    await db.delete(ot)
    await db.commit()