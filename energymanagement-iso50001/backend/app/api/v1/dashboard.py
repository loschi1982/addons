"""
dashboard.py – Dashboard-Endpunkte.

Das Dashboard liefert aggregierte Daten für die Übersichtsseite:
KPI-Karten, Verbrauchscharts, Energieaufteilung und Warnungen.
"""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.dashboard import DashboardResponse, EnPIResponse
from app.services.dashboard_service import DashboardService

router = APIRouter()


@router.get("", response_model=DashboardResponse)
async def get_dashboard(
    period_start: date | None = None,
    period_end: date | None = None,
    granularity: str = Query("monthly", pattern="^(daily|weekly|monthly|yearly)$"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Dashboard-Daten für den angegebenen Zeitraum abrufen."""
    service = DashboardService(db)
    return await service.get_dashboard(period_start, period_end, granularity)


@router.get("/enpi", response_model=list[EnPIResponse])
async def get_enpi_overview(
    period: str = Query("current_year", pattern="^(current_year|last_12_months|custom)$"),
    start_date: date | None = None,
    end_date: date | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Energiekennzahlen (EnPI) Übersicht abrufen."""
    service = DashboardService(db)
    return await service.get_enpi_overview(period, start_date, end_date)
