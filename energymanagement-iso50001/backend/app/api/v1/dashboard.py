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
    site_id: uuid.UUID | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Dashboard-Daten für den angegebenen Zeitraum abrufen."""
    import structlog
    logger = structlog.get_logger()
    try:
        service = DashboardService(db)
        result = await service.get_dashboard(period_start, period_end, granularity, site_id)
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
    quality_reason: str | None = None  # gesetzt bei Datenqualitätsproblemen


class AnomalyResponse(BaseModel):
    """Antwort: echte Ausreißer + Datenqualitätsprobleme getrennt."""
    anomalies: list[AnomalyReading]
    data_quality_issues: list[AnomalyReading]


@router.get("/anomalies", response_model=AnomalyResponse)
async def get_anomalies(
    threshold: float = Query(5.0, ge=2.0, description="Faktor über p95 ab dem ein Ausreißer erkannt wird"),
    limit: int = Query(100, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Statistische Ausreißer in Messwerten erkennen.

    Liefert echte Ausreißer (consumption > threshold × p95) getrennt von
    Datenqualitätsproblemen (Null-Ablesungen, Einfrierungen, Dezimalfehler).
    """
    # Gemeinsame CTEs für beide Queries
    base_cte = """
        WITH reading_gaps AS (
            SELECT
                meter_id,
                consumption,
                EXTRACT(EPOCH FROM (
                    timestamp - LAG(timestamp) OVER (PARTITION BY meter_id ORDER BY timestamp)
                )) / 86400.0 AS gap_days
            FROM meter_readings
            WHERE consumption IS NOT NULL AND consumption > 0
        ),
        meter_stats AS (
            SELECT
                meter_id,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY consumption) AS p95,
                AVG(gap_days) AS avg_days
            FROM reading_gaps
            GROUP BY meter_id
            HAVING COUNT(*) >= 10
              AND PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY consumption) >= 1
        ),
        readings_with_gap AS (
            SELECT
                r.id,
                r.meter_id,
                LAG(r.value, 1) OVER (PARTITION BY r.meter_id ORDER BY r.timestamp) AS prev_value1,
                LAG(r.value, 2) OVER (PARTITION BY r.meter_id ORDER BY r.timestamp) AS prev_value2,
                GREATEST(1, ROUND(
                    EXTRACT(EPOCH FROM (
                        r.timestamp - LAG(r.timestamp) OVER (PARTITION BY r.meter_id ORDER BY r.timestamp)
                    )) / 86400.0
                )) AS days_since_prev
            FROM meter_readings r
        ),
        candidates AS (
            SELECT
                r.id            AS reading_id,
                rg.days_since_prev,
                rg.prev_value1,
                rg.prev_value2,
                m.id            AS meter_id,
                m.name          AS meter_name,
                m.energy_type,
                m.unit,
                m.site_id,
                s.name          AS site_name,
                r.timestamp     AT TIME ZONE 'Europe/Berlin' AS ts,
                r.consumption,
                ms.p95,
                (r.consumption / rg.days_since_prev)
                    / NULLIF((ms.p95 / GREATEST(1, ms.avg_days)), 0) AS factor,
                -- Datenqualitäts-Klassifikation (höchste Priorität zuerst)
                CASE
                    WHEN COALESCE(rg.prev_value1, 1) <= 0 OR COALESCE(rg.prev_value2, 1) <= 0
                        THEN 'Null-Ablesung im Vorgänger'
                    WHEN rg.prev_value2 IS NOT NULL AND rg.prev_value2 != 0
                         AND rg.prev_value1 / NULLIF(rg.prev_value2, 0) NOT BETWEEN 0.01 AND 100
                        THEN 'Möglicher Dezimalfehler im Vorgänger'
                    WHEN rg.prev_value1 IS NOT NULL AND rg.prev_value2 IS NOT NULL
                         AND rg.prev_value1 = rg.prev_value2
                        THEN 'Eingefrorener Zählerstand'
                    ELSE NULL
                END AS quality_reason
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
        )
    """

    # Echte Ausreißer (alle Qualitätsfilter bestehen)
    anomaly_sql = base_cte + """
        SELECT * FROM candidates
        WHERE quality_reason IS NULL
        ORDER BY factor DESC
        LIMIT :limit
    """

    # Datenqualitätsprobleme (mindestens ein Filter schlägt an)
    quality_sql = base_cte + """
        SELECT * FROM candidates
        WHERE quality_reason IS NOT NULL
        ORDER BY factor DESC
        LIMIT :limit
    """

    anomaly_rows = (await db.execute(text(anomaly_sql), {"threshold": threshold, "limit": limit})).fetchall()
    quality_rows = (await db.execute(text(quality_sql), {"threshold": threshold, "limit": limit})).fetchall()

    def _to_model(row: object, quality_reason: str | None = None) -> AnomalyReading:
        return AnomalyReading(
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
            quality_reason=quality_reason or row.quality_reason,
        )

    return AnomalyResponse(
        anomalies=[_to_model(r) for r in anomaly_rows],
        data_quality_issues=[_to_model(r) for r in quality_rows],
    )


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
