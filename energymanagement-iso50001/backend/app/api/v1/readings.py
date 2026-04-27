"""
readings.py – Endpunkte für Zählerstände und Verbrauchsdaten.

Zählerstände können einzeln oder als Bulk erfasst werden.
Die Verbrauchsberechnung erfolgt automatisch als Differenz
aufeinanderfolgender Stände.
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
from app.models.user import User
from app.schemas.common import DeleteResponse, PaginatedResponse
from app.schemas.reading import (
    ConsumptionSummary,
    ReadingBulkCreate,
    ReadingCreate,
    ReadingResponse,
    ReadingUpdate,
)
from app.services.reading_service import ReadingService

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


# ---------------------------------------------------------------------------
# Verbrauchsabfragen
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
# Ausreißer-Erkennung und -Verwaltung
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
    # Alle aktiven Zähler laden
    meter_q = select(Meter).where(Meter.is_active == True, Meter.is_feed_in != True)  # noqa: E712
    if energy_type:
        meter_q = meter_q.where(Meter.energy_type == energy_type)
    meters = list((await db.execute(meter_q)).scalars().all())

    outliers = []
    for meter in meters:
        # Median per Zähler (alle Readings mit positivem Verbrauch)
        median_q = select(
            func.percentile_cont(0.5).within_group(MeterReading.consumption).label("median")
        ).where(
            MeterReading.meter_id == meter.id,
            MeterReading.consumption > 0,
            MeterReading.quality != "outlier",
        )
        median_row = (await db.execute(median_q)).one()
        median = float(median_row.median or 0)
        if median < 1:
            continue

        threshold_val = median * factor_threshold
        if threshold_val < min_value:
            threshold_val = min_value

        # Ausreißer finden
        out_q = select(MeterReading).where(
            MeterReading.meter_id == meter.id,
            MeterReading.consumption > Decimal(str(threshold_val)),
            MeterReading.quality != "outlier",
        ).order_by(MeterReading.consumption.desc()).limit(50)
        readings = list((await db.execute(out_q)).scalars().all())

        for r in readings:
            outliers.append(OutlierItem(
                reading_id=str(r.id),
                meter_id=str(meter.id),
                meter_name=meter.name,
                energy_type=meter.energy_type,
                timestamp=r.timestamp.isoformat(),
                value=float(r.value or 0),
                consumption=float(r.consumption or 0),
                median_consumption=round(median, 2),
                factor=round(float(r.consumption or 0) / median, 1),
                quality=r.quality or "measured",
            ))

    outliers.sort(key=lambda x: -x.factor)
    return outliers[:500]


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
        return {"status": "deleted", "reading_id": str(reading_id)}

    if body.action == "flag":
        reading.quality = "outlier"
        reading.consumption = None
        reading.notes = f"Als Ausreißer markiert am {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')} UTC"
        await db.commit()
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
        return {"status": "interpolated", "new_consumption": float(interpolated), "reading_id": str(reading_id)}


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
        return {"status": "deleted", "count": len(ids)}
    if action == "flag":
        result = await db.execute(select(MeterReading).where(MeterReading.id.in_(ids)))
        readings = result.scalars().all()
        for r in readings:
            r.quality = "outlier"
            r.consumption = None
            r.notes = f"Als Ausreißer markiert (Batch) am {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')} UTC"
        await db.commit()
        return {"status": "flagged", "count": len(ids)}
