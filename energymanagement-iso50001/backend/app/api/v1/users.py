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
    PermissionResponse,
    RoleCreate,
    RoleResponse,
    RoleUpdate,
    UserCreate,
    UserPermissionOverrideCreate,
    UserPermissionOverrideResponse,
    UserResponse,
    UserUpdate,
)
from app.schemas.common import DeleteResponse, MessageResponse, PaginatedResponse
from app.services.user_service import UserService

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
    service = UserService(db)
    result = await service.list_users(
        page=page,
        page_size=page_size,
        search=search,
        role_id=role_id,
        is_active=is_active,
    )

    items = []
    for item in result["items"]:
        user = item["user"]
        items.append(UserResponse(
            id=user.id,
            username=user.username,
            email=user.email,
            display_name=user.display_name,
            language=user.language,
            role_id=user.role_id,
            role_name=item["role_name"],
            is_active=user.is_active,
            is_locked=user.is_locked,
            must_change_password=user.must_change_password,
            allowed_locations=user.allowed_locations,
            created_at=user.created_at,
            last_login=user.last_login,
        ))

    total = result["total"]
    return PaginatedResponse(
        items=items,
        total=total,
        page=result["page"],
        page_size=result["page_size"],
        total_pages=(total + page_size - 1) // page_size if total > 0 else 0,
    )


@router.post("", response_model=UserResponse, status_code=201)
async def create_user(
    request: UserCreate,
    current_user: User = require_permission("users", "create"),
    db: AsyncSession = Depends(get_db),
):
    """Neuen Benutzer anlegen."""
    service = UserService(db)
    user = await service.create_user(
        data=request.model_dump(),
        created_by=current_user.id,
    )
    role = await service.get_role_with_permissions(user.role_id)
    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        display_name=user.display_name,
        language=user.language,
        role_id=user.role_id,
        role_name=role.name,
        is_active=user.is_active,
        is_locked=user.is_locked,
        must_change_password=user.must_change_password,
        allowed_locations=user.allowed_locations,
        created_at=user.created_at,
        last_login=user.last_login,
    )


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Einzelnen Benutzer abrufen."""
    service = UserService(db)
    user = await service.get_user(user_id)
    from app.models.role import Role
    role = await db.get(Role, user.role_id)
    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        display_name=user.display_name,
        language=user.language,
        role_id=user.role_id,
        role_name=role.name if role else None,
        is_active=user.is_active,
        is_locked=user.is_locked,
        must_change_password=user.must_change_password,
        allowed_locations=user.allowed_locations,
        created_at=user.created_at,
        last_login=user.last_login,
    )


@router.put("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: uuid.UUID,
    request: UserUpdate,
    current_user: User = require_permission("users", "update"),
    db: AsyncSession = Depends(get_db),
):
    """Benutzer aktualisieren."""
    service = UserService(db)
    user = await service.update_user(
        user_id,
        data=request.model_dump(exclude_unset=True),
        updated_by=current_user.id,
    )
    from app.models.role import Role
    role = await db.get(Role, user.role_id)
    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        display_name=user.display_name,
        language=user.language,
        role_id=user.role_id,
        role_name=role.name if role else None,
        is_active=user.is_active,
        is_locked=user.is_locked,
        must_change_password=user.must_change_password,
        allowed_locations=user.allowed_locations,
        created_at=user.created_at,
        last_login=user.last_login,
    )


@router.delete("/{user_id}", response_model=DeleteResponse)
async def delete_user(
    user_id: uuid.UUID,
    current_user: User = require_permission("users", "delete"),
    db: AsyncSession = Depends(get_db),
):
    """Benutzer deaktivieren (Soft-Delete)."""
    service = UserService(db)
    await service.delete_user(user_id, deleted_by=current_user.id)
    return DeleteResponse(id=user_id)


@router.post("/{user_id}/unlock", response_model=MessageResponse)
async def unlock_user(
    user_id: uuid.UUID,
    current_user: User = require_permission("users", "update"),
    db: AsyncSession = Depends(get_db),
):
    """Gesperrten Benutzer entsperren."""
    service = UserService(db)
    await service.unlock_user(user_id, unlocked_by=current_user.id)
    return MessageResponse(message="Benutzer erfolgreich entsperrt")


# ---------------------------------------------------------------------------
# Berechtigungs-Overrides
# ---------------------------------------------------------------------------

@router.post(
    "/{user_id}/overrides",
    response_model=UserPermissionOverrideResponse,
    status_code=201,
)
async def add_permission_override(
    user_id: uuid.UUID,
    request: UserPermissionOverrideCreate,
    current_user: User = require_permission("users", "manage_roles"),
    db: AsyncSession = Depends(get_db),
):
    """Berechtigungs-Override für einen Benutzer hinzufügen."""
    service = UserService(db)
    override = await service.add_permission_override(
        user_id=user_id,
        permission_id=request.permission_id,
        override_type=request.override_type,
        reason=request.reason,
        granted_by=current_user.id,
    )
    return UserPermissionOverrideResponse(
        id=override.id,
        user_id=override.user_id,
        permission_id=override.permission_id,
        override_type=override.override_type,
        reason=override.reason,
        granted_by=override.granted_by,
    )


@router.delete("/{user_id}/overrides/{override_id}", response_model=MessageResponse)
async def remove_permission_override(
    user_id: uuid.UUID,
    override_id: uuid.UUID,
    current_user: User = require_permission("users", "manage_roles"),
    db: AsyncSession = Depends(get_db),
):
    """Berechtigungs-Override entfernen."""
    service = UserService(db)
    await service.remove_permission_override(override_id, removed_by=current_user.id)
    return MessageResponse(message="Override entfernt")


# ---------------------------------------------------------------------------
# Rollen-CRUD
# ---------------------------------------------------------------------------

@router.get("/roles/list", response_model=list[RoleResponse])
async def list_roles(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle Rollen auflisten."""
    service = UserService(db)
    roles = await service.list_roles()
    return [
        RoleResponse(
            id=role.id,
            name=role.name,
            display_name=role.display_name,
            description=role.description,
            is_system_role=role.is_system_role,
        )
        for role in roles
    ]


@router.get("/roles/permissions", response_model=list[PermissionResponse])
async def list_permissions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle verfügbaren Berechtigungen auflisten."""
    service = UserService(db)
    perms = await service.list_permissions()
    return [
        PermissionResponse(
            id=p.id,
            module=p.module,
            action=p.action,
            resource_scope=p.resource_scope,
            category=p.category,
        )
        for p in perms
    ]


@router.post("/roles", response_model=RoleResponse, status_code=201)
async def create_role(
    request: RoleCreate,
    current_user: User = require_permission("users", "manage_roles"),
    db: AsyncSession = Depends(get_db),
):
    """Neue Rolle anlegen."""
    service = UserService(db)
    role = await service.create_role(request.model_dump())
    return RoleResponse(
        id=role.id,
        name=role.name,
        display_name=role.display_name,
        description=role.description,
        is_system_role=role.is_system_role,
    )


@router.put("/roles/{role_id}", response_model=RoleResponse)
async def update_role(
    role_id: uuid.UUID,
    request: RoleUpdate,
    current_user: User = require_permission("users", "manage_roles"),
    db: AsyncSession = Depends(get_db),
):
    """Rolle aktualisieren."""
    service = UserService(db)
    role = await service.update_role(role_id, request.model_dump(exclude_unset=True))
    return RoleResponse(
        id=role.id,
        name=role.name,
        display_name=role.display_name,
        description=role.description,
        is_system_role=role.is_system_role,
    )
