"""
settings.py – Endpunkte für Anwendungseinstellungen.

CRUD für Key-Value-Einstellungen (Organisation, Branding, Berichte, EnPI).
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache_delete
from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.user import User
from app.services.settings_service import SettingsService

router = APIRouter()


@router.get("")
async def get_settings(
    category: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle Einstellungen abrufen, optional nach Kategorie."""
    service = SettingsService(db)
    return await service.get_all(category)


@router.get("/{key}")
async def get_setting(
    key: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Einzelne Einstellung abrufen."""
    service = SettingsService(db)
    result = await service.get(key)
    if not result:
        return {"key": key, "value": None}
    return {"key": key, **result}


@router.put("/{key}")
async def update_setting(
    key: str,
    body: dict,
    current_user: User = Depends(
        require_permission("settings", "update")
    ),
    db: AsyncSession = Depends(get_db),
):
    """Einstellung aktualisieren oder erstellen."""
    service = SettingsService(db)
    return await service.update(key, body.get("value", body))


@router.post("/cache/clear")
async def clear_cache(
    current_user: User = Depends(  # noqa: ARG001
        require_permission("settings", "update")
    ),
):
    """Alle Caches leeren."""
    deleted = await cache_delete("*")
    return {"message": f"{deleted} Cache-Einträge gelöscht"}
