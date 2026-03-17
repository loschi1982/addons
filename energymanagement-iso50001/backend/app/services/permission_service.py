"""
permission_service.py – Berechtigungsprüfung.

Prüft ob ein Benutzer eine bestimmte Aktion auf einer Ressource
ausführen darf. Berücksichtigt Rolle, Berechtigungen und
benutzerspezifische Overrides.
"""

import uuid

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.role import Permission, RolePermission, UserPermissionOverride
from app.models.user import User

logger = structlog.get_logger()


class PermissionService:
    """Service für Berechtigungsprüfung."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def has_permission(
        self, user: User, module: str, action: str
    ) -> bool:
        """
        Prüft ob der Benutzer die Berechtigung hat.

        Prüfreihenfolge:
        1. User-Override DENY → sofort abgelehnt
        2. User-Override GRANT → sofort erlaubt
        3. Rollen-Berechtigung → erlaubt wenn vorhanden
        4. Sonst → abgelehnt
        """
        # TODO: Implementierung
        raise NotImplementedError

    async def get_user_permissions(self, user_id: uuid.UUID) -> list[str]:
        """Alle effektiven Berechtigungen eines Benutzers als Strings."""
        # TODO: Implementierung
        raise NotImplementedError
