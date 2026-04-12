"""
contracts.py – Endpunkte für Energielieferverträge.

CRUD für Verträge + Soll-/Ist-Vergleich und Ablauf-Monitoring.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.user import User
from app.schemas.common import PaginatedResponse
from app.schemas.contract import (
    ContractComparisonResponse,
    EnergyContractCreate,
    EnergyContractResponse,
    EnergyContractUpdate,
)
from app.services.contract_service import ContractService

router = APIRouter()


def _to_response(c) -> EnergyContractResponse:
    return EnergyContractResponse(
        id=c.id,
        name=c.name,
        contract_number=c.contract_number,
        supplier=c.supplier,
        energy_type=c.energy_type,
        valid_from=c.valid_from,
        valid_until=c.valid_until,
        notice_period_days=int(c.notice_period_days) if c.notice_period_days is not None else None,
        auto_renewal=c.auto_renewal,
        contracted_annual_kwh=c.contracted_annual_kwh,
        contracted_annual_m3=c.contracted_annual_m3,
        price_per_kwh=c.price_per_kwh,
        price_per_m3=c.price_per_m3,
        base_fee_monthly=c.base_fee_monthly,
        peak_demand_fee=c.peak_demand_fee,
        vat_rate=c.vat_rate,
        max_demand_kw=c.max_demand_kw,
        voltage_level=c.voltage_level,
        renewable_share_percent=c.renewable_share_percent,
        co2_g_per_kwh=c.co2_g_per_kwh,
        notes=c.notes,
        document_path=c.document_path,
        additional_data=c.additional_data,
        meter_ids=[uuid.UUID(m) for m in (c.meter_ids or [])],
        is_active=c.is_active,
        created_at=c.created_at,
        updated_at=c.updated_at,
    )


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("", response_model=PaginatedResponse[EnergyContractResponse])
async def list_contracts(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    energy_type: str | None = None,
    is_active: bool | None = True,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle Energielieferverträge auflisten."""
    service = ContractService(db)
    result = await service.list_contracts(
        page=page, page_size=page_size,
        energy_type=energy_type, is_active=is_active,
    )
    return {
        **result,
        "items": [_to_response(c) for c in result["items"]],
    }


@router.post("", response_model=EnergyContractResponse, status_code=201)
async def create_contract(
    request: EnergyContractCreate,
    current_user: User = Depends(require_permission("economics", "write")),
    db: AsyncSession = Depends(get_db),
):
    """Neuen Energieliefervertrag anlegen."""
    service = ContractService(db)
    contract = await service.create_contract(request.model_dump())
    return _to_response(contract)


@router.get("/expiring", response_model=list[EnergyContractResponse])
async def list_expiring_contracts(
    within_days: int = Query(90, ge=1, le=365),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Verträge auflisten, die innerhalb von N Tagen enden (inkl. abgelaufener)."""
    service = ContractService(db)
    contracts = await service.list_expiring_contracts(within_days=within_days)
    return [_to_response(c) for c in contracts]


@router.get("/{contract_id}", response_model=EnergyContractResponse)
async def get_contract(
    contract_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Einzelnen Vertrag laden."""
    service = ContractService(db)
    try:
        contract = await service.get_contract(contract_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Vertrag nicht gefunden")
    return _to_response(contract)


@router.put("/{contract_id}", response_model=EnergyContractResponse)
async def update_contract(
    contract_id: uuid.UUID,
    request: EnergyContractUpdate,
    current_user: User = Depends(require_permission("economics", "write")),
    db: AsyncSession = Depends(get_db),
):
    """Vertrag aktualisieren."""
    service = ContractService(db)
    try:
        contract = await service.update_contract(
            contract_id, request.model_dump(exclude_unset=True)
        )
    except ValueError:
        raise HTTPException(status_code=404, detail="Vertrag nicht gefunden")
    return _to_response(contract)


@router.delete("/{contract_id}", status_code=204)
async def delete_contract(
    contract_id: uuid.UUID,
    current_user: User = Depends(require_permission("economics", "write")),
    db: AsyncSession = Depends(get_db),
):
    """Vertrag deaktivieren."""
    service = ContractService(db)
    try:
        await service.delete_contract(contract_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Vertrag nicht gefunden")


# ── Soll-/Ist-Vergleich ───────────────────────────────────────────────────────

@router.get("/{contract_id}/comparison", response_model=ContractComparisonResponse)
async def get_contract_comparison(
    contract_id: uuid.UUID,
    period_start: date = Query(...),
    period_end: date = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Soll-/Ist-Vergleich für einen Vertrag.

    Vergleicht das anteilige Sollvolumen des Vertrags mit dem tatsächlichen
    Verbrauch der zugeordneten Zähler im angegebenen Zeitraum.
    Hochrechnung auf Jahresende wird mitgeliefert.
    """
    service = ContractService(db)
    try:
        result = await service.get_comparison(contract_id, period_start, period_end)
    except ValueError:
        raise HTTPException(status_code=404, detail="Vertrag nicht gefunden")
    return result
