"""
auth.py – Schemas für Authentifizierung und Benutzerverwaltung.

Enthält Schemas für Login, Token-Ausgabe, Benutzer-CRUD und
Passwortänderung. Passwort-Felder werden nur in Requests akzeptiert,
nie in Responses zurückgegeben.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas.common import BaseSchema


# ---------------------------------------------------------------------------
# Login / Token
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    """Login mit Benutzername und Passwort."""
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=8)


class TokenResponse(BaseModel):
    """JWT-Token-Paar nach erfolgreichem Login."""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = Field(description="Sekunden bis zum Ablauf des Access-Tokens")


class RefreshTokenRequest(BaseModel):
    """Refresh-Token zum Erneuern des Access-Tokens."""
    refresh_token: str


class ChangePasswordRequest(BaseModel):
    """Passwort ändern – altes und neues Passwort erforderlich."""
    current_password: str = Field(..., min_length=8)
    new_password: str = Field(..., min_length=8)

    @field_validator("new_password")
    @classmethod
    def passwords_differ(cls, v: str, info) -> str:
        """Neues Passwort muss sich vom alten unterscheiden."""
        if "current_password" in info.data and v == info.data["current_password"]:
            raise ValueError("Neues Passwort muss sich vom alten unterscheiden")
        return v


# ---------------------------------------------------------------------------
# Benutzer
# ---------------------------------------------------------------------------

class UserBase(BaseSchema):
    """Gemeinsame Benutzerfelder für Create und Update."""
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    display_name: str | None = Field(None, max_length=255)
    language: str = Field("de", pattern="^(de|en)$")


class UserCreate(UserBase):
    """Neuen Benutzer anlegen – Passwort ist Pflicht."""
    password: str = Field(..., min_length=8)
    role_id: uuid.UUID
    allowed_locations: list[uuid.UUID] | None = None


class UserUpdate(BaseModel):
    """Benutzer aktualisieren – alle Felder optional."""
    email: EmailStr | None = None
    display_name: str | None = None
    language: str | None = None
    role_id: uuid.UUID | None = None
    is_active: bool | None = None
    allowed_locations: list[uuid.UUID] | None = None


class UserResponse(UserBase):
    """Benutzer in API-Responses – ohne Passwort."""
    id: uuid.UUID
    role_id: uuid.UUID
    role_name: str | None = None
    is_active: bool
    is_locked: bool
    must_change_password: bool
    allowed_locations: list[uuid.UUID] | None = None
    created_at: datetime
    last_login: datetime | None = None


class UserProfileResponse(BaseSchema):
    """Eigenes Profil mit Berechtigungen."""
    id: uuid.UUID
    username: str
    email: str
    display_name: str | None
    language: str | None = "de"
    role_name: str
    permissions: list[str]


# ---------------------------------------------------------------------------
# Rollen & Berechtigungen
# ---------------------------------------------------------------------------

class PermissionResponse(BaseSchema):
    """Eine einzelne Berechtigung."""
    id: uuid.UUID
    module: str
    action: str
    resource_scope: str | None
    category: str | None


class RoleBase(BaseModel):
    """Gemeinsame Rollenfelder."""
    name: str = Field(..., max_length=50)
    display_name: str = Field(..., max_length=100)
    description: str | None = None


class RoleCreate(RoleBase):
    """Neue Rolle mit Berechtigungen anlegen."""
    permission_ids: list[uuid.UUID] = []


class RoleUpdate(BaseModel):
    """Rolle aktualisieren."""
    display_name: str | None = None
    description: str | None = None
    permission_ids: list[uuid.UUID] | None = None


class RoleResponse(RoleBase, BaseSchema):
    """Rolle in API-Responses."""
    id: uuid.UUID
    is_system_role: bool
    permissions: list[PermissionResponse] = []


class UserPermissionOverrideCreate(BaseModel):
    """Berechtigungs-Override für einen Benutzer."""
    permission_id: uuid.UUID
    override_type: str = Field(..., pattern="^(grant|deny)$")
    reason: str | None = None


class UserPermissionOverrideResponse(BaseSchema):
    """Override in API-Responses."""
    id: uuid.UUID
    user_id: uuid.UUID
    permission_id: uuid.UUID
    override_type: str
    reason: str | None
    granted_by: uuid.UUID | None
