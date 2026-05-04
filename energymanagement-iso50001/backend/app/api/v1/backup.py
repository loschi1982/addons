"""
backup.py – API-Endpunkte für Datenbank-Export und -Import.

GET  /backup/export               → Datenbank als .json.gz herunterladen (synchron)
POST /backup/export/start         → Async-Export starten, gibt job_id zurück
GET  /backup/download/{job_id}    → Fertigen Export herunterladen
POST /backup/import               → .json.gz hochladen und importieren (synchron)
POST /backup/import/start         → Async-Import starten, gibt job_id zurück
GET  /backup/progress/{job_id}    → Fortschritt eines laufenden Jobs abrufen
GET  /backup/info                 → Metadaten eines Backup-Files prüfen (ohne Import)
"""

import gzip
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.core.security import verify_password, hash_password
from app.models.user import User
from app.services.backup_service import (
    BACKUP_FORMAT_VERSION,
    export_database,
    factory_reset,
    import_database,
)

router = APIRouter()


@router.get("/export")
async def export_backup(
    current_user: User = Depends(require_permission("settings", "update")),
    db: AsyncSession = Depends(get_db),
):
    """
    Exportiert die komplette Datenbank als komprimierte JSON-Datei.

    Die Datei kann auf einem neuen System via POST /backup/import
    wieder eingespielt werden.
    """
    compressed = await export_database(db)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"energy_backup_{timestamp}.json.gz"

    return Response(
        content=compressed,
        media_type="application/gzip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(compressed)),
        },
    )


@router.post("/export/start")
async def start_export(
    current_user: User = Depends(require_permission("settings", "update")),
):
    """
    Startet einen asynchronen Datenbank-Export via Celery.

    Gibt eine job_id zurück, über die der Fortschritt mit
    GET /backup/progress/{job_id} abgefragt werden kann.
    Nach Abschluss steht der Download unter GET /backup/download/{job_id}
    für 30 Minuten bereit.
    """
    from app.tasks import backup_export as backup_export_task
    job_id = str(uuid.uuid4())
    backup_export_task.delay(job_id)
    return {"job_id": job_id}


@router.get("/progress/{job_id}")
async def get_backup_progress(
    job_id: str,
    current_user: User = Depends(get_current_user),
):
    """Fortschritt eines laufenden Backup-Jobs abrufen."""
    from app.core.cache import get_redis
    redis = await get_redis()
    if not redis:
        raise HTTPException(status_code=503, detail="Redis nicht verfügbar.")
    raw = await redis.get(f"backup:{job_id}")
    if not raw:
        raise HTTPException(status_code=404, detail="Job nicht gefunden oder abgelaufen.")
    return json.loads(raw)


@router.get("/download/{job_id}")
async def download_backup_result(
    job_id: str,
    current_user: User = Depends(require_permission("settings", "update")),
):
    """Fertigen asynchronen Export herunterladen (gültig 30 Minuten nach Abschluss)."""
    import redis as redis_lib
    from app.config import get_settings
    settings = get_settings()
    r = redis_lib.Redis.from_url(settings.redis_url, decode_responses=False)
    compressed = r.get(f"backup:result:{job_id}")
    if not compressed:
        raise HTTPException(status_code=404, detail="Export nicht gefunden oder abgelaufen.")
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"energy_backup_{timestamp}.json.gz"
    return Response(
        content=compressed,
        media_type="application/gzip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(compressed)),
        },
    )


@router.post("/import/start")
async def start_import(
    file: UploadFile = File(...),
    current_user: User = Depends(require_permission("settings", "update")),
):
    """
    Lädt eine Backup-Datei hoch und startet den asynchronen Import via Celery.

    Gibt eine job_id zurück, über die der Fortschritt mit
    GET /backup/progress/{job_id} abgefragt werden kann.
    """
    if not file.filename or not file.filename.endswith(".gz"):
        raise HTTPException(status_code=400, detail="Bitte eine .json.gz-Backup-Datei hochladen.")

    backup_bytes = await file.read()
    if len(backup_bytes) < 20:
        raise HTTPException(status_code=400, detail="Datei ist leer oder beschädigt.")

    job_id = str(uuid.uuid4())

    # Datei in Redis zwischenspeichern (1 Stunde TTL)
    import redis as redis_lib
    from app.config import get_settings
    settings = get_settings()
    r = redis_lib.Redis.from_url(settings.redis_url, decode_responses=False)
    r.set(f"backup:upload:{job_id}", backup_bytes, ex=3600)

    from app.tasks import backup_import as backup_import_task
    backup_import_task.delay(job_id)
    return {"job_id": job_id}


