"""
dependencies.py – FastAPI Dependencies für Authentifizierung und Autorisierung.

Dependencies sind wiederverwendbare Bausteine, die vor der Ausführung
eines API-Endpunkts laufen. Sie prüfen z.B. ob der Benutzer angemeldet
ist und die nötigen Berechtigungen hat.

Verwendung in API-Routen:
    @router.get("/meters")
    async def list_meters(
        current_user: User = Depends(get_current_user),  # Muss angemeldet sein
        db: AsyncSession = Depends(get_db),               # Braucht DB-Zugriff
    ):
        ...

    @router.post("/meters")
    async def create_meter(
        current_user: User = require_permission("meters", "create"),  # Braucht Berechtigung
    ):
        ...
"""

from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import AuthenticationError, PermissionDeniedError
from app.core.security import verify_token

# HTTPBearer: Extrahiert den Token aus dem "Authorization: Bearer <token>" Header
security_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security_scheme),
    db: AsyncSession = Depends(get_db),
):
    """
    Identifiziert den aktuell angemeldeten Benutzer anhand des JWT-Tokens.

    Ablauf:
    1. Token aus dem Authorization-Header extrahieren
    2. Token-Signatur und Ablaufdatum prüfen
    3. Benutzer aus der Datenbank laden
    4. Prüfen ob der Account aktiv und nicht gesperrt ist

    Wirft AuthenticationError wenn:
    - Kein Token vorhanden
    - Token ungültig oder abgelaufen
    - Benutzer nicht gefunden oder deaktiviert

    Returns:
        Das User-Objekt des angemeldeten Benutzers
    """
    if credentials is None:
        raise AuthenticationError("Kein Authentifizierungs-Token vorhanden")

    # Token prüfen und dekodieren
    payload = verify_token(credentials.credentials)
    if payload is None:
        raise AuthenticationError("Ungültiger oder abgelaufener Token")

    # Token-Typ prüfen (nur Access Tokens erlaubt, keine Refresh Tokens)
    if payload.get("type") != "access":
        raise AuthenticationError("Ungültiger Token-Typ")

    user_id = payload.get("sub")
    if not user_id:
        raise AuthenticationError("Token enthält keine Benutzer-ID")

    # Benutzer aus der Datenbank laden
    # Hinweis: Das User-Modell wird erst in Phase 1 vollständig implementiert.
    # Bis dahin gibt diese Dependency ein Dictionary zurück.
    from app.models.user import User
    result = await db.execute(select(User).where(User.id == UUID(user_id)))
    user = result.scalar_one_or_none()

    if user is None:
        raise AuthenticationError("Benutzer nicht gefunden")

    if not user.is_active:
        raise AuthenticationError("Benutzerkonto ist deaktiviert")

    if user.is_locked:
        raise AuthenticationError("Benutzerkonto ist gesperrt")

    return user


def require_permission(module: str, action: str):
    """
    Factory-Funktion: Erstellt eine Dependency, die eine bestimmte
    Berechtigung prüft.

    Verwendung:
        @router.post("/meters")
        async def create_meter(
            current_user: User = require_permission("meters", "create"),
        ):
            ...

    Der Benutzer muss:
    1. Angemeldet sein (Token gültig)
    2. Die Berechtigung "{module}.{action}" haben (über Rolle oder Override)

    Args:
        module: Das Modul (z.B. "meters", "readings", "co2")
        action: Die Aktion (z.B. "view", "create", "edit", "delete")

    Returns:
        Eine FastAPI-Dependency-Funktion
    """
    async def dependency(
        current_user=Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        # Berechtigungsprüfung über den Permission-Service
        from app.services.permission_service import PermissionService
        permission_service = PermissionService(db)
        allowed = await permission_service.check(current_user, module, action)

        if not allowed:
            raise PermissionDeniedError(
                f"Keine Berechtigung für {module}.{action}"
            )

        return current_user

    return Depends(dependency)
