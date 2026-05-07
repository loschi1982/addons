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

from app.models.emission import CO2Calculation, EmissionFactor
from app.models.meter import Meter
from app.models.reading import MeterReading

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

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _meter_ids_for_site(self, site_id: uuid.UUID) -> list[uuid.UUID]:
        """Alle aktiven Zähler-IDs für einen Standort."""
        result = await self.db.execute(
            select(Meter.id).where(
                Meter.site_id == site_id,
                Meter.is_active == True,  # noqa: E712
            )
        )
        return [row[0] for row in result.all()]

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

        # Standort-Filter: Zähler-IDs vorab auflösen
        meter_ids: list[uuid.UUID] | None = None
        if site_id:
            meter_ids = await self._meter_ids_for_site(site_id)

        # Vorjahreszeitraum für Trends
        prev_start = date(period_start.year - 1, period_start.month, period_start.day)
        prev_end = date(period_end.year - 1, period_end.month, period_end.day)

        try:
            kpi_cards = await self._build_kpi_cards(period_start, period_end, prev_start, prev_end, meter_ids)
        except Exception as e:
            logger.error("dashboard_kpi_error", error=str(e))
            kpi_cards = []

        try:
            breakdown = await self._get_energy_breakdown(period_start, period_end, meter_ids)
        except Exception as e:
            logger.error("dashboard_breakdown_error", error=str(e))
            breakdown = []

        try:
            chart = await self._get_consumption_chart(period_start, period_end, granularity, meter_ids)
        except Exception as e:
            logger.error("dashboard_chart_error", error=str(e))
            chart = []

        try:
            top_consumers = await self._get_top_consumers(period_start, period_end, meter_ids)
        except Exception as e:
            logger.error("dashboard_top_consumers_error", error=str(e))
            top_consumers = []

        try:
            alerts = await self._get_alerts()
        except Exception as e:
            logger.error("dashboard_alerts_error", error=str(e))
            alerts = []

        try:
            enpi = await self._get_enpi_overview(period_start, period_end)
        except Exception as e:
            logger.error("dashboard_enpi_error", error=str(e))
            enpi = []

        return {
            "period_start": period_start,
            "period_end": period_end,
            "kpi_cards": kpi_cards,
            "energy_breakdown": breakdown,
            "consumption_chart": chart,
            "top_consumers": top_consumers,
            "alerts": alerts,
            "enpi_overview": enpi,
        }

    async def _consumption_by_energy_type(
        self, start: date, end: date, meter_ids: list | None = None
    ) -> list[dict]:
        """Verbrauch je Energietyp in nativer Einheit.

        Konsistent mit _get_consumption_chart: KEIN parent_meter_id-Filter,
        da bei einigen Energieträgern (z.B. Fernwärme) nur Unterzähler
        Messwerte haben.
        """
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
            if et not in groups:
                groups[et] = {"value": Decimal("0"), "unit": row.unit}
            # Wenn gleiche Einheit → addieren; sonst in kWh umrechnen
            if groups[et]["unit"] == row.unit:
                groups[et]["value"] += val
            else:
                conv = CONVERSION_FACTORS.get(row.unit, Decimal("1"))
                groups[et]["value"] += val * conv
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
    ) -> list[dict]:
        """KPI-Karten berechnen – pro Energietyp statt Gesamtverbrauch."""
        cards = []

        # 1. Verbrauch je Energietyp (statt einer Gesamtsumme)
        current_by_type = await self._consumption_by_energy_type(start, end, meter_ids)
        prev_by_type = await self._consumption_by_energy_type(prev_start, prev_end, meter_ids)
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
        co2 = await self._total_co2(start, end, meter_ids)
        prev_co2 = await self._total_co2(prev_start, prev_end, meter_ids)
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
        cost = await self._total_cost(start, end, meter_ids)
        prev_cost = await self._total_cost(prev_start, prev_end, meter_ids)
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

    async def _total_consumption(self, start: date, end: date, meter_ids: list | None = None) -> Decimal:
        """Gesamtverbrauch in kWh."""
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
            total += (row.total or Decimal("0")) * conv
        return Decimal(str(round(float(total), 1)))

    async def _total_co2(self, start: date, end: date, meter_ids: list | None = None) -> Decimal:
        """Gesamt-CO₂ in kg – aus vorberechneten Daten oder Echtzeit-Schätzung."""
        co2_query = select(func.sum(CO2Calculation.co2_kg)).where(
            CO2Calculation.period_start >= start,
            CO2Calculation.period_end <= end,
        )
        result = await self.db.execute(co2_query)
        co2_kg = result.scalar() or Decimal("0")
        if co2_kg > 0:
            return Decimal(str(round(float(co2_kg), 1)))

        # Fallback: Schätzung aus Verbrauchsdaten × Emissionsfaktoren
        try:
            # Verbrauch je Energietyp laden
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
            # Neuesten Emissionsfaktor je Energietyp laden (nach Jahr/Monat, nicht max-Wert)
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
            total = Decimal("0")
            for row in cons_result.all():
                consumption = row.consumption or Decimal("0")
                conv = CONVERSION_FACTORS.get(row.unit, Decimal("1"))
                kwh = consumption * conv
                factor = factors.get(row.energy_type, Decimal("0"))
                total += kwh * factor / Decimal("1000")
            return Decimal(str(round(float(total), 1)))
        except Exception:
            return Decimal("0")

    async def _total_cost(self, start: date, end: date, meter_ids: list | None = None) -> Decimal:
        """Geschätzte Gesamtkosten aus Tarif-Informationen (einzelne Batch-Abfrage)."""
        # Alle aktiven Hauptzähler mit Tarif in einer Abfrage laden
        meters_q = select(Meter).where(
            Meter.is_active == True,  # noqa: E712
            Meter.is_feed_in != True,
            Meter.tariff_info.isnot(None),
        )
        if meter_ids is not None:
            meters_q = meters_q.where(Meter.id.in_(meter_ids))
        meters_result = await self.db.execute(meters_q)
        meters = list(meters_result.scalars().all())
        if not meters:
            return Decimal("0")

        # Zähler mit positivem Tarif filtern (kein DB-Roundtrip mehr pro Zähler)
        priced_meters = [
            m for m in meters
            if Decimal(str((m.tariff_info or {}).get("price_per_kwh", 0))) > 0
        ]
        if not priced_meters:
            return Decimal("0")

        meter_id_list = [m.id for m in priced_meters]
        start_ts = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)
        end_ts = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)

        # Verbrauch aller Zähler in einer einzigen GROUP-BY-Abfrage
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

        consumption_by_meter = {row.meter_id: row.total_consumption or Decimal("0") for row in rows}
        meter_lookup = {m.id: m for m in priced_meters}

        total_cost = Decimal("0")
        for meter_id, consumption in consumption_by_meter.items():
            meter = meter_lookup[meter_id]
            price_per_kwh = Decimal(str((meter.tariff_info or {}).get("price_per_kwh", 0)))
            conv = CONVERSION_FACTORS.get(meter.unit, Decimal("1"))
            total_cost += consumption * conv * price_per_kwh

        return Decimal(str(round(float(total_cost), 2)))

    async def _active_meter_count(self) -> int:
        result = await self.db.execute(
            select(func.count(Meter.id)).where(Meter.is_active == True)  # noqa: E712
        )
        return result.scalar() or 0

    async def _get_energy_breakdown(self, start: date, end: date, meter_ids: list | None = None) -> list[dict]:
        """Verbrauch nach Energietyp aufschlüsseln (mit Originaleinheiten, Kosten, CO₂)."""
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

        if not rows:
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

        # Schritt 4: Pro Energietyp aggregieren
        groups: dict[str, dict] = {}
        for row in rows:
            raw = row.consumption or Decimal("0")
            conv = CONVERSION_FACTORS.get(row.unit, Decimal("1"))
            kwh = raw * conv
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
                groups[row.energy_type]["original_value"] += raw
            # Kosten aus Tarif berechnen
            tariff = tariffs.get(row.id, {})
            price = tariff.get("price_per_kwh")
            if price:
                groups[row.energy_type]["cost_eur"] += kwh * Decimal(str(price))
            # CO₂ schätzen
            factor = factors.get(row.energy_type, Decimal("0"))
            groups[row.energy_type]["co2_kg"] += kwh * factor / Decimal("1000")

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

    async def _get_top_consumers(self, start: date, end: date, meter_ids: list | None = None) -> list[dict]:
        """Top-3 Verbraucher je Energietyp (native Einheiten)."""
        ts_start = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)
        ts_end = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)

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
            .order_by(func.sum(MeterReading.consumption).desc().nullslast())
        )
        if meter_ids is not None:
            query = query.where(Meter.id.in_(meter_ids))
        result = await self.db.execute(query)

        # Nach Energietyp gruppieren, Top-3 je Typ
        groups: dict[str, list[dict]] = {}
        for row in result.all():
            et = row.energy_type
            if et not in groups:
                groups[et] = []
            if len(groups[et]) < 3:
                groups[et].append({
                    "meter_id": str(row.id),
                    "name": row.name,
                    "energy_type": et,
                    "consumption": round(float(row.consumption or 0), 1),
                    "unit": row.unit,
                    "consumption_kwh": round(float(
                        (row.consumption or Decimal("0")) * CONVERSION_FACTORS.get(row.unit, Decimal("1"))
                    ), 1),
                })

        return [
            {
                "energy_type": et,
                "energy_type_label": ENERGY_TYPE_LABELS.get(et, et),
                "meters": meters,
            }
            for et, meters in sorted(groups.items(), key=lambda x: x[0])
        ]

    async def _get_alerts(self) -> list[dict]:
        """Aktive Warnungen (Zähler ohne aktuelle Daten) – eine aggregierte Abfrage."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=7)

        # Eine einzige Abfrage: letzter Messwert je Zähler
        subq = (
            select(
                MeterReading.meter_id,
                func.max(MeterReading.timestamp).label("last_ts"),
            )
            .where(MeterReading.timestamp >= datetime.now(timezone.utc) - timedelta(days=30))
            .group_by(MeterReading.meter_id)
            .subquery()
        )
        result = await self.db.execute(
            select(Meter.id, Meter.name, subq.c.last_ts)
            .outerjoin(subq, Meter.id == subq.c.meter_id)
            .where(Meter.is_active == True)  # noqa: E712
        )
        alerts = []
        for row in result.all():
            last_ts = row.last_ts
            if last_ts and last_ts.tzinfo is None:
                last_ts = last_ts.replace(tzinfo=timezone.utc)
            if not last_ts or last_ts < cutoff:
                alerts.append({
                    "type": "no_data",
                    "severity": "warnung",
                    "message": f"Zähler '{row.name}' hat seit >7 Tagen keine Daten",
                    "meter_id": str(row.id),
                })

        return alerts[:10]

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

    async def _get_enpi_overview(self, start: date, end: date) -> list[dict]:
        """EnPI-Berechnung für alle Hauptzähler."""
        meters_result = await self.db.execute(
            select(Meter).where(
                Meter.is_active == True,  # noqa: E712
                Meter.is_feed_in != True,  # Einspeisezähler ausschließen
                Meter.parent_meter_id.is_(None),
            )
        )
        meters = list(meters_result.scalars().all())

        result = []
        for meter in meters:
            consumption_result = await self.db.execute(
                select(func.sum(MeterReading.consumption)).where(
                    MeterReading.meter_id == meter.id,
                    MeterReading.timestamp >= datetime.combine(
                        start, datetime.min.time(), tzinfo=timezone.utc
                    ),
                    MeterReading.timestamp < datetime.combine(
                        end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
                    ),
                )
            )
            raw_consumption = consumption_result.scalar() or Decimal("0")
            conv = CONVERSION_FACTORS.get(meter.unit, Decimal("1"))
            kwh = raw_consumption * conv

            result.append({
                "meter_id": meter.id,
                "meter_name": meter.name,
                "energy_type": meter.energy_type,
                "enpi_value": kwh,
                "enpi_unit": "kWh",
                "target_value": None,
                "baseline_value": None,
                "period": f"{start.isoformat()} – {end.isoformat()}",
                "status": "on_track",
            })

        return result

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
