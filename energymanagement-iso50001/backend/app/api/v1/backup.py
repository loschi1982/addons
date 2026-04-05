"""
backup.py – API-Endpunkte für Datenbank-Export und -Import.

GET  /backup/export          → Datenbank als .json.gz herunterladen
POST /backup/import          → .json.gz hochladen und importieren
GET  /backup/info            → Metadaten eines Backup-Files prüfen (ohne Import)
"""

import gzip
import json
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
