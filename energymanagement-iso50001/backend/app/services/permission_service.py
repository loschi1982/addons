"""
permission_service.py – Berechtigungsprüfung.

Prüft ob ein Benutzer eine bestimmte Aktion auf einer Ressource
ausführen darf. Berücksichtigt Rolle, Berechtigungen und
benutzerspezifische Overrides.

Prüfreihenfolge (DENY gewinnt immer):
1. User-Override DENY → sofort abgelehnt
2. User-Override GRANT → sofort erlaubt
3. Rollen-Berechtigung → erlaubt wenn vorhanden
4. Sonst → abgelehnt
"""

import uuid
from datetime import date

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.role import Permission, RolePermission, UserPermissionOverride
from app.models.user import User

logger = structlog.get_logger()


class PermissionService:
    """Service für Berechtigungsprüfung."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def check(
        self, user: User, module: str, action: str
    ) -> bool:
        """
        Prüft ob der Benutzer die Berechtigung hat.

        Wird von der require_permission-Dependency aufgerufen.

        Prüfreihenfolge:
        1. User-Override DENY → sofort abgelehnt
        2. User-Override GRANT → sofort erlaubt
        3. Rollen-Berechtigung → erlaubt wenn vorhanden
        4. Sonst → abgelehnt

        Args:
            user: Der Benutzer-Datensatz
            module: Das Modul (z.B. "meters", "readings")
            action: Die Aktion (z.B. "view", "create", "edit", "delete")

        Returns:
            True wenn erlaubt, False wenn nicht
        """
        # Permission-Objekt für module.action laden
        perm = await self._get_permission(module, action)
        if perm is None:
            # Unbekannte Berechtigung → standardmäßig verweigern
            logger.warning(
                "permission_unknown",
                module=module,
                action=action,
                user_id=str(user.id),
            )
            return False

        # 1. + 2. Overrides prüfen (zeitlich gültige)
        override_result = await self._check_overrides(user.id, perm.id)
        if override_result is not None:
            return override_result

        # 3. Rollen-Berechtigung prüfen
        return await self._check_role_permission(user.role_id, perm.id)

    async def has_permission(
        self, user: User, module: str, action: str
    ) -> bool:
        """Alias für check() – Rückwärtskompatibilität."""
        return await self.check(user, module, action)

    async def get_user_permissions(self, user_id: uuid.UUID) -> list[str]:
        """
        Alle effektiven Berechtigungen eines Benutzers als Strings.

        Kombiniert Rollen-Berechtigungen mit Overrides:
        - GRANT-Overrides fügen Berechtigungen hinzu
        - DENY-Overrides entfernen Berechtigungen

        Returns:
            Liste von Strings wie ["meters.view", "meters.create", ...]
        """
        # Benutzer mit Rolle laden
        result = await self.db.execute(
            select(User).where(User.id == user_id)
        )
        user = result.scalar_one_or_none()
        if not user:
            return []

        # Rollen-Berechtigungen laden
        role_perms = await self.db.execute(
            select(Permission)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(RolePermission.role_id == user.role_id)
        )
        perm_set = {
            f"{p.module}.{p.action}": p.id
            for p in role_perms.scalars().all()
        }

        # Aktive Overrides laden
        today = date.today()
        overrides = await self.db.execute(
            select(UserPermissionOverride)
            .options(selectinload(UserPermissionOverride.permission))
            .where(
                UserPermissionOverride.user_id == user_id,
            )
        )

        for ovr in overrides.scalars().all():
            # Zeitliche Gültigkeit prüfen
            if not self._is_override_active(ovr, today):
                continue

            perm_key = f"{ovr.permission.module}.{ovr.permission.action}"
            if ovr.override_type == "DENY":
                perm_set.pop(perm_key, None)
            elif ovr.override_type == "GRANT":
                perm_set[perm_key] = ovr.permission_id

        return sorted(perm_set.keys())

    # ── Interne Hilfsmethoden ──

    async def _get_permission(self, module: str, action: str) -> Permission | None:
        """Permission-Objekt für module.action aus der DB laden."""
        result = await self.db.execute(
            select(Permission).where(
                Permission.module == module,
                Permission.action == action,
            )
        )
        return result.scalar_one_or_none()

    async def _check_overrides(
        self, user_id: uuid.UUID, permission_id: uuid.UUID
    ) -> bool | None:
        """
        Prüft benutzerspezifische Overrides.

        Returns:
            True  → GRANT-Override aktiv (sofort erlauben)
            False → DENY-Override aktiv (sofort verweigern)
            None  → Kein aktiver Override (weiter mit Rollen-Prüfung)
        """
        today = date.today()

        result = await self.db.execute(
            select(UserPermissionOverride).where(
                UserPermissionOverride.user_id == user_id,
                UserPermissionOverride.permission_id == permission_id,
            )
        )
        overrides = result.scalars().all()

        has_grant = False
        for ovr in overrides:
            if not self._is_override_active(ovr, today):
                continue

            # DENY hat immer Vorrang
            if ovr.override_type == "DENY":
                logger.debug(
                    "permission_denied_by_override",
                    user_id=str(user_id),
                    permission_id=str(permission_id),
                )
                return False
            elif ovr.override_type == "GRANT":
                has_grant = True

        if has_grant:
            return True

        return None

    async def _check_role_permission(
        self, role_id: uuid.UUID, permission_id: uuid.UUID
    ) -> bool:
        """Prüft ob die Rolle die Berechtigung hat."""
        result = await self.db.execute(
            select(RolePermission).where(
                RolePermission.role_id == role_id,
                RolePermission.permission_id == permission_id,
            )
        )
        return result.scalar_one_or_none() is not None

    @staticmethod
    def _is_override_active(ovr: UserPermissionOverride, today: date) -> bool:
        """Prüft ob ein Override zeitlich gültig ist."""
        if ovr.valid_from and today < ovr.valid_from:
            return False
        if ovr.valid_to and today > ovr.valid_to:
            return False
        return True
