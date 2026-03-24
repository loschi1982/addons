"""
meter_service.py – Zähler-Verwaltung.

CRUD für Zähler, Baumansicht, Zählerwechsel.
Zähler können hierarchisch organisiert sein (Haupt-/Unterzähler).
"""

import uuid

import structlog
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import MeterNotFoundException
from app.models.consumer import Consumer
from app.models.meter import Meter

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

    async def get_subtree(self, meter_id: uuid.UUID) -> dict:
        """Zählerbaum ab einem bestimmten Zähler aufbauen."""
        # Wurzel laden
        root = await self.db.get(Meter, meter_id)
        if not root:
            raise MeterNotFoundException(str(meter_id))

        # Alle aktiven Zähler laden und Index aufbauen
        result = await self.db.execute(
            select(Meter).where(Meter.is_active == True)  # noqa: E712
        )
        all_meters = result.scalars().all()

        children_by_parent: dict[uuid.UUID | None, list[Meter]] = {}
        for m in all_meters:
            children_by_parent.setdefault(m.parent_meter_id, []).append(m)

        def build_tree(parent_id: uuid.UUID) -> list[dict]:
            nodes = []
            for m in children_by_parent.get(parent_id, []):
                nodes.append({
                    "id": m.id,
                    "name": m.name,
                    "energy_type": m.energy_type,
                    "unit": m.unit,
                    "schema_label": m.schema_label,
                    "children": build_tree(m.id),
                })
            return nodes

        return {
            "id": root.id,
            "name": root.name,
            "energy_type": root.energy_type,
            "unit": root.unit,
            "schema_label": root.schema_label,
            "children": build_tree(root.id),
        }
