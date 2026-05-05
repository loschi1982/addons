"""
backup.py – API-Endpunkte für Datenbank-Export und -Import via pg_dump/pg_restore.

POST /backup/export/start         → Async-Export starten, gibt job_id zurück
GET  /backup/download/{job_id}    → Fertigen Export herunterladen
POST /backup/import/start         → Backup hochladen und Async-Import starten
GET  /backup/progress/{job_id}    → Fortschritt abrufen (Backend-Neustart-sicher)
POST /backup/factory-reset        → System auf Werkseinstellungen zurücksetzen

Robustheits-Design:
- Export und Import laufen als Shell-Skripte in einem eigenen Prozess-Session
  (start_new_session=True) → überleben Backend-Neustarts vollständig
- Status wird auf Disk geschrieben (/tmp/backup_status_{job_id}.json)
  → nach einem Backend-Neustart kann der Client weiterpollen
- _jobs-Dict ist nur ein RAM-Cache; fällt er weg, liest der Endpoint die Datei
"""

import json
import os
import re
import subprocess
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

_TMP = tempfile.gettempdir()

# RAM-Cache für schnellen Zugriff – kein verlässlicher Zustand nach Neustart
_jobs: dict[str, dict[str, Any]] = {}


# ── Pfad-Helfer ──────────────────────────────────────────────────────────────

def _status_path(job_id: str) -> str:
    return os.path.join(_TMP, f"backup_status_{job_id}.json")

def _result_path(job_id: str) -> str:
    return os.path.join(_TMP, f"backup_result_{job_id}.dump")

def _upload_path(job_id: str) -> str:
    return os.path.join(_TMP, f"backup_upload_{job_id}.dump")

def _script_path(job_id: str, kind: str) -> str:
    return os.path.join(_TMP, f"backup_script_{kind}_{job_id}.sh")


# ── Status-Persistenz ────────────────────────────────────────────────────────

def _write_status(job_id: str, data: dict) -> None:
    """Status in RAM-Cache UND Datei schreiben."""
    _jobs[job_id] = data
    try:
        with open(_status_path(job_id), "w") as f:
            json.dump(data, f)
    except OSError as e:
        logger.warning("backup_status_write_failed", job_id=job_id, error=str(e))


def _read_status(job_id: str) -> dict | None:
    """Status aus RAM-Cache oder Datei lesen."""
    if job_id in _jobs:
        return _jobs[job_id]
    path = _status_path(job_id)
    if os.path.exists(path):
        try:
            with open(path) as f:
                data = json.load(f)
            _jobs[job_id] = data
            return data
        except (OSError, json.JSONDecodeError):
            pass
    return None


def _cleanup_files(job_id: str) -> None:
    """Temporäre Dateien eines abgeschlossenen Jobs löschen."""
    for path in [
        _status_path(job_id),
        _upload_path(job_id),
        _script_path(job_id, "export"),
        _script_path(job_id, "import"),
        os.path.join(_TMP, f"backup_err_{job_id}.log"),
    ]:
        try:
            os.unlink(path)
        except OSError:
            pass


# ── DB-URL parsen ─────────────────────────────────────────────────────────────

def _pg_env(database_url: str) -> tuple[dict, dict]:
    """
    Parst die DATABASE_URL.

    Gibt zurück:
      pg:  dict mit host, port, user, dbname für pg_dump-CLI-Flags
      env: Umgebungsvariablen mit PGPASSWORD für den Subprocess
    """
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


# ── Export ──────────────────────────────────────────────────────────────────

