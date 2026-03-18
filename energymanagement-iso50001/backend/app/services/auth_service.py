"""
auth_service.py – Authentifizierungs-Logik.

Kümmert sich um Login, Token-Erstellung, Session-Verwaltung,
Passwortänderung und Account-Sperrung nach fehlgeschlagenen
Login-Versuchen.

Sicherheitsregeln:
- Nach 5 fehlgeschlagenen Login-Versuchen wird der Account gesperrt
- Refresh-Tokens werden als Hash in der DB gespeichert
- Alle sicherheitsrelevanten Aktionen werden im Audit-Log protokolliert
"""

import hashlib
import uuid
from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.exceptions import AccountLockedError, AuthenticationError
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_password,
    verify_token,
)
from app.models.role import Role
from app.models.user import AuditLog, User, UserSession
from app.services.permission_service import PermissionService

logger = structlog.get_logger()

# Maximale fehlgeschlagene Login-Versuche bevor der Account gesperrt wird
MAX_FAILED_ATTEMPTS = 5

# Automatische Entsperrung nach 30 Minuten
AUTO_UNLOCK_MINUTES = 30


class AuthService:
    """Service für Authentifizierung und Session-Verwaltung."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def login(self, username: str, password: str) -> dict:
        """
        Benutzer einloggen.

        Ablauf:
        1. User per Username laden
        2. Prüfen ob aktiv und nicht gesperrt
        3. Passwort verifizieren
        4. Bei Fehler: failed_login_attempts erhöhen, ggf. sperren
        5. Bei Erfolg: Tokens erstellen, Session speichern, Audit-Log

        Returns:
            Dict mit access_token, refresh_token, token_type, expires_in,
            must_change_password
        """
        # Benutzer suchen
        result = await self.db.execute(
            select(User).where(User.username == username)
        )
        user = result.scalar_one_or_none()

        if user is None:
            await self._log_audit(
                None, "login_failed", "auth",
                details={"reason": "user_not_found", "username": username},
            )
            raise AuthenticationError("Ungültiger Benutzername oder Passwort")

        # Account gesperrt?
        if user.is_locked:
            # Automatische Entsperrung nach 30 Minuten prüfen
            if await self._try_auto_unlock(user):
                logger.info("auto_unlock", user_id=str(user.id))
            else:
                await self._log_audit(
                    user.id, "login_blocked", "auth",
                    details={"reason": "account_locked"},
                )
                raise AccountLockedError()

        # Account deaktiviert?
        if not user.is_active:
            raise AuthenticationError("Benutzerkonto ist deaktiviert")

        # Passwort prüfen
        if not verify_password(password, user.password_hash):
            user.failed_login_attempts += 1

            # Nach MAX_FAILED_ATTEMPTS sperren
            if user.failed_login_attempts >= MAX_FAILED_ATTEMPTS:
                user.is_locked = True
                await self._log_audit(
                    user.id, "account_locked", "auth",
                    details={"failed_attempts": user.failed_login_attempts},
                )
                logger.warning(
                    "account_locked",
                    user_id=str(user.id),
                    attempts=user.failed_login_attempts,
                )

            await self.db.commit()
            await self._log_audit(
                user.id, "login_failed", "auth",
                details={"reason": "wrong_password"},
            )
            raise AuthenticationError("Ungültiger Benutzername oder Passwort")

        # Erfolgreicher Login – Zähler zurücksetzen
        user.failed_login_attempts = 0
        user.last_login = datetime.now(timezone.utc)

        # Rollenname für den Token laden
        role = await self.db.get(Role, user.role_id)
        role_name = role.name if role else "viewer"

        # Tokens erstellen
        settings = get_settings()
        access_token = create_access_token(user.id, role_name)
        refresh_token = create_refresh_token(user.id)

        # Session in der DB speichern (Refresh-Token als Hash)
        session = UserSession(
            user_id=user.id,
            token_hash=self._hash_token(refresh_token),
            expires_at=datetime.now(timezone.utc)
            + timedelta(days=settings.refresh_token_expire_days),
        )
        self.db.add(session)

        await self.db.commit()

        await self._log_audit(user.id, "login_success", "auth")

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "expires_in": settings.access_token_expire_minutes * 60,
            "must_change_password": user.must_change_password,
        }

    async def refresh_token(self, refresh_token: str) -> dict:
        """
        Access-Token mit gültigem Refresh-Token erneuern.

        Prüft ob der Refresh-Token in der DB existiert,
        nicht widerrufen und nicht abgelaufen ist.
        """
        # Token dekodieren
        payload = verify_token(refresh_token)
        if payload is None or payload.get("type") != "refresh":
            raise AuthenticationError("Ungültiger Refresh-Token")

        user_id = uuid.UUID(payload["sub"])

        # Session in der DB suchen (über Token-Hash)
        token_hash = self._hash_token(refresh_token)
        result = await self.db.execute(
            select(UserSession).where(
                UserSession.user_id == user_id,
                UserSession.token_hash == token_hash,
                UserSession.is_revoked == False,  # noqa: E712
            )
        )
        session = result.scalar_one_or_none()

        if session is None:
            raise AuthenticationError("Refresh-Token nicht gültig oder widerrufen")

        if session.expires_at < datetime.now(timezone.utc):
            raise AuthenticationError("Refresh-Token abgelaufen")

        # Benutzer laden
        user = await self.db.get(User, user_id)
        if not user or not user.is_active or user.is_locked:
            raise AuthenticationError("Benutzerkonto nicht verfügbar")

        # Rollenname laden
        role = await self.db.get(Role, user.role_id)
        role_name = role.name if role else "viewer"

        # Neuen Access-Token erstellen
        settings = get_settings()
        new_access_token = create_access_token(user.id, role_name)

        return {
            "access_token": new_access_token,
            "refresh_token": refresh_token,  # Refresh-Token bleibt gleich
            "token_type": "bearer",
            "expires_in": settings.access_token_expire_minutes * 60,
        }

    async def logout(self, user_id: uuid.UUID, token: str | None = None) -> None:
        """
        Session invalidieren.

        Wenn ein Token übergeben wird, wird nur diese Session widerrufen.
        Ohne Token werden alle Sessions des Benutzers widerrufen.
        """
        if token:
            token_hash = self._hash_token(token)
            result = await self.db.execute(
                select(UserSession).where(
                    UserSession.user_id == user_id,
                    UserSession.token_hash == token_hash,
                )
            )
            session = result.scalar_one_or_none()
            if session:
                session.is_revoked = True
        else:
            # Alle Sessions widerrufen
            result = await self.db.execute(
                select(UserSession).where(
                    UserSession.user_id == user_id,
                    UserSession.is_revoked == False,  # noqa: E712
                )
            )
            for session in result.scalars().all():
                session.is_revoked = True

        await self.db.commit()
        await self._log_audit(user_id, "logout", "auth")

    async def change_password(
        self, user_id: uuid.UUID, current_password: str, new_password: str
    ) -> None:
        """
        Passwort ändern – altes Passwort muss stimmen.

        Nach Passwortänderung:
        - must_change_password wird auf False gesetzt
        - password_changed_at wird aktualisiert
        - Alle bestehenden Sessions werden widerrufen
        """
        user = await self.db.get(User, user_id)
        if not user:
            raise AuthenticationError("Benutzer nicht gefunden")

        if not verify_password(current_password, user.password_hash):
            raise AuthenticationError("Aktuelles Passwort ist falsch")

        user.password_hash = hash_password(new_password)
        user.must_change_password = False
        user.password_changed_at = datetime.now(timezone.utc)

        # Alle bestehenden Sessions widerrufen (Benutzer muss sich neu einloggen)
        result = await self.db.execute(
            select(UserSession).where(
                UserSession.user_id == user_id,
                UserSession.is_revoked == False,  # noqa: E712
            )
        )
        for session in result.scalars().all():
            session.is_revoked = True

        await self.db.commit()
        await self._log_audit(user_id, "password_changed", "auth")

    async def setup(self, username: str, email: str, password: str, display_name: str | None = None) -> dict:
        """
        Ersteinrichtung: Ersten Benutzer als Administrator anlegen.

        Funktioniert nur, wenn noch keine Benutzer in der DB existieren.
        Der erste Benutzer bekommt automatisch die Administrator-Rolle.

        Returns:
            Dict mit access_token, refresh_token, token_type, expires_in
        """
        # Prüfen ob bereits Benutzer existieren
        result = await self.db.execute(select(User).limit(1))
        if result.scalar_one_or_none() is not None:
            raise AuthenticationError("Setup bereits abgeschlossen – es existieren bereits Benutzer")

        # Administrator-Rolle suchen
        result = await self.db.execute(
            select(Role).where(Role.name == "admin")
        )
        admin_role = result.scalar_one_or_none()
        if not admin_role:
            raise AuthenticationError("Administrator-Rolle nicht gefunden – Seed-Daten fehlen")

        # Ersten Benutzer anlegen
        user = User(
            username=username,
            email=email,
            display_name=display_name or username,
            password_hash=hash_password(password),
            role_id=admin_role.id,
            is_active=True,
            must_change_password=False,
        )
        self.db.add(user)
        await self.db.flush()

        await self._log_audit(user.id, "setup_complete", "auth", details={"username": username})

        # Direkt einloggen
        settings = get_settings()
        access_token = create_access_token(user.id, admin_role.name)
        refresh_token = create_refresh_token(user.id)

        session = UserSession(
            user_id=user.id,
            token_hash=self._hash_token(refresh_token),
            expires_at=datetime.now(timezone.utc)
            + timedelta(days=settings.refresh_token_expire_days),
        )
        self.db.add(session)

        await self.db.commit()

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "expires_in": settings.access_token_expire_minutes * 60,
        }

    async def get_profile(self, user: User) -> dict:
        """
        Benutzerprofil mit Rolle und Berechtigungen laden.

        Returns:
            Dict mit id, username, email, display_name, language,
            role_name, permissions
        """
        role = await self.db.get(Role, user.role_id)
        perm_service = PermissionService(self.db)
        permissions = await perm_service.get_user_permissions(user.id)

        return {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "display_name": user.display_name,
            "language": user.language,
            "role_name": role.name if role else "unknown",
            "permissions": permissions,
        }

    async def check_setup_required(self) -> bool:
        """Prüft ob die Ersteinrichtung noch aussteht (keine Benutzer vorhanden)."""
        result = await self.db.execute(select(User).limit(1))
        return result.scalar_one_or_none() is None

    # ── Interne Hilfsmethoden ──

    async def _try_auto_unlock(self, user: User) -> bool:
        """
        Prüft ob der Account automatisch entsperrt werden kann.

        Automatische Entsperrung nach AUTO_UNLOCK_MINUTES Minuten
        seit dem letzten fehlgeschlagenen Login-Versuch.
        """
        if not user.is_locked:
            return False

        # updated_at als Referenz für den letzten fehlgeschlagenen Versuch
        if hasattr(user, "updated_at") and user.updated_at:
            locked_since = user.updated_at
        else:
            return False

        unlock_after = locked_since + timedelta(minutes=AUTO_UNLOCK_MINUTES)
        if datetime.now(timezone.utc) >= unlock_after:
            user.is_locked = False
            user.failed_login_attempts = 0
            await self.db.commit()
            return True

        return False

    async def _log_audit(
        self, user_id: uuid.UUID | None, action: str, resource_type: str,
        details: dict | None = None,
    ) -> None:
        """Eintrag im Audit-Log erstellen."""
        log = AuditLog(
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            details=details,
        )
        self.db.add(log)
        # Nicht committen – der Aufrufer ist dafür verantwortlich

    @staticmethod
    def _hash_token(token: str) -> str:
        """
        Erstellt einen SHA-256-Hash des Tokens für die DB-Speicherung.

        Refresh-Tokens werden nie im Klartext gespeichert, damit sie
        bei einem Datenbank-Leak nicht missbraucht werden können.
        """
        return hashlib.sha256(token.encode()).hexdigest()
