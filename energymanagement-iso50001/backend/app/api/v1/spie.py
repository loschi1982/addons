"""
spie.py – API-Endpunkte für SPIE-Konfiguration und automatischen Messwert-Import.

GET  /spie/config         → Konfiguration lesen (Passwort maskiert)
POST /spie/config         → Konfiguration speichern
POST /spie/test           → Verbindungstest
POST /spie/sync           → Manuellen Import auslösen (asyncio.Task)
GET  /spie/progress/{id}  → Fortschritt eines laufenden Imports
GET  /spie/status         → Letzter Sync-Zeitpunkt + Ergebnis
POST /spie/probe          → Diagnose: Rohantwort der SPIE-API für einen Zähler
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


@router.post("/probe")
async def probe_spie_readings(
    nav_id: str = Body(...),
    date_from: str = Body(...),
    date_to: str = Body(...),
    current_user: User = Depends(require_permission("settings", "update")),
    db: AsyncSession = Depends(get_db),
):
    """
    Diagnose-Endpunkt: Rohantwort der SPIE-API für einen Zähler.

    Ruft beide bekannten Endpoints auf und gibt die vollständige JSON-Antwort zurück.
    Hilft beim Ermitteln der genauen Response-Struktur für den Parser.

    Body: { "nav_id": "...", "date_from": "2026-03-01", "date_to": "2026-03-31" }
    """
    from datetime import date as _date
    svc = SpieService(db)
    cfg = await svc.get_config_raw()
    if not cfg or not cfg.get("username"):
        raise HTTPException(status_code=400, detail="SPIE nicht konfiguriert.")

    try:
        df = _date.fromisoformat(date_from)
        dt = _date.fromisoformat(date_to)
    except ValueError:
        raise HTTPException(status_code=400, detail="Ungültiges Datumsformat (YYYY-MM-DD erwartet).")

    async with SpieClient() as client:
        await client.login(cfg["username"], cfg["password"])

        # Endpoint 1: Freie Auswertung
        fa_raw = await client.raw_probe(
            nav_id,
            "/legacyfreieauswertung/getfreieauswertungdata",
            {
                "routeParams": {"elementType": "z", "elementId": nav_id, "task": "freieauswertung"},
                "targetRouteParams": {"elementType": "z", "elementId": nav_id, "task": "freieauswertung"},
                "dateFrom": df.isoformat(),
                "dateTo": dt.isoformat(),
                "silentErrorHandling": True,
            },
        )

        # Endpoint 2: Verbrauchsverlauf
        vv_raw = await client.raw_probe(
            nav_id,
            "/legacyverbrauchsverlauf/getverbrauchsverlaufdata",
            {
                "routeParams": {"elementType": "z", "elementId": nav_id, "task": "verbrauchsverlauf"},
                "targetRouteParams": {"elementType": "z", "elementId": nav_id, "task": "verbrauchsverlauf"},
                "dateFrom": df.isoformat(),
                "dateTo": dt.isoformat(),
                "silentErrorHandling": True,
            },
        )

    return {
        "nav_id": nav_id,
        "date_from": date_from,
        "date_to": date_to,
        "freieauswertung": fa_raw,
        "verbrauchsverlauf": vv_raw,
    }


@router.post("/probe-auto")
async def probe_spie_auto(
    current_user: User = Depends(require_permission("settings", "update")),
    db: AsyncSession = Depends(get_db),
):
    """
    Diagnose: Ersten SPIE-Zähler automatisch auswählen und Rohantwort zeigen.

    Wählt den ersten aktiven Zähler mit spie_nav_id und fragt Messwerte
    für die letzten 30 Tage ab. Gibt die vollständige API-Antwort zurück.
    """
    from datetime import date as _date, timedelta
    svc = SpieService(db)
    cfg = await svc.get_config_raw()
    if not cfg or not cfg.get("username"):
        raise HTTPException(status_code=400, detail="SPIE nicht konfiguriert.")

    meters = await svc._load_spie_meters()
    if not meters:
        raise HTTPException(status_code=404, detail="Keine SPIE-Zähler gefunden.")

    # Ersten Zähler mit nav_id nehmen
    meter = None
    nav_id = None
    for m in meters:
        nid = (m.source_config or {}).get("spie_nav_id") or (m.source_config or {}).get("nav_id")
        if nid:
            meter = m
            nav_id = nid
            break

    if not nav_id:
        raise HTTPException(status_code=404, detail="Kein Zähler mit spie_nav_id gefunden.")

    dt = _date.today()
    df = dt - timedelta(days=30)

    async with SpieClient() as client:
        await client.login(cfg["username"], cfg["password"])

        fa_raw = await client.raw_probe(
            nav_id,
            "/legacyfreieauswertung/getfreieauswertungdata",
            {
                "routeParams": {"elementType": "z", "elementId": nav_id, "task": "freieauswertung"},
                "targetRouteParams": {"elementType": "z", "elementId": nav_id, "task": "freieauswertung"},
                "dateFrom": df.isoformat(),
                "dateTo": dt.isoformat(),
                "silentErrorHandling": True,
            },
        )

        vv_raw = await client.raw_probe(
            nav_id,
            "/legacyverbrauchsverlauf/getverbrauchsverlaufdata",
            {
                "routeParams": {"elementType": "z", "elementId": nav_id, "task": "verbrauchsverlauf"},
                "targetRouteParams": {"elementType": "z", "elementId": nav_id, "task": "verbrauchsverlauf"},
                "dateFrom": df.isoformat(),
                "dateTo": dt.isoformat(),
                "silentErrorHandling": True,
            },
        )

    return {
        "meter_name": meter.display_name or meter.name,
        "nav_id": nav_id,
        "date_from": df.isoformat(),
        "date_to": dt.isoformat(),
        "freieauswertung": fa_raw,
        "verbrauchsverlauf": vv_raw,
    }