def _start_export(job_id: str, pg: dict, env: dict) -> None:
    """
    Schreibt ein Shell-Skript für pg_dump und startet es entkoppelt.

    start_new_session=True: der Prozess läuft in einer eigenen Session –
    ein Backend-Neustart sendet kein SIGTERM an diesen Prozess.
    Der Status wird von der Shell in /tmp/backup_status_{job_id}.json geschrieben.
    """
    result = _result_path(job_id)
    status = _status_path(job_id)
    err_log = os.path.join(_TMP, f"backup_err_{job_id}.log")
    script = _script_path(job_id, "export")

    # Shell-Skript schreiben (job_id kommt aus uuid4, kein Injection-Risiko)
    script_content = f"""#!/bin/bash
set -euo pipefail

STATUS='{status}'
RESULT='{result}'
ERR_LOG='{err_log}'

echo '{{"status":"running","phase":"export","percent":50}}' > "$STATUS"

pg_dump \\
  -h '{pg["host"]}' -p '{pg["port"]}' \\
  -U '{pg["user"]}' -d '{pg["dbname"]}' \\
  --format=custom --no-acl --no-owner \\
  --exclude-schema=timescaledb_information \\
  -f "$RESULT" 2>"$ERR_LOG"

RC=$?
if [ $RC -ne 0 ]; then
  ERR=$(cat "$ERR_LOG" | tr '"' "'" | tr '\\n' ' ' | head -c 300)
  echo "{{\\"status\\":\\"error\\",\\"error\\":\\"pg_dump fehlgeschlagen (Code $RC): $ERR\\"}}" > "$STATUS"
  exit 1
fi

SIZE_KB=$(du -k "$RESULT" | cut -f1)
echo "{{\\"status\\":\\"done\\",\\"phase\\":\\"export\\",\\"percent\\":100,\\"size_kb\\":$SIZE_KB}}" > "$STATUS"
rm -f "$ERR_LOG" '{script}'
"""

    with open(script, "w") as f:
        f.write(script_content)
    os.chmod(script, 0o700)

    subprocess.Popen(
        ["bash", script],
        env=env,
        start_new_session=True,   # von Parent-Session lösen → überlebt Backend-Neustart
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
    )
    logger.info("backup_export_started", job_id=job_id, host=pg["host"], db=pg["dbname"])


# ── Import ──────────────────────────────────────────────────────────────────

def _start_import(job_id: str, pg: dict, env: dict) -> None:
    """
    Schreibt ein Shell-Skript für pg_restore (TimescaleDB-Prozedur) und startet es entkoppelt.

    Ablauf im Skript:
      1. timescaledb_pre_restore()
      2. pg_restore --clean --if-exists
      3. timescaledb_post_restore()
    """
    upload = _upload_path(job_id)
    status = _status_path(job_id)
    err_log = os.path.join(_TMP, f"backup_err_{job_id}.log")
    script = _script_path(job_id, "import")

    script_content = f"""#!/bin/bash

STATUS='{status}'
UPLOAD='{upload}'
ERR_LOG='{err_log}'

PSQL_CMD="psql -h '{pg["host"]}' -p '{pg["port"]}' -U '{pg["user"]}' -d '{pg["dbname"]}'"
PG_RESTORE_CMD="pg_restore -h '{pg["host"]}' -p '{pg["port"]}' -U '{pg["user"]}' -d '{pg["dbname"]}'"

# Schritt 1: TimescaleDB Restore-Modus aktivieren
echo '{{"status":"running","phase":"prepare","percent":5}}' > "$STATUS"
$PSQL_CMD -c "SELECT timescaledb_pre_restore();" 2>/dev/null || true

# Schritt 2: pg_restore
echo '{{"status":"running","phase":"import","percent":20}}' > "$STATUS"
$PG_RESTORE_CMD --no-acl --no-owner --clean --if-exists "$UPLOAD" 2>"$ERR_LOG"
RC=$?

if [ $RC -ge 2 ]; then
  ERR=$(tail -5 "$ERR_LOG" | tr '"' "'" | tr '\\n' ' ' | head -c 400)
  $PSQL_CMD -c "SELECT timescaledb_post_restore();" 2>/dev/null || true
  echo "{{\\"status\\":\\"error\\",\\"error\\":\\"pg_restore fehlgeschlagen (Code $RC): $ERR\\"}}" > "$STATUS"
  rm -f "$UPLOAD" "$ERR_LOG" '{script}'
  exit 1
fi

# Schritt 3: TimescaleDB Restore-Modus beenden
echo '{{"status":"running","phase":"finalize","percent":95}}' > "$STATUS"
$PSQL_CMD -c "SELECT timescaledb_post_restore();" 2>/dev/null || true

echo '{{"status":"done","phase":"import","percent":100}}' > "$STATUS"
rm -f "$UPLOAD" "$ERR_LOG" '{script}'
"""

    with open(script, "w") as f:
        f.write(script_content)
    os.chmod(script, 0o700)

    subprocess.Popen(
        ["bash", script],
        env=env,
        start_new_session=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
    )
    logger.info("backup_import_started", job_id=job_id)