@router.post("/import")
async def import_backup(
    file: UploadFile = File(...),
    replace: bool = True,
    current_user: User = Depends(require_permission("settings", "update")),
    db: AsyncSession = Depends(get_db),
):
    """
    Importiert eine Backup-Datei (.json.gz).

    - replace=true (Standard): Bestehende Daten werden vorher gelöscht.
    - replace=false: Nur fehlende Datensätze werden eingefügt (ON CONFLICT DO NOTHING).
    """
    if not file.filename or not file.filename.endswith(".gz"):
        raise HTTPException(
            status_code=400,
            detail="Bitte eine .json.gz-Backup-Datei hochladen.",
        )

    backup_bytes = await file.read()
    if len(backup_bytes) < 20:
        raise HTTPException(status_code=400, detail="Datei ist leer oder beschädigt.")

    try:
        stats = await import_database(db, backup_bytes, replace=replace)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Import fehlgeschlagen: {e}",
        ) from e

    return {
        "message": "Import abgeschlossen",
        "imported_rows": stats["imported"],
        "skipped_tables": stats["skipped"],
        "errors": stats["errors"],
    }


@router.post("/inspect")
async def inspect_backup(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """
    Liest Metadaten aus einer Backup-Datei, ohne sie einzuspielen.
    Gibt Tabellennamen, Zeilenzahlen und Export-Zeitstempel zurück.
    """
    if not file.filename or not file.filename.endswith(".gz"):
        raise HTTPException(status_code=400, detail="Bitte eine .json.gz-Backup-Datei hochladen.")

    backup_bytes = await file.read()
    try:
        json_bytes = gzip.decompress(backup_bytes)
        data = json.loads(json_bytes.decode("utf-8"))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Datei konnte nicht gelesen werden: {e}") from e

    version = data.get("version", "unbekannt")
    exported_at = data.get("exported_at", "unbekannt")
    tables = data.get("tables", {})
    table_summary = {t: len(rows) for t, rows in tables.items()}
    total_rows = sum(table_summary.values())
    compatible = version == BACKUP_FORMAT_VERSION

    return {
        "version": version,
        "compatible": compatible,
        "exported_at": exported_at,
        "file_size_kb": round(len(backup_bytes) / 1024, 1),
        "total_rows": total_rows,
        "tables": table_summary,
        "skipped_tables": data.get("skipped_tables", []),
    }


@router.post("/factory-reset")
async def reset_to_factory(
    password: str = Body(..., embed=True),
    current_user: User = Depends(require_permission("settings", "update")),
    db: AsyncSession = Depends(get_db),
):
    """
    Setzt das System auf Werkseinstellungen zurück.

    Alle Benutzer- und Messdaten werden gelöscht. Seed-Daten (Rollen,
    Emissionsfaktoren, Wetterstationen) bleiben erhalten. Es wird ein
    frischer Admin-Benutzer mit dem bestehenden Passwort angelegt.

    Das aktuelle Administratorpasswort muss zur Bestätigung mitgeschickt werden.
    """
    # Passwort des aktuell angemeldeten Admins prüfen
    if not verify_password(password, current_user.password_hash):
        raise HTTPException(status_code=403, detail="Falsches Passwort. Werksreset abgebrochen.")

    # Nur Admins dürfen zurücksetzen – Role explizit laden (kein lazy-load in async)
    user_with_role = await db.execute(
        select(User).where(User.id == current_user.id).options(selectinload(User.role))
    )
    user_obj = user_with_role.scalar_one_or_none()
    role_name = user_obj.role.name if (user_obj and user_obj.role) else ""
    if role_name != "admin":
        raise HTTPException(status_code=403, detail="Nur Administratoren können das System zurücksetzen.")

    result = await factory_reset(db=db)

    return {
        "message": "System erfolgreich auf Werkseinstellungen zurückgesetzt. Bitte neu einrichten.",
        "deleted_tables": len(result["deleted_tables"]),
        "kept_tables": result["kept_tables"],
        "setup_required": True,
    }
