# Router für Anwendungseinstellungen.
# Einstellungen werden in /data/settings.json gespeichert, nicht in der DB.

from fastapi import APIRouter, Depends

from backend.auth import require_admin
from backend.config import load_settings, save_settings
from backend.schemas.settings import Settings

router = APIRouter()


@router.get("", response_model=Settings)
async def get_settings(_user=Depends(require_admin())):
    """Lädt alle Einstellungen aus /data/settings.json. Nur Admins."""
    data = load_settings()
    return Settings(**data)


@router.put("", response_model=Settings)
async def update_settings(body: Settings, _user=Depends(require_admin())):
    """Speichert neue Einstellungen in /data/settings.json. Nur Admins.
    Achtung: Das JWT-Secret sofort nach Änderung neu einloggen –
    alle alten Tokens werden damit ungültig."""
    saved = save_settings(body.model_dump())
    return Settings(**saved)