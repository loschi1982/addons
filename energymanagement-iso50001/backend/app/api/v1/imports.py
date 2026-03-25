"""
imports.py – Endpunkte für CSV/Excel-Datenimport.

Der Import läuft in drei Schritten:
1. Datei hochladen → Spalten werden erkannt
2. Spaltenzuordnung bestätigen → Import startet
3. Ergebnis abrufen → Zusammenfassung mit Fehlern

Zusätzlich: Import-Historie, Rückgängig-Funktion, Mapping-Profile.
"""

import uuid

from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.user import User
from app.schemas.common import MessageResponse, PaginatedResponse
from app.schemas.reading import (
    DetectedMeterColumn,
    ImportMappingProfileResponse,
    ImportMappingRequest,
    ImportResultResponse,
    ImportUploadResponse,
)
from app.services.import_service import ImportService

router = APIRouter()


@router.post("/upload", response_model=ImportUploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(require_permission("readings", "import")),
    db: AsyncSession = Depends(get_db),
):
    """CSV/Excel-Datei hochladen und Spalten erkennen."""
    content = await file.read()
    service = ImportService(db)
    result = await service.upload_file(
        filename=file.filename or "unknown",
        content=content,
        user_id=current_user.id,
    )

    # Multi-Meter: Auto-Matching gegen bestehende Zähler
    if result.get("is_multi_meter") and result.get("meter_columns"):
        col_names = [mc["column_name"] for mc in result["meter_columns"]]
        matches = await service.match_columns_to_meters(col_names)
        for i, mc in enumerate(result["meter_columns"]):
            mc["matched_meter_id"] = matches[i]["matched_meter_id"]
            mc["matched_meter_name"] = matches[i]["matched_meter_name"]

    return ImportUploadResponse(**result)


@router.post("/process", response_model=ImportResultResponse)
async def process_import(
    request: ImportMappingRequest,
    current_user: User = Depends(require_permission("readings", "import")),
    db: AsyncSession = Depends(get_db),
):
    """Import mit bestätigter Spaltenzuordnung starten."""
    import uuid as _uuid

    service = ImportService(db)

    # Multi-Meter Import
    if request.meter_column_mapping:
        # Batch laden um Datei-Infos zu holen
        batch = await service.get_import_result(request.batch_id)

        # meter_column_mapping konvertieren: str-Index → UUID
        mcm = {
            int(k): _uuid.UUID(v)
            for k, v in request.meter_column_mapping.items()
        }

        # Batch-Daten erneut laden (Datei muss nochmal geparst werden)
        # Da wir die Datei nicht speichern, nutzen wir process_import als Fallback
        # und der eigentliche Multi-Meter-Import passiert über die Rows-API
        result = await service.process_import(
            batch_id=request.batch_id,
            column_mapping=request.column_mapping,
            date_format=request.date_format,
            decimal_separator=request.decimal_separator,
            skip_duplicates=request.skip_duplicates,
            save_as_profile=request.save_as_profile,
            user_id=current_user.id,
            meter_column_mapping=mcm,
        )
    else:
        result = await service.process_import(
            batch_id=request.batch_id,
            column_mapping=request.column_mapping,
            date_format=request.date_format,
            decimal_separator=request.decimal_separator,
            skip_duplicates=request.skip_duplicates,
            save_as_profile=request.save_as_profile,
            user_id=current_user.id,
        )
    return ImportResultResponse(**result)


@router.get("/history")
async def list_import_history(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle bisherigen Imports auflisten."""
    service = ImportService(db)
    return await service.list_import_history(page=page, page_size=page_size)


@router.get("/{batch_id}", response_model=ImportResultResponse)
async def get_import_result(
    batch_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Import-Ergebnis abrufen."""
    service = ImportService(db)
    result = await service.get_import_result(batch_id)
    return ImportResultResponse(**result)


@router.delete("/{batch_id}", response_model=MessageResponse)
async def undo_import(
    batch_id: uuid.UUID,
    current_user: User = Depends(require_permission("readings", "import")),
    db: AsyncSession = Depends(get_db),
):
    """Import rückgängig machen – löscht alle importierten Zählerstände."""
    service = ImportService(db)
    count = await service.undo_import(batch_id)
    return MessageResponse(message=f"{count} Zählerstände gelöscht")


@router.get("/profiles/list", response_model=list[ImportMappingProfileResponse])
async def list_mapping_profiles(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Gespeicherte Import-Profile auflisten."""
    service = ImportService(db)
    return await service.list_mapping_profiles()


@router.delete("/profiles/{profile_id}", response_model=MessageResponse)
async def delete_mapping_profile(
    profile_id: uuid.UUID,
    current_user: User = Depends(require_permission("readings", "import")),
    db: AsyncSession = Depends(get_db),
):
    """Import-Profil löschen."""
    service = ImportService(db)
    await service.delete_mapping_profile(profile_id)
    return MessageResponse(message="Profil gelöscht")
