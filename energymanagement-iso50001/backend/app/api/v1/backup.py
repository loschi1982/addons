"""
backup.py – API-Endpunkte für Datenbank-Export und -Import.

GET  /backup/export               → Datenbank als .json.gz herunterladen (synchron)
POST /backup/export/start         → Async-Export starten (asyncio.Task), gibt job_id zurück
GET  /backup/download/{job_id}    → Fertigen Export herunterladen (Datei auf Disk)
POST /backup/import/start         → Async-Import starten (asyncio.Task), gibt job_id zurück
GET  /backup/progress/{job_id}    → Fortschritt eines laufenden Jobs abrufen
POST /backup/inspect              → Metadaten einer Backup-Datei prüfen (ohne Import)
POST /backup/factory-reset        → System auf Werkseinstellungen zurücksetzen

Wichtig: Export und Import laufen als asyncio.Task im FastAPI-Prozess selbst –
nicht via Celery. Das vermeidet Probleme mit Speicherlimits und Session-Timeouts
die beim Celery-Worker auftreten.
"""

import asyncio
import gzip
import json
import os
import re
import tempfile
import uuid
from datetime import datetime, timezone
from typing import Any

import structlog
from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.core.security import hash_password, verify_password
from app.models.user import User
from app.services.backup_service import (
    BACKUP_FORMAT_VERSION,
    export_database,
    factory_reset,
    import_database,
)

logger = structlog.get_logger()
router = APIRouter()

# ── In-Memory Job-Registry ──────────────────────────────────────────────────
# Speichert Fortschritt laufender und abgeschlossener Backup-Jobs.
# TTL wird durch asyncio-Task selbst verwaltet (Eintrag nach 2 Stunden gelöscht).
_jobs: dict[str, dict[str, Any]] = {}
_TMP = tempfile.gettempdir()


def _job_path(job_id: str, prefix: str) -> str:
    """Sicherer Pfad für temporäre Backup-Dateien."""
    return os.path.join(_TMP, f"backup_{prefix}_{job_id}.json.gz")


async def _cleanup_job(job_id: str, delay: int = 7200) -> None:
    """Job-Eintrag und temp. Datei nach `delay` Sekunden löschen."""
    await asyncio.sleep(delay)
    _jobs.pop(job_id, None)
    for prefix in ("result", "upload"):
        path = _job_path(job_id, prefix)
        try:
            os.unlink(path)
        except OSError:
            pass


async def _run_export(job_id: str) -> None:
    """Export-Task: läuft im selben asyncio-Event-Loop wie FastAPI."""
    from app.config import get_settings

    settings = get_settings()

    def _progress(rows_done: int, total_rows: int, table: str,
                  table_rows: int, table_total: int, phase: str) -> None:
        pct = round(rows_done / total_rows * 100) if total_rows else 0
        _jobs[job_id] = {
            "status": "running",
            "phase": phase,
            "rows_done": rows_done,
            "total_rows": total_rows,
            "table": table,
            "table_rows": table_rows,
            "table_total": table_total,
            "percent": pct,
        }

    _jobs[job_id] = {"status": "running", "phase": "count", "rows_done": 0,
                     "total_rows": 0, "percent": 0, "table": ""}

    # Eigene DB-Engine für den Background-Task (vermeidet Session-Sharing)
    engine = create_async_engine(
        settings.database_url, echo=False, pool_size=2, max_overflow=2,
        pool_recycle=3600,
        connect_args={"command_timeout": None},  # kein Statement-Timeout
    )
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    try:
        async with session_factory() as db:
            compressed = await export_database(db, progress_callback=_progress)

        result_path = _job_path(job_id, "result")
        with open(result_path, "wb") as f:
            f.write(compressed)

        size_kb = round(len(compressed) / 1024, 1)
        _jobs[job_id] = {
            "status": "done", "phase": "export", "percent": 100,
            "size_kb": size_kb, "result_path": result_path,
        }
        logger.info("backup_export_done", job_id=job_id, size_kb=size_kb)

    except Exception as e:
        logger.error("backup_export_failed", job_id=job_id, error=str(e))
        _jobs[job_id] = {"status": "error", "error": str(e)}
    finally:
        await engine.dispose()

    asyncio.create_task(_cleanup_job(job_id))


async def _run_import(job_id: str) -> None:
    """Import-Task: läuft im selben asyncio-Event-Loop wie FastAPI."""
    from app.config import get_settings

    settings = get_settings()

    def _progress(rows_done: int, total_rows: int, table: str,
                  table_rows: int, table_total: int, phase: str,
                  percent: int = 0) -> None:
        _jobs[job_id] = {
            "status": "running", "phase": phase,
            "rows_done": rows_done, "total_rows": total_rows,
            "table": table, "table_rows": table_rows,
            "table_total": table_total, "percent": percent,
        }

    upload_path = _job_path(job_id, "upload")
    if not os.path.exists(upload_path):
        _jobs[job_id] = {"status": "error", "error": "Upload-Datei nicht gefunden."}
        return

    with open(upload_path, "rb") as f:
        backup_bytes = f.read()

    _jobs[job_id] = {"status": "running", "phase": "import",
                     "rows_done": 0, "total_rows": 0, "percent": 0, "table": ""}

    engine = create_async_engine(
        settings.database_url, echo=False, pool_size=2, max_overflow=2,
        pool_recycle=3600,
        connect_args={"command_timeout": None},
    )
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    try:
        async with session_factory() as db:
            stats = await import_database(
                db, backup_bytes, replace=True, progress_callback=_progress
            )

        _jobs[job_id] = {
            "status": "done", "phase": "import", "percent": 100,
            "imported": stats["imported"],
            "skipped": stats["skipped"],
            "errors": stats["errors"],
        }
        logger.info("backup_import_done", job_id=job_id, imported=stats["imported"])

    except Exception as e:
        logger.error("backup_import_failed", job_id=job_id, error=str(e))
        _jobs[job_id] = {"status": "error", "error": str(e)}
    finally:
        await engine.dispose()
        try:
            os.unlink(upload_path)
        except OSError:
            pass

    asyncio.create_task(_cleanup_job(job_id))


