"""
tariff_aggregate_service.py – Vorberechnete Tarif-Aggregate aus Abrechnungen.

Berechnet pro Site und Periode den durchschnittlichen effektiven kWh-Preis
sowie die Basisgebühren je Energieart aus den `energy_invoices`. Ergebnis
wird in `tariff_aggregate_snapshots` persistiert und vom Celery-Beat-Task
`precompute_tariff_aggregates` täglich aufgefrischt.

Statt diese Aggregation bei jedem Aufruf einer Kosten-/Wirtschaftlichkeits-
seite live zu berechnen, lesen die zugehörigen Endpunkte den Snapshot.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import structlog
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.invoice import EnergyInvoice
from app.models.meter import Meter
from app.models.snapshot import TariffAggregateSnapshot
from app.services.snapshot_periods import resolve_period

logger = structlog.get_logger()


class TariffAggregateService:
    """Service für vorberechnete Tarif-Aggregate."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def load_snapshot(
        self, site_id: uuid.UUID | None, period_key: str,
    ) -> dict | None:
        """Lädt ein vorberechnetes Tarif-Aggregat oder None."""
        stmt = select(TariffAggregateSnapshot.payload).where(
            TariffAggregateSnapshot.site_id.is_(None) if site_id is None
            else TariffAggregateSnapshot.site_id == site_id,
            TariffAggregateSnapshot.period_key == period_key,
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def compute_and_persist_snapshot(
        self, site_id: uuid.UUID | None, period_key: str,
    ) -> None:
        """Berechnet effektive Tarife je Energieart aus den Abrechnungen,
        die in die Periode fallen, und persistiert sie."""
        start, end = resolve_period(period_key)
        payload = await self._compute_live(site_id, start, end)
        await self._upsert(site_id, period_key, payload)

    async def _compute_live(
        self, site_id: uuid.UUID | None, start: date, end: date,
    ) -> dict:
        meter_query = select(Meter.id, Meter.energy_type).where(
            Meter.is_active == True,  # noqa: E712
        )
        if site_id:
            meter_query = meter_query.where(Meter.site_id == site_id)
        meters = (await self.db.execute(meter_query)).all()
        if not meters:
            return {"period_start": start, "period_end": end, "by_energy_type": {}}

        meter_id_to_type = {m.id: m.energy_type for m in meters}
        meter_ids = list(meter_id_to_type.keys())

        invoices = (await self.db.execute(
            select(EnergyInvoice).where(
                EnergyInvoice.meter_id.in_(meter_ids),
                EnergyInvoice.period_start <= end,
                EnergyInvoice.period_end >= start,
            )
        )).scalars().all()

        # Aggregation je Energieart
        agg: dict[str, dict[str, Decimal]] = {}
        for inv in invoices:
            etype = meter_id_to_type.get(inv.meter_id)
            if not etype:
                continue
            bucket = agg.setdefault(etype, {
                "net_cost": Decimal("0"),
                "base_fees": Decimal("0"),
                "consumption": Decimal("0"),
                "invoice_count": Decimal("0"),
            })
            net = inv.total_cost_net or (
                inv.total_cost_gross / (1 + (inv.vat_rate or Decimal("0")) / 100)
                if inv.total_cost_gross else Decimal("0")
            )
            bucket["net_cost"] += net or Decimal("0")
            bucket["base_fees"] += inv.base_fee or Decimal("0")
            bucket["consumption"] += inv.total_consumption or Decimal("0")
            bucket["invoice_count"] += Decimal("1")

        by_energy_type = {}
        for etype, b in agg.items():
            cons = b["consumption"]
            effective = None
            if cons > 0:
                effective = (b["net_cost"] - b["base_fees"]) / cons
            by_energy_type[etype] = {
                "net_cost_eur": float(b["net_cost"]),
                "base_fees_eur": float(b["base_fees"]),
                "consumption": float(cons),
                "effective_price_per_kwh": float(effective) if effective is not None else None,
                "invoice_count": int(b["invoice_count"]),
            }

        return {
            "period_start": start,
            "period_end": end,
            "by_energy_type": by_energy_type,
        }

    async def _upsert(
        self, site_id: uuid.UUID | None, period_key: str, payload: dict,
    ) -> None:
        json_payload = jsonable_encoder(payload)
        now = datetime.now(timezone.utc)

        existing = (await self.db.execute(
            select(TariffAggregateSnapshot).where(
                TariffAggregateSnapshot.site_id.is_(None) if site_id is None
                else TariffAggregateSnapshot.site_id == site_id,
                TariffAggregateSnapshot.period_key == period_key,
            )
        )).scalar_one_or_none()

        if existing:
            existing.payload = json_payload
            existing.generated_at = now
        else:
            self.db.add(TariffAggregateSnapshot(
                site_id=site_id,
                period_key=period_key,
                payload=json_payload,
                generated_at=now,
            ))
        await self.db.commit()
