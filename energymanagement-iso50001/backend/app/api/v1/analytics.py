"""
analytics.py – Endpunkte für Analysen und Visualisierungen.

Stellt Zeitreihen, Vergleiche, Sankey-Diagramme, Heatmaps,
Verteilungen, Anomalien und CO₂-Reduktionspfade bereit.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.services.analytics_service import AnalyticsService

router = APIRouter()


@router.get("/timeseries")
async def get_timeseries(
    meter_ids: str | None = Query(None, description="Kommagetrennte Zähler-IDs"),
    energy_type: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    granularity: str = Query("daily", pattern="^(hourly|daily|weekly|monthly|yearly)$"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Zeitreihendaten für Charts."""
    service = AnalyticsService(db)
    ids = [uuid.UUID(m.strip()) for m in meter_ids.split(",")] if meter_ids else None
    return await service.get_timeseries(
        meter_ids=ids,
        energy_type=energy_type,
        start_date=start_date,
        end_date=end_date,
        granularity=granularity,
    )


@router.get("/comparison")
async def get_comparison(
    meter_ids: str = Query(..., description="Kommagetrennte Zähler-IDs"),
    period1_start: date = Query(...),
    period1_end: date = Query(...),
    period2_start: date = Query(...),
    period2_end: date = Query(...),
    granularity: str = Query("monthly", pattern="^(daily|weekly|monthly)$"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Zwei Zeiträume vergleichen."""
    service = AnalyticsService(db)
    ids = [uuid.UUID(m.strip()) for m in meter_ids.split(",")]
    return await service.get_comparison(
        meter_ids=ids,
        period1_start=period1_start,
        period1_end=period1_end,
        period2_start=period2_start,
        period2_end=period2_end,
        granularity=granularity,
    )


@router.get("/distribution")
async def get_distribution(
    start_date: date = Query(...),
    end_date: date = Query(...),
    group_by: str = Query("energy_type", pattern="^(energy_type|location|cost_center)$"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Verbrauchsverteilung (Pie/Donut-Chart)."""
    service = AnalyticsService(db)
    return await service.get_distribution(start_date, end_date, group_by)


@router.get("/heatmap")
async def get_heatmap(
    meter_id: uuid.UUID = Query(...),
    start_date: date | None = None,
    end_date: date | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Verbrauchs-Heatmap (Wochentag × Stunde)."""
    service = AnalyticsService(db)
    return await service.get_heatmap(meter_id, start_date, end_date)


@router.get("/sankey")
async def get_sankey(
    start_date: date = Query(...),
    end_date: date = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Sankey-Diagramm: Energiefluss."""
    service = AnalyticsService(db)
    return await service.get_sankey(start_date, end_date)


@router.get("/weather-corrected")
async def get_weather_corrected(
    meter_id: uuid.UUID = Query(...),
    start_date: date = Query(...),
    end_date: date = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Witterungskorrigierter vs. Rohverbrauch."""
    service = AnalyticsService(db)
    return await service.get_weather_corrected(meter_id, start_date, end_date)


@router.get("/co2-reduction-path")
async def get_co2_reduction_path(
    target_year: int = Query(2030),
    target_reduction_percent: float = Query(55.0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """CO₂-Reduktionspfad mit Ist- und Zielwerten."""
    service = AnalyticsService(db)
    return await service.get_co2_reduction_path(target_year, target_reduction_percent)


@router.get("/benchmarks")
async def get_benchmarks(
    year: int | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """EnPI-Benchmarks pro Zähler."""
    service = AnalyticsService(db)
    return await service.get_benchmarks(year)


@router.get("/anomalies")
async def get_anomalies(
    threshold: float = Query(2.0, ge=1.0, le=5.0),
    days: int = Query(30, ge=7, le=365),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Anomalie-Erkennung für alle aktiven Zähler."""
    service = AnalyticsService(db)
    return await service.get_anomalies(threshold, days)
