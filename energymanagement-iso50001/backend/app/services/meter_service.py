"""
meter_service.py – Zähler-Verwaltung.

CRUD für Zähler, Baumansicht, Zählerwechsel.
Zähler können hierarchisch organisiert sein (Haupt-/Unterzähler).
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import structlog
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import MeterNotFoundException
from app.models.consumer import Consumer
from app.models.meter import Meter
from app.models.reading import MeterReading
from app.models.invoice import EnergyInvoice

logger = structlog.get_logger()


class MeterService:
    """Service für Zähler-CRUD und Hierarchie."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_meters(
        self,
        page: int = 1,
        page_size: int = 25,
        energy_type: str | None = None,
        data_source: str | None = None,
        site_id: uuid.UUID | None = None,
        building_id: uuid.UUID | None = None,
        usage_unit_id: uuid.UUID | None = None,
        is_active: bool | None = True,
        search: str | None = None,
    ) -> dict:
        """
        Zähler auflisten mit Filtern und Pagination.

        Returns:
            Dict mit items, total, page, page_size
        """
        query = select(Meter)

        if energy_type:
            query = query.where(Meter.energy_type == energy_type)
        if data_source:
            query = query.where(Meter.data_source == data_source)
        if site_id:
            query = query.where(Meter.site_id == site_id)
        if building_id:
            query = query.where(Meter.building_id == building_id)
        if usage_unit_id:
            query = query.where(Meter.usage_unit_id == usage_unit_id)
        if is_active is not None:
            query = query.where(Meter.is_active == is_active)
        if search:
            pattern = f"%{search}%"
            query = query.where(
                or_(
                    Meter.name.ilike(pattern),
                    Meter.meter_number.ilike(pattern),
                    Meter.location.ilike(pattern),
                )
            )

        # Gesamtanzahl
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.db.execute(count_query)).scalar() or 0

        # Pagination
        offset = (page - 1) * page_size
        query = query.offset(offset).limit(page_size).order_by(Meter.name)

        result = await self.db.execute(query)
        meters = result.scalars().all()

        return {
            "items": list(meters),
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    async def create_meter(self, data: dict) -> Meter:
        """Neuen Zähler anlegen."""
        meter = Meter(
            name=data["name"],
            description=data.get("description"),
            meter_number=data.get("meter_number"),
            energy_type=data["energy_type"],
            unit=data.get("unit", "kWh"),
            data_source=data.get("data_source", "manual"),
            source_config=data.get("source_config"),
            parent_meter_id=data.get("parent_meter_id"),
            site_id=data.get("site_id"),
            building_id=data.get("building_id"),
            usage_unit_id=data.get("usage_unit_id"),
            location=data.get("location"),
            cost_center=data.get("cost_center"),
            tariff_info=data.get("tariff_info"),
            is_weather_corrected=data.get("is_weather_corrected", False),
            co2_factor_override=data.get("co2_factor_override"),
            is_submeter=data.get("is_submeter", False),
            is_virtual=data.get("is_virtual", False),
            is_feed_in=data.get("is_feed_in", False),
            virtual_config=data.get("virtual_config"),
            schema_label=data.get("schema_label"),
        )
        self.db.add(meter)
        await self.db.commit()

        logger.info("meter_created", meter_id=str(meter.id), name=meter.name)
        return meter

    async def get_meter(self, meter_id: uuid.UUID) -> Meter:
        """Zähler mit Details laden."""
        result = await self.db.execute(
            select(Meter)
            .options(
                selectinload(Meter.consumers),
            )
            .where(Meter.id == meter_id)
        )
        meter = result.scalar_one_or_none()
        if not meter:
            raise MeterNotFoundException(str(meter_id))
        return meter

    async def update_meter(self, meter_id: uuid.UUID, data: dict) -> Meter:
        """Zähler aktualisieren – nur übergebene Felder."""
        meter = await self.db.get(Meter, meter_id)
        if not meter:
            raise MeterNotFoundException(str(meter_id))

        updatable_fields = [
            "name", "description", "meter_number", "energy_type", "unit",
            "data_source", "source_config", "parent_meter_id",
            "site_id", "building_id", "usage_unit_id",
            "location", "cost_center", "tariff_info", "is_weather_corrected",
            "co2_factor_override", "is_active",
            "is_submeter", "is_virtual", "is_feed_in", "is_delivery_based", "virtual_config",
            "schema_label",
        ]

        for field in updatable_fields:
            if field in data:
                setattr(meter, field, data[field])

        await self.db.commit()
        logger.info("meter_updated", meter_id=str(meter_id))
        return meter

    async def delete_meter(self, meter_id: uuid.UUID) -> None:
        """Zähler deaktivieren (Soft-Delete)."""
        meter = await self.db.get(Meter, meter_id)
        if not meter:
            raise MeterNotFoundException(str(meter_id))

        meter.is_active = False
        await self.db.commit()
        logger.info("meter_deleted", meter_id=str(meter_id))

    async def get_meter_tree(self, energy_type: str | None = None) -> list[dict]:
        """
        Zählerbaum als hierarchische Struktur aufbauen.

        Gibt nur Root-Zähler (ohne parent_meter_id) zurück,
        mit verschachtelten Kindern.
        """
        query = select(Meter).where(Meter.is_active == True)  # noqa: E712
        if energy_type:
            query = query.where(Meter.energy_type == energy_type)

        result = await self.db.execute(query)
        all_meters = result.scalars().all()

        # Index nach Parent-ID aufbauen
        children_by_parent: dict[uuid.UUID | None, list[Meter]] = {}
        for m in all_meters:
            parent = m.parent_meter_id
            children_by_parent.setdefault(parent, []).append(m)

        def build_tree(parent_id: uuid.UUID | None) -> list[dict]:
            nodes = []
            for m in children_by_parent.get(parent_id, []):
                nodes.append({
                    "id": m.id,
                    "name": m.name,
                    "meter_number": m.meter_number,
                    "energy_type": m.energy_type,
                    "is_submeter": m.parent_meter_id is not None,
                    "children": build_tree(m.id),
                })
            return nodes

        return build_tree(None)

    async def get_sub_meters(self, meter_id: uuid.UUID) -> list[Meter]:
        """Direkte Unterzähler eines Zählers laden."""
        result = await self.db.execute(
            select(Meter).where(
                Meter.parent_meter_id == meter_id,
                Meter.is_active == True,  # noqa: E712
            )
        )
        return list(result.scalars().all())

    async def get_schema_roots(self) -> list[dict]:
        """Alle Zähler mit schema_label (Betrachtungspunkte) laden."""
        result = await self.db.execute(
            select(Meter).where(
                Meter.schema_label.isnot(None),
                Meter.is_active == True,  # noqa: E712
            ).order_by(Meter.schema_label)
        )
        meters = result.scalars().all()

        roots = []
        for m in meters:
            # Anzahl Unterzähler (direkt + rekursiv) zählen
            count_result = await self.db.execute(
                select(Meter.id).where(
                    Meter.parent_meter_id == m.id,
                    Meter.is_active == True,  # noqa: E712
                )
            )
            child_count = len(count_result.scalars().all())
            roots.append({
                "id": m.id,
                "name": m.name,
                "schema_label": m.schema_label,
                "energy_type": m.energy_type,
                "unit": m.unit,
                "child_count": child_count,
            })
        return roots

    # Umrechnungsfaktoren zu kWh (wie in dashboard_service.py)
    CONVERSION_FACTORS: dict[str, Decimal] = {
        "m³": Decimal("10.3"),
        "l": Decimal("9.8"),
        "kg": Decimal("4.8"),
        "MWh": Decimal("1000"),
        "kWh": Decimal("1"),
    }

    async def get_subtree(
        self,
        meter_id: uuid.UUID,
        period_start: date | None = None,
        period_end: date | None = None,
    ) -> dict:
        """Zählerbaum ab einem bestimmten Zähler mit Verbrauchsdaten aufbauen."""
        # Wurzel laden
        root = await self.db.get(Meter, meter_id)
        if not root:
            raise MeterNotFoundException(str(meter_id))

        # Alle aktiven Zähler mit Verbrauchern laden
        result = await self.db.execute(
            select(Meter)
            .options(selectinload(Meter.consumers))
            .where(Meter.is_active == True)  # noqa: E712
        )
        all_meters = result.scalars().all()

        children_by_parent: dict[uuid.UUID | None, list[Meter]] = {}
        meter_by_id: dict[uuid.UUID, Meter] = {}
        for m in all_meters:
            children_by_parent.setdefault(m.parent_meter_id, []).append(m)
            meter_by_id[m.id] = m

        # Verbrauchsdaten für alle Zähler im Zeitraum laden
        consumption_by_meter: dict[uuid.UUID, Decimal] = {}
        if period_start and period_end:
            start_dt = datetime.combine(period_start, datetime.min.time(), tzinfo=timezone.utc)
            end_dt = datetime.combine(period_end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)

            consumption_query = (
                select(
                    MeterReading.meter_id,
                    func.sum(MeterReading.consumption).label("total"),
                )
                .where(
                    MeterReading.consumption.isnot(None),
                    MeterReading.timestamp >= start_dt,
                    MeterReading.timestamp < end_dt,
                )
                .group_by(MeterReading.meter_id)
            )
            cons_result = await self.db.execute(consumption_query)
            for row in cons_result:
                consumption_by_meter[row.meter_id] = row.total or Decimal("0")

        # Abrechnungen für Kostenberechnung laden (invoice-Tarif)
        invoice_prices: dict[uuid.UUID, Decimal | None] = {}
        if period_start:
            inv_result = await self.db.execute(
                select(EnergyInvoice).order_by(EnergyInvoice.period_end.desc())
            )
            all_invoices = inv_result.scalars().all()
            # Pro Zähler die passende Abrechnung finden
            invoices_by_meter: dict[uuid.UUID, list[EnergyInvoice]] = {}
            for inv in all_invoices:
                invoices_by_meter.setdefault(inv.meter_id, []).append(inv)

            for mid, invs in invoices_by_meter.items():
                # Beste passende Abrechnung: Zeitraum enthält period_start
                best = None
                for inv in invs:
                    if inv.period_start <= period_start <= inv.period_end:
                        best = inv
                        break
                if not best and invs:
                    best = invs[0]  # Fallback: neueste
                if best:
                    invoice_prices[mid] = best.effective_price_per_kwh

        def calc_cost(m: Meter, consumption: Decimal) -> float | None:
            """Kosten basierend auf Tarifmodell berechnen."""
            tariff = m.tariff_info or {}
            tariff_type = tariff.get("tariff_type", "fixed")
            conv = self.CONVERSION_FACTORS.get(m.unit, Decimal("1"))
            consumption_kwh = consumption * conv

            if tariff_type == "invoice":
                price = invoice_prices.get(m.id)
                if price:
                    return float(round(consumption_kwh * price, 2))
                return None

            # Fixed (Standard)
            price_per_kwh = tariff.get("price_per_kwh")
            if price_per_kwh:
                cost = consumption_kwh * Decimal(str(price_per_kwh))
                # Anteilige Grundgebühr
                base_fee = tariff.get("base_fee_monthly")
                if base_fee and period_start and period_end:
                    months = max(1, (period_end.year - period_start.year) * 12 + period_end.month - period_start.month)
                    cost += Decimal(str(base_fee)) * months
                return float(round(cost, 2))

            return None

        def build_node(m: Meter) -> dict:
            consumption = consumption_by_meter.get(m.id, Decimal("0"))
            children = [build_node(c) for c in children_by_parent.get(m.id, [])]

            # Nicht zugeordneter Verbrauch
            children_consumption = sum(
                Decimal(str(c.get("consumption", 0) or 0)) for c in children
            )
            unaccounted = None
            if children and consumption > 0:
                diff = float(round(consumption - children_consumption, 2))
                if diff > 0:
                    unaccounted = diff

            # Verbraucher
            consumers = [
                {
                    "id": str(c.id),
                    "name": c.name,
                    "category": c.category,
                    "rated_power": float(c.rated_power) if c.rated_power else None,
                    "operating_hours": float(c.operating_hours) if c.operating_hours else None,
                }
                for c in (m.consumers or [])
                if c.is_active
            ]

            return {
                "id": m.id,
                "name": m.name,
                "energy_type": m.energy_type,
                "unit": m.unit,
                "schema_label": m.schema_label,
                "consumption": float(consumption) if consumption else 0,
                "cost": calc_cost(m, consumption) if consumption else None,
                "unaccounted": unaccounted,
                "consumers": consumers,
                "children": children,
            }

        return build_node(root)
