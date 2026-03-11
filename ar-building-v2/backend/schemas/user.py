# Pydantic-Schemas für Benutzer und Authentifizierung.

from typing import Literal, Optional, Union
from pydantic import BaseModel, Field


class UserSummary(BaseModel):
    """Öffentliche Benutzerdaten (kein PIN-Hash!)."""
    id: int
    username: str
    role: str

    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    """Daten zum Anlegen oder Bearbeiten eines Benutzers."""
    username: str
    # PIN muss genau 4 Zeichen lang sein.
    pin: str = Field(min_length=4, max_length=4)
    # Besucher bekommen keinen DB-Eintrag, daher keine visitor-Rolle hier.
    role: Literal["staff", "technician", "admin"]


class LoginPinRequest(BaseModel):
    """Login-Anfrage mit Benutzername und PIN."""
    username: str
    pin: str = Field(min_length=4, max_length=4)


class LoginTokenRequest(BaseModel):
    """Login-Anfrage mit Besucher-QR-Token."""
    token: str


class LoginResponse(BaseModel):
    """Antwort nach erfolgreichem Login."""
    jwt: str
    role: str
    username: str
    must_change_pin: bool = False


class ChangePinRequest(BaseModel):
    """Anfrage zum Setzen eines neuen PINs."""
    new_pin: str = Field(min_length=4, max_length=4)