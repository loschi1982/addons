"""
readings.py – Endpunkte für Zählerstände und Verbrauchsdaten.

Zählerstände können einzeln oder als Bulk erfasst werden.
Die Verbrauchsberechnung erfolgt automatisch als Differenz
aufeinanderfolgender Stände.

WICHTIG: Reihenfolge der Routen beachten – statische Pfade (z.B. /consumption/summary,
/outliers) müssen VOR parametrischen Pfaden (/{reading_id}) stehen, da FastAPI
first-match-wins verwendet und sonst "outliers" als reading_id (UUID) interpretiert.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.meter import Meter
from app.models.reading import MeterReading
from app.models.settings import AppSetting
from app.models.user import User
from app.schemas.common import DeleteResponse, PaginatedResponse
from app.schemas.reading import (
    ConsumptionSummary,
    ReadingBulkCreate,
    ReadingCreate,
    ReadingResponse,
    ReadingUpdate,
)
from app.services.reading_service import (
    OUTLIER_DEFAULT_FACTOR,
    OUTLIER_DEFAULT_MIN_VALUE,
    OUTLIER_SNAPSHOT_KEY,
    ReadingService,
)

router = APIRouter()


def _reading_to_response(r) -> ReadingResponse:
    """MeterReading → ReadingResponse."""
    return ReadingResponse(
        id=r.id,
        meter_id=r.meter_id,
        timestamp=r.timestamp,
        value=r.value,
        consumption=r.consumption,
        source=r.source,
        quality=r.quality,
        cost_gross=r.cost_gross,
        vat_rate=r.vat_rate,
        cost_net=r.cost_net,
        notes=r.notes,
        import_batch_id=r.import_batch_id,
    )


@router.get("", response_model=PaginatedResponse[ReadingResponse])
async def list_readings(
    meter_id: uuid.UUID | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    source: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Zählerstände auflisten mit Filtern."""
    service = ReadingService(db)
    result = await service.list_readings(
        meter_id=meter_id,
        start_date=start_date,
        end_date=end_date,
        source=source,
        page=page,
        page_size=page_size,
    )

    total = result["total"]
    return PaginatedResponse(
        items=[_reading_to_response(r) for r in result["items"]],
        total=total,
        page=result["page"],
        page_size=result["page_size"],
        total_pages=(total + page_size - 1) // page_size if total > 0 else 0,
    )


