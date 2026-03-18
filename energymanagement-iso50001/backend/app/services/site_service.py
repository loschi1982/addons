"""
site_service.py – Standort-, Gebäude- und Nutzungseinheit-Verwaltung.

CRUD für die Standort-Hierarchie: Standort → Gebäude → Nutzungseinheit.
"""

import uuid

import structlog
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import EnergyManagementError
from app.models.site import Building, Site, UsageUnit

logger = structlog.get_logger()


class SiteService:
    """Service für Standort-Hierarchie."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # --- Standorte ---

    async def list_sites(self, page: int = 1, page_size: int = 25, search: str | None = None) -> dict:
        """Standorte auflisten mit Pagination und optionaler Suche."""
        query = select(Site).where(Site.is_active == True)  # noqa: E712

        if search:
            pattern = f"%{search}%"
            query = query.where(
                or_(
                    Site.name.ilike(pattern),
                    Site.city.ilike(pattern),
                    Site.code.ilike(pattern),
                )
            )

        # Gesamtzahl
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.db.execute(count_query)).scalar() or 0

        # Paginierte Ergebnisse mit Gebäude-Relation laden
        offset = (page - 1) * page_size
        query = (
            query
            .options(selectinload(Site.buildings))
            .order_by(Site.name)
            .offset(offset)
            .limit(page_size)
        )
        result = await self.db.execute(query)
        sites = result.scalars().unique().all()

        return {
            "items": sites,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": max(1, (total + page_size - 1) // page_size),
        }

    async def create_site(self, data: dict) -> Site:
        """Neuen Standort anlegen."""
        site = Site(**data)
        self.db.add(site)
        await self.db.commit()
        await self.db.refresh(site, attribute_names=["buildings"])
        logger.info("Standort erstellt", site_id=str(site.id), name=site.name)
        return site

    async def get_site(self, site_id: uuid.UUID) -> Site:
        """Standort mit Gebäuden und Nutzungseinheiten laden."""
        query = (
            select(Site)
            .where(Site.id == site_id)
            .options(
                selectinload(Site.buildings).selectinload(Building.usage_units)
            )
        )
        result = await self.db.execute(query)
        site = result.scalar_one_or_none()
        if not site:
            raise EnergyManagementError(
                "Standort nicht gefunden",
                error_code="SITE_NOT_FOUND",
                status_code=404,
            )
        return site

    async def update_site(self, site_id: uuid.UUID, data: dict) -> Site:
        """Standort aktualisieren (nur übergebene Felder)."""
        site = await self.db.get(Site, site_id)
        if not site:
            raise EnergyManagementError(
                "Standort nicht gefunden",
                error_code="SITE_NOT_FOUND",
                status_code=404,
            )
        for key, value in data.items():
            if hasattr(site, key):
                setattr(site, key, value)
        await self.db.commit()
        await self.db.refresh(site, attribute_names=["buildings"])
        logger.info("Standort aktualisiert", site_id=str(site_id))
        return site

    async def delete_site(self, site_id: uuid.UUID) -> None:
        """Standort deaktivieren (Soft-Delete)."""
        site = await self.db.get(Site, site_id)
        if not site:
            raise EnergyManagementError(
                "Standort nicht gefunden",
                error_code="SITE_NOT_FOUND",
                status_code=404,
            )
        site.is_active = False
        await self.db.commit()
        logger.info("Standort deaktiviert", site_id=str(site_id))

    # --- Gebäude ---

    async def list_buildings(self, site_id: uuid.UUID) -> list[Building]:
        """Gebäude eines Standorts auflisten."""
        query = (
            select(Building)
            .where(Building.site_id == site_id, Building.is_active == True)  # noqa: E712
            .options(selectinload(Building.usage_units))
            .order_by(Building.name)
        )
        result = await self.db.execute(query)
        return list(result.scalars().unique().all())

    async def create_building(self, site_id: uuid.UUID, data: dict) -> Building:
        """Neues Gebäude für einen Standort anlegen."""
        # Prüfe ob der Standort existiert
        site = await self.db.get(Site, site_id)
        if not site:
            raise EnergyManagementError(
                "Standort nicht gefunden",
                error_code="SITE_NOT_FOUND",
                status_code=404,
            )
        data["site_id"] = site_id
        building = Building(**data)
        self.db.add(building)
        await self.db.commit()
        await self.db.refresh(building, attribute_names=["usage_units"])
        logger.info("Gebäude erstellt", building_id=str(building.id), site_id=str(site_id))
        return building

    async def get_building(self, building_id: uuid.UUID) -> Building:
        """Gebäude mit Nutzungseinheiten laden."""
        query = (
            select(Building)
            .where(Building.id == building_id)
            .options(selectinload(Building.usage_units))
        )
        result = await self.db.execute(query)
        building = result.scalar_one_or_none()
        if not building:
            raise EnergyManagementError(
                "Gebäude nicht gefunden",
                error_code="BUILDING_NOT_FOUND",
                status_code=404,
            )
        return building

    async def update_building(self, building_id: uuid.UUID, data: dict) -> Building:
        """Gebäude aktualisieren."""
        building = await self.db.get(Building, building_id)
        if not building:
            raise EnergyManagementError(
                "Gebäude nicht gefunden",
                error_code="BUILDING_NOT_FOUND",
                status_code=404,
            )
        for key, value in data.items():
            if hasattr(building, key):
                setattr(building, key, value)
        await self.db.commit()
        await self.db.refresh(building, attribute_names=["usage_units"])
        logger.info("Gebäude aktualisiert", building_id=str(building_id))
        return building

    async def delete_building(self, building_id: uuid.UUID) -> None:
        """Gebäude deaktivieren (Soft-Delete)."""
        building = await self.db.get(Building, building_id)
        if not building:
            raise EnergyManagementError(
                "Gebäude nicht gefunden",
                error_code="BUILDING_NOT_FOUND",
                status_code=404,
            )
        building.is_active = False
        await self.db.commit()
        logger.info("Gebäude deaktiviert", building_id=str(building_id))

    # --- Nutzungseinheiten ---

    async def create_usage_unit(self, building_id: uuid.UUID, data: dict) -> UsageUnit:
        """Neue Nutzungseinheit für ein Gebäude anlegen."""
        building = await self.db.get(Building, building_id)
        if not building:
            raise EnergyManagementError(
                "Gebäude nicht gefunden",
                error_code="BUILDING_NOT_FOUND",
                status_code=404,
            )
        data["building_id"] = building_id
        unit = UsageUnit(**data)
        self.db.add(unit)
        await self.db.commit()
        await self.db.refresh(unit)
        logger.info("Nutzungseinheit erstellt", unit_id=str(unit.id), building_id=str(building_id))
        return unit

    async def update_usage_unit(self, unit_id: uuid.UUID, data: dict) -> UsageUnit:
        """Nutzungseinheit aktualisieren."""
        unit = await self.db.get(UsageUnit, unit_id)
        if not unit:
            raise EnergyManagementError(
                "Nutzungseinheit nicht gefunden",
                error_code="USAGE_UNIT_NOT_FOUND",
                status_code=404,
            )
        for key, value in data.items():
            if hasattr(unit, key):
                setattr(unit, key, value)
        await self.db.commit()
        await self.db.refresh(unit)
        logger.info("Nutzungseinheit aktualisiert", unit_id=str(unit_id))
        return unit

    async def delete_usage_unit(self, unit_id: uuid.UUID) -> None:
        """Nutzungseinheit deaktivieren (Soft-Delete)."""
        unit = await self.db.get(UsageUnit, unit_id)
        if not unit:
            raise EnergyManagementError(
                "Nutzungseinheit nicht gefunden",
                error_code="USAGE_UNIT_NOT_FOUND",
                status_code=404,
            )
        unit.is_active = False
        await self.db.commit()
        logger.info("Nutzungseinheit deaktiviert", unit_id=str(unit_id))
