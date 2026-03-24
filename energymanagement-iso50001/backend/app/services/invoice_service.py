"""
invoice_service.py – Geschäftslogik für Energieabrechnungen.
"""

import uuid
from datetime import date
from decimal import Decimal

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.invoice import EnergyInvoice

logger = structlog.get_logger()


class InvoiceNotFoundException(Exception):
    """Abrechnung nicht gefunden."""
    pass


class InvoiceService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_invoices(self, meter_id: uuid.UUID) -> list[EnergyInvoice]:
        """Alle Abrechnungen eines Zählers laden."""
        result = await self.db.execute(
            select(EnergyInvoice)
            .where(EnergyInvoice.meter_id == meter_id)
            .order_by(EnergyInvoice.period_start.desc())
        )
        return list(result.scalars().all())

    async def create_invoice(self, meter_id: uuid.UUID, data: dict) -> EnergyInvoice:
        """Neue Abrechnung anlegen."""
        invoice = EnergyInvoice(
            meter_id=meter_id,
            period_start=data["period_start"],
            period_end=data["period_end"],
            total_cost_gross=data["total_cost_gross"],
            total_cost_net=data.get("total_cost_net"),
            vat_rate=data.get("vat_rate"),
            base_fee=data.get("base_fee"),
            total_consumption=data.get("total_consumption"),
            invoice_number=data.get("invoice_number"),
            notes=data.get("notes"),
        )
        self.db.add(invoice)
        await self.db.commit()
        logger.info("invoice_created", invoice_id=str(invoice.id), meter_id=str(meter_id))
        return invoice

    async def update_invoice(self, invoice_id: uuid.UUID, data: dict) -> EnergyInvoice:
        """Abrechnung aktualisieren."""
        invoice = await self.db.get(EnergyInvoice, invoice_id)
        if not invoice:
            raise InvoiceNotFoundException(str(invoice_id))

        for field in [
            "period_start", "period_end", "total_cost_gross", "total_cost_net",
            "vat_rate", "base_fee", "total_consumption", "invoice_number", "notes",
        ]:
            if field in data:
                setattr(invoice, field, data[field])

        await self.db.commit()
        logger.info("invoice_updated", invoice_id=str(invoice_id))
        return invoice

    async def delete_invoice(self, invoice_id: uuid.UUID) -> None:
        """Abrechnung löschen."""
        invoice = await self.db.get(EnergyInvoice, invoice_id)
        if not invoice:
            raise InvoiceNotFoundException(str(invoice_id))
        await self.db.delete(invoice)
        await self.db.commit()
        logger.info("invoice_deleted", invoice_id=str(invoice_id))

    async def get_effective_price(
        self, meter_id: uuid.UUID, target_date: date
    ) -> Decimal | None:
        """Effektiven kWh-Preis für ein Datum aus passender Abrechnung ermitteln."""
        result = await self.db.execute(
            select(EnergyInvoice)
            .where(
                EnergyInvoice.meter_id == meter_id,
                EnergyInvoice.period_start <= target_date,
                EnergyInvoice.period_end >= target_date,
            )
            .order_by(EnergyInvoice.period_end.desc())
            .limit(1)
        )
        invoice = result.scalar_one_or_none()
        if invoice:
            return invoice.effective_price_per_kwh

        # Fallback: Letzte verfügbare Abrechnung
        result = await self.db.execute(
            select(EnergyInvoice)
            .where(EnergyInvoice.meter_id == meter_id)
            .order_by(EnergyInvoice.period_end.desc())
            .limit(1)
        )
        invoice = result.scalar_one_or_none()
        return invoice.effective_price_per_kwh if invoice else None
