"""
analytics_service.py – Analysen und Visualisierungsdaten.

Stellt aggregierte Daten für Charts, Heatmaps, Sankey-Diagramme,
Zeitreihenvergleiche und Anomalie-Erkennung bereit.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import structlog
from sqlalchemy import and_, case, extract, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.cache import cached
from app.models.consumer import Consumer, meter_consumer
from app.models.emission import CO2Calculation, EmissionFactor
from app.models.meter import Meter
from app.models.reading import MeterReading
from app.models.site import Building, Site, UsageUnit

logger = structlog.get_logger()

# Brennwert-Umrechnungsfaktoren nach kWh
CONVERSION_FACTORS: dict[str, Decimal] = {
    "m³": Decimal("10.3"),
    "l": Decimal("9.8"),
    "kg": Decimal("4.8"),
    "MWh": Decimal("1000"),
    "kWh": Decimal("1"),
}

MONTH_LABELS = [
    "Jan", "Feb", "Mär", "Apr", "Mai", "Jun",
    "Jul", "Aug", "Sep", "Okt", "Nov", "Dez",
]


class AnalyticsService:
    """Service für Analyse- und Visualisierungsdaten."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ── Zeitreihen ──

    async def get_timeseries(
        self,
        meter_ids: list[uuid.UUID] | None = None,
        energy_type: str | None = None,
        start_date: date | None = None,
        end_date: date | None = None,
        granularity: str = "daily",
    ) -> list[dict]:
        """
        Zeitreihendaten für ein oder mehrere Zähler.

        Granularity: hourly, daily, weekly, monthly, yearly
        """
        # Zähler ermitteln
        meter_query = select(Meter).where(Meter.is_active == True)  # noqa: E712
        if meter_ids:
            meter_query = meter_query.where(Meter.id.in_(meter_ids))
        if energy_type:
            meter_query = meter_query.where(Meter.energy_type == energy_type)
        meters_result = await self.db.execute(meter_query)
        meters = list(meters_result.scalars().all())

        if not meters:
            return []

        # Zeittrunkierung je Granularität
        trunc_map = {
            "hourly": "hour",
            "daily": "day",
            "weekly": "week",
            "monthly": "month",
            "yearly": "year",
        }
        trunc = trunc_map.get(granularity, "day")

        series = []
        for meter in meters:
            query = (
                select(
                    func.date_trunc(trunc, MeterReading.timestamp).label("period"),
                    func.sum(MeterReading.consumption).label("consumption"),
                    func.count().label("count"),
                )
                .where(MeterReading.meter_id == meter.id)
                .group_by(text("period"))
                .order_by(text("period"))
            )
            if start_date:
                query = query.where(
                    MeterReading.timestamp >= datetime.combine(
                        start_date, datetime.min.time(), tzinfo=timezone.utc
                    )
                )
            if end_date:
                query = query.where(
                    MeterReading.timestamp < datetime.combine(
                        end_date, datetime.min.time(), tzinfo=timezone.utc
                    )
                )

            result = await self.db.execute(query)
            rows = result.all()

            conv = CONVERSION_FACTORS.get(meter.unit, Decimal("1"))
            data_points = []
            for row in rows:
                consumption = (row.consumption or Decimal("0")) * conv
                data_points.append({
                    "timestamp": row.period.isoformat() if row.period else None,
                    "value": float(consumption),
                    "count": row.count,
                })

            series.append({
                "meter_id": str(meter.id),
                "meter_name": meter.name,
                "energy_type": meter.energy_type,
                "unit": "kWh",
                "data": data_points,
            })

        return series

    # ── Vergleich ──

    async def get_comparison(
        self,
        meter_ids: list[uuid.UUID],
        period1_start: date,
        period1_end: date,
        period2_start: date,
        period2_end: date,
        granularity: str = "monthly",
    ) -> dict:
        """Zwei Zeiträume vergleichen (z.B. Jahr-zu-Jahr)."""
        async def _aggregate(start: date, end: date) -> dict[str, list]:
            result = {}
            for mid in meter_ids:
                meter = await self.db.get(Meter, mid)
                if not meter:
                    continue
                trunc = "month" if granularity == "monthly" else "day"
                query = (
                    select(
                        func.date_trunc(trunc, MeterReading.timestamp).label("period"),
                        func.sum(MeterReading.consumption).label("consumption"),
                    )
                    .where(
                        MeterReading.meter_id == mid,
                        MeterReading.timestamp >= datetime.combine(
                            start, datetime.min.time(), tzinfo=timezone.utc
                        ),
                        MeterReading.timestamp < datetime.combine(
                            end, datetime.min.time(), tzinfo=timezone.utc
                        ),
                    )
                    .group_by(text("period"))
                    .order_by(text("period"))
                )
                rows = (await self.db.execute(query)).all()
                conv = CONVERSION_FACTORS.get(meter.unit, Decimal("1"))
                result[str(mid)] = [
                    {
                        "period": r.period.isoformat() if r.period else None,
                        "value": float((r.consumption or Decimal("0")) * conv),
                    }
                    for r in rows
                ]
            return result

        period1 = await _aggregate(period1_start, period1_end)
        period2 = await _aggregate(period2_start, period2_end)

        return {
            "period1": {
                "start": period1_start.isoformat(),
                "end": period1_end.isoformat(),
                "data": period1,
            },
            "period2": {
                "start": period2_start.isoformat(),
                "end": period2_end.isoformat(),
                "data": period2,
            },
        }

    # ── Verteilung (Pie/Donut) ──

    async def get_distribution(
        self,
        start_date: date,
        end_date: date,
        group_by: str = "energy_type",
    ) -> list[dict]:
        """Verbrauchsverteilung nach Energietyp, Standort oder Kostenstelle."""
        group_col = {
            "energy_type": Meter.energy_type,
            "location": Meter.location,
            "cost_center": Meter.cost_center,
        }.get(group_by, Meter.energy_type)

        query = (
            select(
                group_col.label("group"),
                Meter.unit,
                func.sum(MeterReading.consumption).label("consumption"),
            )
            .join(MeterReading, MeterReading.meter_id == Meter.id)
            .where(
                Meter.is_active == True,  # noqa: E712
                MeterReading.timestamp >= datetime.combine(
                    start_date, datetime.min.time(), tzinfo=timezone.utc
                ),
                MeterReading.timestamp < datetime.combine(
                    end_date, datetime.min.time(), tzinfo=timezone.utc
                ),
            )
            .group_by(group_col, Meter.unit)
        )
        result = await self.db.execute(query)
        rows = result.all()

        # In kWh umrechnen und pro Gruppe summieren
        groups: dict[str, float] = {}
        for row in rows:
            label = row.group or "Unbekannt"
            conv = CONVERSION_FACTORS.get(row.unit, Decimal("1"))
            kwh = float((row.consumption or Decimal("0")) * conv)
            groups[label] = groups.get(label, 0) + kwh

        total = sum(groups.values())
        return [
            {
                "label": label,
                "value": value,
                "share_percent": round(value / total * 100, 1) if total > 0 else 0,
            }
            for label, value in sorted(groups.items(), key=lambda x: -x[1])
        ]

    # ── Heatmap (Wochentag × Stunde) ──

    async def get_heatmap(
        self,
        meter_id: uuid.UUID,
        start_date: date | None = None,
        end_date: date | None = None,
    ) -> list[dict]:
        """
        Verbrauchs-Heatmap: Stunde × Wochentag.

        Gibt 7×24 = 168 Datenpunkte zurück.
        """
        query = (
            select(
                extract("dow", MeterReading.timestamp).label("weekday"),
                extract("hour", MeterReading.timestamp).label("hour"),
                func.avg(MeterReading.consumption).label("avg_consumption"),
                func.count().label("count"),
            )
            .where(MeterReading.meter_id == meter_id)
            .group_by(text("weekday"), text("hour"))
            .order_by(text("weekday"), text("hour"))
        )
        if start_date:
            query = query.where(
                MeterReading.timestamp >= datetime.combine(
                    start_date, datetime.min.time(), tzinfo=timezone.utc
                )
            )
        if end_date:
            query = query.where(
                MeterReading.timestamp < datetime.combine(
                    end_date, datetime.min.time(), tzinfo=timezone.utc
                )
            )

        result = await self.db.execute(query)
        rows = result.all()

        weekday_labels = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]
        return [
            {
                "weekday": int(row.weekday),
                "weekday_label": weekday_labels[int(row.weekday)],
                "hour": int(row.hour),
                "value": float(row.avg_consumption or 0),
                "count": row.count,
            }
            for row in rows
        ]

    # ── Sankey-Diagramm ──

    async def get_sankey(
        self,
        start_date: date,
        end_date: date,
    ) -> dict:
        """
        Sankey-Daten: Energiefluss von Hauptzählern → Unterzähler → Verbraucher.

        Generiert Knoten (nodes) und Verbindungen (links).
        """
        # Alle aktiven Zähler mit Hierarchie laden
        meters_result = await self.db.execute(
            select(Meter)
            .where(Meter.is_active == True)  # noqa: E712
            .options(selectinload(Meter.consumers))
        )
        meters = list(meters_result.scalars().all())

        # Verbrauch pro Zähler im Zeitraum
        consumption_map: dict[uuid.UUID, float] = {}
        for meter in meters:
            result = await self.db.execute(
                select(func.sum(MeterReading.consumption)).where(
                    MeterReading.meter_id == meter.id,
                    MeterReading.timestamp >= datetime.combine(
                        start_date, datetime.min.time(), tzinfo=timezone.utc
                    ),
                    MeterReading.timestamp < datetime.combine(
                        end_date, datetime.min.time(), tzinfo=timezone.utc
                    ),
                )
            )
            raw = result.scalar() or Decimal("0")
            conv = CONVERSION_FACTORS.get(meter.unit, Decimal("1"))
            consumption_map[meter.id] = float(raw * conv)

        # Knoten und Links aufbauen
        nodes = []
        links = []
        node_ids: dict[str, int] = {}

        def get_node_idx(node_id: str, label: str, node_type: str) -> int:
            if node_id not in node_ids:
                node_ids[node_id] = len(nodes)
                nodes.append({
                    "id": node_id,
                    "label": label,
                    "type": node_type,
                })
            return node_ids[node_id]

        for meter in meters:
            mid = str(meter.id)
            node_type = "hauptzaehler" if not meter.parent_meter_id else "unterzaehler"
            get_node_idx(mid, meter.name, node_type)

            # Verbindung: Hauptzähler → Unterzähler
            if meter.parent_meter_id:
                parent_id = str(meter.parent_meter_id)
                # Sicherstellen, dass der Elternknoten existiert
                parent = next((m for m in meters if m.id == meter.parent_meter_id), None)
                if parent:
                    get_node_idx(parent_id, parent.name, "hauptzaehler")
                    value = consumption_map.get(meter.id, 0)
                    if value > 0:
                        links.append({
                            "source": node_ids[parent_id],
                            "target": node_ids[mid],
                            "value": value,
                        })

            # Verbindung: Zähler → Verbraucher
            if meter.consumers:
                per_consumer = consumption_map.get(meter.id, 0) / max(len(meter.consumers), 1)
                for consumer in meter.consumers:
                    cid = f"consumer_{consumer.id}"
                    get_node_idx(cid, consumer.name, "verbraucher")
                    if per_consumer > 0:
                        links.append({
                            "source": node_ids[mid],
                            "target": node_ids[cid],
                            "value": per_consumer,
                        })

        # Hauptzähler ohne Eltern: "Energiequelle" als Wurzel
        root_meters = [m for m in meters if not m.parent_meter_id]
        if root_meters:
            for rm in root_meters:
                source_label = f"Bezug {rm.energy_type}"
                source_id = f"source_{rm.energy_type}"
                src_idx = get_node_idx(source_id, source_label, "quelle")
                value = consumption_map.get(rm.id, 0)
                if value > 0:
                    links.append({
                        "source": src_idx,
                        "target": node_ids[str(rm.id)],
                        "value": value,
                    })

        return {"nodes": nodes, "links": links}

    # ── Witterungskorrektur-Vergleich ──

    async def get_weather_corrected(
        self,
        meter_id: uuid.UUID,
        start_date: date,
        end_date: date,
    ) -> dict:
        """Rohverbrauch vs. witterungskorrigierter Verbrauch."""
        from app.models.correction import WeatherCorrectedConsumption

        # Rohverbrauch (monatlich)
        raw_query = (
            select(
                func.date_trunc("month", MeterReading.timestamp).label("period"),
                func.sum(MeterReading.consumption).label("consumption"),
            )
            .where(
                MeterReading.meter_id == meter_id,
                MeterReading.timestamp >= datetime.combine(
                    start_date, datetime.min.time(), tzinfo=timezone.utc
                ),
                MeterReading.timestamp < datetime.combine(
                    end_date, datetime.min.time(), tzinfo=timezone.utc
                ),
            )
            .group_by(text("period"))
            .order_by(text("period"))
        )
        raw_result = await self.db.execute(raw_query)
        raw_rows = raw_result.all()

        meter = await self.db.get(Meter, meter_id)
        conv = CONVERSION_FACTORS.get(meter.unit, Decimal("1")) if meter else Decimal("1")

        raw_data = [
            {
                "period": r.period.isoformat() if r.period else None,
                "value": float((r.consumption or Decimal("0")) * conv),
            }
            for r in raw_rows
        ]

        # Witterungskorrigierte Daten
        corr_query = (
            select(WeatherCorrectedConsumption)
            .where(
                WeatherCorrectedConsumption.meter_id == meter_id,
                WeatherCorrectedConsumption.period_start >= start_date,
                WeatherCorrectedConsumption.period_end <= end_date,
            )
            .order_by(WeatherCorrectedConsumption.period_start)
        )
        corr_result = await self.db.execute(corr_query)
        corr_rows = list(corr_result.scalars().all())

        corrected_data = [
            {
                "period": r.period_start.isoformat(),
                "value": float(r.corrected_consumption),
            }
            for r in corr_rows
        ]

        return {
            "meter_id": str(meter_id),
            "meter_name": meter.name if meter else "",
            "raw": raw_data,
            "corrected": corrected_data,
        }

    # ── CO₂-Reduktionspfad ──

    async def get_co2_reduction_path(
        self,
        target_year: int = 2030,
        target_reduction_percent: float = 55.0,
    ) -> dict:
        """CO₂-Reduktionspfad: Ist-Werte und linearer Ziel-Pfad."""
        # Jährliche CO₂-Emissionen
        yearly_query = (
            select(
                extract("year", CO2Calculation.period_start).label("year"),
                func.sum(CO2Calculation.co2_kg).label("co2_kg"),
            )
            .group_by(text("year"))
            .order_by(text("year"))
        )
        result = await self.db.execute(yearly_query)
        rows = result.all()

        actual = [
            {"year": int(r.year), "co2_kg": float(r.co2_kg or 0)}
            for r in rows
        ]

        # Ziel-Pfad berechnen (linear von Basisjahr bis Zieljahr)
        target_path = []
        if actual:
            base_year = actual[0]["year"]
            base_co2 = actual[0]["co2_kg"]
            target_co2 = base_co2 * (1 - target_reduction_percent / 100)
            years_span = target_year - base_year
            if years_span > 0:
                annual_reduction = (base_co2 - target_co2) / years_span
                for y in range(base_year, target_year + 1):
                    target_path.append({
                        "year": y,
                        "co2_kg": base_co2 - annual_reduction * (y - base_year),
                    })

        return {
            "actual": actual,
            "target_path": target_path,
            "target_year": target_year,
            "target_reduction_percent": target_reduction_percent,
        }

    # ── Benchmarks ──

    # Referenzwerte nach VDI 3807 / DIN V 18599 (kWh/m²·a)
    # Schlüssel: (building_type, energy_type) → (gut, mittel, schlecht)
    REFERENCE_VALUES: dict[tuple[str, str], tuple[float, float, float]] = {
        ("office", "electricity"): (30, 55, 90),
        ("office", "gas"): (40, 80, 130),
        ("office", "district_heating"): (40, 75, 120),
        ("school", "electricity"): (15, 30, 55),
        ("school", "gas"): (50, 90, 150),
        ("residential", "electricity"): (20, 40, 65),
        ("residential", "gas"): (60, 110, 170),
        ("retail", "electricity"): (40, 80, 140),
        ("retail", "gas"): (30, 60, 100),
        ("hospital", "electricity"): (60, 110, 180),
        ("hospital", "gas"): (80, 140, 220),
        ("warehouse", "electricity"): (15, 30, 55),
        ("warehouse", "gas"): (25, 50, 90),
        ("production", "electricity"): (40, 90, 160),
        ("production", "gas"): (50, 100, 180),
    }

    @cached("benchmarks", ttl=600)
    async def get_benchmarks(
        self,
        year: int | None = None,
    ) -> dict:
        """
        Erweiterte EnPI-Benchmarks: kWh/m², kWh/Mitarbeiter,
        Vergleich mit VDI 3807 Referenzwerten, Aggregation pro Gebäude.
        """
        if not year:
            year = date.today().year

        start = date(year, 1, 1)
        end = date(year, 12, 31)
        ts_start = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)
        ts_end = datetime.combine(end, datetime.min.time(), tzinfo=timezone.utc)

        # Verbrauch pro Zähler mit Gebäude-/Flächen-Daten
        query = (
            select(
                Meter.id.label("meter_id"),
                Meter.name.label("meter_name"),
                Meter.energy_type,
                Meter.unit,
                func.sum(MeterReading.consumption).label("consumption"),
                UsageUnit.id.label("unit_id"),
                UsageUnit.name.label("unit_name"),
                UsageUnit.area_m2,
                UsageUnit.occupants,
                UsageUnit.target_enpi_kwh_per_m2,
                Building.id.label("building_id"),
                Building.name.label("building_name"),
                Building.building_type,
                Building.gross_floor_area_m2,
                Building.net_floor_area_m2,
                Site.id.label("site_id"),
                Site.name.label("site_name"),
            )
            .join(MeterReading, MeterReading.meter_id == Meter.id)
            .outerjoin(UsageUnit, UsageUnit.id == Meter.usage_unit_id)
            .outerjoin(Building, Building.id == UsageUnit.building_id)
            .outerjoin(Site, Site.id == Building.site_id)
            .where(
                Meter.is_active == True,  # noqa: E712
                MeterReading.timestamp >= ts_start,
                MeterReading.timestamp < ts_end,
            )
            .group_by(
                Meter.id, Meter.name, Meter.energy_type, Meter.unit,
                UsageUnit.id, UsageUnit.name, UsageUnit.area_m2,
                UsageUnit.occupants, UsageUnit.target_enpi_kwh_per_m2,
                Building.id, Building.name, Building.building_type,
                Building.gross_floor_area_m2, Building.net_floor_area_m2,
                Site.id, Site.name,
            )
            .order_by(func.sum(MeterReading.consumption).desc())
        )
        result = await self.db.execute(query)
        rows = result.all()

        # Pro-Zähler-Benchmarks
        meter_benchmarks = []
        # Aggregation pro Gebäude
        building_data: dict[str, dict] = {}

        for row in rows:
            conv = CONVERSION_FACTORS.get(row.unit, Decimal("1"))
            kwh = float((row.consumption or Decimal("0")) * conv)

            area = float(row.area_m2) if row.area_m2 else None
            occupants = row.occupants
            kwh_per_m2 = round(kwh / area, 2) if area and area > 0 else None
            kwh_per_person = (
                round(kwh / occupants, 2) if occupants and occupants > 0 else None
            )

            # Referenzwert-Vergleich
            ref = None
            rating = None
            btype = row.building_type or ""
            ref_key = (btype.lower(), row.energy_type)
            if ref_key in self.REFERENCE_VALUES and kwh_per_m2 is not None:
                good, medium, poor = self.REFERENCE_VALUES[ref_key]
                ref = {"good": good, "medium": medium, "poor": poor}
                if kwh_per_m2 <= good:
                    rating = "good"
                elif kwh_per_m2 <= medium:
                    rating = "medium"
                else:
                    rating = "poor"

            # Zielwert-Vergleich
            target = float(row.target_enpi_kwh_per_m2) if row.target_enpi_kwh_per_m2 else None
            target_deviation = None
            if target and kwh_per_m2 is not None:
                target_deviation = round(
                    ((kwh_per_m2 - target) / target) * 100, 1
                )

            entry = {
                "meter_id": str(row.meter_id),
                "meter_name": row.meter_name,
                "energy_type": row.energy_type,
                "consumption_kwh": kwh,
                "area_m2": area,
                "occupants": occupants,
                "kwh_per_m2": kwh_per_m2,
                "kwh_per_person": kwh_per_person,
                "target_kwh_per_m2": target,
                "target_deviation_percent": target_deviation,
                "reference_values": ref,
                "rating": rating,
                "building_id": str(row.building_id) if row.building_id else None,
                "building_name": row.building_name,
                "building_type": row.building_type,
                "site_id": str(row.site_id) if row.site_id else None,
                "site_name": row.site_name,
                "year": year,
            }
            meter_benchmarks.append(entry)

            # Gebäude-Aggregation
            if row.building_id:
                bid = str(row.building_id)
                if bid not in building_data:
                    b_area = (
                        float(row.net_floor_area_m2 or row.gross_floor_area_m2 or 0)
                    )
                    building_data[bid] = {
                        "building_id": bid,
                        "building_name": row.building_name,
                        "building_type": row.building_type,
                        "site_name": row.site_name,
                        "area_m2": b_area if b_area > 0 else None,
                        "by_energy_type": {},
                    }
                et = row.energy_type
                if et not in building_data[bid]["by_energy_type"]:
                    building_data[bid]["by_energy_type"][et] = 0.0
                building_data[bid]["by_energy_type"][et] += kwh

        # Gebäude-EnPIs berechnen
        building_benchmarks = []
        for bd in building_data.values():
            b_area = bd["area_m2"]
            b_entry = {
                "building_id": bd["building_id"],
                "building_name": bd["building_name"],
                "building_type": bd["building_type"],
                "site_name": bd["site_name"],
                "area_m2": b_area,
                "energy_types": [],
                "year": year,
            }
            for et, kwh_total in bd["by_energy_type"].items():
                kwh_m2 = round(kwh_total / b_area, 2) if b_area else None
                ref = None
                rating = None
                ref_key = (
                    (bd["building_type"] or "").lower(), et
                )
                if ref_key in self.REFERENCE_VALUES and kwh_m2 is not None:
                    good, medium, poor = self.REFERENCE_VALUES[ref_key]
                    ref = {"good": good, "medium": medium, "poor": poor}
                    if kwh_m2 <= good:
                        rating = "good"
                    elif kwh_m2 <= medium:
                        rating = "medium"
                    else:
                        rating = "poor"
                b_entry["energy_types"].append({
                    "energy_type": et,
                    "consumption_kwh": round(kwh_total, 2),
                    "kwh_per_m2": kwh_m2,
                    "reference_values": ref,
                    "rating": rating,
                })
            building_benchmarks.append(b_entry)

        return {
            "year": year,
            "meters": meter_benchmarks,
            "buildings": building_benchmarks,
        }

    # ── Anomalie-Erkennung ──

    async def get_anomalies(
        self,
        threshold: float = 2.0,
        days: int = 30,
    ) -> list[dict]:
        """
        Einfache Anomalie-Erkennung: Tagesverbrauch > threshold × Durchschnitt.

        Prüft die letzten `days` Tage.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)

        meters_result = await self.db.execute(
            select(Meter).where(Meter.is_active == True)  # noqa: E712
        )
        meters = list(meters_result.scalars().all())

        anomalies = []
        for meter in meters:
            # Durchschnittsverbrauch pro Tag
            avg_query = (
                select(
                    func.avg(MeterReading.consumption).label("avg_consumption"),
                    func.stddev(MeterReading.consumption).label("std_consumption"),
                )
                .where(
                    MeterReading.meter_id == meter.id,
                    MeterReading.timestamp >= cutoff,
                    MeterReading.consumption.isnot(None),
                    MeterReading.consumption > 0,
                )
            )
            avg_result = await self.db.execute(avg_query)
            stats = avg_result.one()

            if not stats.avg_consumption or not stats.std_consumption:
                continue

            avg = float(stats.avg_consumption)
            std = float(stats.std_consumption)

            if std == 0:
                continue

            # Ausreißer finden
            anomaly_query = (
                select(MeterReading)
                .where(
                    MeterReading.meter_id == meter.id,
                    MeterReading.timestamp >= cutoff,
                    MeterReading.consumption.isnot(None),
                    MeterReading.consumption > Decimal(str(avg + threshold * std)),
                )
                .order_by(MeterReading.timestamp.desc())
                .limit(5)
            )
            anomaly_result = await self.db.execute(anomaly_query)
            outliers = list(anomaly_result.scalars().all())

            for reading in outliers:
                deviation = float(reading.consumption - Decimal(str(avg))) / std if std > 0 else 0
                anomalies.append({
                    "meter_id": str(meter.id),
                    "meter_name": meter.name,
                    "timestamp": reading.timestamp.isoformat(),
                    "value": float(reading.consumption),
                    "avg_value": avg,
                    "deviation_sigma": round(deviation, 1),
                    "severity": "hoch" if deviation > 3 else "mittel",
                })

        return sorted(anomalies, key=lambda x: -x["deviation_sigma"])
