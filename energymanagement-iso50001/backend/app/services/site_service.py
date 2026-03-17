"""
site_service.py – Standort-, Gebäude- und Nutzungseinheit-Verwaltung.

CRUD für die Standort-Hierarchie: Standort → Gebäude → Nutzungseinheit.
"""

import uuid

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.site import Building, Site, UsageUnit

logger = structlog.get_logger()


class SiteService:
    """Service für Standort-Hierarchie."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # --- Standorte ---

    async def list_sites(self, page: int = 1, page_size: int = 25, search: str | None = None) -> dict:
        """Standorte auflisten."""
        raise NotImplementedError

    async def create_site(self, data: dict) -> Site:
        """Neuen Standort anlegen."""
        raise NotImplementedError

    async def get_site(self, site_id: uuid.UUID) -> Site:
        """Standort mit Gebäuden laden."""
        raise NotImplementedError

    async def update_site(self, site_id: uuid.UUID, data: dict) -> Site:
        """Standort aktualisieren."""
        raise NotImplementedError

    async def delete_site(self, site_id: uuid.UUID) -> None:
        """Standort löschen."""
        raise NotImplementedError

    # --- Gebäude ---

    async def list_buildings(self, site_id: uuid.UUID) -> list[Building]:
        """Gebäude eines Standorts auflisten."""
        raise NotImplementedError

    async def create_building(self, site_id: uuid.UUID, data: dict) -> Building:
        """Neues Gebäude anlegen."""
        raise NotImplementedError

    async def get_building(self, building_id: uuid.UUID) -> Building:
        """Gebäude mit Nutzungseinheiten laden."""
        raise NotImplementedError

    async def update_building(self, building_id: uuid.UUID, data: dict) -> Building:
        """Gebäude aktualisieren."""
        raise NotImplementedError

    async def delete_building(self, building_id: uuid.UUID) -> None:
        """Gebäude löschen."""
        raise NotImplementedError

    # --- Nutzungseinheiten ---

    async def create_usage_unit(self, building_id: uuid.UUID, data: dict) -> UsageUnit:
        """Neue Nutzungseinheit anlegen."""
        raise NotImplementedError

    async def update_usage_unit(self, unit_id: uuid.UUID, data: dict) -> UsageUnit:
        """Nutzungseinheit aktualisieren."""
        raise NotImplementedError

    async def delete_usage_unit(self, unit_id: uuid.UUID) -> None:
        """Nutzungseinheit löschen."""
        raise NotImplementedError
