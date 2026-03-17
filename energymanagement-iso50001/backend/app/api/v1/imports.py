"""
imports.py – Endpunkte für CSV/Excel-Datenimport.

Der Import läuft in drei Schritten:
1. Datei hochladen → Spalten werden erkannt
2. Spaltenzuordnung bestätigen → Import startet
3. Ergebnis abrufen → Zusammenfassung mit Fehlern
"""

import uuid

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.user import User
from app.schemas.reading import (
    ImportMappingProfileResponse,
    ImportMappingRequest,
    ImportResultResponse,
    ImportUploadResponse,
)

router = APIRouter()


@router.post("/upload", response_model=ImportUploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(require_permission("readings", "import")),
    db: AsyncSession = Depends(get_db),
):
    """CSV/Excel-Datei hochladen und Spalten erkennen."""
    raise NotImplementedError("ImportService noch nicht implementiert")


@router.post("/process", response_model=ImportResultResponse)
async def process_import(
    request: ImportMappingRequest,
    current_user: User = Depends(require_permission("readings", "import")),
    db: AsyncSession = Depends(get_db),
):
    """Import mit bestätigter Spaltenzuordnung starten."""
    raise NotImplementedError("ImportService noch nicht implementiert")


@router.get("/{batch_id}", response_model=ImportResultResponse)
async def get_import_result(
    batch_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Import-Ergebnis abrufen."""
    raise NotImplementedError("ImportService noch nicht implementiert")


@router.get("/profiles", response_model=list[ImportMappingProfileResponse])
async def list_mapping_profiles(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Gespeicherte Import-Profile auflisten."""
    raise NotImplementedError("ImportService noch nicht implementiert")


@router.delete("/profiles/{profile_id}")
async def delete_mapping_profile(
    profile_id: uuid.UUID,
    current_user: User = Depends(require_permission("readings", "import")),
    db: AsyncSession = Depends(get_db),
):
    """Import-Profil löschen."""
    raise NotImplementedError("ImportService noch nicht implementiert")
