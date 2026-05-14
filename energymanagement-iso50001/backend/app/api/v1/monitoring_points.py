"""
monitoring_points.py – REST-Endpoints für Energieschema-Betrachtungspunkte.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.common import DeleteResponse
from app.schemas.monitoring_point import MonitoringPointCreate, MonitoringPointResponse
from app.services.monitoring_point_service import MonitoringPointNotFound, MonitoringPointService

router = APIRouter()


@router.get("", response_model=list[MonitoringPointResponse])
async def list_monitoring_points(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle aktiven Betrachtungspunkte des Energieschemas."""
    service = MonitoringPointService(db)
    items = await service.list_points()
    return [MonitoringPointResponse(**item) for item in items]


@router.post("", response_model=MonitoringPointResponse, status_code=201)
async def create_monitoring_point(
    payload: MonitoringPointCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Neuen Betrachtungspunkt anlegen."""
    service = MonitoringPointService(db)
    mp = await service.create_point(
        label=payload.label,
        scope_type=payload.scope_type,
        scope_id=payload.scope_id,
        energy_type=payload.energy_type,
    )
    items = await service.list_points()
    found = next((i for i in items if i["id"] == mp.id), None)
    if found:
        return MonitoringPointResponse(**found)
    # Fallback
    return MonitoringPointResponse(
        id=mp.id,
        label=mp.label,
        scope_type=mp.scope_type,
        scope_id=mp.scope_id,
        scope_name=None,
        energy_type=mp.energy_type,
        meter_count=0,
        is_active=mp.is_active,
        created_at=mp.created_at,
    )


@router.delete("/{mp_id}", response_model=DeleteResponse)
async def delete_monitoring_point(
    mp_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Betrachtungspunkt löschen."""
    service = MonitoringPointService(db)
    try:
        await service.delete_point(mp_id)
    except MonitoringPointNotFound:
        raise HTTPException(status_code=404, detail="Betrachtungspunkt nicht gefunden")
    return DeleteResponse(deleted=True, id=mp_id)


@router.get("/{mp_id}/subtree")
async def get_monitoring_point_subtree(
    mp_id: uuid.UUID,
    period_start: date | None = None,
    period_end: date | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Energieschema-Baum für einen Betrachtungspunkt."""
    service = MonitoringPointService(db)
    try:
        return await service.get_subtree(mp_id, period_start, period_end)
    except MonitoringPointNotFound:
        raise HTTPException(status_code=404, detail="Betrachtungspunkt nicht gefunden")


@router.get("/{mp_id}/subtree-pdf")
async def export_monitoring_point_subtree_pdf(
    mp_id: uuid.UUID,
    period_start: date = Query(...),
    period_end: date = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Energieschema-Auswertung eines Betrachtungspunktes als PDF."""
    from app.services.reporting.schema_report import generate_schema_pdf

    service = MonitoringPointService(db)
    try:
        tree = await service.get_subtree(mp_id, period_start, period_end)
    except MonitoringPointNotFound:
        raise HTTPException(status_code=404, detail="Betrachtungspunkt nicht gefunden")

    label = tree.get("schema_label") or tree.get("name", "schema")
    pdf_bytes = await generate_schema_pdf(
        tree=tree,
        period_start=period_start,
        period_end=period_end,
        schema_label=label,
    )

    name = label.replace(" ", "_")
    filename = f"schema_{name}_{period_start}_{period_end}.pdf"
    content_type = "application/pdf"
    if not pdf_bytes[:4] == b"%PDF":
        content_type = "text/html; charset=utf-8"
        filename = filename.replace(".pdf", ".html")

    return Response(
        content=pdf_bytes,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
