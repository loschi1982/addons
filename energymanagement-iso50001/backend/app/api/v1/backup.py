"""
backup.py – API-Endpunkte für Datenbank-Export und -Import via pg_dump/pg_restore.

GET  /backup/export/start         → Async-Export starten (pg_dump), gibt job_id zurück
GET  /backup/download/{job_id}    → Fertigen Export herunterladen
POST /backup/import/start         → Backup hochladen und Async-Import starten (pg_restore)
GET  /backup/progress/{job_id}    → Fortschritt eines laufenden Jobs abrufen
POST /backup/factory-reset        → System auf Werkseinstellungen zurücksetzen

Export und Import verwenden pg_dump / pg_restore (postgresql16-client ist im Image).
Das ist zuverlässiger und schneller als die frühere Python-Row-Iteration.
Fortschritt wird in einem In-Memory-Dict (_jobs) gespeichert, kein Redis nötig.
"""

import asyncio
import os
import re
import tempfile
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import structlog
from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.core.security import verify_password
from app.models.user import User
from app.services.backup_service import factory_reset

logger = structlog.get_logger()
router = APIRouter()

# ── In-Memory Job-Registry ──────────────────────────────────────────────────
_jobs: dict[str, dict[str, Any]] = {}
_TMP = tempfile.gettempdir()


def _job_path(job_id: str, suffix: str) -> str:
    """Sicherer Pfad für temporäre Backup-Dateien."""
    return os.path.join(_TMP, f"backup_{suffix}_{job_id}.dump")


def _pg_env(database_url: str) -> tuple[dict, dict]:
    """
    Parst die DATABASE_URL und gibt (pg_kwargs, env) zurück.

    pg_kwargs: dict mit host, port, user, dbname für CLI-Flags
    env:       Umgebungsvariablen für den Subprocess (mit PGPASSWORD)
    """
    # postgresql+asyncpg://user:pass@host:port/dbname → postgresql://...
    url = database_url.replace("+asyncpg", "")
    parsed = urlparse(url)
    env = os.environ.copy()
    env["PGPASSWORD"] = parsed.password or ""
    pg = {
        "host": parsed.hostname or "localhost",
        "port": str(parsed.port or 5432),
        "user": parsed.username or "energy",
        "dbname": parsed.path.lstrip("/"),
    }
    return pg, env


async def _cleanup_job(job_id: str, delay: int = 7200) -> None:
    """Job-Eintrag und temp. Datei nach `delay` Sekunden löschen."""
    await asyncio.sleep(delay)
    _jobs.pop(job_id, None)
    for suffix in ("result", "upload"):
        path = _job_path(job_id, suffix)
        try:
            os.unlink(path)
        except OSError:
            pass


# ── Export ──────────────────────────────────────────────────────────────────

