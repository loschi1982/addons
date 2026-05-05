"""
spie.py – API-Endpunkte für SPIE-Konfiguration und automatischen Messwert-Import.

GET  /spie/config         → Konfiguration lesen (Passwort maskiert)
POST /spie/config         → Konfiguration speichern
POST /spie/test           → Verbindungstest
POST /spie/sync           → Manuellen Import auslösen (asyncio.Task)
GET  /spie/progress/{id}  → Fortschritt eines laufenden Imports
GET  /spie/status         → Letzter Sync-Zeitpunkt + Ergebnis
"""

import asyncio
import re
import uuid

import structlog
from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_permission
from app.integrations.spie import SpieClient
from app.models.user import User
from app.services.spie_service import SpieService, read_progress

logger = structlog.get_logger()
router = APIRouter()


@router.get("/config")
async def get_spie_config(
    current_user: User = Depends(require_permission("settings", "update")),
    db: AsyncSession = Depends(get_db),
):
    """SPIE-Konfiguration abrufen (Passwort nicht enthalten)."""
    svc = SpieService(db)
    cfg = await svc.get_config()
    return cfg or {"username": "", "enabled": False, "password_set": False}


@router.post("/config")
async def save_spie_config(
    username: str = Body(...),
    password: str = Body(default=""),
    enabled: bool = Body(...),
    current_user: User = Depends(require_permission("settings", "update")),
    db: AsyncSession = Depends(get_db),
):
    """
    SPIE-Konfiguration speichern.
    password="" → bestehendes Passwort unverändert lassen.
    """
    svc = SpieService(db)
    await svc.save_config(
        username=username,
        password=password if password else None,
        enabled=enabled,
    )
    return {"ok": True}


@router.post("/test")
async def test_spie_connection(
    username: str = Body(...),
    password: str = Body(...),
    current_user: User = Depends(require_permission("settings", "update")),
):
    """Verbindungstest: Login bei SPIE probieren."""
    async with SpieClient() as client:
        ok = await client.test_connection(username, password)
    if ok:
        return {"ok": True, "message": "Verbindung erfolgreich."}
    raise HTTPException(status_code=401, detail="Login fehlgeschlagen. Bitte Zugangsdaten prüfen.")


@router.post("/sync")
async def start_spie_sync(
    current_user: User = Depends(require_permission("settings", "update")),
    db: AsyncSession = Depends(get_db),
):
    """
    Manuellen SPIE-Import starten.

    Läuft als asyncio.Task im FastAPI-Prozess.
    Fortschritt: GET /spie/progress/{job_id}
    """
    svc = SpieService(db)
    cfg = await svc.get_config_raw()
    if not cfg or not cfg.get("username"):
        raise HTTPException(
            status_code=400,
            detail="SPIE nicht konfiguriert. Bitte zuerst Zugangsdaten speichern.",
        )

    job_id = str(uuid.uuid4())

    async def _run():
        from app.core.database import get_db as _get_db
        from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
        from app.config import get_settings
        settings = get_settings()
        engine = create_async_engine(
            settings.database_url, echo=False, pool_size=2, max_overflow=2
        )
        from sqlalchemy.ext.asyncio import async_sessionmaker
        session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        try:
            async with session_factory() as session:
                service = SpieService(session)
                await service.run_import(job_id=job_id)
        except Exception as e:
            from app.services.spie_service import _write_progress
            _write_progress(job_id, {"status": "error", "error": str(e)})
            logger.error("spie_sync_task_failed", job_id=job_id, error=str(e))
        finally:
            await engine.dispose()

    asyncio.create_task(_run())
    return {"job_id": job_id}


@router.get("/progress/{job_id}")
async def get_spie_progress(
    job_id: str,
    current_user: User = Depends(require_permission("settings", "update")),
):
    """Fortschritt eines laufenden SPIE-Imports abrufen."""
    if not re.match(r"^[0-9a-f\-]{36}$", job_id):
        raise HTTPException(status_code=400, detail="Ungültige Job-ID.")
    progress = read_progress(job_id)
    if progress is None:
        raise HTTPException(status_code=404, detail="Job nicht gefunden oder abgelaufen.")
    return progress


@router.get("/status")
async def get_spie_status(
    current_user: User = Depends(require_permission("settings", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Letzter SPIE-Sync-Zeitpunkt und Ergebnis."""
    svc = SpieService(db)
    last = await svc.get_last_sync()
    return last or {"synced_at": None, "imported": 0, "errors": 0, "meters_processed": 0}
