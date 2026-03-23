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


@router.post("/integrations/test/ha")
async def test_ha_integration(
    current_user: User = Depends(require_permission("settings", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Home Assistant Verbindung testen."""
    from app.integrations.homeassistant import HomeAssistantClient
    try:
        client = await HomeAssistantClient.from_settings(db)
        ok = await client.check_connection()
        return {"success": ok, "message": "Verbindung erfolgreich" if ok else "Verbindung fehlgeschlagen"}
    except Exception as e:
        return {"success": False, "message": str(e)}


@router.post("/integrations/test/weather")
async def test_weather_integration(
    current_user: User = Depends(require_permission("settings", "update")),
    db: AsyncSession = Depends(get_db),
):
    """BrightSky Wetter-API testen."""
    from app.integrations.bright_sky import BrightSkyClient
    try:
        client = await BrightSkyClient.from_settings(db)
        ok = await client.check_connection()
        return {"success": ok, "message": "Verbindung erfolgreich" if ok else "Verbindung fehlgeschlagen"}
    except Exception as e:
        return {"success": False, "message": str(e)}


@router.post("/integrations/test/co2")
async def test_co2_integration(
    current_user: User = Depends(require_permission("settings", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Electricity Maps API testen."""
    from app.integrations.electricity_maps import ElectricityMapsClient
    try:
        client = await ElectricityMapsClient.from_settings(db)
        # Zone aus Settings lesen
        service = SettingsService(db)
        cfg = await service.get("integrations_co2")
        zone = cfg["value"].get("zone", "DE") if cfg and cfg.get("value") else "DE"
        ok = await client.check_connection(zone)
        return {"success": ok, "message": "Verbindung erfolgreich" if ok else "Kein API-Key oder Verbindung fehlgeschlagen"}
    except Exception as e:
        return {"success": False, "message": str(e)}
