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
    return ImportUploadResponse(**result)


@router.post("/process", response_model=ImportResultResponse)
async def process_import(
    request: ImportMappingRequest,
    current_user: User = Depends(require_permission("readings", "import")),
    db: AsyncSession = Depends(get_db),
):
    """Import mit bestätigter Spaltenzuordnung starten."""
    service = ImportService(db)
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
