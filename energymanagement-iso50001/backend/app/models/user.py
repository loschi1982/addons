"""
user.py – Benutzer, Sessions und Audit-Log.

Das Benutzersystem ist unabhängig von Home Assistant, damit auch
externe Personen (Auditoren, Berater) Zugang bekommen können,
ohne einen HA-Account zu benötigen.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class User(Base, UUIDMixin, TimestampMixin):
    """
    Ein Benutzer des Energy Management Systems.

    Jeder Benutzer hat eine Rolle (z.B. Administrator, Techniker),
    die bestimmt, welche Module und Aktionen er verwenden darf.
    """
    __tablename__ = "users"

    username: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(255))
    password_hash: Mapped[str] = mapped_column(String(255))

    # Zuordnung zur Rolle (bestimmt Berechtigungen)
    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roles.id"))

    # Account-Status
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)

    # Einstellungen
    language: Mapped[str] = mapped_column(String(5), default="de")

    # Standort-Einschränkung: Wenn gesetzt, sieht der Benutzer nur
    # Daten der angegebenen Standorte. None = alle Standorte sichtbar.
    allowed_locations: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Wer hat diesen Benutzer erstellt?
    created_by: Mapped[uuid.UUID | None] = mapped_column(nullable=True)

    # Beziehungen
    role = relationship("Role", back_populates="users")
    permission_overrides = relationship("UserPermissionOverride", back_populates="user")
    sessions = relationship("UserSession", back_populates="user", cascade="all, delete-orphan")


class UserSession(Base, UUIDMixin):
    """
    Eine aktive Login-Session eines Benutzers.

    Jeder Login erzeugt eine Session. Der Refresh-Token wird als
    Hash gespeichert (nicht im Klartext), damit er bei einem
    Datenbank-Leak nicht missbraucht werden kann.
    """
    __tablename__ = "user_sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    token_hash: Mapped[str] = mapped_column(String(255))
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    is_revoked: Mapped[bool] = mapped_column(Boolean, default=False)

    user = relationship("User", back_populates="sessions")


class AuditLog(Base, UUIDMixin):
    """
    Protokoll aller sicherheitsrelevanten Aktionen.

    Jeder Login, jede Änderung an Benutzern oder Berechtigungen,
    jeder fehlgeschlagene Zugriffsversuch wird hier festgehalten.
    Das ist wichtig für ISO 50001 (Nachvollziehbarkeit) und Sicherheit.
    """
    __tablename__ = "audit_logs"

    user_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    action: Mapped[str] = mapped_column(String(100))
    resource_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    resource_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
