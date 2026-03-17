"""
users.py – Benutzerverwaltungs-Endpunkte.

CRUD für Benutzer und Rollen. Nur Admins dürfen Benutzer
anlegen, ändern oder löschen.
"""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.user import User
from app.schemas.auth import (
    RoleCreate,
    RoleResponse,
    RoleUpdate,
    UserCreate,
    UserResponse,
    UserUpdate,
)
from app.schemas.common import DeleteResponse, MessageResponse, PaginatedResponse

router = APIRouter()


# ---------------------------------------------------------------------------
# Benutzer-CRUD
# ---------------------------------------------------------------------------

@router.get("", response_model=PaginatedResponse[UserResponse])
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    search: str | None = None,
    role_id: uuid.UUID | None = None,
    is_active: bool | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle Benutzer auflisten (mit Filter und Pagination)."""
    # TODO: UserService.list_users() aufrufen
    raise NotImplementedError("UserService noch nicht implementiert")


@router.post("", response_model=UserResponse, status_code=201)
async def create_user(
    request: UserCreate,
    current_user: User = Depends(require_permission("users", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Neuen Benutzer anlegen."""
    # TODO: UserService.create_user() aufrufen
    raise NotImplementedError("UserService noch nicht implementiert")


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Einzelnen Benutzer abrufen."""
    # TODO: UserService.get_user() aufrufen
    raise NotImplementedError("UserService noch nicht implementiert")


@router.put("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: uuid.UUID,
    request: UserUpdate,
    current_user: User = Depends(require_permission("users", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Benutzer aktualisieren."""
    # TODO: UserService.update_user() aufrufen
    raise NotImplementedError("UserService noch nicht implementiert")


@router.delete("/{user_id}", response_model=DeleteResponse)
async def delete_user(
    user_id: uuid.UUID,
    current_user: User = Depends(require_permission("users", "delete")),
    db: AsyncSession = Depends(get_db),
):
    """Benutzer deaktivieren (Soft-Delete)."""
    # TODO: UserService.delete_user() aufrufen
    raise NotImplementedError("UserService noch nicht implementiert")


@router.post("/{user_id}/unlock", response_model=MessageResponse)
async def unlock_user(
    user_id: uuid.UUID,
    current_user: User = Depends(require_permission("users", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Gesperrten Benutzer entsperren."""
    # TODO: UserService.unlock_user() aufrufen
    raise NotImplementedError("UserService noch nicht implementiert")


# ---------------------------------------------------------------------------
# Rollen-CRUD
# ---------------------------------------------------------------------------

@router.get("/roles", response_model=list[RoleResponse])
async def list_roles(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle Rollen auflisten."""
    # TODO: RoleService.list_roles() aufrufen
    raise NotImplementedError("RoleService noch nicht implementiert")


@router.post("/roles", response_model=RoleResponse, status_code=201)
async def create_role(
    request: RoleCreate,
    current_user: User = Depends(require_permission("users", "manage_roles")),
    db: AsyncSession = Depends(get_db),
):
    """Neue Rolle anlegen."""
    # TODO: RoleService.create_role() aufrufen
    raise NotImplementedError("RoleService noch nicht implementiert")


@router.put("/roles/{role_id}", response_model=RoleResponse)
async def update_role(
    role_id: uuid.UUID,
    request: RoleUpdate,
    current_user: User = Depends(require_permission("users", "manage_roles")),
    db: AsyncSession = Depends(get_db),
):
    """Rolle aktualisieren."""
    # TODO: RoleService.update_role() aufrufen
    raise NotImplementedError("RoleService noch nicht implementiert")
