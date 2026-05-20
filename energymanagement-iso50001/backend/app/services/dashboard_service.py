"""
dashboard_service.py – Dashboard-Daten aggregieren.

Stellt KPI-Karten, Energieaufschlüsselung, Top-Verbraucher,
Zeitreihen und Warnungen für die Dashboard-Übersicht bereit.
"""

import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

import structlog
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.district_heating_provider import DistrictHeatingProvider
from app.models.emission import CO2Calculation, EmissionFactor
from app.models.meter import Meter
from app.models.reading import MeterReading
from app.models.settings import AppSetting

logger = structlog.get_logger()

CONVERSION_FACTORS: dict[str, Decimal] = {
    "m³": Decimal("10.3"),
    "l": Decimal("9.8"),
    "kg": Decimal("4.8"),
    "MWh": Decimal("1000"),
    "kWh": Decimal("1"),
}

ENERGY_TYPE_LABELS: dict[str, str] = {
    "electricity": "Strom",
    "natural_gas": "Gas",
    "gas": "Gas",
    "district_heating": "Fernwärme",
    "district_cooling": "Kälte",
    "water": "Wasser",
    "oil": "Öl",
    "pellets": "Pellets",
    "solar": "Solar",
}


class DashboardService:
    """Service für Dashboard-Daten."""

    # Klassen-Cache für get_dashboard: {(site_id, period_start, period_end, granularity): (ts, result)}
    # TTL 60 s — bei Last & schnellen Re-Renders im Frontend liefert das sofort aus dem Cache.
    _dashboard_cache: dict = {}
    _CACHE_TTL_SECONDS = 60

    @classmethod
    def invalidate_cache(cls) -> None:
        """Cache komplett leeren — z.B. nach Daten-Imports."""
        cls._dashboard_cache.clear()

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _get_district_heating_co2_factor(self) -> Decimal | None:
        """
        CO₂-Faktor des konfigurierten Fernwärmeversorgers laden.

        Gibt den versorger-spezifischen Faktor zurück (g CO₂/kWh),
        oder None wenn kein Versorger konfiguriert ist.
        """
        result = await self.db.execute(
            select(AppSetting.value).where(AppSetting.key == "district_heating_provider")
        )
        setting = result.scalar_one_or_none()
        if not setting or not setting.get("provider_id"):
            return None
        provider_id = setting["provider_id"]
        provider = await self.db.get(DistrictHeatingProvider, provider_id)
        if provider:
            return provider.co2_g_per_kwh
        return None

    async def _apply_provider_overrides(self, factors: dict[str, Decimal]) -> dict[str, Decimal]:
        """
        Emissionsfaktoren mit versorger-spezifischen Werten überschreiben.

        - district_heating: Faktor des konfigurierten Versorgers (FW 309)
        - district_cooling: Kein CO₂-Faktor berechenbar → 0
        """
        # Kälte: kein CO₂ berechenbar
        factors.pop("district_cooling", None)

        # Fernwärme: Versorger-Faktor hat Vorrang
        dh_factor = await self._get_district_heating_co2_factor()
        if dh_factor is not None:
            factors["district_heating"] = dh_factor

        return factors

    async def _meter_ids_for_site(self, site_id: uuid.UUID) -> list[uuid.UUID]:
        """Alle aktiven Zähler-IDs für einen Standort (Legacy, nutzt nicht Virtual/Allocation)."""
        result = await self.db.execute(
            select(Meter.id).where(
                Meter.site_id == site_id,
                Meter.is_active == True,  # noqa: E712
            )
        )
        return [row[0] for row in result.all()]

    async def _resolve_meter_set(self, site_id: uuid.UUID | None = None) -> dict:
        """Auflösen einer Zähler-Menge für Dashboard-Aggregationen.

        Cross-Site-Netto: Ist für einen Physical-Root ein Virtual-Netto-Zähler
        (is_virtual=True, virtual_config.type='difference') vorhanden, wird der
        Physical-Root aus `physical_ids` entfernt und stattdessen via Virtual-Meter
        berücksichtigt (`SUM(source) - SUM(subtract)`).

        Allocation: Wenn ein `site_id` gesetzt ist, wird pro Zähler ein
        Anteilsfaktor berechnet aus seinen MeterUnitAllocations (Anteil zur
        gefilterten Site / Summe aller Allocations). Zähler ohne Allocations
        behalten Faktor 1.0, wenn sie zur gefilterten Site gehören.

        Rückgabe:
            {
                'physical_ids': list[UUID]  – direkt aggregierbar via meter_readings,
                'virtual_meters': list[Meter] – Werte separat berechnen,
                'allocation_factors': dict[UUID, Decimal] – Anteilsfaktor je physischer
                    Zähler. Zähler ohne Eintrag → 1.0.
            }
        """
        from app.models.allocation import MeterUnitAllocation
        from app.models.site import Building, UsageUnit

        # 1. Alle aktiven Zähler laden (mit Site-Filter wenn gegeben)
        if site_id is not None:
            # Zähler der gefilterten Site PLUS Zähler, die per Allocation in die Site reichen
            alloc_meter_q = (
                select(MeterUnitAllocation.meter_id)
                .join(UsageUnit, UsageUnit.id == MeterUnitAllocation.usage_unit_id)
                .join(Building, Building.id == UsageUnit.building_id)
                .where(Building.site_id == site_id)
                .distinct()
            )
            meters_q = select(Meter).where(
                Meter.is_active == True,  # noqa: E712
                (Meter.site_id == site_id) | (Meter.id.in_(alloc_meter_q)),
            )
        else:
            meters_q = select(Meter).where(Meter.is_active == True)  # noqa: E712

        all_meters = list((await self.db.execute(meters_q)).scalars().all())

        # 2. Virtual-Netto-Meter trennen, Source-IDs sammeln
        virtual_meters: list[Meter] = []
        virtual_source_ids: set[uuid.UUID] = set()
        for m in all_meters:
            if m.is_virtual and (m.virtual_config or {}).get("type") == "difference":
                src = (m.virtual_config or {}).get("source_meter_id")
                if src:
                    try:
                        virtual_source_ids.add(uuid.UUID(src))
                        virtual_meters.append(m)
                    except ValueError:
                        pass

        # 3. Physical-IDs: nicht virtuell UND nicht source eines Virtual-Meters
        physical_ids = [
            m.id for m in all_meters
            if not m.is_virtual and m.id not in virtual_source_ids
        ]

        # 4. Allocation-Faktoren berechnen (nur bei Site-Filter)
        allocation_factors: dict[uuid.UUID, Decimal] = {}
        if site_id is not None and physical_ids:
            alloc_q = (
                select(
                    MeterUnitAllocation.meter_id,
                    MeterUnitAllocation.allocation_type,
                    MeterUnitAllocation.factor,
                    Building.site_id.label("site_id"),
                )
                .join(UsageUnit, UsageUnit.id == MeterUnitAllocation.usage_unit_id)
                .join(Building, Building.id == UsageUnit.building_id)
                .where(MeterUnitAllocation.meter_id.in_(physical_ids))
            )
            alloc_rows = (await self.db.execute(alloc_q)).all()

            per_meter: dict[uuid.UUID, list[tuple[uuid.UUID, Decimal]]] = {}
            for r in alloc_rows:
                sign = Decimal("1") if r.allocation_type == "add" else Decimal("-1")
                signed = Decimal(str(r.factor)) * sign
                per_meter.setdefault(r.meter_id, []).append((r.site_id, signed))

            for meter_id, allocs in per_meter.items():
                to_site = sum((f for s, f in allocs if s == site_id), Decimal("0"))
                total = sum((f for _, f in allocs), Decimal("0"))
                if total > 0:
                    allocation_factors[meter_id] = to_site / total
                else:
                    # Allocation-Summe ≤ 0: nur direkte Site-Allocation berücksichtigen,
                    # bei 0 → kein Beitrag.
                    allocation_factors[meter_id] = (
                        Decimal("1") if to_site > 0 else Decimal("0")
                    )

        return {
            "physical_ids": physical_ids,
            "virtual_meters": virtual_meters,
            "allocation_factors": allocation_factors,
        }

    async def _compute_virtual_consumption(
        self, virt: Meter, start: date, end: date
    ) -> Decimal:
        """Netto-Verbrauch eines Virtual-Difference-Meters in kWh.

        Berechnet `SUM(source_readings) - SUM(subtract_readings)` für den
        Zeitraum, konvertiert in kWh (Einheit des Virtual-Meters).
        """
        vc = virt.virtual_config or {}
        if vc.get("type") != "difference":
            return Decimal("0")
        source_id_str = vc.get("source_meter_id")
        if not source_id_str:
            return Decimal("0")
        try:
            source_id = uuid.UUID(source_id_str)
            subtract_ids = [uuid.UUID(s) for s in vc.get("subtract_meter_ids", [])]
        except ValueError:
            return Decimal("0")

        ts_start = datetime.combine(start, time.min, tzinfo=timezone.utc)
        ts_end = datetime.combine(end + timedelta(days=1), time.min, tzinfo=timezone.utc)

        src_sum = (await self.db.execute(
            select(func.sum(MeterReading.consumption)).where(
                MeterReading.meter_id == source_id,
                MeterReading.timestamp >= ts_start,
                MeterReading.timestamp < ts_end,
                MeterReading.consumption.isnot(None),
            )
        )).scalar() or Decimal("0")

        sub_sum = Decimal("0")
        if subtract_ids:
            sub_sum = (await self.db.execute(
                select(func.sum(MeterReading.consumption)).where(
                    MeterReading.meter_id.in_(subtract_ids),
                    MeterReading.timestamp >= ts_start,
                    MeterReading.timestamp < ts_end,
                    MeterReading.consumption.isnot(None),
                )
            )).scalar() or Decimal("0")

        net = src_sum - sub_sum
        conv = CONVERSION_FACTORS.get(virt.unit, Decimal("1"))
        return net * conv  # in kWh

    async def get_dashboard(
        self,
        period_start: date | None = None,
        period_end: date | None = None,
        granularity: str = "monthly",
        site_id: uuid.UUID | None = None,
    ) -> dict:
        """Komplette Dashboard-Daten zusammenstellen."""
        today = date.today()
        if not period_start:
            period_start = date(today.year, 1, 1)
        if not period_end:
            period_end = today

        import time as _time

        # Cache-Lookup (60 s TTL)
        cache_key = (str(site_id) if site_id else None, period_start.isoformat(), period_end.isoformat(), granularity)
        entry = self._dashboard_cache.get(cache_key)
        if entry and (_time.time() - entry[0]) < self._CACHE_TTL_SECONDS:
            logger.info("dashboard_cache_hit", site=cache_key[0], age_s=round(_time.time() - entry[0], 1))
            return entry[1]

        timings: dict[str, float] = {}

        async def _timed(name: str, coro):
            t0 = _time.time()
            try:
                return await coro
            finally:
                timings[name] = round((_time.time() - t0) * 1000)

        # Zähler-Menge auflösen: Cross-Site-Netto + Allocation-Faktoren
        meter_set = await _timed("resolve_meter_set", self._resolve_meter_set(site_id))
        physical_ids: list | None = meter_set["physical_ids"] if site_id else None
        virtual_meters: list = meter_set["virtual_meters"]
        allocation_factors: dict = meter_set["allocation_factors"]

        # Vorjahreszeitraum für Trends
        prev_start = date(period_start.year - 1, period_start.month, period_start.day)
        prev_end = date(period_end.year - 1, period_end.month, period_end.day)

        try:
            kpi_cards = await _timed("kpi_cards", self._build_kpi_cards(
                period_start, period_end, prev_start, prev_end,
                physical_ids, virtual_meters, allocation_factors,
            ))
        except Exception as e:
            logger.error("dashboard_kpi_error", error=str(e))
            kpi_cards = []

        try:
            breakdown = await _timed("energy_breakdown", self._get_energy_breakdown(
                period_start, period_end, physical_ids, virtual_meters, allocation_factors,
            ))
        except Exception as e:
            logger.error("dashboard_breakdown_error", error=str(e))
            breakdown = []

        try:
            chart = await _timed("consumption_chart", self._get_consumption_chart(
                period_start, period_end, granularity, physical_ids,
            ))
        except Exception as e:
            logger.error("dashboard_chart_error", error=str(e))
            chart = []

        try:
            top_consumers = await _timed("top_consumers", self._get_top_consumers(
                period_start, period_end, physical_ids, virtual_meters, allocation_factors,
            ))
        except Exception as e:
            logger.error("dashboard_top_consumers_error", error=str(e))
            top_consumers = []

        # Alerts und Plausibilitätswarnungen werden separat über
        # /api/v1/dashboard/data-quality geladen (Tab "Datenqualität"),
        # damit das Hauptdashboard schnell rendert.
        alerts: list = []
        plausibility: list = []

        try:
            enpi = await _timed("enpi", self._get_enpi_overview(period_start, period_end))
        except Exception as e:
            logger.error("dashboard_enpi_error", error=str(e))
            enpi = []

        logger.info(
            "dashboard_timing",
            total_ms=sum(timings.values()),
            site=str(site_id) if site_id else None,
            granularity=granularity,
            **timings,
        )

        result = {
            "period_start": period_start,
            "period_end": period_end,
            "kpi_cards": kpi_cards,
            "energy_breakdown": breakdown,
            "consumption_chart": chart,
            "top_consumers": top_consumers,
            "alerts": alerts,
            "enpi_overview": enpi,
            "plausibility_warnings": plausibility,
        }
        # Cache befüllen
        self._dashboard_cache[cache_key] = (_time.time(), result)
        # Alte Einträge aufräumen (max 50)
        if len(self._dashboard_cache) > 50:
            oldest = sorted(self._dashboard_cache.items(), key=lambda kv: kv[1][0])[:len(self._dashboard_cache)-50]
            for k, _ in oldest:
                self._dashboard_cache.pop(k, None)
        return result

    async def get_data_quality(
        self,
        period_start: date | None = None,
        period_end: date | None = None,
        site_id: uuid.UUID | None = None,
    ) -> dict:
        """Datenqualitätsdaten: Alerts (Zähler ohne aktuelle Daten) und
        Plausibilitätswarnungen (eingefrorene Zähler, Haupt-/Unterzähler-Abweichung).

        Wird vom separaten Tab "Datenqualität" unter Analyse genutzt –
        nicht mehr Teil des Haupt-Dashboards (Performance-Grund).
        """
        today = date.today()
        if not period_start:
            period_start = date(today.year, 1, 1)
        if not period_end:
            period_end = today

        meter_set = await self._resolve_meter_set(site_id)
        physical_ids: list | None = meter_set["physical_ids"] if site_id else None

        try:
            alerts = await self._get_alerts()
        except Exception as e:
            logger.error("data_quality_alerts_error", error=str(e))
            alerts = []

        try:
            plausibility = await self._get_plausibility_warnings(
                period_start, period_end, physical_ids,
            )
        except Exception as e:
            logger.error("data_quality_plausibility_error", error=str(e))
            plausibility = []

        return {
            "period_start": period_start,
            "period_end": period_end,
            "alerts": alerts,
            "plausibility_warnings": plausibility,
        }

    async def _consumption_by_energy_type(
        self, start: date, end: date,
        meter_ids: list | None = None,
        virtual_meters: list | None = None,
        allocation_factors: dict | None = None,
    ) -> list[dict]:
        """Verbrauch je Energietyp in nativer Einheit.

        Berücksichtigt Cross-Site-Netto (virtual_meters) und Allocation-Faktoren.
        """
        # Allocation-Faktoren erfordern Pro-Zähler-Aggregation
        needs_per_meter = bool(allocation_factors)

        if needs_per_meter:
            query = (
                select(
                    Meter.id,
                    Meter.energy_type,
                    Meter.unit,
                    func.sum(MeterReading.consumption).label("total"),
                )
                .join(MeterReading, MeterReading.meter_id == Meter.id)
                .where(
                    Meter.is_active == True,  # noqa: E712
                    Meter.is_feed_in != True,
                    MeterReading.consumption.isnot(None),
                    MeterReading.timestamp >= datetime.combine(
                        start, datetime.min.time(), tzinfo=timezone.utc
                    ),
                    MeterReading.timestamp < datetime.combine(
                        end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
                    ),
                )
                .group_by(Meter.id, Meter.energy_type, Meter.unit)
            )
        else:
            query = (
                select(
                    Meter.energy_type,
                    Meter.unit,
                    func.sum(MeterReading.consumption).label("total"),
                )
                .join(MeterReading, MeterReading.meter_id == Meter.id)
                .where(
                    Meter.is_active == True,  # noqa: E712
                    Meter.is_feed_in != True,
                    MeterReading.consumption.isnot(None),
                    MeterReading.timestamp >= datetime.combine(
                        start, datetime.min.time(), tzinfo=timezone.utc
                    ),
                    MeterReading.timestamp < datetime.combine(
                        end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
                    ),
                )
                .group_by(Meter.energy_type, Meter.unit)
            )
        if meter_ids is not None:
            query = query.where(Meter.id.in_(meter_ids))
        result = await self.db.execute(query)

        # Pro Energietyp: native Einheit beibehalten
        groups: dict[str, dict] = {}
        for row in result.all():
            et = row.energy_type
            val = row.total or Decimal("0")
            # Allocation-Faktor anwenden, wenn Pro-Zähler-Aggregation
            if needs_per_meter and allocation_factors:
                val = val * allocation_factors.get(row.id, Decimal("1"))
            if et not in groups:
                groups[et] = {"value": Decimal("0"), "unit": row.unit}
            if groups[et]["unit"] == row.unit:
                groups[et]["value"] += val
            else:
                conv = CONVERSION_FACTORS.get(row.unit, Decimal("1"))
                groups[et]["value"] += val * conv
                groups[et]["unit"] = "kWh"

        # Virtual-Netto-Meter dazumischen (kWh)
        for vm in (virtual_meters or []):
            kwh = await self._compute_virtual_consumption(vm, start, end)
            if kwh == 0:
                continue
            et = vm.energy_type
            if et not in groups:
                groups[et] = {"value": Decimal("0"), "unit": vm.unit}
            # Virtual liefert kWh; wenn group eine andere Einheit hat, in kWh konvertieren
            if groups[et]["unit"] == "kWh":
                groups[et]["value"] += kwh
            elif groups[et]["unit"] == vm.unit:
                # Rückrechnen in native Einheit
                conv = CONVERSION_FACTORS.get(vm.unit, Decimal("1"))
                native = kwh / conv if conv > 0 else kwh
                groups[et]["value"] += native
            else:
                # Inkonsistente Einheiten → alles in kWh
                conv = CONVERSION_FACTORS.get(groups[et]["unit"], Decimal("1"))
                groups[et]["value"] = groups[et]["value"] * conv + kwh
                groups[et]["unit"] = "kWh"

        return [
            {
                "energy_type": et,
                "label": ENERGY_TYPE_LABELS.get(et, et),
                "value": round(float(info["value"]), 1),
                "unit": info["unit"],
            }
            for et, info in sorted(groups.items(), key=lambda x: -float(x[1]["value"]))
        ]

    async def _build_kpi_cards(
        self, start: date, end: date, prev_start: date, prev_end: date,
        meter_ids: list | None = None,
        virtual_meters: list | None = None,
        allocation_factors: dict | None = None,
    ) -> list[dict]:
        """KPI-Karten berechnen – pro Energietyp statt Gesamtverbrauch."""
        cards = []

        # 1. Verbrauch je Energietyp (statt einer Gesamtsumme)
        current_by_type = await self._consumption_by_energy_type(
            start, end, meter_ids, virtual_meters, allocation_factors
        )
        prev_by_type = await self._consumption_by_energy_type(
            prev_start, prev_end, meter_ids, virtual_meters, allocation_factors
        )
        prev_lookup = {item["energy_type"]: item["value"] for item in prev_by_type}

        for item in current_by_type:
            prev_val = prev_lookup.get(item["energy_type"], 0)
            trend = self._calc_trend(Decimal(str(item["value"])), Decimal(str(prev_val)))
            cards.append({
                "label": item["label"],
                "value": item["value"],
                "unit": item["unit"],
                "energy_type": item["energy_type"],
                "trend_percent": trend,
                "trend_direction": self._trend_dir(trend),
                "comparison_value": prev_val,
                "comparison_label": "Vorjahr",
            })

        # 2. CO₂-Emissionen
        co2 = await self._total_co2(start, end, meter_ids, virtual_meters, allocation_factors)
        prev_co2 = await self._total_co2(prev_start, prev_end, meter_ids, virtual_meters, allocation_factors)
        co2_trend = self._calc_trend(co2, prev_co2)

        cards.append({
            "label": "CO₂-Emissionen",
            "value": float(co2),
            "unit": "kg CO₂",
            "trend_percent": co2_trend,
            "trend_direction": self._trend_dir(co2_trend),
            "comparison_value": float(prev_co2),
            "comparison_label": "Vorjahr",
        })

        # 3. Geschätzte Kosten
        cost = await self._total_cost(start, end, meter_ids, virtual_meters, allocation_factors)
        prev_cost = await self._total_cost(prev_start, prev_end, meter_ids, virtual_meters, allocation_factors)
        cost_trend = self._calc_trend(cost, prev_cost)

        cards.append({
            "label": "Energiekosten",
            "value": float(cost),
            "unit": "€",
            "trend_percent": cost_trend,
            "trend_direction": self._trend_dir(cost_trend),
            "comparison_value": float(prev_cost),
            "comparison_label": "Vorjahr",
        })

        # 4. Aktive Zähler
        meter_count = await self._active_meter_count()
        cards.append({
            "label": "Aktive Zähler",
            "value": float(meter_count),
            "unit": "Stk.",
            "trend_percent": None,
            "trend_direction": None,
            "comparison_value": None,
            "comparison_label": None,
        })

        # 5. + 6. PV-Kennzahlen (nur wenn Einspeisezähler vorhanden)
        pv = await self._calc_pv_metrics(start, end)
        if pv["has_pv"]:
            prev_pv = await self._calc_pv_metrics(prev_start, prev_end)
            prod_trend = self._calc_trend(pv["production"], prev_pv["production"])
            cards.append({
                "label": "Eigenproduktion",
                "value": pv["production"],
                "unit": "kWh",
                "trend_percent": prod_trend,
                "trend_direction": self._trend_dir(prod_trend),
                "comparison_value": prev_pv["production"],
                "comparison_label": "Vorjahr",
            })
            cards.append({
                "label": "Autarkiegrad",
                "value": pv["autarky"],
                "unit": "%",
                "trend_percent": None,
                "trend_direction": None,
                "comparison_value": prev_pv["autarky"] if prev_pv["has_pv"] else None,
                "comparison_label": "Vorjahr",
            })

        return cards

    async def _total_consumption(
        self, start: date, end: date,
        meter_ids: list | None = None,
        virtual_meters: list | None = None,
        allocation_factors: dict | None = None,
    ) -> Decimal:
        """Gesamtverbrauch in kWh, inkl. Cross-Site-Netto + Allocation-Faktoren."""
        needs_per_meter = bool(allocation_factors)

        if needs_per_meter:
            query = (
                select(
                    Meter.id,
                    Meter.unit,
                    func.sum(MeterReading.consumption).label("total"),
                )
                .join(MeterReading, MeterReading.meter_id == Meter.id)
                .where(
                    Meter.is_active == True,  # noqa: E712
                    Meter.is_feed_in != True,
                    MeterReading.timestamp >= datetime.combine(
                        start, datetime.min.time(), tzinfo=timezone.utc
                    ),
                    MeterReading.timestamp < datetime.combine(
                        end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
                    ),
                )
                .group_by(Meter.id, Meter.unit)
            )
        else:
            query = (
                select(
                    Meter.unit,
                    func.sum(MeterReading.consumption).label("total"),
                )
                .join(MeterReading, MeterReading.meter_id == Meter.id)
                .where(
                    Meter.is_active == True,  # noqa: E712
                    Meter.is_feed_in != True,
                    MeterReading.timestamp >= datetime.combine(
                        start, datetime.min.time(), tzinfo=timezone.utc
                    ),
                    MeterReading.timestamp < datetime.combine(
                        end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
                    ),
                )
                .group_by(Meter.unit)
            )
        if meter_ids is not None:
            query = query.where(Meter.id.in_(meter_ids))
        result = await self.db.execute(query)

        total = Decimal("0")
        for row in result.all():
            conv = CONVERSION_FACTORS.get(row.unit, Decimal("1"))
            val = (row.total or Decimal("0")) * conv
            if needs_per_meter and allocation_factors:
                val = val * allocation_factors.get(row.id, Decimal("1"))
            total += val

        # Virtual-Netto-Meter addieren (liefern bereits kWh)
        for vm in (virtual_meters or []):
            total += await self._compute_virtual_consumption(vm, start, end)

        return Decimal(str(round(float(total), 1)))

    async def _total_co2(
        self, start: date, end: date,
        meter_ids: list | None = None,
        virtual_meters: list | None = None,
        allocation_factors: dict | None = None,
    ) -> Decimal:
        """Gesamt-CO₂ in kg – aus vorberechneten Daten oder Echtzeit-Schätzung.

        Bei Site-Filter mit Allocation/Virtual wird immer der Schätzungs-Pfad
        genutzt, weil CO2Calculation keine Cross-Site/Allocation-Auflösung kennt.
        """
        has_overrides = bool(virtual_meters) or bool(allocation_factors)
        if not has_overrides:
            co2_query = select(func.sum(CO2Calculation.co2_kg)).where(
                CO2Calculation.period_start >= start,
                CO2Calculation.period_end <= end,
            )
            result = await self.db.execute(co2_query)
            co2_kg = result.scalar() or Decimal("0")
            if co2_kg > 0:
                return Decimal(str(round(float(co2_kg), 1)))

        # Schätzung aus Verbrauchsdaten × Emissionsfaktoren
        try:
            needs_per_meter = bool(allocation_factors)
            if needs_per_meter:
                cons_q = (
                    select(
                        Meter.id,
                        Meter.energy_type,
                        Meter.unit,
                        func.sum(MeterReading.consumption).label("consumption"),
                    )
                    .join(MeterReading, MeterReading.meter_id == Meter.id)
                    .where(
                        Meter.is_active == True,  # noqa: E712
                        Meter.is_feed_in != True,
                        MeterReading.consumption.isnot(None),
                        MeterReading.timestamp >= datetime.combine(start, time.min, tzinfo=timezone.utc),
                        MeterReading.timestamp < datetime.combine(end + timedelta(days=1), time.min, tzinfo=timezone.utc),
                    )
                    .group_by(Meter.id, Meter.energy_type, Meter.unit)
                )
            else:
                cons_q = (
                    select(
                        Meter.energy_type,
                        Meter.unit,
                        func.sum(MeterReading.consumption).label("consumption"),
                    )
                    .join(MeterReading, MeterReading.meter_id == Meter.id)
                    .where(
                        Meter.is_active == True,  # noqa: E712
                        Meter.is_feed_in != True,
                        MeterReading.consumption.isnot(None),
                        MeterReading.timestamp >= datetime.combine(start, time.min, tzinfo=timezone.utc),
                        MeterReading.timestamp < datetime.combine(end + timedelta(days=1), time.min, tzinfo=timezone.utc),
                    )
                    .group_by(Meter.energy_type, Meter.unit)
                )
            if meter_ids is not None:
                cons_q = cons_q.where(Meter.id.in_(meter_ids))
            cons_result = await self.db.execute(cons_q)

            latest_year_sub = (
                select(
                    EmissionFactor.energy_type,
                    func.max(EmissionFactor.year * 100 + func.coalesce(EmissionFactor.month, 0)).label("max_period"),
                )
                .group_by(EmissionFactor.energy_type)
                .subquery()
            )
            factors_result = await self.db.execute(
                select(EmissionFactor.energy_type, EmissionFactor.co2_g_per_kwh.label("co2_factor"))
                .join(
                    latest_year_sub,
                    (EmissionFactor.energy_type == latest_year_sub.c.energy_type)
                    & ((EmissionFactor.year * 100 + func.coalesce(EmissionFactor.month, 0)) == latest_year_sub.c.max_period),
                )
            )
            factors: dict[str, Decimal] = {
                row.energy_type: Decimal(str(row.co2_factor))
                for row in factors_result.all()
                if row.co2_factor
            }
            factors = await self._apply_provider_overrides(factors)
            total = Decimal("0")
            for row in cons_result.all():
                consumption = row.consumption or Decimal("0")
                conv = CONVERSION_FACTORS.get(row.unit, Decimal("1"))
                kwh = consumption * conv
                if needs_per_meter and allocation_factors:
                    kwh = kwh * allocation_factors.get(row.id, Decimal("1"))
                factor = factors.get(row.energy_type, Decimal("0"))
                total += kwh * factor / Decimal("1000")

            # Virtual-Netto-Meter ergänzen
            for vm in (virtual_meters or []):
                kwh = await self._compute_virtual_consumption(vm, start, end)
                if kwh == 0:
                    continue
                factor = factors.get(vm.energy_type, Decimal("0"))
                total += kwh * factor / Decimal("1000")

            return Decimal(str(round(float(total), 1)))
        except Exception:
            return Decimal("0")

    async def _total_cost(
        self, start: date, end: date,
        meter_ids: list | None = None,
        virtual_meters: list | None = None,
        allocation_factors: dict | None = None,
    ) -> Decimal:
        """Gesamtkosten aus Tarif-Informationen + direkte Reading-Kosten.

        Allocation-Faktoren werden auf alle Beiträge angewendet. Virtual-Netto-
        Meter werden über den Tarif ihres Source-Meters bewertet (Fallback: 0).
        """
        start_ts = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)
        end_ts = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)

        total_cost = Decimal("0")
        tariff_meter_ids: set = set()
        af = allocation_factors or {}

        # ── 1. Tarif-basierte Kosten (Zähler mit price_per_kwh) ──
        meters_q = select(Meter).where(
            Meter.is_active == True,  # noqa: E712
            Meter.is_feed_in != True,
            Meter.tariff_info.isnot(None),
        )
        if meter_ids is not None:
            meters_q = meters_q.where(Meter.id.in_(meter_ids))
        meters_result = await self.db.execute(meters_q)
        meters = list(meters_result.scalars().all())

        priced_meters = [
            m for m in meters
            if Decimal(str((m.tariff_info or {}).get("price_per_kwh", 0))) > 0
        ]

        if priced_meters:
            meter_id_list = [m.id for m in priced_meters]
            tariff_meter_ids = set(meter_id_list)

            rows = (await self.db.execute(
                select(
                    MeterReading.meter_id,
                    func.sum(MeterReading.consumption).label("total_consumption"),
                )
                .where(
                    MeterReading.meter_id.in_(meter_id_list),
                    MeterReading.timestamp >= start_ts,
                    MeterReading.timestamp < end_ts,
                )
                .group_by(MeterReading.meter_id)
            )).all()

            meter_lookup = {m.id: m for m in priced_meters}
            for row in rows:
                consumption = row.total_consumption or Decimal("0")
                meter = meter_lookup[row.meter_id]
                price_per_kwh = Decimal(str((meter.tariff_info or {}).get("price_per_kwh", 0)))
                conv = CONVERSION_FACTORS.get(meter.unit, Decimal("1"))
                cost = consumption * conv * price_per_kwh
                cost = cost * af.get(meter.id, Decimal("1"))
                total_cost += cost

        # ── 2. Direkte Kosten aus Readings (Abrechnungsdaten) ──
        # Bei Allocation-Faktoren: pro Zähler aggregieren um Faktor anzuwenden
        if af:
            direct_q = (
                select(
                    MeterReading.meter_id,
                    func.sum(MeterReading.cost_net).label("cost"),
                )
                .join(Meter, Meter.id == MeterReading.meter_id)
                .where(
                    Meter.is_active == True,  # noqa: E712
                    Meter.is_feed_in != True,
                    MeterReading.cost_net > 0,
                    MeterReading.timestamp >= start_ts,
                    MeterReading.timestamp < end_ts,
                )
                .group_by(MeterReading.meter_id)
            )
            if tariff_meter_ids:
                direct_q = direct_q.where(~MeterReading.meter_id.in_(tariff_meter_ids))
            if meter_ids is not None:
                direct_q = direct_q.where(Meter.id.in_(meter_ids))
            for r in (await self.db.execute(direct_q)).all():
                total_cost += (r.cost or Decimal("0")) * af.get(r.meter_id, Decimal("1"))
        else:
            direct_q = (
                select(func.sum(MeterReading.cost_net))
                .join(Meter, Meter.id == MeterReading.meter_id)
                .where(
                    Meter.is_active == True,  # noqa: E712
                    Meter.is_feed_in != True,
                    MeterReading.cost_net > 0,
                    MeterReading.timestamp >= start_ts,
                    MeterReading.timestamp < end_ts,
                )
            )
            if tariff_meter_ids:
                direct_q = direct_q.where(~MeterReading.meter_id.in_(tariff_meter_ids))
            if meter_ids is not None:
                direct_q = direct_q.where(Meter.id.in_(meter_ids))
            direct_cost = (await self.db.execute(direct_q)).scalar() or Decimal("0")
            total_cost += direct_cost

        # ── 3. Virtual-Netto-Meter: Kosten via Tarif des Source-Meters ──
        for vm in (virtual_meters or []):
            vc = vm.virtual_config or {}
            src_str = vc.get("source_meter_id")
            if not src_str:
                continue
            try:
                src_id = uuid.UUID(src_str)
            except ValueError:
                continue
            src_meter = await self.db.get(Meter, src_id)
            if src_meter is None:
                continue
            tariff = src_meter.tariff_info or {}
            price = tariff.get("price_per_kwh")
            if not price:
                continue
            kwh = await self._compute_virtual_consumption(vm, start, end)
            total_cost += kwh * Decimal(str(price))

        return Decimal(str(round(float(total_cost), 2)))

    async def _active_meter_count(self) -> int:
        result = await self.db.execute(
            select(func.count(Meter.id)).where(Meter.is_active == True)  # noqa: E712
        )
        return result.scalar() or 0

    async def _get_energy_breakdown(
        self, start: date, end: date,
        meter_ids: list | None = None,
        virtual_meters: list | None = None,
        allocation_factors: dict | None = None,
    ) -> list[dict]:
        """Verbrauch nach Energietyp aufschlüsseln (mit Originaleinheiten, Kosten, CO₂).

        Berücksichtigt Cross-Site-Netto + Allocation-Faktoren.
        """
        af = allocation_factors or {}
        # Schritt 1: Verbrauch je Zähler aggregieren (kein JSON im GROUP BY)
        query = (
            select(
                Meter.id,
                Meter.energy_type,
                Meter.unit,
                func.sum(MeterReading.consumption).label("consumption"),
            )
            .join(MeterReading, MeterReading.meter_id == Meter.id)
            .where(
                Meter.is_active == True,  # noqa: E712
                Meter.is_feed_in != True,
                MeterReading.consumption.isnot(None),
                MeterReading.timestamp >= datetime.combine(
                    start, datetime.min.time(), tzinfo=timezone.utc
                ),
                MeterReading.timestamp < datetime.combine(
                    end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
                ),
            )
            .group_by(Meter.id, Meter.energy_type, Meter.unit)
        )
        if meter_ids is not None:
            query = query.where(Meter.id.in_(meter_ids))
        result = await self.db.execute(query)
        rows = result.all()

        if not rows and not virtual_meters:
            return []

        # Schritt 2: tariff_info je Zähler laden
        meter_ids = [row.id for row in rows]
        tariff_result = await self.db.execute(
            select(Meter.id, Meter.tariff_info).where(Meter.id.in_(meter_ids))
        )
        tariffs: dict = {row.id: (row.tariff_info or {}) for row in tariff_result.all()}

        # Schritt 3: Emissionsfaktoren je Energietyp laden (neuester Jahreswert)
        latest_year_sub = (
            select(
                EmissionFactor.energy_type,
                func.max(EmissionFactor.year * 100 + func.coalesce(EmissionFactor.month, 0)).label("max_period"),
            )
            .group_by(EmissionFactor.energy_type)
            .subquery()
        )
        factors_result = await self.db.execute(
            select(EmissionFactor.energy_type, EmissionFactor.co2_g_per_kwh.label("co2_factor"))
            .join(
                latest_year_sub,
                (EmissionFactor.energy_type == latest_year_sub.c.energy_type)
                & ((EmissionFactor.year * 100 + func.coalesce(EmissionFactor.month, 0)) == latest_year_sub.c.max_period),
            )
        )
        factors: dict[str, Decimal] = {
            row.energy_type: Decimal(str(row.co2_factor))
            for row in factors_result.all()
            if row.co2_factor
        }
        # Versorger-spezifische Faktoren anwenden
        factors = await self._apply_provider_overrides(factors)

        # Schritt 4: Direkte Kosten aus Readings laden (für Zähler ohne Tarif)
        tariffed_ids = {m_id for m_id, t in tariffs.items() if t.get("price_per_kwh")}
        direct_costs_by_et: dict[str, Decimal] = {}
        if True:
            dcq = (
                select(
                    Meter.energy_type,
                    func.sum(MeterReading.cost_net).label("direct_cost"),
                )
                .join(MeterReading, MeterReading.meter_id == Meter.id)
                .where(
                    Meter.is_active == True,  # noqa: E712
                    Meter.is_feed_in != True,
                    MeterReading.cost_net > 0,
                    MeterReading.timestamp >= datetime.combine(
                        start, datetime.min.time(), tzinfo=timezone.utc
                    ),
                    MeterReading.timestamp < datetime.combine(
                        end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
                    ),
                )
                .group_by(Meter.energy_type)
            )
            if tariffed_ids:
                dcq = dcq.where(~Meter.id.in_(tariffed_ids))
            if meter_ids is not None:
                dcq = dcq.where(Meter.id.in_(meter_ids))
            dc_result = await self.db.execute(dcq)
            for dc_row in dc_result.all():
                direct_costs_by_et[dc_row.energy_type] = dc_row.direct_cost or Decimal("0")

        # Schritt 5: Pro Energietyp aggregieren
        groups: dict[str, dict] = {}
        for row in rows:
            raw = row.consumption or Decimal("0")
            conv = CONVERSION_FACTORS.get(row.unit, Decimal("1"))
            kwh = raw * conv
            factor_share = af.get(row.id, Decimal("1"))
            kwh = kwh * factor_share
            raw_eff = raw * factor_share
            if row.energy_type not in groups:
                groups[row.energy_type] = {
                    "kwh": Decimal("0"),
                    "original_value": Decimal("0"),
                    "original_unit": row.unit,
                    "cost_eur": Decimal("0"),
                    "co2_kg": Decimal("0"),
                }
            groups[row.energy_type]["kwh"] += kwh
            # Originalwert nur akkumulieren wenn gleiche Einheit
            if groups[row.energy_type]["original_unit"] == row.unit:
                groups[row.energy_type]["original_value"] += raw_eff
            # Kosten aus Tarif berechnen
            tariff = tariffs.get(row.id, {})
            price = tariff.get("price_per_kwh")
            if price:
                groups[row.energy_type]["cost_eur"] += kwh * Decimal(str(price))
            # CO₂ schätzen
            factor = factors.get(row.energy_type, Decimal("0"))
            groups[row.energy_type]["co2_kg"] += kwh * factor / Decimal("1000")

        # Direkte Kosten aus Readings hinzufügen (Allocation-gefiltert wenn nötig)
        if af:
            # Mit Allocation: pro Zähler holen und mit Faktor multiplizieren
            dcq2 = (
                select(
                    MeterReading.meter_id,
                    Meter.energy_type,
                    func.sum(MeterReading.cost_net).label("cost"),
                )
                .join(Meter, Meter.id == MeterReading.meter_id)
                .where(
                    Meter.is_active == True,  # noqa: E712
                    Meter.is_feed_in != True,
                    MeterReading.cost_net > 0,
                    MeterReading.timestamp >= datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc),
                    MeterReading.timestamp < datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc),
                )
                .group_by(MeterReading.meter_id, Meter.energy_type)
            )
            if tariffed_ids:
                dcq2 = dcq2.where(~Meter.id.in_(tariffed_ids))
            if meter_ids is not None:
                dcq2 = dcq2.where(Meter.id.in_(meter_ids))
            for r in (await self.db.execute(dcq2)).all():
                if r.energy_type in groups:
                    groups[r.energy_type]["cost_eur"] += (r.cost or Decimal("0")) * af.get(r.meter_id, Decimal("1"))
        else:
            for et, dc in direct_costs_by_et.items():
                if et in groups:
                    groups[et]["cost_eur"] += dc

        # Virtual-Netto-Meter dazumischen
        for vm in (virtual_meters or []):
            kwh = await self._compute_virtual_consumption(vm, start, end)
            if kwh == 0:
                continue
            et = vm.energy_type
            if et not in groups:
                groups[et] = {
                    "kwh": Decimal("0"),
                    "original_value": Decimal("0"),
                    "original_unit": vm.unit,
                    "cost_eur": Decimal("0"),
                    "co2_kg": Decimal("0"),
                }
            groups[et]["kwh"] += kwh
            if groups[et]["original_unit"] == vm.unit:
                conv = CONVERSION_FACTORS.get(vm.unit, Decimal("1"))
                groups[et]["original_value"] += kwh / conv if conv > 0 else kwh
            # CO₂ aus Faktor
            f = factors.get(et, Decimal("0"))
            groups[et]["co2_kg"] += kwh * f / Decimal("1000")
            # Kosten via Source-Meter-Tarif
            vc = vm.virtual_config or {}
            src_str = vc.get("source_meter_id")
            if src_str:
                try:
                    src_id = uuid.UUID(src_str)
                    src_m = await self.db.get(Meter, src_id)
                    if src_m and src_m.tariff_info:
                        price = src_m.tariff_info.get("price_per_kwh")
                        if price:
                            groups[et]["cost_eur"] += kwh * Decimal(str(price))
                except ValueError:
                    pass

        total = sum(g["kwh"] for g in groups.values())
        return [
            {
                "energy_type": et,
                "consumption_kwh": round(float(info["kwh"]), 1),
                "original_value": round(float(info["original_value"]), 1),
                "original_unit": info["original_unit"],
                "cost_eur": round(float(info["cost_eur"]), 2) if info["cost_eur"] > 0 else None,
                "co2_kg": round(float(info["co2_kg"]), 1) if info["co2_kg"] > 0 else None,
                "share_percent": round(float(info["kwh"] / total * 100), 1) if total > 0 else 0,
            }
            for et, info in sorted(groups.items(), key=lambda x: -x[1]["kwh"])
        ]

    async def _get_consumption_chart(
        self, start: date, end: date, granularity: str, meter_ids: list | None = None
    ) -> list[dict]:
        """Verbrauchszeitreihe nach Energieträger aggregiert (nicht je Zähler)."""
        trunc_map = {"daily": "day", "weekly": "week", "monthly": "month", "yearly": "year"}
        trunc = trunc_map.get(granularity, "month")

        ts_start = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)
        ts_end = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)

        # Nach energy_type aggregieren statt je Zähler
        query = (
            select(
                Meter.energy_type,
                Meter.unit,
                func.date_trunc(trunc, MeterReading.timestamp).label("period"),
                func.sum(MeterReading.consumption).label("consumption"),
            )
            .join(MeterReading, MeterReading.meter_id == Meter.id)
            .where(
                Meter.is_active == True,  # noqa: E712
                Meter.is_feed_in != True,
                MeterReading.timestamp >= ts_start,
                MeterReading.timestamp < ts_end,
            )
            .group_by(Meter.energy_type, Meter.unit, text("period"))
            .order_by(Meter.energy_type, text("period"))
        )
        if meter_ids is not None:
            query = query.where(Meter.id.in_(meter_ids))
        result = await self.db.execute(query)
        rows = result.all()

        # Bezeichnungen für Energieträger
        labels = {
            "electricity": "Strom",
            "district_heating": "Fernwärme",
            "district_cooling": "Kälte",
            "water": "Wasser",
            "gas": "Gas",
        }

        # Ergebnisse nach energy_type gruppieren
        charts: dict = {}
        for row in rows:
            et = row.energy_type
            if et not in charts:
                charts[et] = {
                    "meter_id": et,
                    "meter_name": labels.get(et, et),
                    "energy_type": et,
                    "unit": "kWh",
                    "data": [],
                }
            conv = CONVERSION_FACTORS.get(row.unit, Decimal("1"))
            charts[et]["data"].append({
                "label": row.period.strftime("%b %Y") if row.period else "",
                "value": round(float((row.consumption or Decimal("0")) * conv), 1),
            })

        return list(charts.values())

    async def _get_top_consumers(
        self, start: date, end: date,
        meter_ids: list | None = None,
        virtual_meters: list | None = None,
        allocation_factors: dict | None = None,
    ) -> list[dict]:
        """Top-3 Verbraucher je Energietyp (native Einheiten).

        Berücksichtigt Cross-Site-Netto (Virtual-Meter ersetzen Physical-Source)
        und Allocation-Faktoren (anteiliger Beitrag des Zählers zur Site).
        """
        ts_start = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)
        ts_end = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
        af = allocation_factors or {}

        query = (
            select(
                Meter.id,
                Meter.name,
                Meter.display_name,
                Meter.energy_type,
                Meter.unit,
                func.sum(MeterReading.consumption).label("consumption"),
            )
            .join(MeterReading, MeterReading.meter_id == Meter.id)
            .where(
                Meter.is_active == True,  # noqa: E712
                Meter.is_feed_in != True,
                MeterReading.consumption.isnot(None),
                MeterReading.consumption > 0,
                MeterReading.timestamp >= ts_start,
                MeterReading.timestamp < ts_end,
            )
            .group_by(Meter.id, Meter.name, Meter.display_name, Meter.energy_type, Meter.unit)
            .having(func.sum(MeterReading.consumption) > 0)
        )
        if meter_ids is not None:
            query = query.where(Meter.id.in_(meter_ids))
        result = await self.db.execute(query)

        # Sammeln aller Kandidaten pro Energietyp (mit Allocation-Faktor angewendet)
        candidates: dict[str, list[dict]] = {}
        for row in result.all():
            raw_native = row.consumption or Decimal("0")
            factor_share = af.get(row.id, Decimal("1"))
            eff_native = raw_native * factor_share
            if eff_native <= 0:
                continue
            label = f"{row.display_name} ({row.name})" if row.display_name else row.name
            candidates.setdefault(row.energy_type, []).append({
                "meter_id": str(row.id),
                "name": label,
                "energy_type": row.energy_type,
                "consumption": float(eff_native),
                "unit": row.unit,
                "consumption_kwh": float(eff_native * CONVERSION_FACTORS.get(row.unit, Decimal("1"))),
                "_sort_key": float(eff_native * CONVERSION_FACTORS.get(row.unit, Decimal("1"))),
            })

        # Virtual-Netto-Meter dazumischen (mit ihren berechneten Werten)
        for vm in (virtual_meters or []):
            kwh = await self._compute_virtual_consumption(vm, start, end)
            if kwh <= 0:
                continue
            label = f"{vm.display_name} ({vm.name})" if vm.display_name else vm.name
            conv = CONVERSION_FACTORS.get(vm.unit, Decimal("1"))
            native = kwh / conv if conv > 0 else kwh
            candidates.setdefault(vm.energy_type, []).append({
                "meter_id": str(vm.id),
                "name": label,
                "energy_type": vm.energy_type,
                "consumption": float(native),
                "unit": vm.unit,
                "consumption_kwh": float(kwh),
                "_sort_key": float(kwh),
            })

        # Top-3 je Typ
        groups: dict[str, list[dict]] = {}
        for et, items in candidates.items():
            items.sort(key=lambda x: -x["_sort_key"])
            top3 = items[:3]
            for it in top3:
                it["consumption"] = round(it["consumption"], 1)
                it["consumption_kwh"] = round(it["consumption_kwh"], 1)
                it.pop("_sort_key", None)
            groups[et] = top3

        return [
            {
                "energy_type": et,
                "energy_type_label": ENERGY_TYPE_LABELS.get(et, et),
                "meters": meters,
            }
            for et, meters in sorted(groups.items(), key=lambda x: x[0])
        ]

    async def _get_alerts(self) -> list[dict]:
        """Aktive Warnungen: aktive Zähler ohne Reading der letzten 7 Tage.

        Liefert alle betroffenen Zähler (kein Limit) mit technischem Namen,
        Klarnamen, letztem Reading-Zeitpunkt und Anzahl Tage ohne Daten.
        """
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=7)

        # Letzter Reading je Zähler über *alle* Daten (nicht nur 30 Tage),
        # damit der Zeitpunkt korrekt angezeigt werden kann.
        subq = (
            select(
                MeterReading.meter_id,
                func.max(MeterReading.timestamp).label("last_ts"),
            )
            .group_by(MeterReading.meter_id)
            .subquery()
        )
        result = await self.db.execute(
            select(Meter.id, Meter.name, Meter.display_name, subq.c.last_ts)
            .outerjoin(subq, Meter.id == subq.c.meter_id)
            .where(
                Meter.is_active == True,  # noqa: E712
                Meter.is_feed_in != True,
            )
        )
        alerts = []
        for row in result.all():
            last_ts = row.last_ts
            if last_ts and last_ts.tzinfo is None:
                last_ts = last_ts.replace(tzinfo=timezone.utc)
            if last_ts and last_ts >= cutoff:
                continue  # Zähler hat aktuelle Daten

            days_since = (now - last_ts).days if last_ts else None
            alerts.append({
                "type": "no_data",
                "severity": "warnung",
                "meter_id": str(row.id),
                "meter_name": row.name,
                "meter_display_name": row.display_name,
                "last_reading_at": last_ts.isoformat() if last_ts else None,
                "days_since": days_since,
                "message": f"Zähler '{row.name}' hat seit >7 Tagen keine Daten",  # Backward-Compat
            })

        # Sortierung: längste Stille zuerst, Zähler ohne Reading ganz oben
        alerts.sort(key=lambda a: (a["days_since"] is None, -(a["days_since"] or 0)), reverse=True)
        return alerts

    async def get_enpi_overview(
        self,
        period: str = "current_year",
        start_date: date | None = None,
        end_date: date | None = None,
    ) -> list[dict]:
        """EnPI-Übersicht für alle Hauptzähler."""
        today = date.today()
        if period == "current_year":
            start = date(today.year, 1, 1)
            end = today
        elif period == "last_12_months":
            end = today
            start = date(today.year - 1, today.month, today.day)
        else:
            start = start_date or date(today.year, 1, 1)
            end = end_date or today

        return await self._get_enpi_overview(start, end)

    async def _get_plausibility_warnings(
        self, start: date, end: date, meter_ids: list | None = None
    ) -> list[dict]:
        """Plausibilitätsprüfungen kombiniert (Sub-Meter-Mismatch + eingefrorene Zähler)."""
        warnings = await self._get_submeter_warnings(start, end, meter_ids)
        warnings.extend(await self._get_frozen_meter_warnings(meter_ids))
        return warnings

    async def _get_frozen_meter_warnings(
        self, meter_ids: list | None = None
    ) -> list[dict]:
        """Findet Zähler, deren Zählerstand seit X Tagen unverändert ist.

        Eine einzige Query mit LATERAL JOIN: Kandidaten-Filter (MIN(value)=MAX(value)
        in den letzten 14 Tagen) plus für jeden Treffer den exakten Zeitpunkt
        der letzten Wertänderung. Auf großen DBs ~30x schneller als die zuvor
        verwendete pro-Kandidat-Subquery-Schleife.

        Auto-Quellen (modbus/bacnet/shelly/knx/homeassistant/mqtt): Schwelle 14 Tage
        Sonst: Schwelle 90 Tage (typisch für manuelle Eintragungen / Monatsabrechnungen)
        """
        auto_sources = {"modbus", "bacnet", "shelly", "knx", "homeassistant", "mqtt"}
        AUTO_THRESHOLD_DAYS = 14
        MANUAL_THRESHOLD_DAYS = 90
        MAX_NO_DATA_DAYS = 30  # älter als 30 Tage ohne Reading = stillgelegt, keine Warnung

        # Eine Query: Kandidaten + letzte Wertänderung via LATERAL
        combined_q = text("""
            WITH candidates AS (
                SELECT mr.meter_id,
                       MIN(mr.value) AS frozen_value,
                       MAX(mr.timestamp) AS last_ts
                FROM meter_readings mr
                WHERE mr.timestamp >= NOW() - INTERVAL '14 days'
                GROUP BY mr.meter_id
                HAVING MIN(mr.value) = MAX(mr.value) AND COUNT(*) >= 5
            )
            SELECT c.meter_id, c.frozen_value, c.last_ts, lc.last_change_ts,
                   m.name, m.display_name, m.energy_type, m.unit, m.data_source
            FROM candidates c
            JOIN meters m ON m.id = c.meter_id AND m.is_active = TRUE
            LEFT JOIN LATERAL (
                SELECT MAX(timestamp) AS last_change_ts FROM meter_readings mr2
                WHERE mr2.meter_id = c.meter_id AND mr2.value <> c.frozen_value
            ) lc ON true
        """)
        rows = (await self.db.execute(combined_q)).all()
        if not rows:
            return []

        meter_id_set = set(meter_ids) if meter_ids else None
        warnings: list[dict] = []
        now = datetime.now(timezone.utc)

        # Für Kandidaten ohne jegliche Wertänderung: MIN(timestamp) als Beginn nachladen
        no_change_ids = [r.meter_id for r in rows if r.last_change_ts is None]
        first_ts_map: dict = {}
        if no_change_ids:
            first_rows = await self.db.execute(text("""
                SELECT meter_id, MIN(timestamp) AS first_ts
                FROM meter_readings WHERE meter_id = ANY(:ids)
                GROUP BY meter_id
            """).bindparams(ids=no_change_ids))
            first_ts_map = {r.meter_id: r.first_ts for r in first_rows.all()}

        for r in rows:
            if meter_id_set and r.meter_id not in meter_id_set:
                continue
            last_ts = r.last_ts
            if (now - last_ts).days > MAX_NO_DATA_DAYS:
                continue

            last_change_ts = r.last_change_ts or first_ts_map.get(r.meter_id)
            if last_change_ts is None:
                continue

            frozen_days = (last_ts - last_change_ts).days
            threshold = AUTO_THRESHOLD_DAYS if r.data_source in auto_sources else MANUAL_THRESHOLD_DAYS
            if frozen_days < threshold:
                continue

            warnings.append({
                "warning_type": "frozen_meter",
                "meter_name": r.name,
                "meter_display_name": r.display_name,
                "meter_id": str(r.meter_id),
                "energy_type": r.energy_type,
                "frozen_since": last_change_ts.date().isoformat(),
                "frozen_days": frozen_days,
                "frozen_value": float(r.frozen_value),
                "last_reading_at": last_ts.isoformat(),
                "main_unit": r.unit,
            })

        warnings.sort(key=lambda w: w["frozen_days"], reverse=True)
        return warnings

    async def _get_submeter_warnings(
        self, start: date, end: date, meter_ids: list | None = None
    ) -> list[dict]:
        """Plausibilitätsprüfung: Hauptzähler vs. Summe Unterzähler.

        Warnt wenn die Differenz > 15 % beträgt.
        """
        ts_start = datetime.combine(start, time.min, tzinfo=timezone.utc)
        ts_end = datetime.combine(end + timedelta(days=1), time.min, tzinfo=timezone.utc)

        # Hauptzähler laden, die Unterzähler haben
        parent_q = (
            select(Meter.id, Meter.name, Meter.display_name, Meter.energy_type, Meter.unit)
            .where(
                Meter.is_active == True,  # noqa: E712
                Meter.parent_meter_id.is_(None),
                Meter.id.in_(
                    select(Meter.parent_meter_id).where(
                        Meter.parent_meter_id.isnot(None),
                        Meter.is_active == True,  # noqa: E712
                    ).distinct()
                ),
            )
        )
        if meter_ids is not None:
            parent_q = parent_q.where(Meter.id.in_(meter_ids))
        parents = (await self.db.execute(parent_q)).all()
        if not parents:
            return []

        parent_ids = [p.id for p in parents]

        # Verbrauch der Hauptzähler
        main_q = (
            select(
                MeterReading.meter_id,
                func.sum(MeterReading.consumption).label("total"),
            )
            .where(
                MeterReading.meter_id.in_(parent_ids),
                MeterReading.timestamp >= ts_start,
                MeterReading.timestamp < ts_end,
            )
            .group_by(MeterReading.meter_id)
        )
        main_result = {r.meter_id: float(r.total or 0) for r in (await self.db.execute(main_q)).all()}

        # Alle Unterzähler + deren Verbrauch
        sub_q = (
            select(
                Meter.parent_meter_id,
                func.sum(MeterReading.consumption).label("total"),
            )
            .join(MeterReading, MeterReading.meter_id == Meter.id)
            .where(
                Meter.parent_meter_id.in_(parent_ids),
                Meter.is_active == True,  # noqa: E712
                MeterReading.timestamp >= ts_start,
                MeterReading.timestamp < ts_end,
            )
            .group_by(Meter.parent_meter_id)
        )
        sub_result = {r.parent_meter_id: float(r.total or 0) for r in (await self.db.execute(sub_q)).all()}

        warnings = []
        for p in parents:
            main_val = main_result.get(p.id, 0)
            sub_sum = sub_result.get(p.id, 0)
            if main_val <= 0 or sub_sum <= 0:
                continue
            diff_pct = abs(1 - sub_sum / main_val) * 100
            if diff_pct > 15:
                warnings.append({
                    "warning_type": "sub_meter_mismatch",
                    "meter_name": p.name,
                    "meter_display_name": p.display_name,
                    "meter_id": str(p.id),
                    "energy_type": p.energy_type,
                    "main_value": round(main_val, 1),
                    "main_unit": p.unit,
                    "sub_sum": round(sub_sum, 1),
                    "diff_percent": round(diff_pct, 1),
                })

        return warnings

    async def _get_enpi_overview(self, start: date, end: date) -> list[dict]:
        """EnPI-Berechnung für alle aktiven Zähler (eine Batch-Abfrage)."""
        ts_start = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)
        ts_end = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)

        # Eine einzige Query: Verbrauch je Zähler aggregiert
        query = (
            select(
                Meter.id,
                Meter.name,
                Meter.energy_type,
                Meter.unit,
                func.sum(MeterReading.consumption).label("consumption"),
            )
            .join(MeterReading, MeterReading.meter_id == Meter.id)
            .where(
                Meter.is_active == True,  # noqa: E712
                Meter.is_feed_in != True,
                MeterReading.consumption.isnot(None),
                MeterReading.consumption > 0,
                MeterReading.timestamp >= ts_start,
                MeterReading.timestamp < ts_end,
            )
            .group_by(Meter.id, Meter.name, Meter.energy_type, Meter.unit)
            .having(func.sum(MeterReading.consumption) > 0)
            .order_by(func.sum(MeterReading.consumption).desc())
            .limit(20)
        )
        rows = (await self.db.execute(query)).all()

        return [
            {
                "meter_id": row.id,
                "meter_name": row.name,
                "energy_type": row.energy_type,
                "enpi_value": round(float(
                    (row.consumption or Decimal("0")) * CONVERSION_FACTORS.get(row.unit, Decimal("1"))
                ), 1),
                "enpi_unit": "kWh",
                "target_value": None,
                "baseline_value": None,
                "period": f"{start.isoformat()} – {end.isoformat()}",
                "status": "on_track",
            }
            for row in rows
        ]

    async def _calc_pv_metrics(self, start: date, end: date) -> dict:
        """PV-Kennzahlen: Eigenproduktion und Autarkiegrad."""
        # Einspeisezähler = PV-Produktion (is_feed_in == True)
        query = (
            select(
                Meter.unit,
                func.sum(MeterReading.consumption).label("total"),
            )
            .join(MeterReading, MeterReading.meter_id == Meter.id)
            .where(
                Meter.is_active == True,  # noqa: E712
                Meter.is_feed_in == True,  # Nur Einspeisezähler
                MeterReading.timestamp >= datetime.combine(
                    start, datetime.min.time(), tzinfo=timezone.utc
                ),
                MeterReading.timestamp < datetime.combine(
                    end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
                ),
            )
            .group_by(Meter.unit)
        )
        result = await self.db.execute(query)
        rows = result.all()

        if not rows:
            return {"has_pv": False, "production": Decimal("0"), "autarky": Decimal("0")}

        production = Decimal("0")
        for row in rows:
            conv = CONVERSION_FACTORS.get(row.unit, Decimal("1"))
            production += abs(row.total or Decimal("0")) * conv

        # Autarkiegrad = Eigenproduktion / Gesamtverbrauch × 100
        consumption = await self._total_consumption(start, end)
        if consumption > 0:
            autarky = min(production / consumption * 100, Decimal("100"))
        else:
            autarky = Decimal("0")

        return {
            "has_pv": True,
            "production": Decimal(str(round(float(production), 1))),
            "autarky": Decimal(str(round(float(autarky), 1))),
        }

    @staticmethod
    def _calc_trend(current: Decimal, previous: Decimal) -> float | None:
        if previous > 0:
            return round(float((current - previous) / previous * 100), 1)
        return None

    @staticmethod
    def _trend_dir(trend: float | None) -> str | None:
        if trend is None:
            return None
        if trend > 0:
            return "up"
        if trend < 0:
            return "down"
        return "stable"
