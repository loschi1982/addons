"""
role.py – Rollen, Berechtigungen und Overrides.

Das Berechtigungsmodell funktioniert zweistufig:
1. Jeder Benutzer hat eine Rolle (z.B. "Techniker")
2. Jede Rolle hat einen Satz Berechtigungen (z.B. "meters.view", "meters.create")
3. Optional: Einzelne Berechtigungen können pro Benutzer erweitert oder
   eingeschränkt werden (Overrides), ohne die Rolle zu ändern.
"""

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import UUIDMixin


class Role(Base, UUIDMixin):
    """
    Eine Benutzerrolle wie z.B. Administrator, Energiemanager, Viewer.

    Systemrollen (is_system_role=True) können nicht gelöscht werden,
    damit immer mindestens eine Admin-Rolle existiert.
    """
    __tablename__ = "roles"

    name: Mapped[str] = mapped_column(String(100), unique=True)
    display_name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_system_role: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    permissions = relationship("RolePermission", back_populates="role", cascade="all, delete-orphan")
    users = relationship("User", back_populates="role")


class Permission(Base, UUIDMixin):
    """
    Eine einzelne Berechtigung wie z.B. "meters.create".

    Berechtigungen werden bei der Installation als Seed-Daten geladen.
    Sie definieren, WAS im System möglich ist – die Zuordnung zu Rollen
    bestimmt dann, WER es tun darf.
    """
    __tablename__ = "permissions"

    module: Mapped[str] = mapped_column(String(100))
    action: Mapped[str] = mapped_column(String(50))
    resource_scope: Mapped[str] = mapped_column(String(50), default="all")
    description: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(100))


class RolePermission(Base, UUIDMixin):
    """Verknüpfung: Welche Berechtigungen hat welche Rolle?"""
    __tablename__ = "role_permissions"

    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roles.id"))
    permission_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("permissions.id"))

    role = relationship("Role", back_populates="permissions")
    permission = relationship("Permission")


class UserPermissionOverride(Base, UUIDMixin):
    """
    Benutzer-spezifische Ausnahmen von den Rollen-Berechtigungen.

    Beispiel: Ein Techniker darf normalerweise keine Berichte erstellen.
    Über einen GRANT-Override kann ihm diese Berechtigung temporär
    gegeben werden (z.B. für ein Projekt), ohne seine Rolle zu ändern.

    override_type:
    - GRANT: Berechtigung zusätzlich erteilen
    - DENY: Berechtigung entziehen (überschreibt Rolle)
    """
    __tablename__ = "user_permission_overrides"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    permission_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("permissions.id"))
    override_type: Mapped[str] = mapped_column(String(10))  # GRANT oder DENY
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    granted_by: Mapped[uuid.UUID] = mapped_column()
    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    user = relationship("User", back_populates="permission_overrides")
    permission = relationship("Permission")
