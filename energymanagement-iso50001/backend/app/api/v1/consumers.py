"""
consumers.py – Endpunkte für Verbraucher (Großverbraucher / SEU).

Verbraucher sind energetisch relevante Anlagen (z.B. Heizkessel,
Lüftungsanlage), die einem oder mehreren Zählern zugeordnet werden.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.consumer import Consumer, meter_consumer
from app.models.meter import Meter
from app.models.user import User
from app.schemas.common import DeleteResponse, PaginatedResponse
from app.schemas.meter import ConsumerCreate, ConsumerResponse, ConsumerUpdate

router = APIRouter()

# Mapping zwischen Schema-Strings und DB-Integers für Priorität
_PRIORITY_TO_INT = {"low": 0, "normal": 1, "high": 2, "critical": 3}
_PRIORITY_TO_STR = {v: k for k, v in _PRIORITY_TO_INT.items()}


def _priority_to_str(val: int | None) -> str:
    """DB-Integer → Schema-String."""
    return _PRIORITY_TO_STR.get(val or 0, "normal")


def _consumer_to_response(c: Consumer, replaced_by_name: str | None = None) -> ConsumerResponse:
    """Consumer-Modell → ConsumerResponse."""
    return ConsumerResponse(
        id=c.id,
        name=c.name,
        category=c.category,
        rated_power_kw=c.rated_power,
        operating_hours_per_year=int(c.operating_hours) if c.operating_hours else None,
        priority=_priority_to_str(c.priority),
        usage_unit_id=c.usage_unit_id,
        description=c.notes,
        meter_ids=[m.id for m in c.meters] if c.meters else [],
        manufacturer=c.manufacturer,
        model=c.model,
        serial_number=c.serial_number,
        commissioned_at=c.commissioned_at,
        decommissioned_at=c.decommissioned_at,
        replaced_by_id=c.replaced_by_id,
        replaced_by_name=replaced_by_name,
        purchase_cost=c.purchase_cost,
        installation_cost=c.installation_cost,
        annual_maintenance_cost=c.annual_maintenance_cost,
        expected_lifetime_years=c.expected_lifetime_years,
        created_at=c.created_at,
    )


@router.get("", response_model=PaginatedResponse[ConsumerResponse])
async def list_consumers(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    category: str | None = None,
    usage_unit_id: uuid.UUID | None = None,
    search: str | None = None,
    status: str | None = Query(None, description="active, decommissioned, all"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle Verbraucher auflisten."""
    query = select(Consumer)

    # Status-Filter
    if status == "decommissioned":
        query = query.where(Consumer.decommissioned_at.isnot(None))
    elif status == "all":
        pass  # keine Einschränkung
    else:
        # Standard: nur aktive (nicht dekommissioniert und is_active)
        query = query.where(
            Consumer.is_active == True,  # noqa: E712
            Consumer.decommissioned_at.is_(None),
        )

    if category:
        query = query.where(Consumer.category == category)
    if usage_unit_id:
        query = query.where(Consumer.usage_unit_id == usage_unit_id)
    if search:
        pattern = f"%{search}%"
        query = query.where(
            or_(
                Consumer.name.ilike(pattern),
                Consumer.notes.ilike(pattern),
                Consumer.manufacturer.ilike(pattern),
                Consumer.model.ilike(pattern),
                Consumer.serial_number.ilike(pattern),
            )
        )

    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    offset = (page - 1) * page_size
    query = (
        query.offset(offset).limit(page_size).order_by(Consumer.name)
        .options(selectinload(Consumer.meters))
        .options(selectinload(Consumer.replaced_by))
    )
    result = await db.execute(query)
    consumers = result.scalars().all()

    items = [
        _consumer_to_response(
            c,
            replaced_by_name=c.replaced_by.name if c.replaced_by else None,
        )
        for c in consumers
    ]

    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size if total > 0 else 0,
    )


