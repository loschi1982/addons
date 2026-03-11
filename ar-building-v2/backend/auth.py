# Enthält alle Authentifizierungs-Hilfsfunktionen:
# - PIN-Hashing und -Prüfung mit bcrypt
# - JWT erstellen und lesen
# - FastAPI-Dependencies für Rollenprüfung

import bcrypt
from datetime import datetime, timezone, timedelta
from typing import Optional

from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from backend.config import get_jwt_secret, get_jwt_expire_hours

# HTTPBearer liest den "Authorization: Bearer <token>" Header aus.
bearer_scheme = HTTPBearer()


# ─── PIN / Passwort ────────────────────────────────────────────────────────────

def hash_pin(pin: str) -> str:
    """Wandelt einen PIN-String in einen sicheren bcrypt-Hash um.
    Der Hash wird in der Datenbank gespeichert, nicht der echte PIN."""
    hashed = bcrypt.hashpw(pin.encode("utf-8"), bcrypt.gensalt())
    return hashed.decode("utf-8")


def verify_pin(pin: str, hashed: str) -> bool:
    """Prüft ob ein eingegebener PIN mit dem gespeicherten Hash übereinstimmt.
    bcrypt vergleicht intern sicher ohne den echten PIN zu kennen."""
    return bcrypt.checkpw(pin.encode("utf-8"), hashed.encode("utf-8"))


# ─── JWT ───────────────────────────────────────────────────────────────────────

def create_jwt(username: str, role: str) -> str:
    """Erstellt ein JWT-Token mit Benutzername, Rolle und Ablaufzeit.
    Das Token ist standardmäßig 12 Stunden gültig."""
    expire = datetime.now(timezone.utc) + timedelta(hours=get_jwt_expire_hours())
    payload = {
        "sub": username,   # Subject: Benutzername
        "role": role,      # Rolle des Benutzers
        "exp": expire,     # Ablaufzeitpunkt
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm="HS256")


def decode_jwt(token: str) -> Optional[dict]:
    """Liest und prüft ein JWT-Token. Gibt None zurück wenn es ungültig oder abgelaufen ist."""
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=["HS256"])
        return payload
    except JWTError:
        return None


# ─── FastAPI Dependencies ──────────────────────────────────────────────────────

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)) -> dict:
    """FastAPI-Dependency: Liest das JWT aus dem Authorization-Header und gibt den Benutzer zurück.
    Wirft einen 401-Fehler wenn das Token fehlt oder ungültig ist."""
    payload = decode_jwt(credentials.credentials)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    return {"username": payload.get("sub"), "role": payload.get("role")}


def require_any_role():
    """FastAPI-Dependency: Erlaubt Zugriff für alle eingeloggten Benutzer (jede Rolle).
    Gibt das Benutzer-Dict zurück: {"username": ..., "role": ...}"""
    def dependency(user: dict = Depends(get_current_user)) -> dict:
        return user
    return dependency


def require_admin():
    """FastAPI-Dependency: Erlaubt Zugriff nur für Benutzer mit der Rolle 'admin'.
    Wirft einen 403-Fehler für alle anderen Rollen."""
    def dependency(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Admin role required",
            )
        return user
    return dependency


def require_roles(*roles: str):
    """FastAPI-Dependency: Erlaubt Zugriff nur für bestimmte Rollen.
    Beispiel: require_roles('staff', 'technician', 'admin')"""
    def dependency(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Required role: {', '.join(roles)}",
            )
        return user
    return dependency