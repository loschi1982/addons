"""
reports.py – Endpunkte für Energieberichte.

Berichte werden als PDF generiert (WeasyPrint) und enthalten
einen eingefrorenen Daten-Snapshot zum Zeitpunkt der Erstellung.
"""

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
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
    ReportStatusResponse,
    ReportUpdate,
)
from app.services.report_service import ReportService

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
    service = ReportService(db)
    return await service.list_reports(
        page=page, page_size=page_size,
        report_type=report_type, status=status,
    )


@router.post("", response_model=ReportResponse, status_code=201)
async def create_report(
    request: ReportCreate,
    current_user: User = Depends(require_permission("reports", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Neuen Bericht anlegen und Daten-Snapshot erstellen."""
    service = ReportService(db)
    return await service.create_report(
        request.model_dump(),
        user_id=current_user.id,
    )


@router.get("/{report_id}", response_model=ReportDetailResponse)
async def get_report(
    report_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Bericht mit Details abrufen."""
    service = ReportService(db)
    report = await service.get_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Bericht nicht gefunden")
    return report


@router.put("/{report_id}", response_model=ReportResponse)
async def update_report(
    report_id: uuid.UUID,
    request: ReportUpdate,
    current_user: User = Depends(require_permission("reports", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Bericht aktualisieren."""
    service = ReportService(db)
    report = await service.update_report(
        report_id, request.model_dump(exclude_unset=True)
    )
    if not report:
        raise HTTPException(status_code=404, detail="Bericht nicht gefunden")
    return report


@router.delete("/{report_id}", response_model=DeleteResponse)
async def delete_report(
    report_id: uuid.UUID,
    current_user: User = Depends(require_permission("reports", "delete")),
    db: AsyncSession = Depends(get_db),
):
    """Bericht und zugehörige PDF-Datei löschen."""
    service = ReportService(db)
    deleted = await service.delete_report(report_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Bericht nicht gefunden")
    return DeleteResponse(message="Bericht gelöscht", id=report_id)


@router.get("/{report_id}/status", response_model=ReportStatusResponse)
async def get_report_status(
    report_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generierungsstatus eines Berichts abfragen (Polling)."""
    service = ReportService(db)
    status = await service.get_report_status(report_id)
    if not status:
        raise HTTPException(status_code=404, detail="Bericht nicht gefunden")
    return status


@router.post("/{report_id}/generate")
async def generate_pdf(
    report_id: uuid.UUID,
    request: ReportGenerateRequest | None = None,
    current_user: User = Depends(require_permission("reports", "generate")),
    db: AsyncSession = Depends(get_db),
):
    """PDF-Bericht synchron generieren."""
    service = ReportService(db)
    report = await service.get_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Bericht nicht gefunden")

    await service.generate_pdf(report_id)
    return {"message": "PDF-Generierung abgeschlossen", "report_id": str(report_id), "status": "ready"}


@router.get("/{report_id}/pdf")
async def download_pdf(
    report_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """PDF-Bericht herunterladen."""
    service = ReportService(db)
    report = await service.get_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Bericht nicht gefunden")

    if not report.pdf_path:
        raise HTTPException(status_code=404, detail="PDF noch nicht generiert")

    pdf_file = Path(report.pdf_path)
    if not pdf_file.exists():
        raise HTTPException(status_code=404, detail="PDF-Datei nicht gefunden")

    safe_title = report.title.encode("ascii", "ignore").decode("ascii").replace(" ", "_")
    filename = f"{safe_title}_{report.period_start}_{report.period_end}.pdf"
    return FileResponse(
        str(pdf_file),
        media_type="application/pdf",
        filename=filename,
    )
