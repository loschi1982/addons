"""
allocation_service.py – Zähler-Nutzungseinheit-Zuordnungen.

CRUD für Zuordnungen und Verbrauchsberechnung pro Nutzungseinheit
unter Berücksichtigung von Add/Subtract-Semantik und Faktoren.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    AllocationDuplicateError,
    AllocationNotFoundException,
    MeterNotFoundException,
    SiteNotFoundException,
)
from app.models.allocation import MeterUnitAllocation
from app.models.meter import Meter
from app.models.reading import MeterReading
from app.models.site import UsageUnit

logger = structlog.get_logger()


class AllocationService:
    """Service für Zähler-Einheit-Zuordnungen und Verbrauchsberechnung."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_allocations(
        self,
        meter_id: uuid.UUID | None = None,
        usage_unit_id: uuid.UUID | None = None,
        page: int = 1,
        page_size: int = 25,
    ) -> dict:
        """Zuordnungen auflisten mit optionalen Filtern."""
        query = select(MeterUnitAllocation)

        if meter_id:
            query = query.where(MeterUnitAllocation.meter_id == meter_id)
        if usage_unit_id:
            query = query.where(MeterUnitAllocation.usage_unit_id == usage_unit_id)

        # Gesamtanzahl
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.db.execute(count_query)).scalar() or 0

        # Pagination
        offset = (page - 1) * page_size
        query = query.offset(offset).limit(page_size).order_by(
            MeterUnitAllocation.created_at
        )

        result = await self.db.execute(query)
        items = result.scalars().all()

        return {
            "items": list(items),
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": max(1, (total + page_size - 1) // page_size),
        }

    async def create_allocation(self, data: dict) -> MeterUnitAllocation:
        """
        Neue Zuordnung anlegen.

        Validiert: Zähler und Nutzungseinheit müssen existieren.
        Prüft auf Duplikat (gleiche meter_id + usage_unit_id).
        """
        meter_id = data["meter_id"]
        usage_unit_id = data["usage_unit_id"]

        # Existenz prüfen
        meter = await self.db.get(Meter, meter_id)
        if not meter:
            raise MeterNotFoundException(str(meter_id))

        unit = await self.db.get(UsageUnit, usage_unit_id)
        if not unit:
            raise SiteNotFoundException(f"Nutzungseinheit {usage_unit_id}")

        # Duplikat prüfen
        existing = await self.db.execute(
            select(MeterUnitAllocation).where(
                MeterUnitAllocation.meter_id == meter_id,
                MeterUnitAllocation.usage_unit_id == usage_unit_id,
            )
        )
        if existing.scalar_one_or_none():
            raise AllocationDuplicateError(
                f"Zähler {meter.name} ist bereits der Nutzungseinheit zugeordnet"
            )

        allocation = MeterUnitAllocation(
            meter_id=meter_id,
            usage_unit_id=usage_unit_id,
            allocation_type=data.get("allocation_type", "add"),
            factor=data.get("factor", Decimal("1.0")),
            description=data.get("description"),
        )
        self.db.add(allocation)
        await self.db.commit()

        logger.info(
            "allocation_created",
            allocation_id=str(allocation.id),
            meter_id=str(meter_id),
            usage_unit_id=str(usage_unit_id),
            type=allocation.allocation_type,
        )
        return allocation

    async def get_allocation(self, allocation_id: uuid.UUID) -> MeterUnitAllocation:
        """Einzelne Zuordnung laden."""
        allocation = await self.db.get(MeterUnitAllocation, allocation_id)
        if not allocation:
            raise AllocationNotFoundException(str(allocation_id))
        return allocation

    async def update_allocation(
        self, allocation_id: uuid.UUID, data: dict
    ) -> MeterUnitAllocation:
        """Zuordnung aktualisieren (allocation_type, factor, description)."""
        allocation = await self.db.get(MeterUnitAllocation, allocation_id)
        if not allocation:
            raise AllocationNotFoundException(str(allocation_id))

        for field in ("allocation_type", "factor", "description"):
            if field in data and data[field] is not None:
                setattr(allocation, field, data[field])

        await self.db.commit()
        logger.info("allocation_updated", allocation_id=str(allocation_id))
        return allocation

    async def delete_allocation(self, allocation_id: uuid.UUID) -> None:
        """Zuordnung löschen (Hard-Delete)."""
        allocation = await self.db.get(MeterUnitAllocation, allocation_id)
        if not allocation:
            raise AllocationNotFoundException(str(allocation_id))

        await self.db.delete(allocation)
        await self.db.commit()
        logger.info("allocation_deleted", allocation_id=str(allocation_id))

    async def calculate_unit_consumption(
        self,
        usage_unit_id: uuid.UUID,
        start_date: date,
        end_date: date,
    ) -> dict:
        """
        Verbrauch einer Nutzungseinheit berechnen.

        Algorithmus:
        1. Alle Zuordnungen für diese Nutzungseinheit laden
        2. Für jeden zugeordneten Zähler: Verbrauch im Zeitraum summieren
        3. Verbrauch × factor anwenden
        4. Je nach allocation_type addieren oder subtrahieren

        Formel: total = Σ(consumption_i × factor_i × sign_i)
        wobei sign_i = +1 für "add", -1 für "subtract"
        """
        unit = await self.db.get(UsageUnit, usage_unit_id)
        if not unit:
            raise SiteNotFoundException(f"Nutzungseinheit {usage_unit_id}")

        # Alle Zuordnungen laden
        result = await self.db.execute(
            select(MeterUnitAllocation).where(
                MeterUnitAllocation.usage_unit_id == usage_unit_id
            )
        )
        allocations = result.scalars().all()

        total = Decimal("0")
        allocation_details = []
        unit_label = "kWh"  # Fallback

        start_dt = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc)
        end_dt = datetime.combine(end_date, datetime.max.time(), tzinfo=timezone.utc)

        for alloc in allocations:
            # Zähler laden für Name und Einheit
            meter = await self.db.get(Meter, alloc.meter_id)
            if not meter:
                continue

            unit_label = meter.unit

            # Verbrauch im Zeitraum summieren
            consumption_result = await self.db.execute(
                select(func.sum(MeterReading.consumption)).where(
                    MeterReading.meter_id == alloc.meter_id,
                    MeterReading.timestamp >= start_dt,
                    MeterReading.timestamp <= end_dt,
                    MeterReading.consumption.isnot(None),
                )
            )
            raw_consumption = consumption_result.scalar() or Decimal("0")

            # Faktor und Vorzeichen anwenden
            sign = Decimal("1") if alloc.allocation_type == "add" else Decimal("-1")
            adjusted = raw_consumption * alloc.factor * sign
            total += adjusted

            allocation_details.append({
                "meter_id": str(alloc.meter_id),
                "meter_name": meter.name,
                "allocation_type": alloc.allocation_type,
                "factor": float(alloc.factor),
                "raw_consumption": float(raw_consumption),
                "adjusted_consumption": float(adjusted),
                "description": alloc.description,
            })

        return {
            "usage_unit_id": usage_unit_id,
            "usage_unit_name": unit.name,
            "total_consumption": total,
            "unit": unit_label,
            "period_start": start_date,
            "period_end": end_date,
            "allocations": allocation_details,
        }
