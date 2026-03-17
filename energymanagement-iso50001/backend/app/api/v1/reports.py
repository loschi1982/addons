"""
reports.py – Endpunkte für Energieberichte.

Berichte werden als PDF generiert (WeasyPrint) und enthalten
einen eingefrorenen Daten-Snapshot zum Zeitpunkt der Erstellung.
"""

import uuid

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.user import User
from app.schemas.common import DeleteResponse, PaginatedResponse
from app.schemas.report import (
    ReportCreate,
    ReportDetailResponse,
    ReportGenerateRequest,
    ReportResponse,
    ReportUpdate,
)

router = APIRouter()


@router.get("", response_model=PaginatedResponse[ReportResponse])
async def list_reports(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    report_type: str | None = None,
    status: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle Berichte auflisten."""
    raise NotImplementedError("ReportService noch nicht implementiert")


@router.post("", response_model=ReportResponse, status_code=201)
async def create_report(
    request: ReportCreate,
    current_user: User = Depends(require_permission("reports", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Neuen Bericht anlegen und Daten-Snapshot erstellen."""
    raise NotImplementedError("ReportService noch nicht implementiert")


@router.get("/{report_id}", response_model=ReportDetailResponse)
async def get_report(
    report_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Bericht mit Details abrufen."""
    raise NotImplementedError("ReportService noch nicht implementiert")


@router.put("/{report_id}", response_model=ReportResponse)
async def update_report(
    report_id: uuid.UUID,
    request: ReportUpdate,
    current_user: User = Depends(require_permission("reports", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Bericht aktualisieren."""
    raise NotImplementedError("ReportService noch nicht implementiert")


@router.delete("/{report_id}", response_model=DeleteResponse)
async def delete_report(
    report_id: uuid.UUID,
    current_user: User = Depends(require_permission("reports", "delete")),
    db: AsyncSession = Depends(get_db),
):
    """Bericht löschen."""
    raise NotImplementedError("ReportService noch nicht implementiert")


@router.post("/{report_id}/generate")
async def generate_pdf(
    report_id: uuid.UUID,
    request: ReportGenerateRequest | None = None,
    current_user: User = Depends(require_permission("reports", "generate")),
    db: AsyncSession = Depends(get_db),
):
    """PDF-Bericht generieren (async via Celery)."""
    raise NotImplementedError("ReportService noch nicht implementiert")


@router.get("/{report_id}/download")
async def download_pdf(
    report_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """PDF-Bericht herunterladen."""
    raise NotImplementedError("ReportService noch nicht implementiert")
