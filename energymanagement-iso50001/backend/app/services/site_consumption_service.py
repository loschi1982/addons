"""
site_consumption_service.py – Standort-Nettoverbrauch bei standortübergreifenden Zählerbäumen.

Problem: Ein Zähler kann physisch (parent_meter_id) unter einem fremden Standort hängen.
Dadurch würde der Verbrauch doppelt gezählt werden.

Lösung: PhysicalRoots(S) − ExitSet(S) = Nettoverbrauch(S)

PhysicalRoots(S): Zähler von S, deren Parent NULL ist oder einem fremden Standort gehört.
ExitSet(S):       Zähler eines anderen Standorts, deren Parent zu S gehört (Subtraktionszähler).
"""

import uuid
from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal

import structlog
from sqlalchemy import func, select
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meter import Meter
from app.models.reading import MeterReading
from app.models.site import Site

logger = structlog.get_logger()


class SiteConsumptionService:
    """Berechnet Standort-Nettoverbräuche unter Berücksichtigung von Subtraktionszählern."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ──────────────────────────────────────────────────────────────────────────
    # Nettoverbrauch
    # ──────────────────────────────────────────────────────────────────────────

    async def get_site_net_consumption(
        self,
        site_id: uuid.UUID,
        period_start: date,
        period_end: date,
    ) -> dict:
        """
        Nettoverbrauch eines Standorts berechnen.

        Gibt zurück:
          gross_consumption_kwh    – Summe der PhysicalRoots-Zähler
          cross_site_exit_kwh      – WIRKSAM abgezogene Fremdzähler (pro Strang
                                     auf den Wurzelverbrauch gedeckelt)
          cross_site_exit_raw_kwh  – roher Verbrauch aller Fremd-Unterzähler
          net_consumption_kwh      – Nettoverbrauch = gross − wirksamer Abzug (≥ 0)
          exit_points              – Liste der Subtraktionszähler (mit subtracted-Flag)
        """
        start_dt = datetime.combine(period_start, datetime.min.time()).replace(
            tzinfo=timezone.utc
        )
        end_dt = datetime.combine(period_end, datetime.max.time()).replace(
            tzinfo=timezone.utc
        )

        # Alle aktiven Zähler des Standorts inkl. Parent → für Wurzel-Zuordnung.
        site_rows = (await self.db.execute(
            select(Meter.id, Meter.parent_meter_id).where(
                Meter.site_id == site_id, Meter.is_active == True,  # noqa: E712
            )
        )).all()
        site_meter_ids = {r.id for r in site_rows}

        if not site_meter_ids:
            return {
                "gross_consumption_kwh": Decimal("0"),
                "cross_site_exit_kwh": Decimal("0"),
                "cross_site_exit_raw_kwh": Decimal("0"),
                "net_consumption_kwh": Decimal("0"),
                "exit_points": [],
            }

        parent_map = {r.id: r.parent_meter_id for r in site_rows}

        def root_of(meter_id: uuid.UUID) -> uuid.UUID:
            """Aufstieg bis zum PhysicalRoot des Standorts (Parent fehlt/fremd)."""
            cur = meter_id
            seen: set[uuid.UUID] = set()
            while True:
                p = parent_map.get(cur)
                if p is None or p not in site_meter_ids or p in seen:
                    return cur
                seen.add(cur)
                cur = p

        # PhysicalRoots(S): Parent fehlt ODER liegt außerhalb des Standorts.
        physical_root_ids = [
            r.id for r in site_rows
            if r.parent_meter_id is None or r.parent_meter_id not in site_meter_ids
        ]

        # ── ExitSet(S): Fremdzähler direkt unter einem S-Zähler ──
        ParentMeter2 = aliased(Meter)
        exit_rows = (await self.db.execute(
            select(
                Meter.id,
                Meter.name,
                Meter.parent_meter_id,
                Meter.site_id,
                Site.name.label("owner_site_name"),
            )
            .join(ParentMeter2, Meter.parent_meter_id == ParentMeter2.id)
            .join(Site, Meter.site_id == Site.id, isouter=True)
            .where(
                ParentMeter2.site_id == site_id,
                Meter.site_id != site_id,
                Meter.is_active == True,  # noqa: E712
                ParentMeter2.is_active == True,  # noqa: E712
            )
        )).all()

        # Verbrauch je Zähler (Batch): PhysicalRoots + Exit-Kinder.
        root_cons = await self._sum_by_meter(physical_root_ids, start_dt, end_dt)
        exit_cons = await self._sum_by_meter([r.id for r in exit_rows], start_dt, end_dt)

        gross_kwh = sum(root_cons.values(), Decimal("0"))
        raw_exit_kwh = sum(exit_cons.values(), Decimal("0"))

        # Exit-Verbrauch dem jeweiligen Wurzelstrang zuordnen.
        exit_by_root: dict[uuid.UUID, Decimal] = defaultdict(lambda: Decimal("0"))
        for er in exit_rows:
            if er.parent_meter_id in site_meter_ids:
                exit_by_root[root_of(er.parent_meter_id)] += exit_cons.get(er.id, Decimal("0"))

        # Netto je Wurzel: max(0, Verbrauch_Wurzel − zugeordnete Exits). Damit wird
        # NIE mehr abgezogen, als der (gemessene) Wurzelzähler hergibt → kein
        # negativer Nettoverbrauch durch nicht gemessene Hauptzähler.
        net_kwh = Decimal("0")
        for rid in physical_root_ids:
            diff = root_cons.get(rid, Decimal("0")) - exit_by_root.get(rid, Decimal("0"))
            if diff > 0:
                net_kwh += diff
        effective_exit_kwh = gross_kwh - net_kwh

        # Exit-Punkte mit Flag, ob sie wirksam abgezogen werden (Wurzel gemessen).
        exit_points = []
        for er in exit_rows:
            rid = root_of(er.parent_meter_id) if er.parent_meter_id in site_meter_ids else None
            subtracted = bool(rid is not None and root_cons.get(rid, Decimal("0")) > 0)
            exit_points.append({
                "meter_id": er.id,
                "meter_name": er.name,
                "owner_site_id": er.site_id,
                "owner_site_name": er.owner_site_name or "Unbekannter Standort",
                "consumption_kwh": exit_cons.get(er.id, Decimal("0")),
                "subtracted": subtracted,
            })

        logger.info(
            "site_net_consumption",
            site_id=str(site_id),
            gross=float(gross_kwh),
            exit_effective=float(effective_exit_kwh),
            exit_raw=float(raw_exit_kwh),
            net=float(net_kwh),
        )

        return {
            "gross_consumption_kwh": gross_kwh,
            "cross_site_exit_kwh": effective_exit_kwh,
            "cross_site_exit_raw_kwh": raw_exit_kwh,
            "net_consumption_kwh": net_kwh,
            "exit_points": exit_points,
        }

    async def get_sites_consumption_by_energy(
        self,
        period_start: date,
        period_end: date,
    ) -> list[dict]:
        """
        Verbrauch aller Standorte nach Energieträger in einem Zeitraum.

        Verwendet nur PhysicalRoot-Zähler (parent_meter_id IS NULL, is_virtual=False)
        um Doppelzählung durch Unterzähler zu vermeiden.
        Gibt eine Liste von {site_id, site_name, by_energy: {energy_type: kwh}} zurück.
        """
        from app.models.site import Site as SiteModel

        start_dt = datetime.combine(period_start, datetime.min.time()).replace(tzinfo=timezone.utc)
        end_dt = datetime.combine(period_end, datetime.max.time()).replace(tzinfo=timezone.utc)

        result = await self.db.execute(
            select(
                Meter.site_id,
                SiteModel.name.label("site_name"),
                Meter.energy_type,
                func.sum(MeterReading.consumption).label("kwh"),
            )
            .join(MeterReading, MeterReading.meter_id == Meter.id)
            .join(SiteModel, SiteModel.id == Meter.site_id)
            .where(
                Meter.is_active == True,  # noqa: E712
                Meter.is_virtual == False,  # noqa: E712
                Meter.parent_meter_id.is_(None),
                Meter.site_id.is_not(None),
                MeterReading.timestamp >= start_dt,
                MeterReading.timestamp <= end_dt,
                MeterReading.consumption.is_not(None),
            )
            .group_by(Meter.site_id, SiteModel.name, Meter.energy_type)
        )
        rows = result.all()

        sites: dict[str, dict] = {}
        for row in rows:
            sid = str(row.site_id)
            if sid not in sites:
                sites[sid] = {"site_id": sid, "site_name": row.site_name, "by_energy": {}}
            sites[sid]["by_energy"][row.energy_type] = float(row.kwh or 0)

        return list(sites.values())

    async def _sum_consumption(
        self,
        meter_ids: list[uuid.UUID],
        start_dt: datetime,
        end_dt: datetime,
    ) -> Decimal:
        """Gesamtverbrauch einer Menge von Zähler-IDs im Zeitraum."""
        if not meter_ids:
            return Decimal("0")

        result = await self.db.execute(
            select(func.sum(MeterReading.consumption)).where(
                MeterReading.meter_id.in_(meter_ids),
                MeterReading.timestamp >= start_dt,
                MeterReading.timestamp <= end_dt,
                MeterReading.consumption.is_not(None),
            )
        )
        total = result.scalar()
        return Decimal(str(total)) if total is not None else Decimal("0")

    async def _sum_by_meter(
        self,
        meter_ids: list[uuid.UUID],
        start_dt: datetime,
        end_dt: datetime,
    ) -> dict[uuid.UUID, Decimal]:
        """Verbrauch je Zähler (Batch) im Zeitraum als {meter_id: Decimal}."""
        if not meter_ids:
            return {}
        rows = (await self.db.execute(
            select(
                MeterReading.meter_id,
                func.sum(MeterReading.consumption).label("t"),
            ).where(
                MeterReading.meter_id.in_(meter_ids),
                MeterReading.timestamp >= start_dt,
                MeterReading.timestamp <= end_dt,
                MeterReading.consumption.is_not(None),
            ).group_by(MeterReading.meter_id)
        )).all()
        return {
            r.meter_id: (Decimal(str(r.t)) if r.t is not None else Decimal("0"))
            for r in rows
        }

    # ──────────────────────────────────────────────────────────────────────────
    # Annotierter Zählerbaum
    # ──────────────────────────────────────────────────────────────────────────

    async def get_site_meter_tree_annotated(
        self,
        site_id: uuid.UUID,
        energy_type: str | None = None,
    ) -> list[dict]:
        """
        Zählerbaum eines Standorts als verschachtelte Struktur.

        Enthält alle eigenen Zähler plus direkt angehängte Fremdzähler
        (ExitSet). Jeder Knoten ist mit cross_site_boundary und
        owner_site_name angereichert.

        Fremdzähler werden amber markiert (cross_site_boundary=True).
        Ihre Kinder (weiterer Fremdzähler-Teilbaum) werden NICHT geladen,
        da sie für die Standortansicht irrelevant sind.
        """
        # Eigene Zähler laden
        own_q = select(Meter, Site.name.label("site_name")).join(
            Site, Meter.site_id == Site.id, isouter=True
        ).where(
            Meter.site_id == site_id,
            Meter.is_active == True,  # noqa: E712
        )
        if energy_type:
            own_q = own_q.where(Meter.energy_type == energy_type)

        own_result = await self.db.execute(own_q)
        own_rows = own_result.all()
        own_meter_ids = {row.Meter.id for row in own_rows}

        # ExitSet: Fremdzähler direkt unter eigenen Zählern
        ParentAlias = aliased(Meter)
        exit_q = (
            select(Meter, Site.name.label("site_name"))
            .join(ParentAlias, Meter.parent_meter_id == ParentAlias.id)
            .join(Site, Meter.site_id == Site.id, isouter=True)
            .where(
                ParentAlias.site_id == site_id,
                Meter.site_id != site_id,
                Meter.is_active == True,  # noqa: E712
                ParentAlias.is_active == True,  # noqa: E712
            )
        )
        if energy_type:
            exit_q = exit_q.where(Meter.energy_type == energy_type)

        exit_result = await self.db.execute(exit_q)
        exit_rows = exit_result.all()
        exit_meter_ids = {row.Meter.id for row in exit_rows}

        # Site-Name für den aktuellen Standort (für own meters)
        site_name_result = await self.db.execute(
            select(Site.name).where(Site.id == site_id)
        )
        own_site_name = site_name_result.scalar() or ""

        # Alle Knoten als dict aufbauen
        all_nodes: dict[uuid.UUID, dict] = {}

        for row in own_rows:
            m = row.Meter
            all_nodes[m.id] = {
                "id": str(m.id),
                "name": m.name,
                "meter_number": m.meter_number,
                "energy_type": m.energy_type,
                "unit": m.unit,
                "data_source": m.data_source,
                "parent_meter_id": str(m.parent_meter_id) if m.parent_meter_id else None,
                "is_active": m.is_active,
                "is_virtual": m.is_virtual,
                "is_feed_in": m.is_feed_in,
                "site_id": str(m.site_id) if m.site_id else None,
                "building_id": str(m.building_id) if m.building_id else None,
                "usage_unit_id": str(m.usage_unit_id) if m.usage_unit_id else None,
                "source_config": m.source_config,
                "virtual_config": m.virtual_config,
                "is_delivery_based": getattr(m, "is_delivery_based", False),
                "is_weather_corrected": m.is_weather_corrected,
                "is_submeter": m.is_submeter,
                "schema_label": getattr(m, "schema_label", None),
                "notes": getattr(m, "notes", None),
                "cross_site_boundary": False,
                "owner_site_name": own_site_name,
                "children": [],
            }

        for row in exit_rows:
            m = row.Meter
            if m.id not in all_nodes:  # Doppelungen vermeiden
                all_nodes[m.id] = {
                    "id": str(m.id),
                    "name": m.name,
                    "meter_number": m.meter_number,
                    "energy_type": m.energy_type,
                    "unit": m.unit,
                    "data_source": m.data_source,
                    "parent_meter_id": str(m.parent_meter_id) if m.parent_meter_id else None,
                    "is_active": m.is_active,
                    "is_virtual": m.is_virtual,
                    "is_feed_in": m.is_feed_in,
                    "site_id": str(m.site_id) if m.site_id else None,
                    "building_id": str(m.building_id) if m.building_id else None,
                    "usage_unit_id": str(m.usage_unit_id) if m.usage_unit_id else None,
                    "source_config": m.source_config,
                    "virtual_config": m.virtual_config,
                    "is_delivery_based": getattr(m, "is_delivery_based", False),
                    "is_weather_corrected": m.is_weather_corrected,
                    "is_submeter": m.is_submeter,
                    "schema_label": getattr(m, "schema_label", None),
                    "notes": getattr(m, "notes", None),
                    "cross_site_boundary": True,
                    "owner_site_name": row.site_name or "Anderer Standort",
                    "children": [],  # Kinder von Fremdzählern nicht rekursiv laden
                }

        # Baum aufbauen: Kinder an Eltern hängen, Wurzeln sammeln
        roots: list[dict] = []
        for node in all_nodes.values():
            parent_id = node["parent_meter_id"]
            if parent_id and uuid.UUID(parent_id) in all_nodes:
                # Hat bekannten Parent im Knotenset → als Kind einhängen
                all_nodes[uuid.UUID(parent_id)]["children"].append(node)
            elif not node["cross_site_boundary"]:
                # Kein Parent im Set → Wurzel (nur eigene Zähler als Roots anzeigen)
                roots.append(node)

        # Alphabetisch sortieren
        def sort_nodes(nodes: list[dict]) -> None:
            nodes.sort(key=lambda n: n["name"])
            for n in nodes:
                sort_nodes(n["children"])

        sort_nodes(roots)
        return roots

    # ──────────────────────────────────────────────────────────────────────────
    # Virtuelle Netto-Zähler synchronisieren
    # ──────────────────────────────────────────────────────────────────────────

    async def sync_virtual_net_meters(self, site_id: uuid.UUID) -> list[dict]:
        """
        Erstellt oder aktualisiert virtuelle Netto-Zähler für alle PhysicalRoots
        eines Standorts, die direkte ExitSet-Unterzähler besitzen.

        Logik:
          PhysicalRoot(S) mit ExitSet-Kindern → Virtual "Netto"-Zähler
          virtual_config = {type: "difference", source_meter_id: root.id,
                            subtract_meter_ids: [exit1.id, exit2.id, ...]}

        Idempotent: Bei erneutem Aufruf werden bestehende virtuelle Zähler
        aktualisiert falls der ExitSet sich geändert hat.
        """
        # Standortname für Zählerbezeichnung
        site_result = await self.db.execute(
            select(Site.name).where(Site.id == site_id)
        )
        site_name = site_result.scalar() or "Standort"

        # ExitSet(S): Fremdzähler direkt unter einem eigenen Zähler, gruppiert nach Parent
        ParentAlias = aliased(Meter)
        exit_q = await self.db.execute(
            select(
                Meter.id,
                Meter.name,
                Meter.parent_meter_id,
            )
            .join(ParentAlias, Meter.parent_meter_id == ParentAlias.id)
            .where(
                ParentAlias.site_id == site_id,
                Meter.site_id != site_id,
                Meter.is_active == True,  # noqa: E712
                ParentAlias.is_active == True,  # noqa: E712
            )
        )
        exit_rows = exit_q.all()

        if not exit_rows:
            return []

        # Gruppieren: parent_id → [exit_ids]
        exits_by_parent: dict[uuid.UUID, list[uuid.UUID]] = {}
        for row in exit_rows:
            exits_by_parent.setdefault(row.parent_meter_id, []).append(row.id)

        # Parent-Zähler-Objekte laden
        parent_ids = list(exits_by_parent.keys())
        parents_q = await self.db.execute(
            select(Meter).where(Meter.id.in_(parent_ids))
        )
        parents = {m.id: m for m in parents_q.scalars().all()}

        # Bestehende virtuelle Netto-Zähler für diesen Standort laden
        # Kennzeichen: is_virtual=True, virtual_config.type = "difference"
        virt_q = await self.db.execute(
            select(Meter).where(
                Meter.site_id == site_id,
                Meter.is_virtual == True,  # noqa: E712
                Meter.is_active == True,  # noqa: E712
            )
        )
        existing_virtual = virt_q.scalars().all()
        # Map: source_meter_id → virtueller Zähler
        virtual_by_source: dict[uuid.UUID, Meter] = {}
        for vm in existing_virtual:
            vc = vm.virtual_config or {}
            if vc.get("type") == "difference" and vc.get("source_meter_id"):
                try:
                    src_id = uuid.UUID(vc["source_meter_id"])
                    virtual_by_source[src_id] = vm
                except (ValueError, KeyError):
                    pass

        results = []
        for parent_id, exit_ids in exits_by_parent.items():
            parent = parents.get(parent_id)
            if not parent:
                continue

            subtract_ids_str = sorted(str(i) for i in exit_ids)
            virtual_config = {
                "type": "difference",
                "source_meter_id": str(parent_id),
                "subtract_meter_ids": subtract_ids_str,
            }

            existing_vm = virtual_by_source.get(parent_id)
            if existing_vm is None:
                # Neuen virtuellen Zähler anlegen
                new_meter = Meter(
                    name=f"{parent.name} – Netto {site_name}",
                    energy_type=parent.energy_type,
                    unit=parent.unit,
                    site_id=site_id,
                    parent_meter_id=None,
                    is_virtual=True,
                    is_active=True,
                    virtual_config=virtual_config,
                    data_source="virtual",
                )
                self.db.add(new_meter)
                await self.db.flush()
                action = "erstellt"
                meter_id = new_meter.id
                meter_name = new_meter.name
                logger.info("virtual_net_meter_created", meter_id=str(meter_id), site_id=str(site_id))
            else:
                # Prüfen ob subtract_ids sich geändert haben
                old_vc = existing_vm.virtual_config or {}
                old_subtract = sorted(old_vc.get("subtract_meter_ids", []))
                if old_subtract != subtract_ids_str:
                    existing_vm.virtual_config = virtual_config
                    action = "aktualisiert"
                    logger.info("virtual_net_meter_updated", meter_id=str(existing_vm.id), site_id=str(site_id))
                else:
                    action = "unverändert"
                meter_id = existing_vm.id
                meter_name = existing_vm.name

            results.append({
                "id": str(meter_id),
                "name": meter_name,
                "action": action,
                "subtract_count": len(exit_ids),
            })

        await self.db.commit()
        return results
