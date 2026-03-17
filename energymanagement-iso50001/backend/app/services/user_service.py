"""
user_service.py – Benutzerverwaltung.

CRUD-Operationen für Benutzer und Rollen, einschließlich
Berechtigungsprüfung und Account-Management.
"""

import uuid

import structlog
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import UserNotFoundException
from app.core.security import hash_password
from app.models.role import (
    Permission,
    Role,
    RolePermission,
    UserPermissionOverride,
)
from app.models.user import AuditLog, User

logger = structlog.get_logger()


class UserService:
    """Service für Benutzer-CRUD."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_users(
        self,
        page: int = 1,
        page_size: int = 25,
        search: str | None = None,
        role_id: uuid.UUID | None = None,
        is_active: bool | None = None,
    ) -> dict:
        """
        Benutzer auflisten mit Filtern und Pagination.

        Returns:
            Dict mit items, total, page, page_size
        """
        query = select(User)

        # Filter anwenden
        if search:
            pattern = f"%{search}%"
            query = query.where(
                or_(
                    User.username.ilike(pattern),
                    User.email.ilike(pattern),
                    User.display_name.ilike(pattern),
                )
            )
        if role_id:
            query = query.where(User.role_id == role_id)
        if is_active is not None:
            query = query.where(User.is_active == is_active)

        # Gesamtanzahl ermitteln
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.db.execute(count_query)).scalar() or 0

        # Pagination
        offset = (page - 1) * page_size
        query = query.offset(offset).limit(page_size).order_by(User.username)

        result = await self.db.execute(query)
        users = result.scalars().all()

        # Rollennamen laden
        items = []
        for user in users:
            role = await self.db.get(Role, user.role_id)
            items.append({
                "user": user,
                "role_name": role.name if role else None,
            })

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    async def create_user(
        self, data: dict, created_by: uuid.UUID | None = None
    ) -> User:
        """
        Neuen Benutzer anlegen.

        Args:
            data: Dict mit username, email, password, role_id, etc.
            created_by: ID des anlegenden Benutzers

        Returns:
            Das angelegte User-Objekt
        """
        # Prüfen ob Username oder Email bereits existieren
        existing = await self.db.execute(
            select(User).where(
                or_(
                    User.username == data["username"],
                    User.email == data["email"],
                )
            )
        )
        if existing.scalar_one_or_none():
            from app.core.exceptions import EnergyManagementError
            raise EnergyManagementError(
                "Benutzername oder E-Mail bereits vergeben",
                error_code="USER_EXISTS",
                status_code=409,
            )

        # Rolle prüfen
        role = await self.db.get(Role, data["role_id"])
        if not role:
            from app.core.exceptions import EnergyManagementError
            raise EnergyManagementError(
                "Rolle nicht gefunden",
                error_code="ROLE_NOT_FOUND",
                status_code=404,
            )

        user = User(
            username=data["username"],
            email=data["email"],
            display_name=data.get("display_name", data["username"]),
            password_hash=hash_password(data["password"]),
            role_id=data["role_id"],
            language=data.get("language", "de"),
            allowed_locations=data.get("allowed_locations"),
            must_change_password=data.get("must_change_password", True),
            created_by=created_by,
        )
        self.db.add(user)
        await self.db.flush()

        # Audit-Log
        self.db.add(AuditLog(
            user_id=created_by,
            action="user_created",
            resource_type="user",
            resource_id=user.id,
            details={"username": user.username, "role": role.name},
        ))

        await self.db.commit()

        logger.info(
            "user_created",
            user_id=str(user.id),
            username=user.username,
        )
        return user

    async def get_user(self, user_id: uuid.UUID) -> User:
        """Einzelnen Benutzer laden."""
        user = await self.db.get(User, user_id)
        if not user:
            raise UserNotFoundException(str(user_id))
        return user

    async def update_user(
        self, user_id: uuid.UUID, data: dict, updated_by: uuid.UUID | None = None
    ) -> User:
        """
        Benutzer aktualisieren.

        Nur übergebene Felder werden geändert.
        """
        user = await self.db.get(User, user_id)
        if not user:
            raise UserNotFoundException(str(user_id))

        changes = {}
        for field in ["email", "display_name", "language", "role_id",
                       "is_active", "allowed_locations"]:
            if field in data and data[field] is not None:
                old_val = getattr(user, field)
                setattr(user, field, data[field])
                changes[field] = {"old": str(old_val), "new": str(data[field])}

        if changes:
            self.db.add(AuditLog(
                user_id=updated_by,
                action="user_updated",
                resource_type="user",
                resource_id=user.id,
                details={"changes": changes},
            ))

        await self.db.commit()
        return user

    async def delete_user(
        self, user_id: uuid.UUID, deleted_by: uuid.UUID | None = None
    ) -> None:
        """Benutzer deaktivieren (Soft-Delete)."""
        user = await self.db.get(User, user_id)
        if not user:
            raise UserNotFoundException(str(user_id))

        user.is_active = False

        self.db.add(AuditLog(
            user_id=deleted_by,
            action="user_deleted",
            resource_type="user",
            resource_id=user.id,
            details={"username": user.username},
        ))

        await self.db.commit()
        logger.info("user_deleted", user_id=str(user_id))

    async def unlock_user(
        self, user_id: uuid.UUID, unlocked_by: uuid.UUID | None = None
    ) -> None:
        """Gesperrten Benutzer entsperren."""
        user = await self.db.get(User, user_id)
        if not user:
            raise UserNotFoundException(str(user_id))

        user.is_locked = False
        user.failed_login_attempts = 0

        self.db.add(AuditLog(
            user_id=unlocked_by,
            action="user_unlocked",
            resource_type="user",
            resource_id=user.id,
        ))

        await self.db.commit()
        logger.info("user_unlocked", user_id=str(user_id))

    # ── Rollen-Verwaltung ──

    async def list_roles(self) -> list[Role]:
        """Alle aktiven Rollen laden."""
        result = await self.db.execute(
            select(Role)
            .where(Role.is_active == True)  # noqa: E712
            .order_by(Role.name)
        )
        return list(result.scalars().all())

    async def get_role_with_permissions(self, role_id: uuid.UUID) -> Role:
        """Rolle mit allen Berechtigungen laden."""
        result = await self.db.execute(
            select(Role)
            .options(selectinload(Role.permissions).selectinload(RolePermission.permission))
            .where(Role.id == role_id)
        )
        role = result.scalar_one_or_none()
        if not role:
            from app.core.exceptions import EnergyManagementError
            raise EnergyManagementError(
                "Rolle nicht gefunden",
                error_code="ROLE_NOT_FOUND",
                status_code=404,
            )
        return role

    async def create_role(self, data: dict) -> Role:
        """Neue Rolle mit Berechtigungen anlegen."""
        role = Role(
            name=data["name"],
            display_name=data["display_name"],
            description=data.get("description"),
        )
        self.db.add(role)
        await self.db.flush()

        # Berechtigungen zuordnen
        for perm_id in data.get("permission_ids", []):
            rp = RolePermission(role_id=role.id, permission_id=perm_id)
            self.db.add(rp)

        await self.db.commit()
        return role

    async def update_role(self, role_id: uuid.UUID, data: dict) -> Role:
        """Rolle aktualisieren."""
        role = await self.db.get(Role, role_id)
        if not role:
            from app.core.exceptions import EnergyManagementError
            raise EnergyManagementError(
                "Rolle nicht gefunden",
                error_code="ROLE_NOT_FOUND",
                status_code=404,
            )

        if role.is_system_role and "name" in data:
            from app.core.exceptions import EnergyManagementError
            raise EnergyManagementError(
                "Systemrollen können nicht umbenannt werden",
                error_code="SYSTEM_ROLE_PROTECTED",
                status_code=403,
            )

        for field in ["display_name", "description"]:
            if field in data and data[field] is not None:
                setattr(role, field, data[field])

        # Berechtigungen aktualisieren (wenn übergeben)
        if "permission_ids" in data and data["permission_ids"] is not None:
            # Alte Zuordnungen löschen
            result = await self.db.execute(
                select(RolePermission).where(RolePermission.role_id == role_id)
            )
            for rp in result.scalars().all():
                await self.db.delete(rp)

            # Neue Zuordnungen anlegen
            for perm_id in data["permission_ids"]:
                rp = RolePermission(role_id=role.id, permission_id=perm_id)
                self.db.add(rp)

        await self.db.commit()
        return role

    async def list_permissions(self) -> list[Permission]:
        """Alle verfügbaren Berechtigungen laden."""
        result = await self.db.execute(
            select(Permission).order_by(Permission.module, Permission.action)
        )
        return list(result.scalars().all())

    # ── Permission Overrides ──

    async def add_permission_override(
        self,
        user_id: uuid.UUID,
        permission_id: uuid.UUID,
        override_type: str,
        reason: str | None,
        granted_by: uuid.UUID,
    ) -> UserPermissionOverride:
        """Berechtigungs-Override für einen Benutzer hinzufügen."""
        override = UserPermissionOverride(
            user_id=user_id,
            permission_id=permission_id,
            override_type=override_type.upper(),
            reason=reason,
            granted_by=granted_by,
        )
        self.db.add(override)

        self.db.add(AuditLog(
            user_id=granted_by,
            action="permission_override_added",
            resource_type="user",
            resource_id=user_id,
            details={
                "permission_id": str(permission_id),
                "override_type": override_type,
            },
        ))

        await self.db.commit()
        return override

    async def remove_permission_override(
        self, override_id: uuid.UUID, removed_by: uuid.UUID
    ) -> None:
        """Berechtigungs-Override entfernen."""
        override = await self.db.get(UserPermissionOverride, override_id)
        if override:
            self.db.add(AuditLog(
                user_id=removed_by,
                action="permission_override_removed",
                resource_type="user",
                resource_id=override.user_id,
                details={"override_id": str(override_id)},
            ))
            await self.db.delete(override)
            await self.db.commit()