@router.post("", response_model=ReadingResponse, status_code=201)
async def create_reading(
    request: ReadingCreate,
    current_user: User = Depends(require_permission("readings", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Einzelnen Zählerstand erfassen."""
    service = ReadingService(db)
    reading = await service.create_reading(request.model_dump())
    return _reading_to_response(reading)


@router.post("/bulk", response_model=list[ReadingResponse], status_code=201)
async def create_readings_bulk(
    request: ReadingBulkCreate,
    current_user: User = Depends(require_permission("readings", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Mehrere Zählerstände auf einmal erfassen."""
    service = ReadingService(db)
    readings = await service.create_readings_bulk(
        [r.model_dump() for r in request.readings]
    )
    return [_reading_to_response(r) for r in readings]


# ---------------------------------------------------------------------------
# Verbrauchsabfragen – VOR /{reading_id} damit /consumption/summary nicht als
# UUID-Pfad interpretiert wird.
# ---------------------------------------------------------------------------

@router.get("/consumption/summary", response_model=list[ConsumptionSummary])
async def get_consumption_summary(
    meter_ids: str | None = Query(None, description="Komma-getrennte Zähler-UUIDs"),
    start_date: date = Query(...),
    end_date: date = Query(...),
    granularity: str = Query("monthly", pattern="^(daily|weekly|monthly|yearly)$"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Verbrauchszusammenfassung für Zeitraum und Zähler."""
    parsed_ids = []
    if meter_ids:
        for mid in meter_ids.split(","):
            parsed_ids.append(uuid.UUID(mid.strip()))

    service = ReadingService(db)
    return await service.get_consumption_summary(
        meter_ids=parsed_ids,
        start_date=start_date,
        end_date=end_date,
        granularity=granularity,
    )


# ---------------------------------------------------------------------------
# Ausreißer-Erkennung und -Verwaltung – VOR /{reading_id}
# ---------------------------------------------------------------------------

class OutlierItem(BaseModel):
    reading_id: str
    meter_id: str
    meter_name: str
    energy_type: str
    timestamp: str
    value: float
    consumption: float
    median_consumption: float
    factor: float          # consumption / median
    quality: str


class OutlierAction(BaseModel):
    action: Literal["delete", "flag", "interpolate"]


@router.get("/outliers", response_model=list[OutlierItem])
async def detect_outliers(
    factor_threshold: float = Query(10.0, description="Minimalfaktor über dem Median für Ausreißer"),
    min_value: float = Query(100.0, description="Mindestwert (kWh/m³) damit ein Wert als Ausreißer gilt"),
    energy_type: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Erkennt Ausreißer via IQR-ähnlicher Methode:
    Werte > factor_threshold × Median des jeweiligen Zählers gelten als Ausreißer.
    """
    # Schnellster Pfad: Bei Default-Parametern aus der vorberechneten Liste
    # liefern (Celery-Task precompute_consumption_stats). Vermeidet jeden
    # Live-Scan über die Timescale-Chunks. Energieart wird im Speicher gefiltert.
    if factor_threshold == OUTLIER_DEFAULT_FACTOR and min_value == OUTLIER_DEFAULT_MIN_VALUE:
        snap = (await db.execute(
            select(AppSetting.value).where(AppSetting.key == OUTLIER_SNAPSHOT_KEY)
        )).scalar_one_or_none()
        if snap and snap.get("items") is not None:
            items = snap["items"]
            if energy_type:
                items = [it for it in items if it.get("energy_type") == energy_type]
            return [OutlierItem(**it) for it in items[:500]]

    params: dict = {"factor": factor_threshold, "min_value": min_value}
    if energy_type:
        params["energy_type"] = energy_type
    energy_filter = "AND m.energy_type = :energy_type" if energy_type else ""

    # Schneller Pfad: gegen die vorberechnete Median-Tabelle joinen (Celery-
    # Task precompute_consumption_stats). Der teure percentile_cont entfällt;
    # der Index meter_readings(meter_id, consumption) macht den Range-Scan je
    # Zähler effizient.
    has_stats = (await db.execute(
        text("SELECT 1 FROM meter_consumption_stats LIMIT 1")
    )).scalar()

    if has_stats:
        # LATERAL erzwingt pro Zähler einen Index-Range-Scan auf
        # (meter_id, consumption): es werden nur die wenigen Readings über dem
        # Schwellwert gelesen, kein voller Tabellen-Scan. m wird zuerst gefiltert
        # (aktiv, kein Einspeiser, optional energy_type), dann je Zähler gejoint.
        sql = """
            SELECT mr.id, s.meter_id, m.name AS meter_name, m.energy_type,
                   mr.timestamp, mr.value, mr.consumption, mr.quality,
                   s.median_consumption AS median
            FROM meter_consumption_stats s
            JOIN meters m ON m.id = s.meter_id
            JOIN LATERAL (
                SELECT r.id, r.timestamp, r.value, r.consumption, r.quality
                FROM meter_readings r
                WHERE r.meter_id = s.meter_id
                  AND r.quality <> 'outlier'
                  AND r.consumption > GREATEST(s.median_consumption * :factor, :min_value)
                ORDER BY r.consumption DESC
                LIMIT 500
            ) mr ON true
            WHERE s.median_consumption >= 1
              AND m.is_active = true
              AND m.is_feed_in IS NOT TRUE
              {energy_filter}
            ORDER BY (mr.consumption / s.median_consumption) DESC
            LIMIT 500
        """.format(energy_filter=energy_filter)
    else:
        # Fallback (z.B. direkt nach Deploy, bevor der Celery-Task lief):
        # Median live via percentile_cont berechnen. Langsamer, aber korrekt.
        sql = """
            WITH meter_median AS (
                SELECT mr.meter_id,
                       percentile_cont(0.5) WITHIN GROUP (ORDER BY mr.consumption) AS median
                FROM meter_readings mr
                JOIN meters m ON m.id = mr.meter_id
                WHERE mr.consumption > 0
                  AND mr.quality <> 'outlier'
                  AND m.is_active = true
                  AND m.is_feed_in IS NOT TRUE
                  {energy_filter}
                GROUP BY mr.meter_id
                HAVING percentile_cont(0.5) WITHIN GROUP (ORDER BY mr.consumption) >= 1
            )
            SELECT mr.id, mr.meter_id, m.name AS meter_name, m.energy_type,
                   mr.timestamp, mr.value, mr.consumption, mr.quality, mm.median
            FROM meter_readings mr
            JOIN meter_median mm ON mm.meter_id = mr.meter_id
            JOIN meters m ON m.id = mr.meter_id
            WHERE mr.quality <> 'outlier'
              AND mr.consumption > GREATEST(mm.median * :factor, :min_value)
            ORDER BY (mr.consumption / mm.median) DESC
            LIMIT 500
        """.format(energy_filter=energy_filter)

    rows = (await db.execute(text(sql), params)).all()

    outliers = []
    for r in rows:
        median = float(r.median or 0)
        cons = float(r.consumption or 0)
        outliers.append(OutlierItem(
            reading_id=str(r.id),
            meter_id=str(r.meter_id),
            meter_name=r.meter_name,
            energy_type=r.energy_type,
            timestamp=r.timestamp.isoformat(),
            value=float(r.value or 0),
            consumption=cons,
            median_consumption=round(median, 2),
            factor=round(cons / median, 1) if median > 0 else 0,
            quality=r.quality or "measured",
        ))

    return outliers


@router.post("/outliers/bulk-action")
async def bulk_handle_outliers(
    reading_ids: list[str],
    action: Literal["delete", "flag"],
    current_user: User = Depends(require_permission("readings", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Massenaktion auf mehrere Ausreißer gleichzeitig."""
    ids = [uuid.UUID(rid) for rid in reading_ids]
    if action == "delete":
        await db.execute(delete(MeterReading).where(MeterReading.id.in_(ids)))
        await db.commit()
        await ReadingService(db).prune_outlier_snapshot(set(reading_ids))
        return {"status": "deleted", "count": len(ids)}
    if action == "flag":
        result = await db.execute(select(MeterReading).where(MeterReading.id.in_(ids)))
        readings = result.scalars().all()
        for r in readings:
            r.quality = "outlier"
            r.consumption = None
            r.notes = f"Als Ausreißer markiert (Batch) am {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')} UTC"
        await db.commit()
        await ReadingService(db).prune_outlier_snapshot(set(reading_ids))
        return {"status": "flagged", "count": len(ids)}


# ---------------------------------------------------------------------------
# Einzelne Messwert-Abfragen – NACH allen statischen Pfaden
# ---------------------------------------------------------------------------

@router.get("/{reading_id}/page-info")
async def get_reading_page_info(
    reading_id: uuid.UUID,
    page_size: int = Query(25, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Seitennummer und Position eines Messwerts in der paginierten Liste ermitteln.

    Nützlich um nach einer reading_id direkt die richtige Seite zu öffnen.
    Rückgabe: {meter_id, page, position_on_page, total}
    """
    reading = await db.get(MeterReading, reading_id)
    if not reading:
        raise HTTPException(status_code=404, detail="Messwert nicht gefunden")

    # Anzahl neuerer Messwerte zählen (timestamp DESC → position = count_newer)
    count_newer = await db.scalar(
        select(func.count(MeterReading.id)).where(
            MeterReading.meter_id == reading.meter_id,
            MeterReading.timestamp > reading.timestamp,
        )
    ) or 0

    total = await db.scalar(
        select(func.count(MeterReading.id)).where(
            MeterReading.meter_id == reading.meter_id,
        )
    ) or 0

    page = (count_newer // page_size) + 1
    position_on_page = count_newer % page_size

    return {
        "meter_id": str(reading.meter_id),
        "page": page,
        "position_on_page": position_on_page,
        "total": total,
    }


@router.get("/{reading_id}", response_model=ReadingResponse)
async def get_reading(
    reading_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Einzelnen Zählerstand abrufen."""
    service = ReadingService(db)
    reading = await service.get_reading(reading_id)
    return _reading_to_response(reading)


@router.put("/{reading_id}", response_model=ReadingResponse)
async def update_reading(
    reading_id: uuid.UUID,
    request: ReadingUpdate,
    current_user: User = Depends(require_permission("readings", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Zählerstand korrigieren."""
    service = ReadingService(db)
    reading = await service.update_reading(
        reading_id, request.model_dump(exclude_unset=True)
    )
    return _reading_to_response(reading)


@router.delete("/{reading_id}", response_model=DeleteResponse)
async def delete_reading(
    reading_id: uuid.UUID,
    current_user: User = Depends(require_permission("readings", "delete")),
    db: AsyncSession = Depends(get_db),
):
    """Zählerstand löschen."""
    service = ReadingService(db)
    await service.delete_reading(reading_id)
    return DeleteResponse(id=reading_id)


@router.post("/outliers/{reading_id}/action")
async def handle_outlier(
    reading_id: uuid.UUID,
    body: OutlierAction,
    current_user: User = Depends(require_permission("readings", "update")),
    db: AsyncSession = Depends(get_db),
):
    """
    Aktion auf einen Ausreißer-Messwert:
    - delete: Messwert löschen
    - flag: Als Ausreißer markieren (quality=outlier, consumption=NULL)
    - interpolate: Consumption durch Mittelwert der Nachbarwerte ersetzen
    """
    result = await db.execute(select(MeterReading).where(MeterReading.id == reading_id))
    reading = result.scalar_one_or_none()
    if not reading:
        raise HTTPException(status_code=404, detail="Messwert nicht gefunden")

    if body.action == "delete":
        await db.delete(reading)
        await db.commit()
        await ReadingService(db).prune_outlier_snapshot({str(reading_id)})
        return {"status": "deleted", "reading_id": str(reading_id)}

    if body.action == "flag":
        reading.quality = "outlier"
        reading.consumption = None
        reading.notes = f"Als Ausreißer markiert am {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')} UTC"
        await db.commit()
        await ReadingService(db).prune_outlier_snapshot({str(reading_id)})
        return {"status": "flagged", "reading_id": str(reading_id)}

    if body.action == "interpolate":
        # Vorheriger und nächster Wert desselben Zählers
        prev_q = select(MeterReading.consumption).where(
            MeterReading.meter_id == reading.meter_id,
            MeterReading.timestamp < reading.timestamp,
            MeterReading.consumption.isnot(None),
            MeterReading.quality != "outlier",
        ).order_by(MeterReading.timestamp.desc()).limit(1)
        next_q = select(MeterReading.consumption).where(
            MeterReading.meter_id == reading.meter_id,
            MeterReading.timestamp > reading.timestamp,
            MeterReading.consumption.isnot(None),
            MeterReading.quality != "outlier",
        ).order_by(MeterReading.timestamp).limit(1)
        prev_val = (await db.execute(prev_q)).scalar_one_or_none()
        next_val = (await db.execute(next_q)).scalar_one_or_none()

        if prev_val is not None and next_val is not None:
            interpolated = (prev_val + next_val) / 2
        elif prev_val is not None:
            interpolated = prev_val
        elif next_val is not None:
            interpolated = next_val
        else:
            raise HTTPException(status_code=422, detail="Keine Nachbarwerte für Interpolation")

        reading.consumption = interpolated
        reading.quality = "interpolated"
        reading.notes = (
            f"Interpoliert am {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')} UTC "
            f"(original: {float(reading.value):.1f})"
        )
        await db.commit()
        await ReadingService(db).prune_outlier_snapshot({str(reading_id)})
        return {"status": "interpolated", "new_consumption": float(interpolated), "reading_id": str(reading_id)}
