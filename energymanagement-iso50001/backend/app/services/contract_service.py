"""
contract_service.py – Business Logic für Energielieferverträge.

Verwaltung von Verträgen und Soll-/Ist-Vergleich:
Vertragliches Jahresvolumen vs. tatsächlicher Verbrauch aus meter_readings.
"""

import uuid
from datetime import date
from decimal import Decimal

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contract import EnergyContract
from app.models.reading import MeterReading

logger = structlog.get_logger()


class ContractService:
    """Service für Energielieferverträge."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ─────────────────────────────────────────────
    # CRUD
    # ─────────────────────────────────────────────

    async def list_contracts(
        self,
        page: int = 1,
        page_size: int = 25,
        energy_type: str | None = None,
        is_active: bool | None = True,
    ) -> dict:
        """Alle Verträge paginiert auflisten."""
        query = select(EnergyContract)
        if is_active is not None:
            query = query.where(EnergyContract.is_active == is_active)
        if energy_type:
            query = query.where(EnergyContract.energy_type == energy_type)
        query = query.order_by(EnergyContract.energy_type, EnergyContract.name)

        count_q = select(func.count()).select_from(query.subquery())
        total = (await self.db.execute(count_q)).scalar() or 0

        query = query.offset((page - 1) * page_size).limit(page_size)
        result = await self.db.execute(query)
        items = result.scalars().all()

        return {"items": items, "total": total, "page": page, "page_size": page_size}

    async def get_contract(self, contract_id: uuid.UUID) -> EnergyContract:
        """Einzelnen Vertrag laden."""
        contract = await self.db.get(EnergyContract, contract_id)
        if not contract:
            raise ValueError("Vertrag nicht gefunden")
        return contract

    async def create_contract(self, data: dict) -> EnergyContract:
        """Neuen Vertrag anlegen."""
        # meter_ids als Liste von Strings speichern (JSON-kompatibel)
        if "meter_ids" in data:
            data["meter_ids"] = [str(m) for m in data["meter_ids"]]
        contract = EnergyContract(**data)
        self.db.add(contract)
        await self.db.commit()
        await self.db.refresh(contract)
        logger.info("contract_created", contract_id=str(contract.id), name=contract.name)
        return contract

    async def update_contract(
        self, contract_id: uuid.UUID, data: dict
    ) -> EnergyContract:
        """Vertrag aktualisieren."""
        contract = await self.get_contract(contract_id)
        if "meter_ids" in data and data["meter_ids"] is not None:
            data["meter_ids"] = [str(m) for m in data["meter_ids"]]
        for key, value in data.items():
            if hasattr(contract, key):
                setattr(contract, key, value)
        await self.db.commit()
        await self.db.refresh(contract)
        return contract

    async def delete_contract(self, contract_id: uuid.UUID) -> None:
        """Vertrag deaktivieren (Soft-Delete)."""
        contract = await self.get_contract(contract_id)
        contract.is_active = False
        await self.db.commit()

    # ─────────────────────────────────────────────
    # Soll-/Ist-Vergleich
    # ─────────────────────────────────────────────

    async def get_comparison(
        self,
        contract_id: uuid.UUID,
        period_start: date,
        period_end: date,
    ) -> dict:
        """
        Soll-/Ist-Vergleich: Vertrag vs. tatsächlicher Verbrauch.

        Berechnet anteiliges Sollvolumen für den Zeitraum (pro-rata),
        vergleicht mit tatsächlichem Verbrauch aus meter_readings,
        und rechnet auf das Jahresende hoch.
        """
        contract = await self.get_contract(contract_id)

        today = date.today()
        days_in_period = (period_end - period_start).days or 1
        days_elapsed = min((today - period_start).days, days_in_period)

        # Anteiliges Sollvolumen für den Zeitraum (pro-rata auf 365 Tage)
        contracted_period_kwh = None
        if contract.contracted_annual_kwh:
            contracted_period_kwh = round(
                contract.contracted_annual_kwh * Decimal(days_in_period) / Decimal(365), 2
            )

        # Tatsächlicher Verbrauch aus den zugeordneten Zählern
        meter_uuids = [uuid.UUID(m) for m in (contract.meter_ids or []) if m]
        actual_kwh = Decimal("0")
        actual_cost_net = Decimal("0")

        if meter_uuids:
            reading_q = select(
                func.sum(MeterReading.consumption).label("kwh"),
                func.sum(MeterReading.cost_net).label("cost_net"),
            ).where(
                MeterReading.meter_id.in_(meter_uuids),
                MeterReading.timestamp >= period_start,
                MeterReading.timestamp < period_end,
                MeterReading.consumption.isnot(None),
            )
            row = (await self.db.execute(reading_q)).one()
            actual_kwh = Decimal(str(row.kwh or 0))
            actual_cost_net = Decimal(str(row.cost_net or 0))

        # Abweichung Soll/Ist
        deviation_kwh = None
        deviation_percent = None
        if contracted_period_kwh is not None:
            deviation_kwh = round(actual_kwh - contracted_period_kwh, 2)
            if contracted_period_kwh != 0:
                deviation_percent = round(
                    (actual_kwh - contracted_period_kwh) / contracted_period_kwh * 100, 1
                )

        # Hochrechnung auf Jahresende (linear auf Basis des bisherigen Verbrauchs)
        projected_annual_kwh = None
        if days_elapsed > 0:
            projected_annual_kwh = round(
                actual_kwh / Decimal(days_elapsed) * Decimal(365), 2
            )

        # Effektiver Preis aus Readings
        actual_price_per_kwh = None
        if actual_kwh > 0 and actual_cost_net > 0:
            actual_price_per_kwh = round(actual_cost_net / actual_kwh, 6)

        # Ablauf-Status
        is_expired = bool(contract.valid_until and contract.valid_until < today)
        expires_soon = False
        if contract.valid_until and not is_expired:
            days_to_expiry = (contract.valid_until - today).days
            notice = int(contract.notice_period_days or 90)
            expires_soon = days_to_expiry <= notice

        return {
            "contract_id": contract.id,
            "contract_name": contract.name,
            "supplier": contract.supplier,
            "energy_type": contract.energy_type,
            "period_start": period_start,
            "period_end": period_end,
            "contracted_annual_kwh": contract.contracted_annual_kwh,
            "contracted_period_kwh": contracted_period_kwh,
            "actual_kwh": round(actual_kwh, 2),
            "actual_cost_net": round(actual_cost_net, 2),
            "deviation_kwh": deviation_kwh,
            "deviation_percent": deviation_percent,
            "projected_annual_kwh": projected_annual_kwh,
            "contracted_price_per_kwh": contract.price_per_kwh,
            "actual_price_per_kwh": actual_price_per_kwh,
            "days_in_period": days_in_period,
            "days_elapsed": days_elapsed,
            "is_expired": is_expired,
            "expires_soon": expires_soon,
        }

    async def list_expiring_contracts(self, within_days: int = 90) -> list[EnergyContract]:
        """Verträge auflisten, die bald enden oder bereits abgelaufen sind."""
        today = date.today()
        from datetime import timedelta
        threshold = today + timedelta(days=within_days)

        result = await self.db.execute(
            select(EnergyContract)
            .where(
                EnergyContract.is_active == True,  # noqa: E712
                EnergyContract.valid_until.isnot(None),
                EnergyContract.valid_until <= threshold,
            )
            .order_by(EnergyContract.valid_until)
        )
        return list(result.scalars().all())
