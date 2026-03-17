"""
consumers.py – Endpunkte für Verbraucher (Großverbraucher / SEU).

Verbraucher sind energetisch relevante Anlagen (z.B. Heizkessel,
Lüftungsanlage), die einem oder mehreren Zählern zugeordnet werden.
"""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
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
    raise NotImplementedError("ConsumerService noch nicht implementiert")


@router.post("", response_model=ConsumerResponse, status_code=201)
async def create_consumer(
    request: ConsumerCreate,
    current_user: User = Depends(require_permission("consumers", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Neuen Verbraucher anlegen."""
    raise NotImplementedError("ConsumerService noch nicht implementiert")


@router.get("/{consumer_id}", response_model=ConsumerResponse)
async def get_consumer(
    consumer_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Einzelnen Verbraucher abrufen."""
    raise NotImplementedError("ConsumerService noch nicht implementiert")


@router.put("/{consumer_id}", response_model=ConsumerResponse)
async def update_consumer(
    consumer_id: uuid.UUID,
    request: ConsumerUpdate,
    current_user: User = Depends(require_permission("consumers", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Verbraucher aktualisieren."""
    raise NotImplementedError("ConsumerService noch nicht implementiert")


@router.delete("/{consumer_id}", response_model=DeleteResponse)
async def delete_consumer(
    consumer_id: uuid.UUID,
    current_user: User = Depends(require_permission("consumers", "delete")),
    db: AsyncSession = Depends(get_db),
):
    """Verbraucher löschen."""
    raise NotImplementedError("ConsumerService noch nicht implementiert")
