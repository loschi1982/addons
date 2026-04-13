"""
trainings.py – Schulungsdokumentation nach ISO 50001 Kap. 7.2/7.3.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.user import User
from app.services.training_service import TrainingService

router = APIRouter()


def _to_dict(t) -> dict:
    return {
        "id": str(t.id),
        "title": t.title,
        "training_type": t.training_type,
        "iso_clause": t.iso_clause,
        "topic": t.topic,
        "description": t.description,
        "training_date": t.training_date.isoformat(),
        "duration_hours": float(t.duration_hours) if t.duration_hours else None,
        "location": t.location,
        "trainer": t.trainer,
        "external_provider": t.external_provider,
        "participants": t.participants or [],
        "participant_count": t.participant_count or len(t.participants or []),
        "status": t.status,
        "effectiveness_check": t.effectiveness_check,
        "effectiveness_date": t.effectiveness_date.isoformat() if t.effectiveness_date else None,
        "effectiveness_result": t.effectiveness_result,
        "next_training_date": t.next_training_date.isoformat() if t.next_training_date else None,
        "recurrence_months": t.recurrence_months,
        "notes": t.notes,
        "created_at": t.created_at.isoformat(),
    }


@router.get("")
async def list_trainings(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    status: str | None = None,
    year: int | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Schulungen paginiert auflisten."""
    service = TrainingService(db)
    result = await service.list_trainings(page=page, page_size=page_size, status=status, year=year)
    return {**result, "items": [_to_dict(t) for t in result["items"]]}


@router.get("/stats")
async def get_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Statistiken: Gesamt, geplant, fällige Wiederholungen."""
    service = TrainingService(db)
    return await service.get_stats()


@router.post("", status_code=201)
async def create_training(
    data: dict,
    current_user: User = Depends(require_permission("iso", "manage_audits")),
    db: AsyncSession = Depends(get_db),
):
    """Neue Schulung anlegen."""
    from datetime import date
    if "training_date" in data and isinstance(data["training_date"], str):
        data["training_date"] = date.fromisoformat(data["training_date"])
    if "effectiveness_date" in data and isinstance(data.get("effectiveness_date"), str):
        data["effectiveness_date"] = date.fromisoformat(data["effectiveness_date"])
    if "next_training_date" in data and isinstance(data.get("next_training_date"), str):
        data["next_training_date"] = date.fromisoformat(data["next_training_date"])
    service = TrainingService(db)
    training = await service.create_training(data)
    return _to_dict(training)


@router.get("/{training_id}")
async def get_training(
    training_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Einzelne Schulung laden."""
    service = TrainingService(db)
    try:
        training = await service.get_training(training_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Schulung nicht gefunden")
    return _to_dict(training)


@router.put("/{training_id}")
async def update_training(
    training_id: uuid.UUID,
    data: dict,
    current_user: User = Depends(require_permission("iso", "manage_audits")),
    db: AsyncSession = Depends(get_db),
):
    """Schulung aktualisieren."""
    from datetime import date
    for field in ("training_date", "effectiveness_date", "next_training_date"):
        if field in data and isinstance(data.get(field), str):
            data[field] = date.fromisoformat(data[field])
    service = TrainingService(db)
    try:
        training = await service.update_training(training_id, data)
    except ValueError:
        raise HTTPException(status_code=404, detail="Schulung nicht gefunden")
    return _to_dict(training)


@router.delete("/{training_id}", status_code=204)
async def delete_training(
    training_id: uuid.UUID,
    current_user: User = Depends(require_permission("iso", "manage_audits")),
    db: AsyncSession = Depends(get_db),
):
    """Schulung löschen."""
    service = TrainingService(db)
    try:
        await service.delete_training(training_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Schulung nicht gefunden")
