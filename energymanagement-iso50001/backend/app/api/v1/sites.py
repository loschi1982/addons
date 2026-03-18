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
from app.services.site_service import SiteService

router = APIRouter()


# -- Feld-Mapping: Schema → Model --
# Schema und Model verwenden teilweise unterschiedliche Feldnamen

SITE_FIELD_MAP = {
    "zip_code": "postal_code",
}

BUILDING_FIELD_MAP = {
    "total_area_m2": "gross_floor_area_m2",
    "floors": "floors_above_ground",
}

UNIT_FIELD_MAP = {
    "unit_number": "code",
    "tenant_since": "lease_start",
    "target_enpi": "target_enpi_kwh_per_m2",
}


def _map_fields(data: dict, field_map: dict) -> dict:
    """Schema-Feldnamen auf Model-Feldnamen umwandeln."""
    result = {}
    for key, value in data.items():
        model_key = field_map.get(key, key)
        result[model_key] = value
    # target_enpi_unit wird nicht im Model gespeichert
    result.pop("target_enpi_unit", None)
    return result


def _site_response(site) -> dict:
    """Site-Model → SiteResponse-Daten."""
    return {
        "id": site.id,
        "name": site.name,
        "street": site.street,
        "zip_code": site.postal_code,
        "city": site.city,
        "country": site.country,
        "latitude": site.latitude,
        "longitude": site.longitude,
        "weather_station_id": site.weather_station_id,
        "co2_region": site.co2_region,
        "timezone": site.timezone,
        "building_count": len(site.buildings) if site.buildings else 0,
        "created_at": site.created_at,
    }


def _building_response(building) -> dict:
    """Building-Model → BuildingResponse-Daten."""
    return {
        "id": building.id,
        "name": building.name,
        "site_id": building.site_id,
        "street": building.street,
        "building_type": building.building_type,
        "building_year": building.building_year,
        "total_area_m2": building.gross_floor_area_m2,
        "heated_area_m2": building.heated_area_m2,
        "cooled_area_m2": building.cooled_area_m2,
        "floors": building.floors_above_ground,
        "energy_certificate_class": building.energy_certificate_class,
        "energy_certificate_value": building.energy_certificate_value,
        "usage_unit_count": len(building.usage_units) if building.usage_units else 0,
        "created_at": building.created_at,
    }


def _unit_response(unit) -> dict:
    """UsageUnit-Model → UsageUnitResponse-Daten."""
    return {
        "id": unit.id,
        "name": unit.name,
        "building_id": unit.building_id,
        "usage_type": unit.usage_type,
        "unit_number": unit.code,
        "floor": unit.floor,
        "area_m2": unit.area_m2,
        "occupants": unit.occupants,
        "tenant_name": unit.tenant_name,
        "tenant_since": str(unit.lease_start) if unit.lease_start else None,
        "target_enpi": unit.target_enpi_kwh_per_m2,
        "target_enpi_unit": "kWh/m²" if unit.target_enpi_kwh_per_m2 else None,
        "created_at": unit.created_at,
    }


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
    service = SiteService(db)
    result = await service.list_sites(page=page, page_size=page_size, search=search)

    return PaginatedResponse(
        items=[SiteResponse(**_site_response(s)) for s in result["items"]],
        total=result["total"],
        page=result["page"],
        page_size=result["page_size"],
        total_pages=result["total_pages"],
    )


