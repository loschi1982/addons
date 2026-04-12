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
    meter_ids: str | None = Query(None, description="Kommagetrennte Zähler-IDs"),
    energy_type: str | None = None,
    period1_start: date = Query(...),
    period1_end: date = Query(...),
    period2_start: date = Query(...),
    period2_end: date = Query(...),
    granularity: str = Query("monthly", pattern="^(daily|weekly|monthly)$"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Zwei Zeiträume vergleichen (nach Zähler-IDs oder Energieträger)."""
    service = AnalyticsService(db)
    ids = [uuid.UUID(m.strip()) for m in meter_ids.split(",")] if meter_ids else None
    return await service.get_comparison(
        meter_ids=ids,
        energy_type=energy_type,
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
    energy_type: str | None = Query(None, description="Filter nach Energieart"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Sankey-Diagramm: Energiefluss."""
    service = AnalyticsService(db)
    return await service.get_sankey(start_date, end_date, energy_type=energy_type)


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


@router.get("/self-consumption")
async def get_self_consumption(
    start_date: date | None = None,
    end_date: date | None = None,
    granularity: str = Query("monthly", pattern="^(daily|weekly|monthly|yearly)$"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Eigenverbrauch und Autarkiegrad als Zeitreihe."""
    from datetime import date as date_type
    today = date_type.today()
    if not start_date:
        start_date = date_type(today.year, 1, 1)
    if not end_date:
        end_date = today
    service = AnalyticsService(db)
    return await service.get_self_consumption_trend(start_date, end_date, granularity)


@router.get("/duration-curve")
async def get_duration_curve(
    meter_id: uuid.UUID = Query(...),
    year: int | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Jahresdauerlinie für einen Zähler."""
    service = AnalyticsService(db)
    return await service.get_load_duration_curve(meter_id, year)


@router.get("/cumulative")
async def get_cumulative(
    meter_ids: str | None = Query(None, description="Kommagetrennte Zähler-IDs"),
    energy_type: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Kumulative Verbrauchslinie."""
    service = AnalyticsService(db)
    ids = [uuid.UUID(m.strip()) for m in meter_ids.split(",")] if meter_ids else None
    return await service.get_cumulative(ids, energy_type, start_date, end_date)


@router.get("/monthly-comparison")
async def get_monthly_comparison(
    year_a: int = Query(..., description="Basisjahr (z.B. 2024)"),
    year_b: int = Query(..., description="Vergleichsjahr (z.B. 2025)"),
    energy_types: str | None = Query(None, description="Kommagetrennte Energiearten (electricity,natural_gas,…)"),
    meter_ids: str | None = Query(None, description="Kommagetrennte Zähler-IDs"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Monatlicher Vergleich zweier Jahre nach Energieträger.

    Gibt für jeden Monat (1–12) und jeden Energieträger die nativen Verbräuche
    beider Jahre sowie die prozentuale Abweichung zurück.
    """
    service = AnalyticsService(db)
    ids = [uuid.UUID(m.strip()) for m in meter_ids.split(",")] if meter_ids else None
    et_filter = [e.strip() for e in energy_types.split(",")] if energy_types else None
    return await service.get_monthly_comparison(year_a, year_b, et_filter, ids)


@router.get("/energy-balance")
async def get_energy_balance(
    start_date: date = Query(...),
    end_date: date = Query(...),
    energy_types: str | None = Query(None, description="Kommagetrennte Energiearten"),
    meter_ids: str | None = Query(None, description="Kommagetrennte Zähler-IDs"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Energiebilanz für einen Zeitraum – monatlich aufgeschlüsselt nach Energieträgern.

    Rückgabe: {"energy_types": [...], "months": [...], "rows": [{month, label, values: {et: {native, kwh, cost}}}]}
    """
    service = AnalyticsService(db)
    ids = [uuid.UUID(m.strip()) for m in meter_ids.split(",")] if meter_ids else None
    et_filter = [e.strip() for e in energy_types.split(",")] if energy_types else None
    return await service.get_energy_balance(start_date, end_date, et_filter, ids)