# ── API-Endpunkte ────────────────────────────────────────────────────────────

@router.get("/export")
async def export_backup(
    current_user: User = Depends(require_permission("settings", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Exportiert die komplette Datenbank als komprimierte JSON-Datei (synchron)."""
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
    Startet einen asynchronen Datenbank-Export.

    Der Export läuft als asyncio.Task im FastAPI-Prozess.
    Fortschritt: GET /backup/progress/{job_id}
    Download:    GET /backup/download/{job_id}
    """
    job_id = str(uuid.uuid4())
    asyncio.create_task(_run_export(job_id))
    return {"job_id": job_id}


@router.get("/progress/{job_id}")
async def get_backup_progress(
    job_id: str,
    current_user: User = Depends(get_current_user),
):
    """Fortschritt eines laufenden Backup-Jobs abrufen."""
    if not re.match(r'^[0-9a-f\-]{36}$', job_id):
        raise HTTPException(status_code=400, detail="Ungültige Job-ID.")
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job nicht gefunden oder abgelaufen.")
    return job


@router.get("/download/{job_id}")
async def download_backup_result(
    job_id: str,
    current_user: User = Depends(require_permission("settings", "update")),
):
    """Fertigen asynchronen Export herunterladen."""
    if not re.match(r'^[0-9a-f\-]{36}$', job_id):
        raise HTTPException(status_code=400, detail="Ungültige Job-ID.")
    result_path = _job_path(job_id, "result")
    if not os.path.exists(result_path):
        raise HTTPException(status_code=404, detail="Export nicht gefunden oder bereits gelöscht.")
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"energy_backup_{timestamp}.json.gz"
    return FileResponse(path=result_path, media_type="application/gzip", filename=filename)


@router.post("/import/start")
async def start_import(
    file: UploadFile = File(...),
    current_user: User = Depends(require_permission("settings", "update")),
):
    """
    Lädt eine Backup-Datei hoch und startet den asynchronen Import.

    Die Datei wird auf Disk gespeichert (vermeidet RAM-Engpass).
    Fortschritt: GET /backup/progress/{job_id}
    """
    if not file.filename or not file.filename.endswith(".gz"):
        raise HTTPException(status_code=400, detail="Bitte eine .json.gz-Backup-Datei hochladen.")

    backup_bytes = await file.read()
    if len(backup_bytes) < 20:
        raise HTTPException(status_code=400, detail="Datei ist leer oder beschädigt.")

    job_id = str(uuid.uuid4())
    upload_path = _job_path(job_id, "upload")
    with open(upload_path, "wb") as f:
        f.write(backup_bytes)

    asyncio.create_task(_run_import(job_id))
    return {"job_id": job_id}


@router.post("/import")
async def import_backup(
    file: UploadFile = File(...),
    replace: bool = True,
    current_user: User = Depends(require_permission("settings", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Importiert eine Backup-Datei (.json.gz) synchron."""
    if not file.filename or not file.filename.endswith(".gz"):
        raise HTTPException(status_code=400, detail="Bitte eine .json.gz-Backup-Datei hochladen.")
    backup_bytes = await file.read()
    if len(backup_bytes) < 20:
        raise HTTPException(status_code=400, detail="Datei ist leer oder beschädigt.")
    try:
        stats = await import_database(db, backup_bytes, replace=replace)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Import fehlgeschlagen: {e}") from e
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
    """Liest Metadaten aus einer Backup-Datei, ohne sie einzuspielen."""
    if not file.filename or not file.filename.endswith(".gz"):
        raise HTTPException(status_code=400, detail="Bitte eine .json.gz-Backup-Datei hochladen.")
    backup_bytes = await file.read()
    try:
        json_bytes = gzip.decompress(backup_bytes)
        data = json.loads(json_bytes.decode("utf-8"))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Datei konnte nicht gelesen werden: {e}") from e

    version = data.get("version", "unbekannt")
    tables = data.get("tables", {})
    table_summary = {t: len(rows) for t, rows in tables.items()}
    total_rows = sum(table_summary.values())
    compatible = version == BACKUP_FORMAT_VERSION
    return {
        "version": version,
        "compatible": compatible,
        "exported_at": data.get("exported_at", "unbekannt"),
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
    """Setzt das System auf Werkseinstellungen zurück."""
    if not verify_password(password, current_user.password_hash):
        raise HTTPException(status_code=403, detail="Falsches Passwort. Werksreset abgebrochen.")

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