@router.post("", response_model=SiteResponse, status_code=201)
async def create_site(
    request: SiteCreate,
    current_user: User = Depends(require_permission("sites", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Neuen Standort anlegen."""
    service = SiteService(db)
    data = _map_fields(request.model_dump(exclude_unset=True), SITE_FIELD_MAP)
    site = await service.create_site(data)
    return SiteResponse(**_site_response(site))


@router.get("/{site_id}", response_model=SiteDetailResponse)
async def get_site(
    site_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Standort mit Gebäuden abrufen."""
    service = SiteService(db)
    site = await service.get_site(site_id)
    resp = _site_response(site)
    resp["buildings"] = [
        BuildingResponse(**_building_response(b))
        for b in site.buildings
        if b.is_active
    ]
    return SiteDetailResponse(**resp)


@router.put("/{site_id}", response_model=SiteResponse)
async def update_site(
    site_id: uuid.UUID,
    request: SiteUpdate,
    current_user: User = Depends(require_permission("sites", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Standort aktualisieren."""
    service = SiteService(db)
    data = _map_fields(request.model_dump(exclude_unset=True), SITE_FIELD_MAP)
    site = await service.update_site(site_id, data)
    return SiteResponse(**_site_response(site))


@router.delete("/{site_id}", response_model=DeleteResponse)
async def delete_site(
    site_id: uuid.UUID,
    current_user: User = Depends(require_permission("sites", "delete")),
    db: AsyncSession = Depends(get_db),
):
    """Standort löschen."""
    service = SiteService(db)
    await service.delete_site(site_id)
    return DeleteResponse(id=site_id)


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
    service = SiteService(db)
    buildings = await service.list_buildings(site_id)
    return [BuildingResponse(**_building_response(b)) for b in buildings]


@router.post("/{site_id}/buildings", response_model=BuildingResponse, status_code=201)
async def create_building(
    site_id: uuid.UUID,
    request: BuildingCreate,
    current_user: User = Depends(require_permission("sites", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Neues Gebäude anlegen."""
    service = SiteService(db)
    data = _map_fields(request.model_dump(exclude_unset=True), BUILDING_FIELD_MAP)
    data.pop("site_id", None)  # Kommt aus der URL
    building = await service.create_building(site_id, data)
    return BuildingResponse(**_building_response(building))


@router.get("/{site_id}/buildings/{building_id}", response_model=BuildingDetailResponse)
async def get_building(
    site_id: uuid.UUID,
    building_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Gebäude mit Nutzungseinheiten abrufen."""
    service = SiteService(db)
    building = await service.get_building(building_id)
    resp = _building_response(building)
    resp["usage_units"] = [
        UsageUnitResponse(**_unit_response(u))
        for u in building.usage_units
        if u.is_active
    ]
    return BuildingDetailResponse(**resp)


@router.put("/{site_id}/buildings/{building_id}", response_model=BuildingResponse)
async def update_building(
    site_id: uuid.UUID,
    building_id: uuid.UUID,
    request: BuildingUpdate,
    current_user: User = Depends(require_permission("sites", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Gebäude aktualisieren."""
    service = SiteService(db)
    data = _map_fields(request.model_dump(exclude_unset=True), BUILDING_FIELD_MAP)
    building = await service.update_building(building_id, data)
    return BuildingResponse(**_building_response(building))


@router.delete("/{site_id}/buildings/{building_id}", response_model=DeleteResponse)
async def delete_building(
    site_id: uuid.UUID,
    building_id: uuid.UUID,
    current_user: User = Depends(require_permission("sites", "delete")),
    db: AsyncSession = Depends(get_db),
):
    """Gebäude löschen."""
    service = SiteService(db)
    await service.delete_building(building_id)
    return DeleteResponse(id=building_id)


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
    service = SiteService(db)
    data = _map_fields(request.model_dump(exclude_unset=True), UNIT_FIELD_MAP)
    data.pop("building_id", None)  # Kommt aus der URL
    unit = await service.create_usage_unit(building_id, data)
    return UsageUnitResponse(**_unit_response(unit))


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
    service = SiteService(db)
    data = _map_fields(request.model_dump(exclude_unset=True), UNIT_FIELD_MAP)
    unit = await service.update_usage_unit(unit_id, data)
    return UsageUnitResponse(**_unit_response(unit))


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
    service = SiteService(db)
    await service.delete_usage_unit(unit_id)
    return DeleteResponse(id=unit_id)
