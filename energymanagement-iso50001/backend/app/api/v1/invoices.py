"""
invoices.py – Endpunkte für Energieabrechnungen.

Abrechnungen werden pro Zähler erfasst und dienen zur Berechnung
des effektiven kWh-Preises bei gleitenden Tarifen.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.user import User
from app.schemas.common import DeleteResponse
from app.schemas.invoice import (
    EnergyInvoiceCreate,
    EnergyInvoiceResponse,
    EnergyInvoiceUpdate,
)
from app.services.invoice_service import InvoiceNotFoundException, InvoiceService

router = APIRouter()


def _invoice_to_response(invoice) -> EnergyInvoiceResponse:
    return EnergyInvoiceResponse(
        id=invoice.id,
        meter_id=invoice.meter_id,
        period_start=invoice.period_start,
        period_end=invoice.period_end,
        total_cost_gross=invoice.total_cost_gross,
        total_cost_net=invoice.total_cost_net,
        vat_rate=invoice.vat_rate,
        base_fee=invoice.base_fee,
        total_consumption=invoice.total_consumption,
        invoice_number=invoice.invoice_number,
        notes=invoice.notes,
        effective_price_per_kwh=invoice.effective_price_per_kwh,
        created_at=invoice.created_at,
    )


@router.get("/meters/{meter_id}/invoices", response_model=list[EnergyInvoiceResponse])
async def list_invoices(
    meter_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle Abrechnungen eines Zählers auflisten."""
    service = InvoiceService(db)
    invoices = await service.list_invoices(meter_id)
    return [_invoice_to_response(i) for i in invoices]


@router.post("/meters/{meter_id}/invoices", response_model=EnergyInvoiceResponse, status_code=201)
async def create_invoice(
    meter_id: uuid.UUID,
    request: EnergyInvoiceCreate,
    current_user: User = Depends(require_permission("meters", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Neue Abrechnung für einen Zähler anlegen."""
    service = InvoiceService(db)
    invoice = await service.create_invoice(meter_id, request.model_dump())
    return _invoice_to_response(invoice)


@router.put("/invoices/{invoice_id}", response_model=EnergyInvoiceResponse)
async def update_invoice(
    invoice_id: uuid.UUID,
    request: EnergyInvoiceUpdate,
    current_user: User = Depends(require_permission("meters", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Abrechnung aktualisieren."""
    service = InvoiceService(db)
    try:
        invoice = await service.update_invoice(
            invoice_id, request.model_dump(exclude_unset=True)
        )
        return _invoice_to_response(invoice)
    except InvoiceNotFoundException:
        raise HTTPException(status_code=404, detail="Abrechnung nicht gefunden")


@router.delete("/invoices/{invoice_id}", response_model=DeleteResponse)
async def delete_invoice(
    invoice_id: uuid.UUID,
    current_user: User = Depends(require_permission("meters", "delete")),
    db: AsyncSession = Depends(get_db),
):
    """Abrechnung löschen."""
    service = InvoiceService(db)
    try:
        await service.delete_invoice(invoice_id)
        return DeleteResponse(id=invoice_id)
    except InvoiceNotFoundException:
        raise HTTPException(status_code=404, detail="Abrechnung nicht gefunden")
