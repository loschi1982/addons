# Router für Benutzerverwaltung. Alle Endpunkte nur für Admins.

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.database import get_db
from backend.auth import require_admin, hash_pin
from backend.models.user import User
from backend.schemas.user import UserSummary, UserCreate

router = APIRouter()


@router.get("", response_model=list[UserSummary])
async def list_users(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """Gibt alle Benutzer zurück (ohne PIN-Hashes). Nur Admins."""
    result = await db.execute(select(User))
    users = result.scalars().all()
    return [UserSummary(id=u.id, username=u.username, role=u.role) for u in users]


@router.post("", response_model=UserSummary, status_code=201)
async def create_user(
    body: UserCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """Legt einen neuen Benutzer an. Der PIN wird gehasht gespeichert."""
    # Prüfen ob der Benutzername bereits vergeben ist.
    existing = await db.execute(select(User).where(User.username == body.username))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="Username already exists")

    user = User(
        username=body.username,
        pin_hash=hash_pin(body.pin),
        role=body.role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return UserSummary(id=user.id, username=user.username, role=user.role)


@router.put("/{user_id}", response_model=UserSummary)
async def update_user(
    user_id: int,
    body: UserCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """Bearbeitet einen Benutzer. Ein neuer PIN wird automatisch neu gehasht."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    user.username = body.username
    user.pin_hash = hash_pin(body.pin)
    user.role = body.role

    await db.commit()
    await db.refresh(user)
    return UserSummary(id=user.id, username=user.username, role=user.role)


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """Löscht einen Benutzer. Nur Admins."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    await db.delete(user)
    await db.commit()