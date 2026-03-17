"""
auth.py – Authentifizierungs-Endpunkte.

Login, Logout, Token-Refresh und Passwortänderung.
Die eigentliche Logik liegt im AuthService.
"""

import uuid

from fastapi import APIRouter, Depends
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

router = APIRouter()


@router.post("/login", response_model=TokenResponse)
async def login(
    request: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """Benutzer einloggen und JWT-Token-Paar zurückgeben."""
    # TODO: AuthService.login() aufrufen
    raise NotImplementedError("AuthService noch nicht implementiert")


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    request: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db),
):
    """Access-Token mit Refresh-Token erneuern."""
    # TODO: AuthService.refresh_token() aufrufen
    raise NotImplementedError("AuthService noch nicht implementiert")


@router.post("/logout", response_model=MessageResponse)
async def logout(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Aktuelle Session beenden (Token invalidieren)."""
    # TODO: AuthService.logout() aufrufen
    return MessageResponse(message="Erfolgreich abgemeldet")


@router.get("/me", response_model=UserProfileResponse)
async def get_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Eigenes Profil mit Berechtigungen abrufen."""
    # TODO: Profil mit Berechtigungen laden
    raise NotImplementedError("Noch nicht implementiert")


@router.put("/me/password", response_model=MessageResponse)
async def change_password(
    request: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Eigenes Passwort ändern."""
    # TODO: AuthService.change_password() aufrufen
    raise NotImplementedError("AuthService noch nicht implementiert")
