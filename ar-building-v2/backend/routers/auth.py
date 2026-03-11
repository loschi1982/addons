# Router für Authentifizierungs-Endpunkte:
# - POST /api/auth/login  (PIN-Login oder Visitor-Token-Login)
# - GET  /api/auth/visitor-token (neuen Visitor-Token generieren, nur Admin)

import secrets
import time
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.database import get_db
from backend.auth import verify_pin, hash_pin, create_jwt, require_admin, bearer_scheme
from backend.models.user import User
from backend.schemas.user import LoginResponse, ChangePinRequest
from backend.config import load_settings, save_settings

router = APIRouter()

# Einfaches In-Memory-Rate-Limiting: max. 5 Fehlversuche pro Username in 60 Sekunden.
_failed_attempts: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT_MAX = 5
_RATE_LIMIT_WINDOW = 60  # Sekunden


def _check_rate_limit(key: str) -> None:
    """Wirft 429 wenn der Key das Rate Limit überschritten hat."""
    now = time.monotonic()
    # Alte Einträge außerhalb des Fensters entfernen.
    _failed_attempts[key] = [t for t in _failed_attempts[key] if now - t < _RATE_LIMIT_WINDOW]
    if len(_failed_attempts[key]) >= _RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Zu viele Fehlversuche. Bitte 60 Sekunden warten.",
        )


def _record_failure(key: str) -> None:
    """Registriert einen Fehlversuch für den gegebenen Key."""
    _failed_attempts[key].append(time.monotonic())


def _clear_failures(key: str) -> None:
    """Löscht alle Fehlversuche nach erfolgreichem Login."""
    _failed_attempts.pop(key, None)


@router.post("/login", response_model=LoginResponse)
async def login(body: dict, db: AsyncSession = Depends(get_db)):
    """Login-Endpunkt. Akzeptiert entweder username+pin oder einen visitor-token.
    Gibt bei Erfolg ein JWT zurück."""

    # Visitor-Token-Login: body enthält nur {"token": "login:visitor-abc123"}
    if "token" in body and "username" not in body:
        token: str = body.get("token", "")
        settings = load_settings()
        perm_token = settings.get("visitor_token")
        token_enabled = settings.get("visitor_token_enabled", False)
        # Nur der hinterlegte permanente Token ist gültig, und nur wenn er aktiv ist.
        if not perm_token or not token_enabled or token != perm_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
            )
        jwt_token = create_jwt(username="visitor", role="visitor")
        return LoginResponse(jwt=jwt_token, role="visitor", username="visitor")

    # PIN-Login: body enthält {"username": "...", "pin": "...."}
    username = body.get("username")
    pin = body.get("pin", "")
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )

    # Rate Limit prüfen bevor DB-Zugriff.
    _check_rate_limit(username)

    # Benutzer in der Datenbank suchen.
    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()

    if user is None:
        _record_failure(username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )

    # Kein PIN gesetzt (Erst-Setup): Login ohne Prüfung, muss PIN setzen.
    if user.pin_hash is None:
        _clear_failures(username)
        jwt_token = create_jwt(username=user.username, role=user.role)
        return LoginResponse(jwt=jwt_token, role=user.role, username=user.username, must_change_pin=True)

    # Normaler Login: PIN prüfen.
    if not verify_pin(pin, user.pin_hash):
        _record_failure(username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )

    _clear_failures(username)
    jwt_token = create_jwt(username=user.username, role=user.role)
    return LoginResponse(jwt=jwt_token, role=user.role, username=user.username)


@router.post("/change-pin")
async def change_pin(
    body: ChangePinRequest,
    credentials=Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
):
    """Setzt den PIN des eingeloggten Benutzers. Funktioniert auch beim Erst-Setup."""
    from backend.auth import decode_jwt
    payload = decode_jwt(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    result = await db.execute(select(User).where(User.username == payload["sub"]))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    user.pin_hash = hash_pin(body.new_pin)
    await db.commit()
    return {"ok": True}


@router.get("/visitor-token")
async def get_visitor_token(_user=Depends(require_admin())):
    """Gibt den dauerhaften Besucher-Token zurück (wird beim ersten Aufruf generiert).
    Nur Admins dürfen das."""
    settings = load_settings()
    token = settings.get("visitor_token")
    if not token:
        token = f"login:visitor-{secrets.token_hex(16)}"
        settings["visitor_token"] = token
        save_settings(settings)
    return {
        "token": token,
        "qr_content": token,
        "enabled": settings.get("visitor_token_enabled", False),
    }


@router.post("/visitor-token/toggle")
async def toggle_visitor_token(_user=Depends(require_admin())):
    """Aktiviert oder deaktiviert den dauerhaften Besucher-Token."""
    settings = load_settings()
    settings["visitor_token_enabled"] = not settings.get("visitor_token_enabled", False)
    save_settings(settings)
    return {"enabled": settings["visitor_token_enabled"]}


@router.post("/visitor-token/regenerate")
async def regenerate_visitor_token(_user=Depends(require_admin())):
    """Generiert einen neuen dauerhaften Besucher-Token (der alte wird ungültig)."""
    settings = load_settings()
    token = f"login:visitor-{secrets.token_hex(16)}"
    settings["visitor_token"] = token
    save_settings(settings)
    return {
        "token": token,
        "qr_content": token,
        "enabled": settings.get("visitor_token_enabled", False),
    }
