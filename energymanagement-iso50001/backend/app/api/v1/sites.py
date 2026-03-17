"""
sites.py – Endpunkte für Standorte, Gebäude und Nutzungseinheiten.

Die Standort-Hierarchie: Standort → Gebäude → Nutzungseinheit.
Gebäude und Nutzungseinheiten sind als verschachtelte Ressourcen
unter ihrem jeweiligen Elternobjekt erreichbar.
"""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.user import User
from app.schemas.common import DeleteResponse, PaginatedResponse
from app.schemas.site import (
    BuildingCreate,
    BuildingDetailResponse,
    BuildingResponse,
    BuildingUpdate,
    SiteCreate,
    SiteDetailResponse,
    SiteResponse,
    SiteUpdate,
    UsageUnitCreate,
    UsageUnitResponse,
    UsageUnitUpdate,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Standorte
# ---------------------------------------------------------------------------

@router.get("", response_model=PaginatedResponse[SiteResponse])
async def list_sites(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    search: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle Standorte auflisten."""
    raise NotImplementedError("SiteService noch nicht implementiert")


@router.post("", response_model=SiteResponse, status_code=201)
async def create_site(
    request: SiteCreate,
    current_user: User = Depends(require_permission("sites", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Neuen Standort anlegen."""
    raise NotImplementedError("SiteService noch nicht implementiert")


@router.get("/{site_id}", response_model=SiteDetailResponse)
async def get_site(
    site_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Standort mit Gebäuden abrufen."""
    raise NotImplementedError("SiteService noch nicht implementiert")


@router.put("/{site_id}", response_model=SiteResponse)
async def update_site(
    site_id: uuid.UUID,
    request: SiteUpdate,
    current_user: User = Depends(require_permission("sites", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Standort aktualisieren."""
    raise NotImplementedError("SiteService noch nicht implementiert")


@router.delete("/{site_id}", response_model=DeleteResponse)
async def delete_site(
    site_id: uuid.UUID,
    current_user: User = Depends(require_permission("sites", "delete")),
    db: AsyncSession = Depends(get_db),
):
    """Standort löschen."""
    raise NotImplementedError("SiteService noch nicht implementiert")


# ---------------------------------------------------------------------------
# Gebäude (unter Standort)
# ---------------------------------------------------------------------------

@router.get("/{site_id}/buildings", response_model=list[BuildingResponse])
async def list_buildings(
    site_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Gebäude eines Standorts auflisten."""
    raise NotImplementedError("BuildingService noch nicht implementiert")


@router.post("/{site_id}/buildings", response_model=BuildingResponse, status_code=201)
async def create_building(
    site_id: uuid.UUID,
    request: BuildingCreate,
    current_user: User = Depends(require_permission("sites", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Neues Gebäude anlegen."""
    raise NotImplementedError("BuildingService noch nicht implementiert")


@router.get("/{site_id}/buildings/{building_id}", response_model=BuildingDetailResponse)
async def get_building(
    site_id: uuid.UUID,
    building_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Gebäude mit Nutzungseinheiten abrufen."""
    raise NotImplementedError("BuildingService noch nicht implementiert")


@router.put("/{site_id}/buildings/{building_id}", response_model=BuildingResponse)
async def update_building(
    site_id: uuid.UUID,
    building_id: uuid.UUID,
    request: BuildingUpdate,
    current_user: User = Depends(require_permission("sites", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Gebäude aktualisieren."""
    raise NotImplementedError("BuildingService noch nicht implementiert")


@router.delete("/{site_id}/buildings/{building_id}", response_model=DeleteResponse)
async def delete_building(
    site_id: uuid.UUID,
    building_id: uuid.UUID,
    current_user: User = Depends(require_permission("sites", "delete")),
    db: AsyncSession = Depends(get_db),
):
    """Gebäude löschen."""
    raise NotImplementedError("BuildingService noch nicht implementiert")


# ---------------------------------------------------------------------------
# Nutzungseinheiten (unter Gebäude)
# ---------------------------------------------------------------------------

@router.post(
    "/{site_id}/buildings/{building_id}/units",
    response_model=UsageUnitResponse,
    status_code=201,
)
async def create_usage_unit(
    site_id: uuid.UUID,
    building_id: uuid.UUID,
    request: UsageUnitCreate,
    current_user: User = Depends(require_permission("sites", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Neue Nutzungseinheit anlegen."""
    raise NotImplementedError("UsageUnitService noch nicht implementiert")


@router.put(
    "/{site_id}/buildings/{building_id}/units/{unit_id}",
    response_model=UsageUnitResponse,
)
async def update_usage_unit(
    site_id: uuid.UUID,
    building_id: uuid.UUID,
    unit_id: uuid.UUID,
    request: UsageUnitUpdate,
    current_user: User = Depends(require_permission("sites", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Nutzungseinheit aktualisieren."""
    raise NotImplementedError("UsageUnitService noch nicht implementiert")


@router.delete(
    "/{site_id}/buildings/{building_id}/units/{unit_id}",
    response_model=DeleteResponse,
)
async def delete_usage_unit(
    site_id: uuid.UUID,
    building_id: uuid.UUID,
    unit_id: uuid.UUID,
    current_user: User = Depends(require_permission("sites", "delete")),
    db: AsyncSession = Depends(get_db),
):
    """Nutzungseinheit löschen."""
    raise NotImplementedError("UsageUnitService noch nicht implementiert")
