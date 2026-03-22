"""
consumers.py – Endpunkte für Verbraucher (Großverbraucher / SEU).

Verbraucher sind energetisch relevante Anlagen (z.B. Heizkessel,
Lüftungsanlage), die einem oder mehreren Zählern zugeordnet werden.
"""

import uuid

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


@router.get("", response_model=PaginatedResponse[ConsumerResponse])
async def list_consumers(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    category: str | None = None,
    usage_unit_id: uuid.UUID | None = None,
    search: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle Verbraucher auflisten."""
    query = select(Consumer).where(Consumer.is_active == True)  # noqa: E712

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
            )
        )

    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size).order_by(Consumer.name)
    result = await db.execute(query)
    consumers = result.scalars().all()

    items = [
        ConsumerResponse(
            id=c.id,
            name=c.name,
            category=c.category,
            rated_power_kw=c.rated_power,
            operating_hours_per_year=int(c.operating_hours) if c.operating_hours else None,
            priority=str(c.priority),
            usage_unit_id=c.usage_unit_id,
            description=c.notes,
            created_at=c.created_at,
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
    consumer = Consumer(
        name=request.name,
        category=request.category,
        rated_power=request.rated_power_kw,
        operating_hours=request.operating_hours_per_year,
        priority=int(request.priority) if request.priority else 0,
        usage_unit_id=request.usage_unit_id,
        notes=request.description,
    )
    db.add(consumer)
    await db.flush()

    # Zähler-Zuordnungen speichern
    meter_ids_list: list[uuid.UUID] = []
    if request.meter_ids:
        for mid in request.meter_ids:
            meter = await db.get(Meter, mid)
            if meter:
                consumer.meters.append(meter)
                meter_ids_list.append(mid)

    await db.commit()

    return ConsumerResponse(
        id=consumer.id,
        name=consumer.name,
        category=consumer.category,
        rated_power_kw=consumer.rated_power,
        operating_hours_per_year=int(consumer.operating_hours) if consumer.operating_hours else None,
        priority=str(consumer.priority),
        usage_unit_id=consumer.usage_unit_id,
        description=consumer.notes,
        meter_ids=meter_ids_list,
        created_at=consumer.created_at,
    )


@router.get("/{consumer_id}", response_model=ConsumerResponse)
async def get_consumer(
    consumer_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Einzelnen Verbraucher abrufen."""
    consumer = await db.get(Consumer, consumer_id)
    if not consumer:
        from app.core.exceptions import EnergyManagementError
        raise EnergyManagementError(
            "Verbraucher nicht gefunden",
            error_code="CONSUMER_NOT_FOUND",
            status_code=404,
        )

    return ConsumerResponse(
        id=consumer.id,
        name=consumer.name,
        category=consumer.category,
        rated_power_kw=consumer.rated_power,
        operating_hours_per_year=int(consumer.operating_hours) if consumer.operating_hours else None,
        priority=str(consumer.priority),
        usage_unit_id=consumer.usage_unit_id,
        description=consumer.notes,
        created_at=consumer.created_at,
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
    }
    for schema_field, model_field in field_map.items():
        if schema_field in data:
            setattr(consumer, model_field, data[schema_field])

    # Zähler-Zuordnungen aktualisieren
    meter_ids_list: list[uuid.UUID] = []
    if "meter_ids" in data:
        # Alte Zuordnungen laden und ersetzen
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
                    meter_ids_list.append(mid)

    await db.commit()

    return ConsumerResponse(
        id=consumer.id,
        name=consumer.name,
        category=consumer.category,
        rated_power_kw=consumer.rated_power,
        operating_hours_per_year=int(consumer.operating_hours) if consumer.operating_hours else None,
        priority=str(consumer.priority),
        usage_unit_id=consumer.usage_unit_id,
        description=consumer.notes,
        meter_ids=meter_ids_list,
        created_at=consumer.created_at,
    )


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
