"""
emissions.py – Endpunkte für CO₂-Emissionen.

CO₂-Berechnung auf Basis von Emissionsfaktoren (BAFA, UBA,
Electricity Maps) und Verbrauchsdaten der Zähler.
Fernwärmeversorger-Verwaltung für standortspezifische CO₂-Faktoren.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.district_heating_provider import DistrictHeatingProvider
from app.models.user import User
from app.schemas.district_heating_provider import (
    DistrictHeatingProviderCreate,
    DistrictHeatingProviderResponse,
)
from app.schemas.emission import (
    CO2DashboardData,
    CO2Summary,
    EmissionFactorCreate,
    EmissionFactorResponse,
    EmissionFactorSourceResponse,
)
from app.services.co2_service import CO2Service

router = APIRouter()


@router.get("/dashboard", response_model=CO2DashboardData)
async def get_co2_dashboard(
    year: int | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """CO₂-Dashboard-Daten abrufen."""
    service = CO2Service(db)
    return await service.get_dashboard(year)


@router.get("/summary", response_model=CO2Summary)
async def get_co2_summary(
    start_date: date = Query(...),
    end_date: date = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """CO₂-Zusammenfassung für einen Zeitraum."""
    service = CO2Service(db)
    return await service.get_summary(start_date, end_date)


@router.get("/factors/sources", response_model=list[EmissionFactorSourceResponse])
async def list_factor_sources(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Verfügbare Emissionsfaktor-Quellen auflisten."""
    service = CO2Service(db)
    return await service.list_sources()


@router.get("/factors", response_model=list[EmissionFactorResponse])
async def list_factors(
    energy_type: str | None = None,
    year: int | None = None,
    source_id: uuid.UUID | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Emissionsfaktoren auflisten."""
    service = CO2Service(db)
    factors = await service.list_factors(
        energy_type=energy_type, year=year, source_id=source_id
    )
    # source_name hinzufügen
    result = []
    for f in factors:
        resp = EmissionFactorResponse(
            id=f.id,
            source_id=f.source_id,
            energy_type=f.energy_type,
            year=f.year or 0,
            month=f.month,
            region=f.region,
            co2_g_per_kwh=f.co2_g_per_kwh,
            scope=f.scope,
            source_name=f.source.name if f.source else None,
        )
        result.append(resp)
    return result


@router.post("/factors", response_model=EmissionFactorResponse, status_code=201)
async def create_factor(
    request: EmissionFactorCreate,
    current_user: User = Depends(require_permission("emissions", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Eigenen Emissionsfaktor anlegen."""
    service = CO2Service(db)
    factor = await service.create_factor(request.model_dump())
    return EmissionFactorResponse(
        id=factor.id,
        source_id=factor.source_id,
        energy_type=factor.energy_type,
        year=factor.year or 0,
        month=factor.month,
        region=factor.region,
        co2_g_per_kwh=factor.co2_g_per_kwh,
        scope=factor.scope,
    )


@router.get("/export")
async def export_co2(
    start_date: date = Query(...),
    end_date: date = Query(...),
    format: str = Query(
        "ghg", pattern="^(ghg|emas)$",
        description="Export-Format: ghg (GHG Protocol) oder emas",
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """CO₂-Bilanz als CSV exportieren (GHG Protocol oder EMAS)."""
    service = CO2Service(db)

    if format == "emas":
        csv_data = await service.export_emas_csv(start_date, end_date)
        filename = f"co2_emas_{start_date}_{end_date}.csv"
    else:
        csv_data = await service.export_ghg_csv(start_date, end_date)
        filename = f"co2_ghg_{start_date}_{end_date}.csv"

    # BOM für Excel-Kompatibilität
    bom = "\ufeff"
    return StreamingResponse(
        iter([bom + csv_data]),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.post("/calculate")
async def trigger_calculation(
    start_date: date = Query(...),
    end_date: date = Query(...),
    meter_ids: str | None = Query(None),
    current_user: User = Depends(require_permission("emissions", "calculate")),
    db: AsyncSession = Depends(get_db),
):
    """CO₂-Neuberechnung für einen Zeitraum anstoßen.

    Iteriert intern monatsweise (Backfill) und legt je (Zähler, Kalendermonat)
    genau EINE kanonische Zeile an. So entstehen keine mehrmonatigen Sammel-
    zeilen, deren Wert sonst im Startmonat fälschlich aufaddiert würde.
    """
    service = CO2Service(db)
    ids = [uuid.UUID(m.strip()) for m in meter_ids.split(",")] if meter_ids else None

    result = await service.backfill_all(start_date, end_date, meter_ids=ids)
    return {
        "message": f"{result['calculated']} Berechnungen über {result['months']} Monate "
                   f"({result['errors']} Fehler, {result.get('purged_noncanonical', 0)} Alt-Zeilen bereinigt)",
        **result,
    }


@router.post("/recalculate")
async def trigger_backfill(
    period_start: date | None = Query(None, description="Default: ältestes Reading"),
    period_end: date | None = Query(None, description="Default: heute"),
    energy_types: str | None = Query(None, description="Komma-Liste, z.B. 'district_heating,gas'"),
    current_user: User = Depends(require_permission("emissions", "calculate")),
    db: AsyncSession = Depends(get_db),
):
    """CO₂-Berechnungen für längeren Zeitraum monatsweise nachholen (Backfill).

    Idempotent (UPSERT): mehrfach aufrufen ist sicher und überschreibt
    bestehende Werte mit aktuell gültigen Faktoren.
    """
    service = CO2Service(db)
    et_filter = [t.strip() for t in energy_types.split(",")] if energy_types else None

    if not period_start:
        oldest = await service.find_oldest_reading_date(et_filter)
        if not oldest:
            return {"message": "Keine Readings gefunden, nichts zu tun.", "months": 0}
        period_start = oldest
    if not period_end:
        period_end = date.today()

    result = await service.backfill_all(period_start, period_end, et_filter)
    return {
        "message": f"{result['calculated']} Berechnungen über {result['months']} Monate ({result['errors']} Fehler)",
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "energy_types": et_filter,
        **result,
    }


# ── Fernwärmeversorger ──

@router.get(
    "/district-heating-providers",
    response_model=list[DistrictHeatingProviderResponse],
)
async def list_district_heating_providers(
    search: str | None = Query(None, description="Suchbegriff (Name oder Stadt)"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Deutsche Fernwärmeversorger mit FW-309-Kennzahlen auflisten."""
    query = select(DistrictHeatingProvider).order_by(DistrictHeatingProvider.name)
    if search:
        pattern = f"%{search}%"
        query = query.where(
            DistrictHeatingProvider.name.ilike(pattern)
            | DistrictHeatingProvider.city.ilike(pattern)
        )
    result = await db.execute(query)
    return list(result.scalars().all())


@router.get(
    "/district-heating-providers/{provider_id}",
    response_model=DistrictHeatingProviderResponse,
)
async def get_district_heating_provider(
    provider_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Einzelnen Fernwärmeversorger abrufen."""
    provider = await db.get(DistrictHeatingProvider, provider_id)
    if not provider:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Versorger nicht gefunden")
    return provider


@router.post(
    "/district-heating-providers",
    response_model=DistrictHeatingProviderResponse,
    status_code=201,
)
async def create_district_heating_provider(
    data: DistrictHeatingProviderCreate,
    current_user: User = Depends(require_permission("emissions", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Eigenen Fernwärmeversorger anlegen (falls nicht in der Liste)."""
    provider = DistrictHeatingProvider(**data.model_dump())
    db.add(provider)
    await db.commit()
    await db.refresh(provider)
    return provider
