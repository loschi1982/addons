"""
control_strategies.py – BMS-Regelstrategien und Sollwert-Vergleich.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.user import User
from app.services.control_strategy_service import ControlStrategyService

router = APIRouter()


def _to_dict(s) -> dict:
    return {
        "id": str(s.id),
        "name": s.name,
        "description": s.description,
        "strategy_type": s.strategy_type,
        "building_id": str(s.building_id) if s.building_id else None,
        "building_name": s.building.name if s.building else None,
        "usage_unit_id": str(s.usage_unit_id) if s.usage_unit_id else None,
        "usage_unit_name": s.usage_unit.name if s.usage_unit else None,
        "ha_entity_id": s.ha_entity_id,
        "setpoint_heating": float(s.setpoint_heating) if s.setpoint_heating else None,
        "setpoint_cooling": float(s.setpoint_cooling) if s.setpoint_cooling else None,
        "setpoint_night_reduction": float(s.setpoint_night_reduction) if s.setpoint_night_reduction else None,
        "max_co2_ppm": float(s.max_co2_ppm) if s.max_co2_ppm else None,
        "operating_days": s.operating_days or [],
        "operating_time_start": s.operating_time_start.isoformat() if s.operating_time_start else None,
        "operating_time_end": s.operating_time_end.isoformat() if s.operating_time_end else None,
        "valid_from": s.valid_from.isoformat() if s.valid_from else None,
        "valid_until": s.valid_until.isoformat() if s.valid_until else None,
        "is_active": s.is_active,
        "notes": s.notes,
        "created_at": s.created_at.isoformat(),
    }


@router.get("")
async def list_strategies(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    strategy_type: str | None = None,
    is_active: bool | None = True,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Regelstrategien auflisten."""
    service = ControlStrategyService(db)
    result = await service.list_strategies(
        page=page, page_size=page_size,
        strategy_type=strategy_type, is_active=is_active,
    )
    return {**result, "items": [_to_dict(s) for s in result["items"]]}


@router.post("", status_code=201)
async def create_strategy(
    data: dict,
    current_user: User = Depends(require_permission("settings", "write")),
    db: AsyncSession = Depends(get_db),
):
    """Neue Regelstrategie anlegen."""
    from datetime import time
    for field in ("valid_from", "valid_until"):
        if field in data and isinstance(data.get(field), str):
            data[field] = date.fromisoformat(data[field])
    for field in ("operating_time_start", "operating_time_end"):
        if field in data and isinstance(data.get(field), str):
            data[field] = time.fromisoformat(data[field])
    for field in ("building_id", "usage_unit_id"):
        if field in data and isinstance(data.get(field), str) and data[field]:
            data[field] = uuid.UUID(data[field])
    service = ControlStrategyService(db)
    strategy = await service.create_strategy(data)
    from sqlalchemy.ext.asyncio import AsyncSession
    strategy = await service.get_strategy(strategy.id)
    return _to_dict(strategy)


@router.get("/{strategy_id}")
async def get_strategy(
    strategy_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Einzelne Regelstrategie laden."""
    service = ControlStrategyService(db)
    try:
        s = await service.get_strategy(strategy_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Regelstrategie nicht gefunden")
    return _to_dict(s)


@router.put("/{strategy_id}")
async def update_strategy(
    strategy_id: uuid.UUID,
    data: dict,
    current_user: User = Depends(require_permission("settings", "write")),
    db: AsyncSession = Depends(get_db),
):
    """Regelstrategie aktualisieren."""
    from datetime import time
    for field in ("valid_from", "valid_until"):
        if field in data and isinstance(data.get(field), str):
            data[field] = date.fromisoformat(data[field])
    for field in ("operating_time_start", "operating_time_end"):
        if field in data and isinstance(data.get(field), str) and data[field]:
            data[field] = time.fromisoformat(data[field])
    service = ControlStrategyService(db)
    try:
        await service.update_strategy(strategy_id, data)
        s = await service.get_strategy(strategy_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Regelstrategie nicht gefunden")
    return _to_dict(s)


@router.delete("/{strategy_id}", status_code=204)
async def delete_strategy(
    strategy_id: uuid.UUID,
    current_user: User = Depends(require_permission("settings", "write")),
    db: AsyncSession = Depends(get_db),
):
    """Regelstrategie deaktivieren."""
    service = ControlStrategyService(db)
    try:
        await service.delete_strategy(strategy_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Regelstrategie nicht gefunden")


@router.get("/{strategy_id}/compliance")
async def get_compliance(
    strategy_id: uuid.UUID,
    period_start: date = Query(...),
    period_end: date = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Soll-/Ist-Vergleich: Regelstrategie vs. Klimasensor-Messwerte.

    Vergleicht Solltemperatur und CO₂-Grenzwert mit den tatsächlich
    gemessenen Durchschnittswerten der zugeordneten Klimasensoren.
    """
    service = ControlStrategyService(db)
    try:
        return await service.get_compliance_report(strategy_id, period_start, period_end)
    except ValueError:
        raise HTTPException(status_code=404, detail="Regelstrategie nicht gefunden")
