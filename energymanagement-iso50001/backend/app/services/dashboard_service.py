"""
dashboard_service.py – Dashboard-Datenaufbereitung.

Aggregiert Verbrauchsdaten, KPIs und Warnungen für die
Übersichtsseite des Frontends.
"""

from datetime import date

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger()


class DashboardService:
    """Service für Dashboard-Daten."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_dashboard(
        self,
        period_start: date | None = None,
        period_end: date | None = None,
        granularity: str = "monthly",
    ) -> dict:
        """
        Dashboard-Daten zusammenstellen.

        Enthält: KPI-Karten, Verbrauchscharts, Energieaufteilung,
        Top-Verbraucher, aktive Warnungen und EnPI-Übersicht.
        """
        raise NotImplementedError

    async def get_enpi_overview(
        self,
        period: str = "current_year",
        start_date: date | None = None,
        end_date: date | None = None,
    ) -> list[dict]:
        """Energiekennzahlen (EnPI) berechnen."""
        raise NotImplementedError
