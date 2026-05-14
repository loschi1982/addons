"""
monitoring_point_service.py – Service für Betrachtungspunkte.

Verwaltet die CRUD-Operationen und baut den Energieschema-Baum für jeden
Scope-Typ (Site/Building/UsageUnit/Meter). Bei Hierarchie-Scopes wird eine
synthetische Wurzel über alle relevanten Hauptzähler erzeugt.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.meter import Meter
from app.models.monitoring_point import MonitoringPoint
from app.models.site import Building, Site, UsageUnit
from app.services.meter_service import MeterService

logger = structlog.get_logger()


# Umrechnungsfaktoren zu kWh (konsistent zu MeterService)
CONVERSION_FACTORS: dict[str, Decimal] = {
    "m³": Decimal("10.3"),
    "l": Decimal("9.8"),
    "kg": Decimal("4.8"),
    "MWh": Decimal("1000"),
    "kWh": Decimal("1"),
}


class MonitoringPointNotFound(Exception):
    pass


class MonitoringPointService:
    """Verwaltung und Abfrage der Energieschema-Betrachtungspunkte."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ─────────────────────────────────────────────────────────────────
    # CRUD
    # ─────────────────────────────────────────────────────────────────

    async def list_points(self) -> list[dict]:
        """Alle aktiven Betrachtungspunkte mit Anzeige-Name und meter_count."""
        rows = (await self.db.execute(
            select(MonitoringPoint)
            .options(
                selectinload(MonitoringPoint.site),
                selectinload(MonitoringPoint.building),
                selectinload(MonitoringPoint.usage_unit),
                selectinload(MonitoringPoint.meter),
            )
            .where(MonitoringPoint.is_active == True)  # noqa: E712
            .order_by(MonitoringPoint.label)
        )).scalars().all()

        result: list[dict] = []
        for mp in rows:
            scope_name = self._scope_display_name(mp)
            meter_ids = await self._collect_meter_ids(mp)
            result.append({
                "id": mp.id,
                "label": mp.label,
                "scope_type": mp.scope_type,
                "scope_id": mp.scope_id,
                "scope_name": scope_name,
                "energy_type": mp.energy_type,
                "meter_count": len(meter_ids),
                "is_active": mp.is_active,
                "created_at": mp.created_at,
            })
        return result

    async def create_point(
        self,
        label: str,
        scope_type: str,
        scope_id: uuid.UUID,
        energy_type: str | None = None,
    ) -> MonitoringPoint:
        """Neuen Betrachtungspunkt anlegen."""
        kwargs: dict = {"label": label, "energy_type": energy_type if scope_type != "meter" else None}
        if scope_type == "site":
            kwargs["site_id"] = scope_id
        elif scope_type == "building":
            kwargs["building_id"] = scope_id
        elif scope_type == "usage_unit":
            kwargs["usage_unit_id"] = scope_id
        elif scope_type == "meter":
            kwargs["meter_id"] = scope_id
        else:
            raise ValueError(f"Unbekannter scope_type: {scope_type}")

        mp = MonitoringPoint(**kwargs)
        self.db.add(mp)
        await self.db.commit()
        await self.db.refresh(mp)
        return mp

    async def delete_point(self, mp_id: uuid.UUID) -> None:
        mp = (await self.db.execute(
            select(MonitoringPoint).where(MonitoringPoint.id == mp_id)
        )).scalar_one_or_none()
        if not mp:
            raise MonitoringPointNotFound(str(mp_id))
        await self.db.delete(mp)
        await self.db.commit()

    # ─────────────────────────────────────────────────────────────────
    # Subtree
    # ─────────────────────────────────────────────────────────────────

    async def get_subtree(
        self,
        mp_id: uuid.UUID,
        period_start: date | None = None,
        period_end: date | None = None,
    ) -> dict:
        """Energieschema-Baum für einen Betrachtungspunkt."""
        mp = (await self.db.execute(
            select(MonitoringPoint)
            .options(
                selectinload(MonitoringPoint.site),
                selectinload(MonitoringPoint.building),
                selectinload(MonitoringPoint.usage_unit),
                selectinload(MonitoringPoint.meter),
            )
            .where(MonitoringPoint.id == mp_id)
        )).scalar_one_or_none()
        if not mp:
            raise MonitoringPointNotFound(str(mp_id))

        meter_svc = MeterService(self.db)

        # Scope = einzelner Zähler → direkter Delegate
        if mp.meter_id is not None:
            tree = await meter_svc.get_subtree(mp.meter_id, period_start, period_end)
            tree["schema_label"] = mp.label
            return tree

        # Scope = Site/Building/UsageUnit → synthetische Wurzel
        root_meters = await self._collect_root_meters(mp)
        children: list[dict] = []
        total_kwh = Decimal("0")
        total_cost: Decimal | None = None
        energy_types_seen: set[str] = set()

        for root in root_meters:
            try:
                child_tree = await meter_svc.get_subtree(root.id, period_start, period_end)
            except Exception as e:
                logger.warning("monitoring_point_subtree_failed", root_meter=str(root.id), error=str(e))
                continue
            children.append(child_tree)
            energy_types_seen.add(root.energy_type)

            # Aggregat-kWh: Verbrauch × Konvertierungsfaktor pro Hauptzähler
            consumption = Decimal(str(child_tree.get("consumption") or 0))
            conv = CONVERSION_FACTORS.get(root.unit, Decimal("1"))
            total_kwh += consumption * conv

            cost = child_tree.get("cost")
            if cost is not None:
                total_cost = (total_cost or Decimal("0")) + Decimal(str(cost))

        mixed = len(energy_types_seen) > 1
        scope_name = self._scope_display_name(mp)

        return {
            "id": f"mp:{mp.id}",
            "name": mp.label,
            "energy_type": mp.energy_type or ("mixed" if mixed else (next(iter(energy_types_seen)) if energy_types_seen else None)),
            "unit": "kWh",
            "schema_label": mp.label,
            "virtual_config": None,
            "consumption": float(total_kwh),
            "cost": float(total_cost) if total_cost is not None else None,
            "unaccounted": None,
            "consumers": [],
            "is_virtual_root": True,
            "scope": {
                "type": mp.scope_type,
                "id": str(mp.scope_id),
                "name": scope_name,
            },
            "children": children,
        }

    # ─────────────────────────────────────────────────────────────────
    # Helpers
    # ─────────────────────────────────────────────────────────────────

    def _scope_display_name(self, mp: MonitoringPoint) -> str | None:
        """Anzeige-Name für den Scope (Site-/Building-/Unit-/Meter-Name)."""
        if mp.meter is not None:
            return mp.meter.display_name or mp.meter.name
        if mp.usage_unit is not None:
            return mp.usage_unit.name
        if mp.building is not None:
            return mp.building.name
        if mp.site is not None:
            return mp.site.name
        return None

    async def _collect_meter_ids(self, mp: MonitoringPoint) -> list[uuid.UUID]:
        """Alle aktiven Meter-IDs, die zu diesem Punkt gehören (inkl. Unterzähler)."""
        if mp.meter_id is not None:
            return [mp.meter_id]

        # Site/Building/Unit-Scope: alle Meter mit passender Hierarchie-Zuordnung
        q = select(Meter.id).where(Meter.is_active == True)  # noqa: E712
        if mp.usage_unit_id is not None:
            q = q.where(Meter.usage_unit_id == mp.usage_unit_id)
        elif mp.building_id is not None:
            # Meter direkt am Building ODER an einer Unit des Buildings
            unit_ids_subq = (
                select(UsageUnit.id).where(UsageUnit.building_id == mp.building_id)
            )
            q = q.where(
                (Meter.building_id == mp.building_id)
                | (Meter.usage_unit_id.in_(unit_ids_subq))
            )
        elif mp.site_id is not None:
            building_ids_subq = select(Building.id).where(Building.site_id == mp.site_id)
            unit_ids_subq = select(UsageUnit.id).where(UsageUnit.building_id.in_(building_ids_subq))
            q = q.where(
                (Meter.site_id == mp.site_id)
                | (Meter.building_id.in_(building_ids_subq))
                | (Meter.usage_unit_id.in_(unit_ids_subq))
            )
        if mp.energy_type:
            q = q.where(Meter.energy_type == mp.energy_type)
        return list((await self.db.execute(q)).scalars().all())

    async def _collect_root_meters(self, mp: MonitoringPoint) -> list[Meter]:
        """Alle Haupt-Zähler (parent_meter_id IS NULL) im Scope."""
        meter_ids = await self._collect_meter_ids(mp)
        if not meter_ids:
            return []
        rows = (await self.db.execute(
            select(Meter).where(
                Meter.id.in_(meter_ids),
                Meter.parent_meter_id.is_(None),
            ).order_by(Meter.energy_type, Meter.name)
        )).scalars().all()
        return list(rows)
