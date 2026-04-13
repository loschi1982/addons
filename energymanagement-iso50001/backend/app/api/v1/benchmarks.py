"""
benchmarks.py – Externe Benchmarkreferenzwerte (VDI 3807, GEFMA 124, BAFA).
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.user import User
from app.services.benchmark_service import BenchmarkService

router = APIRouter()


@router.get("")
async def list_references(
    building_type: str | None = None,
    energy_type: str | None = None,
    source: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle Referenzwerte auflisten (mit Auto-Seeding beim ersten Aufruf)."""
    service = BenchmarkService(db)
    await service.ensure_seeded()
    refs = await service.list_references(
        building_type=building_type, energy_type=energy_type, source=source
    )
    return [
        {
            "id": str(r.id),
            "building_type": r.building_type,
            "energy_type": r.energy_type,
            "source": r.source,
            "unit": r.unit,
            "value_good": float(r.value_good),
            "value_medium": float(r.value_medium),
            "value_poor": float(r.value_poor),
            "description": r.description,
            "valid_from": r.valid_from.isoformat() if r.valid_from else None,
            "is_active": r.is_active,
        }
        for r in refs
    ]


@router.get("/overview")
async def get_overview(
    year: int | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Übersicht aller verfügbaren Referenzwerte und Gebäudetypen."""
    service = BenchmarkService(db)
    return await service.get_overview(year)


@router.get("/compare")
async def compare(
    building_type: str = Query(...),
    energy_type: str = Query(...),
    actual_value: float = Query(..., description="Eigener Messwert"),
    unit: str = Query("kwh_per_m2_a"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Eigenen EnPI-Wert mit Branchenreferenz vergleichen."""
    service = BenchmarkService(db)
    return await service.compare(building_type, energy_type, actual_value, unit)


@router.post("", status_code=201)
async def create_reference(
    data: dict,
    current_user: User = Depends(require_permission("settings", "write")),
    db: AsyncSession = Depends(get_db),
):
    """Neuen Referenzwert anlegen (z.B. eigene Branchenwerte)."""
    service = BenchmarkService(db)
    ref = await service.create_reference(data)
    return {"id": str(ref.id), "created": True}


@router.put("/{ref_id}", status_code=200)
async def update_reference(
    ref_id: uuid.UUID,
    data: dict,
    current_user: User = Depends(require_permission("settings", "write")),
    db: AsyncSession = Depends(get_db),
):
    """Referenzwert aktualisieren."""
    service = BenchmarkService(db)
    try:
        ref = await service.update_reference(ref_id, data)
    except ValueError:
        raise HTTPException(status_code=404, detail="Referenzwert nicht gefunden")
    return {"id": str(ref.id), "updated": True}


@router.delete("/{ref_id}", status_code=204)
async def delete_reference(
    ref_id: uuid.UUID,
    current_user: User = Depends(require_permission("settings", "write")),
    db: AsyncSession = Depends(get_db),
):
    """Referenzwert deaktivieren."""
    service = BenchmarkService(db)
    try:
        await service.delete_reference(ref_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Referenzwert nicht gefunden")