# ── API-Endpunkte ────────────────────────────────────────────────────────────

@router.post("/export/start")
async def start_export(
    current_user: User = Depends(require_permission("settings", "update")),
):
    """
    Startet einen Datenbank-Export via pg_dump.

    Der Export-Prozess ist vom Backend entkoppelt und überlebt dessen Neustart.
    Fortschritt: GET /backup/progress/{job_id}
    Download:    GET /backup/download/{job_id}
    """
    from app.config import get_settings
    settings = get_settings()

    job_id = str(uuid.uuid4())
    pg, env = _pg_env(settings.database_url)

    _write_status(job_id, {"status": "running", "phase": "export", "percent": 50})

    try:
        _start_export(job_id, pg, env)
    except Exception as e:
        _write_status(job_id, {"status": "error", "error": str(e)})
        raise HTTPException(status_code=500, detail=f"Export konnte nicht gestartet werden: {e}") from e

    return {"job_id": job_id}


@router.get("/progress/{job_id}")
async def get_backup_progress(
    job_id: str,
    current_user: User = Depends(get_current_user),
):
    """
    Fortschritt eines Backup-Jobs abrufen.

    Liest zunächst aus dem RAM-Cache, dann aus der Status-Datei auf Disk.
    Funktioniert auch nach einem Backend-Neustart solange der Job-Prozess läuft.
    """
    if not re.match(r"^[0-9a-f\-]{36}$", job_id):
        raise HTTPException(status_code=400, detail="Ungültige Job-ID.")

    # Status-Datei direkt lesen (aktuellster Stand vom laufenden Shell-Skript)
    status_file = _status_path(job_id)
    if os.path.exists(status_file):
        try:
            with open(status_file) as f:
                data = json.load(f)
            _jobs[job_id] = data  # Cache aktualisieren
            return data
        except (OSError, json.JSONDecodeError):
            pass

    # Fallback: RAM-Cache (z.B. direkt nach dem Start bevor Datei geschrieben wurde)
    job = _jobs.get(job_id)
    if job is not None:
        return job

    raise HTTPException(status_code=404, detail="Job nicht gefunden oder abgelaufen.")


@router.get("/download/{job_id}")
async def download_backup_result(
    job_id: str,
    current_user: User = Depends(require_permission("settings", "update")),
):
    """Fertigen Export herunterladen."""
    if not re.match(r"^[0-9a-f\-]{36}$", job_id):
        raise HTTPException(status_code=400, detail="Ungültige Job-ID.")
    path = _result_path(job_id)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Export nicht gefunden oder bereits gelöscht.")
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    return FileResponse(
        path=path,
        media_type="application/octet-stream",
        filename=f"energy_backup_{timestamp}.dump",
    )


@router.post("/import/start")
async def start_import(
    file: UploadFile = File(...),
    current_user: User = Depends(require_permission("settings", "update")),
):
    """
    Lädt eine pg_dump-Backup-Datei (.dump) hoch und startet den Import.

    Der Import-Prozess ist vom Backend entkoppelt und überlebt dessen Neustart.
    Fortschritt: GET /backup/progress/{job_id}
    """
    from app.config import get_settings
    settings = get_settings()

    # Magic Bytes prüfen (pg_dump Custom-Format beginnt mit "PGDMP")
    backup_bytes = await file.read()
    if len(backup_bytes) < 5 or backup_bytes[:5] != b"PGDMP":
        raise HTTPException(
            status_code=400,
            detail="Ungültige Backup-Datei. Bitte eine .dump-Datei (pg_dump Custom-Format) hochladen.",
        )

    job_id = str(uuid.uuid4())
    upload = _upload_path(job_id)
    with open(upload, "wb") as f:
        f.write(backup_bytes)

    pg, env = _pg_env(settings.database_url)
    _write_status(job_id, {"status": "running", "phase": "prepare", "percent": 5})

    try:
        _start_import(job_id, pg, env)
    except Exception as e:
        _write_status(job_id, {"status": "error", "error": str(e)})
        try:
            os.unlink(upload)
        except OSError:
            pass
        raise HTTPException(status_code=500, detail=f"Import konnte nicht gestartet werden: {e}") from e

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