async def _run_export(job_id: str) -> None:
    """
    Exportiert die komplette Datenbank via pg_dump (Custom-Format, alle Schemas).

    Kein --schema-Filter: TimescaleDB-Hypertables speichern ihre Daten in
    _timescaledb_internal als Chunks – ohne dieses Schema wäre das Backup leer.
    Schreibt die Ausgabe direkt auf Disk – kein RAM-Limit.
    """
    from app.config import get_settings
    settings = get_settings()

    _jobs[job_id] = {"status": "running", "phase": "export", "percent": 50}
    result_path = _job_path(job_id, "result")
    pg, env = _pg_env(settings.database_url)

    logger.info("backup_export_start", job_id=job_id, host=pg["host"], db=pg["dbname"])

    try:
        proc = await asyncio.create_subprocess_exec(
            "pg_dump",
            "-h", pg["host"],
            "-p", pg["port"],
            "-U", pg["user"],
            "-d", pg["dbname"],
            "--format=custom",      # komprimiertes Binärformat
            "--no-acl",             # keine GRANT-Statements
            "--no-owner",           # keine ALTER OWNER-Statements
            # Kein --schema=public! TimescaleDB-Chunks liegen in _timescaledb_internal.
            # Nur timescaledb_information ausschließen (nur Views, kein Datenverlust).
            "--exclude-schema=timescaledb_information",
            "-f", result_path,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()

        if proc.returncode != 0:
            err = stderr.decode(errors="replace").strip()
            logger.error("backup_export_failed", job_id=job_id, returncode=proc.returncode, stderr=err)
            _jobs[job_id] = {"status": "error", "error": f"pg_dump fehlgeschlagen (Code {proc.returncode}): {err}"}
            return

        size_kb = round(os.path.getsize(result_path) / 1024, 1)
        _jobs[job_id] = {
            "status": "done", "phase": "export", "percent": 100,
            "size_kb": size_kb, "result_path": result_path,
        }
        logger.info("backup_export_done", job_id=job_id, size_kb=size_kb)

    except FileNotFoundError:
        msg = "pg_dump nicht gefunden. Ist postgresql-client installiert?"
        logger.error("backup_export_failed", job_id=job_id, error=msg)
        _jobs[job_id] = {"status": "error", "error": msg}
    except Exception as e:
        logger.error("backup_export_failed", job_id=job_id, error=str(e))
        _jobs[job_id] = {"status": "error", "error": str(e)}

    asyncio.create_task(_cleanup_job(job_id))


# ── Import ──────────────────────────────────────────────────────────────────

async def _psql_cmd(pg: dict, env: dict, sql: str) -> tuple[int, str]:
    """Führt einen einzelnen SQL-Befehl via psql aus. Gibt (returncode, stderr) zurück."""
    proc = await asyncio.create_subprocess_exec(
        "psql",
        "-h", pg["host"],
        "-p", pg["port"],
        "-U", pg["user"],
        "-d", pg["dbname"],
        "-c", sql,
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    return proc.returncode, stderr.decode(errors="replace").strip()


async def _run_import(job_id: str) -> None:
    """
    Importiert ein pg_dump-Backup via pg_restore (TimescaleDB-kompatibel).

    TimescaleDB-Restore-Prozedur:
      1. timescaledb_pre_restore()  – deaktiviert Jobs, versetzt DB in Restore-Modus
      2. pg_restore --clean         – löscht + restauriert alle Objekte inkl. Chunks
      3. timescaledb_post_restore() – aktiviert Jobs, rebuildet Metadaten

    Kein manuelles DROP SCHEMA nötig – pg_restore --clean übernimmt das.
    """
    from app.config import get_settings
    settings = get_settings()

    upload_path = _job_path(job_id, "upload")
    if not os.path.exists(upload_path):
        _jobs[job_id] = {"status": "error", "error": "Upload-Datei nicht gefunden."}
        return

    pg, env = _pg_env(settings.database_url)
    logger.info("backup_import_start", job_id=job_id)

    try:
        # Schritt 1: TimescaleDB in Restore-Modus versetzen
        _jobs[job_id] = {"status": "running", "phase": "prepare", "percent": 5}
        rc, err = await _psql_cmd(pg, env, "SELECT timescaledb_pre_restore();")
        if rc != 0:
            logger.warning("backup_import_pre_restore_warn", stderr=err)
            # Kein harter Fehler – läuft auch ohne TimescaleDB-Extension

        # Schritt 2: pg_restore (--clean = bestehende Objekte vorher löschen)
        _jobs[job_id] = {"status": "running", "phase": "import", "percent": 20}
        proc = await asyncio.create_subprocess_exec(
            "pg_restore",
            "-h", pg["host"],
            "-p", pg["port"],
            "-U", pg["user"],
            "-d", pg["dbname"],
            "--no-acl",
            "--no-owner",
            "--clean",          # DROP IF EXISTS vor jedem CREATE
            "--if-exists",      # verhindert Fehler bei nicht-existierenden Objekten
            upload_path,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()

        # pg_restore: returncode 1 = Warnungen (normal), >= 2 = echter Fehler
        if proc.returncode >= 2:
            err_text = stderr.decode(errors="replace").strip()
            logger.error("backup_import_failed", job_id=job_id, returncode=proc.returncode, stderr=err_text)
            _jobs[job_id] = {"status": "error", "error": f"pg_restore fehlgeschlagen (Code {proc.returncode}): {err_text}"}
            # Restore-Modus trotzdem beenden
            await _psql_cmd(pg, env, "SELECT timescaledb_post_restore();")
            return

        warnings = stderr.decode(errors="replace").strip()
        if warnings:
            logger.warning("backup_import_warnings", job_id=job_id, warnings=warnings[:500])

        # Schritt 3: TimescaleDB Restore-Modus beenden
        _jobs[job_id] = {"status": "running", "phase": "finalize", "percent": 95}
        rc, err = await _psql_cmd(pg, env, "SELECT timescaledb_post_restore();")
        if rc != 0:
            logger.warning("backup_import_post_restore_warn", stderr=err)

        _jobs[job_id] = {"status": "done", "phase": "import", "percent": 100}
        logger.info("backup_import_done", job_id=job_id)

    except FileNotFoundError:
        msg = "pg_restore nicht gefunden. Ist postgresql-client installiert?"
        logger.error("backup_import_failed", job_id=job_id, error=msg)
        _jobs[job_id] = {"status": "error", "error": msg}
    except Exception as e:
        logger.error("backup_import_failed", job_id=job_id, error=str(e))
        _jobs[job_id] = {"status": "error", "error": str(e)}
    finally:
        try:
            os.unlink(upload_path)
        except OSError:
            pass

    asyncio.create_task(_cleanup_job(job_id))


# ── API-Endpunkte ────────────────────────────────────────────────────────────

@router.post("/export/start")
async def start_export(
    current_user: User = Depends(require_permission("settings", "update")),
):
    """
    Startet einen asynchronen Datenbank-Export via pg_dump.

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
    if not re.match(r"^[0-9a-f\-]{36}$", job_id):
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
    if not re.match(r"^[0-9a-f\-]{36}$", job_id):
        raise HTTPException(status_code=400, detail="Ungültige Job-ID.")
    result_path = _job_path(job_id, "result")
    if not os.path.exists(result_path):
        raise HTTPException(status_code=404, detail="Export nicht gefunden oder bereits gelöscht.")
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"energy_backup_{timestamp}.dump"
    return FileResponse(
        path=result_path,
        media_type="application/octet-stream",
        filename=filename,
    )


@router.post("/import/start")
async def start_import(
    file: UploadFile = File(...),
    current_user: User = Depends(require_permission("settings", "update")),
):
    """
    Lädt eine pg_dump-Backup-Datei (.dump) hoch und startet den asynchronen Import.

    Fortschritt: GET /backup/progress/{job_id}
    """
    # pg_dump Custom-Format: Magic Bytes "PGDMP"
    backup_bytes = await file.read()
    if len(backup_bytes) < 5 or not backup_bytes[:5].startswith(b"PGDMP"):
        raise HTTPException(
            status_code=400,
            detail="Ungültige Backup-Datei. Bitte eine .dump-Datei (pg_dump Custom-Format) hochladen.",
        )

    job_id = str(uuid.uuid4())
    upload_path = _job_path(job_id, "upload")
    with open(upload_path, "wb") as f:
        f.write(backup_bytes)

    asyncio.create_task(_run_import(job_id))
    return {"job_id": job_id}


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
