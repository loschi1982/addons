"""
dashboard.py – Dashboard-Endpunkte.

Das Dashboard liefert aggregierte Daten für die Übersichtsseite:
KPI-Karten, Verbrauchscharts, Energieaufteilung und Warnungen.
"""

import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.meter import Meter
from app.models.reading import MeterReading
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
    import structlog
    logger = structlog.get_logger()
    try:
        service = DashboardService(db)
        result = await service.get_dashboard(period_start, period_end, granularity)
        return result
    except Exception as e:
        logger.error("dashboard_error", error=str(e), error_type=type(e).__name__)
        import traceback
        logger.error("dashboard_traceback", tb=traceback.format_exc())
        raise


class AnomalyReading(BaseModel):
    """Ein statistisch auffälliger Messwert."""
    reading_id: uuid.UUID
    meter_id: uuid.UUID
    meter_name: str
    energy_type: str
    unit: str
    site_id: uuid.UUID | None
    site_name: str | None
    timestamp: str
    consumption: Decimal
    p95: Decimal
    factor: Decimal      # (consumption/days) / (p95/avg_days) – tagesbereinigt
    days_since_prev: int  # Tage seit vorherigem Messwert


@router.get("/anomalies", response_model=list[AnomalyReading])
async def get_anomalies(
    threshold: float = Query(5.0, ge=2.0, description="Faktor über p95 ab dem ein Ausreißer erkannt wird"),
    limit: int = Query(100, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Statistische Ausreißer in Messwerten erkennen.

    Liefert Messwerte, deren consumption > threshold × p95 des jeweiligen Zählers.
    Sortiert nach Schwere (höchster Faktor zuerst).
    """
    result = await db.execute(text("""
        WITH meter_stats AS (
            -- Tagesbereinigter p95: Verbrauch pro Tag je Zähler
            -- avg_days = durchschnittlicher Ablese-Abstand in Tagen
            SELECT
                meter_id,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY consumption) AS p95,
                AVG(
                    EXTRACT(EPOCH FROM (
                        timestamp - LAG(timestamp) OVER (PARTITION BY meter_id ORDER BY timestamp)
                    )) / 86400.0
                ) AS avg_days
            FROM meter_readings
            WHERE consumption IS NOT NULL AND consumption > 0
            GROUP BY meter_id
            HAVING COUNT(*) >= 10
              AND PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY consumption) >= 1
        ),
        readings_with_gap AS (
            SELECT
                r.id,
                r.meter_id,
                r.timestamp,
                r.consumption,
                r.quality,
                GREATEST(1, ROUND(
                    EXTRACT(EPOCH FROM (
                        r.timestamp - LAG(r.timestamp) OVER (PARTITION BY r.meter_id ORDER BY r.timestamp)
                    )) / 86400.0
                )) AS days_since_prev
            FROM meter_readings r
        )
        SELECT
            r.id            AS reading_id,
            rg.days_since_prev,
            m.meter_id,
            m.name          AS meter_name,
            m.energy_type,
            m.unit,
            m.site_id,
            s.name          AS site_name,
            r.timestamp     AT TIME ZONE 'Europe/Berlin' AS ts,
            r.consumption,
            ms.p95,
            -- Tagesbereinigter Faktor: (Verbrauch/Tage) / (p95/avg_days)
            (r.consumption / rg.days_since_prev)
                / NULLIF((ms.p95 / GREATEST(1, ms.avg_days)), 0) AS factor
        FROM meter_readings r
        JOIN readings_with_gap rg ON r.id = rg.id
        JOIN meter_stats ms ON r.meter_id = ms.meter_id
        JOIN meters m ON r.meter_id = m.id
        LEFT JOIN sites s ON m.site_id = s.id
        WHERE r.consumption > 0
          AND m.is_active = TRUE
          AND r.quality != 'verified'
          AND rg.days_since_prev IS NOT NULL
          AND (r.consumption / rg.days_since_prev)
              / NULLIF((ms.p95 / GREATEST(1, ms.avg_days)), 0) > :threshold
        ORDER BY factor DESC
        LIMIT :limit
    """), {"threshold": threshold, "limit": limit})

    rows = result.fetchall()
    return [
        AnomalyReading(
            reading_id=row.reading_id,
            meter_id=row.meter_id,
            meter_name=row.meter_name,
            energy_type=row.energy_type,
            unit=row.unit,
            site_id=row.site_id,
            site_name=row.site_name,
            timestamp=str(row.ts)[:16],
            consumption=Decimal(str(row.consumption)),
            p95=Decimal(str(row.p95)),
            factor=Decimal(str(row.factor)),
            days_since_prev=int(row.days_since_prev),
        )
        for row in rows
    ]


@router.delete("/anomalies/{reading_id}")
async def delete_anomaly_reading(
    reading_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Einen als Ausreißer markierten Messwert löschen."""
    reading = await db.get(MeterReading, reading_id)
    if reading:
        await db.delete(reading)
        await db.commit()
    return {"deleted": True, "id": reading_id}


@router.patch("/anomalies/{reading_id}/accept")
async def accept_anomaly_reading(
    reading_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Einen Ausreißer als geprüft/gültig markieren (quality = verified)."""
    reading = await db.get(MeterReading, reading_id)
    if reading:
        reading.quality = "verified"
        await db.commit()
    return {"accepted": True, "id": reading_id}


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