@router.post("", response_model=ConsumerResponse, status_code=201)
async def create_consumer(
    request: ConsumerCreate,
    current_user: User = Depends(require_permission("consumers", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Neuen Verbraucher anlegen."""
    priority_val = _PRIORITY_TO_INT.get(request.priority, 1)

    consumer = Consumer(
        name=request.name,
        category=request.category,
        rated_power=request.rated_power_kw,
        operating_hours=request.operating_hours_per_year,
        priority=priority_val,
        usage_unit_id=request.usage_unit_id,
        notes=request.description,
        manufacturer=request.manufacturer,
        model=request.model,
        serial_number=request.serial_number,
        commissioned_at=request.commissioned_at,
        decommissioned_at=request.decommissioned_at,
        replaced_by_id=request.replaced_by_id,
        purchase_cost=request.purchase_cost,
        installation_cost=request.installation_cost,
        annual_maintenance_cost=request.annual_maintenance_cost,
        expected_lifetime_years=request.expected_lifetime_years,
    )
    db.add(consumer)
    await db.flush()

    # Zähler-Zuordnungen speichern
    if request.meter_ids:
        for mid in request.meter_ids:
            meter = await db.get(Meter, mid)
            if meter:
                await db.execute(
                    meter_consumer.insert().values(
                        meter_id=mid, consumer_id=consumer.id
                    )
                )

    await db.commit()

    # Meters laden für Response
    result = await db.execute(
        select(Consumer).where(Consumer.id == consumer.id)
        .options(selectinload(Consumer.meters))
    )
    consumer = result.scalar_one()

    return _consumer_to_response(consumer)


@router.get("/{consumer_id}", response_model=ConsumerResponse)
async def get_consumer(
    consumer_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Einzelnen Verbraucher abrufen."""
    result = await db.execute(
        select(Consumer)
        .where(Consumer.id == consumer_id)
        .options(selectinload(Consumer.meters))
        .options(selectinload(Consumer.replaced_by))
    )
    consumer = result.scalar_one_or_none()
    if not consumer:
        from app.core.exceptions import EnergyManagementError
        raise EnergyManagementError(
            "Verbraucher nicht gefunden",
            error_code="CONSUMER_NOT_FOUND",
            status_code=404,
        )

    return _consumer_to_response(
        consumer,
        replaced_by_name=consumer.replaced_by.name if consumer.replaced_by else None,
    )


@router.put("/{consumer_id}", response_model=ConsumerResponse)
async def update_consumer(
    consumer_id: uuid.UUID,
    request: ConsumerUpdate,
    current_user: User = Depends(require_permission("consumers", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Verbraucher aktualisieren."""
    consumer = await db.get(Consumer, consumer_id)
    if not consumer:
        from app.core.exceptions import EnergyManagementError
        raise EnergyManagementError(
            "Verbraucher nicht gefunden",
            error_code="CONSUMER_NOT_FOUND",
            status_code=404,
        )

    data = request.model_dump(exclude_unset=True)
    field_map = {
        "name": "name",
        "category": "category",
        "rated_power_kw": "rated_power",
        "operating_hours_per_year": "operating_hours",
        "priority": "priority",
        "usage_unit_id": "usage_unit_id",
        "description": "notes",
        "manufacturer": "manufacturer",
        "model": "model",
        "serial_number": "serial_number",
        "commissioned_at": "commissioned_at",
        "decommissioned_at": "decommissioned_at",
        "replaced_by_id": "replaced_by_id",
        "purchase_cost": "purchase_cost",
        "installation_cost": "installation_cost",
        "annual_maintenance_cost": "annual_maintenance_cost",
        "expected_lifetime_years": "expected_lifetime_years",
    }
    for schema_field, model_field in field_map.items():
        if schema_field in data:
            value = data[schema_field]
            if schema_field == "priority":
                value = _PRIORITY_TO_INT.get(value, 1)
            setattr(consumer, model_field, value)

    # Zähler-Zuordnungen aktualisieren
    if "meter_ids" in data:
        await db.execute(
            meter_consumer.delete().where(meter_consumer.c.consumer_id == consumer_id)
        )
        if data["meter_ids"]:
            for mid in data["meter_ids"]:
                meter = await db.get(Meter, mid)
                if meter:
                    await db.execute(
                        meter_consumer.insert().values(meter_id=mid, consumer_id=consumer_id)
                    )

    await db.commit()

    # Neu laden mit Beziehungen
    result = await db.execute(
        select(Consumer).where(Consumer.id == consumer_id)
        .options(selectinload(Consumer.meters))
        .options(selectinload(Consumer.replaced_by))
    )
    consumer = result.scalar_one()

    return _consumer_to_response(
        consumer,
        replaced_by_name=consumer.replaced_by.name if consumer.replaced_by else None,
    )


@router.post("/{consumer_id}/replace", response_model=ConsumerResponse, status_code=201)
async def replace_consumer(
    consumer_id: uuid.UUID,
    request: ConsumerCreate,
    current_user: User = Depends(require_permission("consumers", "update")),
    db: AsyncSession = Depends(get_db),
):
    """
    Verbraucher ersetzen: Alten deaktivieren, neuen anlegen und verknüpfen.

    Der alte Verbraucher bekommt decommissioned_at (heute) und replaced_by_id.
    Der neue Verbraucher wird mit den übergebenen Daten erstellt.
    """
    old_consumer = await db.get(Consumer, consumer_id)
    if not old_consumer:
        from app.core.exceptions import EnergyManagementError
        raise EnergyManagementError(
            "Verbraucher nicht gefunden",
            error_code="CONSUMER_NOT_FOUND",
            status_code=404,
        )

    # Neuen Verbraucher anlegen
    priority_val = _PRIORITY_TO_INT.get(request.priority, 1)
    new_consumer = Consumer(
        name=request.name,
        category=request.category,
        rated_power=request.rated_power_kw,
        operating_hours=request.operating_hours_per_year,
        priority=priority_val,
        usage_unit_id=request.usage_unit_id or old_consumer.usage_unit_id,
        notes=request.description,
        manufacturer=request.manufacturer,
        model=request.model,
        serial_number=request.serial_number,
        commissioned_at=request.commissioned_at or date.today(),
        purchase_cost=request.purchase_cost,
        installation_cost=request.installation_cost,
        annual_maintenance_cost=request.annual_maintenance_cost,
        expected_lifetime_years=request.expected_lifetime_years,
    )
    db.add(new_consumer)
    await db.flush()

    # Zähler-Zuordnungen
    if request.meter_ids:
        for mid in request.meter_ids:
            meter = await db.get(Meter, mid)
            if meter:
                await db.execute(
                    meter_consumer.insert().values(meter_id=mid, consumer_id=new_consumer.id)
                )

    # Alten Verbraucher deaktivieren
    old_consumer.decommissioned_at = old_consumer.decommissioned_at or date.today()
    old_consumer.replaced_by_id = new_consumer.id

    await db.commit()

    # Neu laden
    result = await db.execute(
        select(Consumer).where(Consumer.id == new_consumer.id)
        .options(selectinload(Consumer.meters))
    )
    new_consumer = result.scalar_one()

    return _consumer_to_response(new_consumer)


@router.delete("/{consumer_id}", response_model=DeleteResponse)
async def delete_consumer(
    consumer_id: uuid.UUID,
    current_user: User = Depends(require_permission("consumers", "delete")),
    db: AsyncSession = Depends(get_db),
):
    """Verbraucher deaktivieren (Soft-Delete)."""
    consumer = await db.get(Consumer, consumer_id)
    if not consumer:
        from app.core.exceptions import EnergyManagementError
        raise EnergyManagementError(
            "Verbraucher nicht gefunden",
            error_code="CONSUMER_NOT_FOUND",
            status_code=404,
        )

    consumer.is_active = False
    await db.commit()
    return DeleteResponse(id=consumer_id)
