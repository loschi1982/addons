"""
system.py – API-Endpunkte für System-Verwaltung und Updates.

Endpunkte:
- GET  /system/version        – Aktuelle Version + Deployment-Modus
- GET  /system/updates/check  – GitHub auf neue Version prüfen
- POST /system/updates/install – Update durchführen (nur Admin, nur Standalone)
- GET  /system/updates/log    – Letztes Update-Log
"""

from fastapi import APIRouter, Depends

from app.core.dependencies import get_current_user, require_permission
from app.services.update_service import UpdateService

router = APIRouter()


@router.get("/version")
async def get_version(
    current_user=Depends(get_current_user),
):
    """Aktuelle Version und Deployment-Modus abfragen."""
    service = UpdateService()
    return await service.get_version_info()


@router.get("/updates/check")
async def check_updates(
    current_user=Depends(get_current_user),
):
    """Prüft auf GitHub ob eine neue Version verfügbar ist."""
    service = UpdateService()
    return await service.check_for_updates()


@router.post("/updates/install")
async def install_update(
    current_user=Depends(require_permission("system", "update")),
):
    """
    Führt ein Update durch (nur im Standalone-Modus).
    Erfordert Admin-Berechtigung.
    """
    service = UpdateService()
    return await service.install_update()


@router.get("/updates/log")
async def get_update_log(
    current_user=Depends(get_current_user),
):
    """Gibt den Log des letzten Updates zurück."""
    service = UpdateService()
    return await service.get_update_log()
