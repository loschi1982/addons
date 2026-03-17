"""
user_service.py – Benutzerverwaltung.

CRUD-Operationen für Benutzer und Rollen, einschließlich
Berechtigungsprüfung und Account-Management.
"""

import uuid

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.models.user import User

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
        """Benutzer auflisten mit Filtern und Pagination."""
        # TODO: Implementierung
        raise NotImplementedError

    async def create_user(self, data: dict) -> User:
        """Neuen Benutzer anlegen."""
        # TODO: Implementierung
        raise NotImplementedError

    async def get_user(self, user_id: uuid.UUID) -> User:
        """Einzelnen Benutzer laden."""
        # TODO: Implementierung
        raise NotImplementedError

    async def update_user(self, user_id: uuid.UUID, data: dict) -> User:
        """Benutzer aktualisieren."""
        # TODO: Implementierung
        raise NotImplementedError

    async def delete_user(self, user_id: uuid.UUID) -> None:
        """Benutzer deaktivieren (Soft-Delete)."""
        # TODO: Implementierung
        raise NotImplementedError

    async def unlock_user(self, user_id: uuid.UUID) -> None:
        """Gesperrten Benutzer entsperren."""
        # TODO: Implementierung
        raise NotImplementedError
