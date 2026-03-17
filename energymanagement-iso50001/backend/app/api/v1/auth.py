"""
auth.py – Authentifizierungs-Endpunkte.

Login, Logout, Token-Refresh, Passwortänderung und Ersteinrichtung.
Die eigentliche Logik liegt im AuthService.
"""

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    RefreshTokenRequest,
    TokenResponse,
    UserProfileResponse,
)
from app.schemas.common import MessageResponse
from app.services.auth_service import AuthService

router = APIRouter()


# ---------------------------------------------------------------------------
# Setup (Ersteinrichtung)
# ---------------------------------------------------------------------------

class SetupRequest(LoginRequest):
    """Ersteinrichtung: Erster Benutzer wird als Admin angelegt."""
    email: str
    display_name: str | None = None


@router.post("/setup", response_model=TokenResponse)
async def setup(
    request: SetupRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Ersteinrichtung – nur möglich wenn noch keine Benutzer existieren.

    Legt den ersten Benutzer als Administrator an und gibt ein
    Token-Paar zurück, damit der Benutzer sofort eingeloggt ist.
    """
    service = AuthService(db)
    result = await service.setup(
        username=request.username,
        email=request.email,
        password=request.password,
        display_name=request.display_name,
    )
    return TokenResponse(**result)


@router.get("/setup/status")
async def setup_status(db: AsyncSession = Depends(get_db)):
    """Prüft ob die Ersteinrichtung noch aussteht."""
    service = AuthService(db)
    required = await service.check_setup_required()
    return {"setup_required": required}


# ---------------------------------------------------------------------------
# Login / Logout / Token-Refresh
# ---------------------------------------------------------------------------

@router.post("/login", response_model=TokenResponse)
async def login(
    request: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """Benutzer einloggen und JWT-Token-Paar zurückgeben."""
    service = AuthService(db)
    result = await service.login(request.username, request.password)
    return TokenResponse(**result)


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    request: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db),
):
    """Access-Token mit Refresh-Token erneuern."""
    service = AuthService(db)
    result = await service.refresh_token(request.refresh_token)
    return TokenResponse(**result)


@router.post("/logout", response_model=MessageResponse)
async def logout(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Aktuelle Session beenden (Token invalidieren)."""
    service = AuthService(db)
    await service.logout(current_user.id)
    return MessageResponse(message="Erfolgreich abgemeldet")


# ---------------------------------------------------------------------------
# Profil & Passwort
# ---------------------------------------------------------------------------

@router.get("/me", response_model=UserProfileResponse)
async def get_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Eigenes Profil mit Berechtigungen abrufen."""
    service = AuthService(db)
    result = await service.get_profile(current_user)
    return UserProfileResponse(**result)


@router.put("/me/password", response_model=MessageResponse)
async def change_password(
    request: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Eigenes Passwort ändern."""
    service = AuthService(db)
    await service.change_password(
        current_user.id, request.current_password, request.new_password
    )
    return MessageResponse(message="Passwort erfolgreich geändert")
