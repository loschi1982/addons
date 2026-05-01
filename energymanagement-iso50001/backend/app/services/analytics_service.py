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
from app.models.allocation import MeterUnitAllocation
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

    @staticmethod
    def _meter_label(meter: "Meter") -> str:  # type: ignore[name-defined]
        """Anzeigename: Klarname (location) → display_name → technischer Name."""
        return (meter.location or "").strip() or (meter.display_name or "").strip() or meter.name

    # ── Einfrierungs-Erkennung ──

    @staticmethod
    async def _find_frozen_accumulations(
        db: AsyncSession,
        meter_id: uuid.UUID,
        start: datetime,
        end: datetime,
    ) -> list[dict]:
        """
        Findet Messwerte nach eingefrorenen Perioden (gleicher Zählerstand über ≥2 Intervalle).

        Gibt zurück: [{timestamp, frozen_from, frozen_hours, consumption}]
        – timestamp:    Zeitpunkt des Spike (Wertewechsel nach Einfrierung)
        – frozen_from:  Letzter Messwert mit anderem Zählerstand (Einfrierungsbeginn)
        – frozen_hours: Akkumulierungsdauer in Stunden
        – consumption:  Akkumulierter Verbrauch (kWh / m³ / …)
        """
        # Schritt 1: Spike-Ereignisse erkennen – Wert ändert sich nach 2+ identischen Ablesungen
        spike_sql = text("""
            WITH vals AS (
                SELECT timestamp, value, consumption,
                    LAG(value, 1) OVER (ORDER BY timestamp) AS pv1,
                    LAG(value, 2) OVER (ORDER BY timestamp) AS pv2
                FROM meter_readings
                WHERE meter_id = :meter_id
                  AND timestamp BETWEEN :start AND :end
            )
            SELECT timestamp, pv1 AS frozen_val, consumption
            FROM vals
            WHERE value IS DISTINCT FROM pv1
              AND pv1 IS NOT NULL AND pv2 IS NOT NULL AND pv1 = pv2
              AND consumption > 0
        """)
        result = await db.execute(spike_sql, {
            "meter_id": str(meter_id), "start": start, "end": end
        })
        spikes = result.fetchall()

        if not spikes:
            return []

        events = []
        for spike in spikes:
            # Schritt 2: Einfrierungsbeginn = letzter Messwert mit anderem Zählerstand
            freeze_sql = text("""
                SELECT timestamp AS frozen_from
                FROM meter_readings
                WHERE meter_id = :meter_id
                  AND timestamp < :spike_ts
                  AND value IS DISTINCT FROM :frozen_val
                ORDER BY timestamp DESC
                LIMIT 1
            """)
            res2 = await db.execute(freeze_sql, {
                "meter_id": str(meter_id),
                "spike_ts": spike.timestamp,
                "frozen_val": spike.frozen_val,
            })
            freeze_row = res2.fetchone()

            if not freeze_row or not freeze_row.frozen_from:
                continue

            frozen_from = freeze_row.frozen_from
            frozen_hours = (spike.timestamp - frozen_from).total_seconds() / 3600
            if frozen_hours <= 0:
                continue

            events.append({
                "timestamp": spike.timestamp,
                "frozen_from": frozen_from,
                "frozen_hours": frozen_hours,
                "consumption": float(spike.consumption or 0.0),
            })

        return events

    @staticmethod
    def _smooth_frozen(
        data_points: list[dict],
        frozen_events: list[dict],
        granularity: str,
    ) -> list[dict]:
        """
        Verteilt akkumulierten Verbrauch nach Einfrierungen gleichmäßig auf die betroffenen
        Perioden und markiert alle betroffenen Datenpunkte mit is_interpolated=True.
        """
        # Periodenlänge je Granularität in Sekunden (Näherung für Überschneidungsberechnung)
        period_secs = {
            "hour": 3600,
            "day": 86400,
            "week": 7 * 86400,
            "month": 30 * 86400,
            "year": 365 * 86400,
        }.get(granularity, 86400)

        for event in frozen_events:
            spike_ts = event["timestamp"]
            frozen_from = event["frozen_from"]
            total_cons = event["consumption"]
            total_secs = (spike_ts - frozen_from).total_seconds()

            if total_secs <= 0 or total_cons <= 0:
                continue

            # Timezone sicherstellen
            if spike_ts.tzinfo is None:
                spike_ts = spike_ts.replace(tzinfo=timezone.utc)
            if frozen_from.tzinfo is None:
                frozen_from = frozen_from.replace(tzinfo=timezone.utc)

            for dp in data_points:
                raw_ts = dp.get("timestamp")
                if not raw_ts:
                    continue
                try:
                    p_start = datetime.fromisoformat(raw_ts)
                    if p_start.tzinfo is None:
                        p_start = p_start.replace(tzinfo=timezone.utc)
                except (ValueError, TypeError):
                    continue

                p_end = p_start + timedelta(seconds=period_secs)

                # Überschneidung mit der eingefrorenen Periode [frozen_from, spike_ts]
                overlap_start = max(p_start, frozen_from)
                overlap_end = min(p_end, spike_ts)
                if overlap_end <= overlap_start:
                    continue

                fraction = (overlap_end - overlap_start).total_seconds() / total_secs
                contribution = fraction * total_cons
                is_spike_bucket = p_start <= spike_ts < p_end

                if is_spike_bucket:
                    # Spike-Bucket: akkumulierten Verbrauch herausrechnen, Anteil zurückgeben
                    dp["value"] = round(max(0.0, dp["value"] - total_cons + contribution), 4)
                else:
                    # Eingefrorener Bucket: anteiligen Verbrauch hinzufügen
                    dp["value"] = round(dp["value"] + contribution, 4)

                dp["is_interpolated"] = True

        # Nicht betroffene Punkte kennzeichnen
        for dp in data_points:
            dp.setdefault("is_interpolated", False)

        return data_points

    # ── Hilfsmethoden ──

    async def _meter_ids_for_site(self, site_id: uuid.UUID) -> list[uuid.UUID]:
        """
        Aktive Zähler eines Standorts zurückgeben.

        Wenn für einen physischen Root-Zähler ein virtueller Netto-Zähler
        (type="difference") vorhanden ist, wird der physische Root-Zähler
        ausgeschlossen und stattdessen der virtuelle Netto-Zähler verwendet
        (verhindert Doppelzählung bei standortübergreifenden Zählerhierarchien).
        """
        result = await self.db.execute(
            select(Meter.id, Meter.is_virtual, Meter.virtual_config).where(
                Meter.site_id == site_id,
                Meter.is_active == True,  # noqa: E712
            )
        )
        rows = result.all()

        # IDs physischer Zähler, für die ein virtueller Netto-Zähler existiert
        virtual_source_ids: set[uuid.UUID] = set()
        for row in rows:
            if row.is_virtual and (row.virtual_config or {}).get("type") == "difference":
                src = (row.virtual_config or {}).get("source_meter_id")
                if src:
                    try:
                        virtual_source_ids.add(uuid.UUID(src))
                    except ValueError:
                        pass

        return [row.id for row in rows if row.id not in virtual_source_ids]

    async def _get_difference_series(
        self,
        meter: "Meter",  # type: ignore[name-defined]
        trunc: str,
        start_date: "date | None",
        end_date: "date | None",
    ) -> list[dict]:
        """
        Zeitreihe für einen virtuellen Differenz-Zähler (type='difference').

        Berechnet: source_readings − sum(subtract_readings) pro Zeitbucket.
        """
        vc = meter.virtual_config or {}
        source_id = uuid.UUID(vc["source_meter_id"])
        subtract_ids = [uuid.UUID(s) for s in vc.get("subtract_meter_ids", [])]
        conv = CONVERSION_FACTORS.get(meter.unit, Decimal("1"))

        async def _fetch_bucket_map(ids: list[uuid.UUID]) -> dict[str, Decimal]:
            """Zeitreihe als {period_iso: summe} für eine Menge von Zähler-IDs."""
            q = (
                select(
                    func.date_trunc(trunc, MeterReading.timestamp).label("period"),
                    func.sum(MeterReading.consumption).label("total"),
                )
                .where(MeterReading.meter_id.in_(ids))
                .group_by("period")
                .order_by("period")
            )
            if start_date:
                q = q.where(
                    MeterReading.timestamp >= datetime.combine(
                        start_date, datetime.min.time(), tzinfo=timezone.utc
                    )
                )
            if end_date:
                q = q.where(
                    MeterReading.timestamp < datetime.combine(
                        end_date + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
                    )
                )
            rows = (await self.db.execute(q)).all()
            return {row.period.isoformat(): Decimal(str(row.total or 0)) for row in rows}

        source_map = await _fetch_bucket_map([source_id])
        subtract_map = await _fetch_bucket_map(subtract_ids) if subtract_ids else {}

        all_periods = sorted(source_map.keys() | subtract_map.keys())
        return [
            {
                "timestamp": p,
                "value": float(
                    (source_map.get(p, Decimal("0")) - subtract_map.get(p, Decimal("0"))) * conv
                ),
                "count": 1,
            }
            for p in all_periods
        ]

    # ── Zeitreihen ──

    async def get_timeseries(
        self,
        meter_ids: list[uuid.UUID] | None = None,
        energy_type: str | None = None,
        start_date: date | None = None,
        end_date: date | None = None,
        granularity: str = "daily",
        site_id: uuid.UUID | None = None,
    ) -> list[dict]:
        """
        Zeitreihendaten für ein oder mehrere Zähler.

        Granularity: hourly, daily, weekly, monthly, yearly
        """
        # Standortfilter → Zähler-IDs auflösen
        if site_id and not meter_ids:
            meter_ids = await self._meter_ids_for_site(site_id)

        # Zähler ermitteln (Einspeisezähler ausschließen)
        meter_query = select(Meter).where(
            Meter.is_active == True,  # noqa: E712
            Meter.is_feed_in != True,
        )
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
            # Virtueller Differenz-Zähler: eigene Berechnungslogik
            if meter.is_virtual and (meter.virtual_config or {}).get("type") == "difference":
                data_points = await self._get_difference_series(meter, trunc, start_date, end_date)
                series.append({
                    "meter_id": str(meter.id),
                    "meter_name": self._meter_label(meter),
                    "energy_type": meter.energy_type,
                    "unit": "kWh",
                    "is_virtual": True,
                    "data": data_points,
                })
                continue

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
                        end_date + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
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
                    "is_interpolated": False,
                })

            # Eingefrorene Akkumulierungen erkennen und Verbrauch glätten
            if start_date and end_date and data_points:
                ts_start = datetime.combine(
                    start_date, datetime.min.time(), tzinfo=timezone.utc
                )
                ts_end = datetime.combine(
                    end_date + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
                )
                frozen_events = await AnalyticsService._find_frozen_accumulations(
                    self.db, meter.id, ts_start, ts_end
                )
                if frozen_events:
                    data_points = AnalyticsService._smooth_frozen(data_points, frozen_events, trunc)

            series.append({
                "meter_id": str(meter.id),
                "meter_name": self._meter_label(meter),
                "energy_type": meter.energy_type,
                "unit": "kWh",
                "is_virtual": meter.is_virtual,
                "data": data_points,
            })

        return series

    # ── Vergleich ──

    async def get_comparison(
        self,
        meter_ids: list[uuid.UUID] | None = None,
        energy_type: str | None = None,
        period1_start: date = None,
        period1_end: date = None,
        period2_start: date = None,
        period2_end: date = None,
        granularity: str = "monthly",
        site_id: uuid.UUID | None = None,
    ) -> dict:
        """Zwei Zeiträume vergleichen (z.B. Jahr-zu-Jahr)."""
        # Standortfilter → Zähler-IDs auflösen
        if site_id and not meter_ids:
            meter_ids = await self._meter_ids_for_site(site_id)
        # Wenn energy_type gesetzt, Zähler automatisch ermitteln
        if not meter_ids and energy_type:
            meter_query = select(Meter.id).where(
                Meter.is_active == True,  # noqa: E712
                Meter.is_feed_in != True,
                Meter.parent_meter_id.is_(None),
                Meter.energy_type == energy_type,
            )
            result = await self.db.execute(meter_query)
            meter_ids = [row[0] for row in result.all()]
        if not meter_ids:
            return {"period1": {"start": "", "end": "", "data": {}}, "period2": {"start": "", "end": "", "data": {}}}

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
                            end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
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
        site_id: uuid.UUID | None = None,
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
                Meter.is_feed_in != True,  # Einspeisezähler ausschließen
                Meter.parent_meter_id.is_(None),  # Keine Unterzähler-Doppelzählung
                MeterReading.timestamp >= datetime.combine(
                    start_date, datetime.min.time(), tzinfo=timezone.utc
                ),
                MeterReading.timestamp < datetime.combine(
                    end_date, datetime.min.time(), tzinfo=timezone.utc
                ),
            )
            .group_by(group_col, Meter.unit)
        )
        if site_id:
            query = query.where(Meter.site_id == site_id)
        result = await self.db.execute(query)
        rows = result.all()

        # In kWh umrechnen und pro Gruppe summieren + Originalwerte tracken
        groups: dict[str, dict] = {}
        for row in rows:
            label = row.group or "Unbekannt"
            raw = row.consumption or Decimal("0")
            conv = CONVERSION_FACTORS.get(row.unit, Decimal("1"))
            kwh = float(raw * conv)
            if label not in groups:
                groups[label] = {"kwh": 0.0, "original_value": 0.0, "original_unit": row.unit}
            groups[label]["kwh"] += kwh
            if groups[label]["original_unit"] == row.unit:
                groups[label]["original_value"] += float(raw)

        total = sum(g["kwh"] for g in groups.values())
        return [
            {
                "label": label,
                "value": info["kwh"],
                "original_value": info["original_value"],
                "original_unit": info["original_unit"],
                "share_percent": round(info["kwh"] / total * 100, 1) if total > 0 else 0,
            }
            for label, info in sorted(groups.items(), key=lambda x: -x[1]["kwh"])
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
        energy_type: str | None = None,
        meter_ids: list[uuid.UUID] | None = None,
    ) -> dict:
        """
        Sankey-Daten: Energiefluss von Hauptzählern → Unterzähler → Verbraucher.

        Generiert Knoten (nodes) und Verbindungen (links).
        Optional nach Energieart oder Zähler-IDs filtern (für Standort-Berichte).
        """
        # Alle aktiven Zähler mit Hierarchie laden
        query = (
            select(Meter)
            .where(Meter.is_active == True)  # noqa: E712
            .options(selectinload(Meter.consumers))
        )
        if energy_type:
            query = query.where(Meter.energy_type == energy_type)
        if meter_ids:
            query = query.where(Meter.id.in_(meter_ids))
        meters_result = await self.db.execute(query)
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
                        end_date + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
                    ),
                )
            )
            raw = result.scalar() or Decimal("0")
            conv = CONVERSION_FACTORS.get(meter.unit, Decimal("1"))
            consumption_map[meter.id] = float(raw * conv)

        # Hierarchie-Tiefe berechnen (für korrekte Spaltenplatzierung)
        meter_by_id = {m.id: m for m in meters}

        def calc_depth(m: Meter) -> int:
            """Tiefe im Zähler-Baum berechnen (Root = 0)."""
            depth = 0
            current = m
            while current.parent_meter_id and current.parent_meter_id in meter_by_id:
                depth += 1
                current = meter_by_id[current.parent_meter_id]
            return depth

        depth_map = {m.id: calc_depth(m) for m in meters}

        # Knoten und Links aufbauen
        nodes: list[dict] = []
        links: list[dict] = []
        node_ids: dict[str, int] = {}

        def get_node_idx(node_id: str, label: str, node_type: str, depth: int = 0) -> int:
            if node_id not in node_ids:
                node_ids[node_id] = len(nodes)
                nodes.append({
                    "id": node_id,
                    "label": label,
                    "type": node_type,
                    "depth": depth,
                })
            return node_ids[node_id]

        # Maximale Tiefe der Nicht-Erzeuger bestimmen (für Verbraucher-Spalte)
        max_consumer_depth = 0
        for meter in meters:
            if not getattr(meter, "is_feed_in", False):
                max_consumer_depth = max(max_consumer_depth, depth_map[meter.id])

        # Namen sammeln, um Duplikate zwischen Zählern und Verbrauchern zu erkennen
        meter_names = {self._meter_label(m) for m in meters}
        all_consumer_names: set[str] = set()
        for m in meters:
            if m.consumers:
                for c in m.consumers:
                    all_consumer_names.add(c.name)
        # Namen, die sowohl als Zähler als auch als Verbraucher vorkommen
        ambiguous_names = meter_names & all_consumer_names

        for meter in meters:
            mid = str(meter.id)
            depth = depth_map[meter.id]
            is_producer = getattr(meter, "is_feed_in", False)

            # Typ bestimmen
            if is_producer:
                node_type = "eigenproduktion"
            elif depth == 0:
                node_type = "hauptzaehler"
            else:
                node_type = "unterzaehler"

            # Label: Bei Namenskollision Typ-Suffix anhängen
            label = self._meter_label(meter)
            if label in ambiguous_names:
                label = f"{label} (Zähler)"

            # Alle Zähler (inkl. Erzeuger) nach Hierarchie-Tiefe platzieren
            get_node_idx(mid, label, node_type, depth + 1)

            # Vorwärts-Links (Verbrauch): Eltern → Kind – nur für Nicht-Erzeuger
            if meter.parent_meter_id and not is_producer:
                parent = meter_by_id.get(meter.parent_meter_id)
                if parent:
                    parent_id = str(parent.id)
                    parent_depth = depth_map[parent.id]
                    parent_type = "eigenproduktion" if getattr(parent, "is_feed_in", False) \
                        else ("hauptzaehler" if parent_depth == 0 else "unterzaehler")
                    parent_node_depth = parent_depth + 1
                    parent_label = self._meter_label(parent)
                    if parent_label in ambiguous_names:
                        parent_label = f"{parent_label} (Zähler)"
                    get_node_idx(parent_id, parent_label, parent_type, parent_node_depth)
                    value = consumption_map.get(meter.id, 0)

                    links.append({
                        "source": node_ids[parent_id],
                        "target": node_ids[mid],
                        "value": max(value, 0),
                        "direction": "consumption",
                    })

            # Verbindung: Zähler → Verbraucher (Anlagen)
            if meter.consumers:
                meter_value = max(consumption_map.get(meter.id, 0), 0)
                per_consumer = meter_value / max(len(meter.consumers), 1)
                for consumer in meter.consumers:
                    cid = f"consumer_{consumer.id}"
                    consumer_depth = depth + 2
                    c_label = consumer.name
                    if c_label in ambiguous_names:
                        c_label = f"{c_label} (Verbraucher)"
                    get_node_idx(cid, c_label, "verbraucher", consumer_depth)
                    links.append({
                        "source": node_ids[mid],
                        "target": node_ids[cid],
                        "value": per_consumer,
                        "direction": "consumption",
                    })

        # Rückwärts-Links (Einspeisung): Erzeuger → Eltern → ... → Netzeinspeisung
        for meter in meters:
            if not getattr(meter, "is_feed_in", False):
                continue
            feed_in_value = abs(consumption_map.get(meter.id, 0))

            # Pfad vom Erzeuger bis zum Root-Zähler nach oben verfolgen
            current = meter
            while current.parent_meter_id and current.parent_meter_id in meter_by_id:
                parent = meter_by_id[current.parent_meter_id]
                links.append({
                    "source": node_ids[str(current.id)],
                    "target": node_ids[str(parent.id)],
                    "value": feed_in_value,
                    "direction": "feed_in",
                })
                current = parent

            # Am Root-Zähler: Link zur "Netzeinspeisung"
            if not current.parent_meter_id:
                export_id = f"export_{current.energy_type}"
                export_label = f"Einspeisung {current.energy_type}"
                get_node_idx(export_id, export_label, "einspeisung", 0)
                links.append({
                    "source": node_ids[str(current.id)],
                    "target": node_ids[export_id],
                    "value": feed_in_value,
                    "direction": "feed_in",
                })

        # Hauptzähler ohne Eltern: "Energiequelle" als Wurzel (Spalte 0)
        root_meters = [m for m in meters if not m.parent_meter_id]
        for rm in root_meters:
            source_label = f"Bezug {rm.energy_type}"
            source_id = f"source_{rm.energy_type}"
            src_idx = get_node_idx(source_id, source_label, "quelle", 0)
            value = consumption_map.get(rm.id, 0)
            if value > 0:
                links.append({
                    "source": src_idx,
                    "target": node_ids[str(rm.id)],
                    "value": value,
                    "direction": "consumption",
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
            "meter_name": self._meter_label(meter) if meter else "",
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
        ts_end = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)

        # Verbrauch pro Zähler mit Gebäude-/Flächen-Daten
        query = (
            select(
                Meter.id.label("meter_id"),
                Meter.name.label("meter_name"),
                Meter.location.label("meter_location"),
                Meter.display_name.label("meter_display_name"),
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
                Meter.is_feed_in != True,  # Einspeisezähler ausschließen
                MeterReading.timestamp >= ts_start,
                MeterReading.timestamp < ts_end,
            )
            .group_by(
                Meter.id, Meter.name, Meter.location, Meter.display_name, Meter.energy_type, Meter.unit,
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
                "meter_name": (row.meter_location or "").strip() or (row.meter_display_name or "").strip() or row.meter_name,
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
        max_gap_hours: float = 0.0,
    ) -> list[dict]:
        """
        Lücken-robuste Anomalie-Erkennung auf Basis normierter Verbrauchsrate (kWh/h).

        Statt absolutem Verbrauch (kWh) wird rate = consumption / gap_hours geprüft.
        Damit werden künstliche Ausreißer durch fehlende Messwerte eliminiert:
        ein Messwert nach 30-Tage-Lücke hat eine normale Rate, obwohl der absolute
        Wert 30× höher als üblich erscheint.

        max_gap_hours=0 → automatisch 5× Median-Intervall des Zählers.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)

        meters_result = await self.db.execute(
            select(Meter).where(
                Meter.is_active == True,  # noqa: E712
                Meter.is_feed_in != True,  # Einspeisezähler ausschließen
            )
        )
        meters = list(meters_result.scalars().all())

        anomalies = []
        for meter in meters:
            # LAG-Query: Zeitabstand + Vorgängerwerte berechnen.
            # Wichtig: CTE läuft über ALLE Zeilen (auch value=0 Fehlauslesungen),
            # damit prev_value1/prev_value2 korrekt gefüllt sind.
            # Erst im äußeren WHERE werden Null-Ablesungen als Artefakte ausgeschlossen.
            sql = text("""
                WITH all_readings AS (
                    SELECT
                        id,
                        timestamp,
                        value,
                        consumption,
                        LAG(value, 1) OVER (ORDER BY timestamp) AS prev_value1,
                        LAG(value, 2) OVER (ORDER BY timestamp) AS prev_value2,
                        EXTRACT(EPOCH FROM (
                            timestamp - LAG(timestamp) OVER (ORDER BY timestamp)
                        )) / 3600.0 AS gap_hours
                    FROM meter_readings
                    WHERE meter_id = :meter_id
                      AND timestamp >= :cutoff
                )
                SELECT id, timestamp, consumption, gap_hours
                FROM all_readings
                WHERE consumption IS NOT NULL
                  AND consumption > 0
                  AND gap_hours IS NOT NULL
                  AND gap_hours > 0
                  AND COALESCE(prev_value1, 1) > 0
                  AND COALESCE(prev_value2, 1) > 0
                ORDER BY timestamp
            """)
            result = await self.db.execute(
                sql, {"meter_id": str(meter.id), "cutoff": cutoff}
            )
            rows = result.fetchall()

            if len(rows) < 5:
                continue

            gap_hours_list = [float(r.gap_hours) for r in rows]
            rates = [float(r.consumption) / float(r.gap_hours) for r in rows]

            # Effektives max_gap: 5× Median-Intervall (automatisch, wenn nicht manuell gesetzt)
            if max_gap_hours > 0:
                effective_max_gap = max_gap_hours
            else:
                sorted_gaps = sorted(gap_hours_list)
                n = len(sorted_gaps)
                median_gap = (sorted_gaps[n // 2] + sorted_gaps[(n - 1) // 2]) / 2
                effective_max_gap = 5.0 * median_gap

            # Messungen nach Datenlücken > effective_max_gap als Artefakte ausschließen
            valid = [
                (r, rate)
                for r, rate in zip(rows, rates)
                if float(r.gap_hours) <= effective_max_gap
            ]

            if len(valid) < 5:
                continue

            valid_rates = [rate for _, rate in valid]
            avg_rate = sum(valid_rates) / len(valid_rates)
            variance = sum((r - avg_rate) ** 2 for r in valid_rates) / len(valid_rates)
            std_rate = variance ** 0.5

            if std_rate == 0:
                continue

            avg_value = sum(float(r.consumption) for r, _ in valid) / len(valid)

            # Top-5 Ausreißer nach Rate-Sigma (absteigend)
            outliers = sorted(
                [(r, rate) for r, rate in valid if rate > avg_rate + threshold * std_rate],
                key=lambda x: -x[1],
            )[:5]

            for reading, rate in outliers:
                deviation = (rate - avg_rate) / std_rate
                anomalies.append({
                    "meter_id": str(meter.id),
                    "meter_name": self._meter_label(meter),
                    "timestamp": reading.timestamp.isoformat(),
                    "value": float(reading.consumption),
                    "interval_hours": round(float(reading.gap_hours), 2),
                    "rate_per_hour": round(rate, 4),
                    "avg_value": round(avg_value, 2),
                    "avg_rate": round(avg_rate, 4),
                    "deviation_sigma": round(deviation, 1),
                    "severity": "hoch" if deviation > 3 else "mittel",
                })

        return sorted(anomalies, key=lambda x: -x["deviation_sigma"])

    # ── Eigenverbrauch & Autarkiegrad ──

    async def get_self_consumption_trend(
        self,
        start_date: date,
        end_date: date,
        granularity: str = "monthly",
    ) -> list[dict]:
        """Monatliche Eigenverbrauch- und Autarkiegrad-Zeitreihe."""
        trunc_map = {"daily": "day", "weekly": "week", "monthly": "month", "yearly": "year"}
        trunc = trunc_map.get(granularity, "month")

        # PV-Produktion pro Periode (Einspeisezähler)
        pv_query = (
            select(
                func.date_trunc(trunc, MeterReading.timestamp).label("period"),
                Meter.unit,
                func.sum(MeterReading.consumption).label("production"),
            )
            .join(MeterReading, MeterReading.meter_id == Meter.id)
            .where(
                Meter.is_active == True,  # noqa: E712
                Meter.is_feed_in == True,
                MeterReading.timestamp >= datetime.combine(
                    start_date, datetime.min.time(), tzinfo=timezone.utc
                ),
                MeterReading.timestamp < datetime.combine(
                    end_date + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
                ),
            )
            .group_by(text("period"), Meter.unit)
            .order_by(text("period"))
        )
        pv_result = await self.db.execute(pv_query)
        pv_rows = pv_result.all()

        # PV pro Periode in kWh aggregieren
        pv_by_period: dict[str, float] = {}
        for row in pv_rows:
            key = row.period.isoformat() if row.period else ""
            conv = CONVERSION_FACTORS.get(row.unit, Decimal("1"))
            pv_by_period[key] = pv_by_period.get(key, 0) + abs(float((row.production or Decimal("0")) * conv))

        # Gesamtverbrauch pro Periode (ohne Einspeisung, ohne Unterzähler)
        consumption_query = (
            select(
                func.date_trunc(trunc, MeterReading.timestamp).label("period"),
                Meter.unit,
                func.sum(MeterReading.consumption).label("consumption"),
            )
            .join(MeterReading, MeterReading.meter_id == Meter.id)
            .where(
                Meter.is_active == True,  # noqa: E712
                Meter.is_feed_in != True,
                Meter.parent_meter_id.is_(None),
                MeterReading.timestamp >= datetime.combine(
                    start_date, datetime.min.time(), tzinfo=timezone.utc
                ),
                MeterReading.timestamp < datetime.combine(
                    end_date + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
                ),
            )
            .group_by(text("period"), Meter.unit)
            .order_by(text("period"))
        )
        cons_result = await self.db.execute(consumption_query)
        cons_rows = cons_result.all()

        cons_by_period: dict[str, float] = {}
        for row in cons_rows:
            key = row.period.isoformat() if row.period else ""
            conv = CONVERSION_FACTORS.get(row.unit, Decimal("1"))
            cons_by_period[key] = cons_by_period.get(key, 0) + float((row.consumption or Decimal("0")) * conv)

        # Zusammenführen
        all_periods = sorted(set(list(pv_by_period.keys()) + list(cons_by_period.keys())))
        series = []
        for period in all_periods:
            if not period:
                continue
            pv_kwh = pv_by_period.get(period, 0)
            cons_kwh = cons_by_period.get(period, 0)
            autarky = min(pv_kwh / cons_kwh * 100, 100) if cons_kwh > 0 else 0
            series.append({
                "period": period,
                "production_kwh": round(pv_kwh, 1),
                "consumption_kwh": round(cons_kwh, 1),
                "self_consumption_kwh": round(min(pv_kwh, cons_kwh), 1),
                "autarky_percent": round(autarky, 1),
            })

        return series

    # ── Jahresdauerlinie ──

    async def get_load_duration_curve(
        self,
        meter_id: uuid.UUID,
        year: int | None = None,
    ) -> dict:
        """Jahresdauerlinie: Alle Verbrauchswerte eines Zählers absteigend sortiert."""
        if not year:
            year = date.today().year
        start = datetime.combine(date(year, 1, 1), datetime.min.time(), tzinfo=timezone.utc)
        end = datetime.combine(date(year + 1, 1, 1), datetime.min.time(), tzinfo=timezone.utc)

        meter = await self.db.get(Meter, meter_id)
        if not meter:
            return {"meter_id": str(meter_id), "year": year, "data": []}

        query = (
            select(MeterReading.consumption)
            .where(
                MeterReading.meter_id == meter_id,
                MeterReading.timestamp >= start,
                MeterReading.timestamp < end,
                MeterReading.consumption.isnot(None),
                MeterReading.consumption > 0,
            )
            .order_by(MeterReading.consumption.desc())
        )
        result = await self.db.execute(query)
        values = [float(row[0]) for row in result.all()]

        conv = float(CONVERSION_FACTORS.get(meter.unit, Decimal("1")))
        return {
            "meter_id": str(meter_id),
            "meter_name": self._meter_label(meter),
            "year": year,
            "unit": "kWh",
            "data": [
                {"index": i, "value": round(v * conv, 2)}
                for i, v in enumerate(values)
            ],
        }

    # ── Summenlinie ──

    async def get_cumulative(
        self,
        meter_ids: list[uuid.UUID] | None = None,
        energy_type: str | None = None,
        start_date: date | None = None,
        end_date: date | None = None,
        site_id: uuid.UUID | None = None,
    ) -> list[dict]:
        """Kumulative Verbrauchslinie pro Zähler."""
        if site_id and not meter_ids:
            meter_ids = await self._meter_ids_for_site(site_id)
        meter_query = select(Meter).where(
            Meter.is_active == True,  # noqa: E712
            Meter.is_feed_in != True,
            Meter.parent_meter_id.is_(None),
        )
        if meter_ids:
            meter_query = meter_query.where(Meter.id.in_(meter_ids))
        if energy_type:
            meter_query = meter_query.where(Meter.energy_type == energy_type)
        meters_result = await self.db.execute(meter_query)
        meters = list(meters_result.scalars().all())

        if not meters:
            return []

        series = []
        for meter in meters:
            query = (
                select(
                    MeterReading.timestamp,
                    MeterReading.consumption,
                )
                .where(
                    MeterReading.meter_id == meter.id,
                    MeterReading.consumption.isnot(None),
                )
                .order_by(MeterReading.timestamp)
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
                        end_date + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
                    )
                )

            result = await self.db.execute(query)
            rows = result.all()

            conv = float(CONVERSION_FACTORS.get(meter.unit, Decimal("1")))
            cumulative = 0.0
            data_points = []
            for row in rows:
                cumulative += float(row.consumption or 0) * conv
                data_points.append({
                    "timestamp": row.timestamp.isoformat() if row.timestamp else None,
                    "value": round(cumulative, 1),
                })

            series.append({
                "meter_id": str(meter.id),
                "meter_name": self._meter_label(meter),
                "energy_type": meter.energy_type,
                "unit": "kWh",
                "data": data_points,
            })

        return series

    # ── Monatlicher Jahresvergleich (CAFM-Anforderung) ──

    async def get_monthly_comparison(
        self,
        year_a: int,
        year_b: int,
        energy_types: list[str] | None = None,
        meter_ids: list[uuid.UUID] | None = None,
        site_id: uuid.UUID | None = None,
    ) -> dict:
        """
        Monatlicher Verbrauchsvergleich zweier Jahre, aufgeschlüsselt nach Energieträgern.

        Rückgabe:
          {
            "year_a": 2024, "year_b": 2025,
            "energy_types": [{"key": "electricity", "label": "Strom", "unit": "kWh", "color": "#F59E0B"}],
            "months": [{"month": 1, "label": "Jan"}, ...],
            "rows": [{
              "month": 1, "label": "Jan",
              "values": {
                "electricity": {"year_a": 1234.5, "year_b": 1100.0, "delta_pct": -10.9, "unit": "kWh"}
              }
            }]
          }
        """
        ET_LABELS: dict[str, str] = {
            "electricity": "Strom", "natural_gas": "Erdgas", "heating_oil": "Heizöl",
            "district_heating": "Fernwärme", "district_cooling": "Kälte",
            "water": "Wasser", "solar": "Solar", "lpg": "Flüssiggas",
            "wood_pellets": "Holzpellets", "compressed_air": "Druckluft",
            "steam": "Dampf", "other": "Sonstige",
        }
        ET_COLORS: dict[str, str] = {
            "electricity": "#F59E0B", "natural_gas": "#3B82F6", "heating_oil": "#8B5CF6",
            "district_heating": "#F97316", "district_cooling": "#0EA5E9",
            "water": "#06B6D4", "solar": "#10B981", "lpg": "#EC4899",
            "wood_pellets": "#84CC16", "compressed_air": "#6B7280",
            "steam": "#EF4444", "other": "#9CA3AF",
        }

        # Zähler laden
        if site_id and not meter_ids:
            meter_ids = await self._meter_ids_for_site(site_id)
        meter_query = select(Meter).where(Meter.is_active == True)  # noqa: E712
        if meter_ids:
            meter_query = meter_query.where(Meter.id.in_(meter_ids))
        if energy_types:
            meter_query = meter_query.where(Meter.energy_type.in_(energy_types))
        meters_result = await self.db.execute(meter_query)
        meters = list(meters_result.scalars().all())

        if not meters:
            return {"year_a": year_a, "year_b": year_b, "energy_types": [], "months": [], "rows": []}

        # Alle vorhandenen Energiearten bestimmen
        et_set: dict[str, str] = {}  # energy_type → primary_unit
        for m in meters:
            if m.energy_type not in et_set:
                et_set[m.energy_type] = m.unit or "kWh"

        # Monatliche Verbräuche für beide Jahre je Energieart abfragen
        async def _monthly_by_et(year: int) -> dict[str, dict[int, float]]:
            """Ergibt {energy_type: {month: native_consumption}}"""
            result: dict[str, dict[int, float]] = {et: {} for et in et_set}
            for energy_type, primary_unit in et_set.items():
                et_meters = [m for m in meters if m.energy_type == energy_type]
                for month_num in range(1, 13):
                    m_start = datetime(year, month_num, 1, tzinfo=timezone.utc)
                    if month_num == 12:
                        m_end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
                    else:
                        m_end = datetime(year, month_num + 1, 1, tzinfo=timezone.utc)

                    total = Decimal("0")
                    for meter in et_meters:
                        q = select(func.sum(MeterReading.consumption)).where(
                            MeterReading.meter_id == meter.id,
                            MeterReading.timestamp >= m_start,
                            MeterReading.timestamp < m_end,
                            MeterReading.consumption.isnot(None),
                        )
                        val = (await self.db.execute(q)).scalar() or Decimal("0")
                        total += val
                    result[energy_type][month_num] = float(total)
            return result

        data_a = await _monthly_by_et(year_a)
        data_b = await _monthly_by_et(year_b)

        months_meta = [{"month": m, "label": MONTH_LABELS[m - 1]} for m in range(1, 13)]

        rows = []
        for month_num in range(1, 13):
            values: dict[str, dict] = {}
            for et, unit in et_set.items():
                val_a = data_a[et].get(month_num, 0)
                val_b = data_b[et].get(month_num, 0)
                delta_pct = None
                if val_a > 0:
                    delta_pct = round((val_b - val_a) / val_a * 100, 1)
                values[et] = {
                    "year_a": round(val_a, 2),
                    "year_b": round(val_b, 2),
                    "delta_pct": delta_pct,
                    "unit": unit,
                }
            rows.append({
                "month": month_num,
                "label": MONTH_LABELS[month_num - 1],
                "values": values,
            })

        et_meta = [
            {
                "key": et,
                "label": ET_LABELS.get(et, et),
                "unit": unit,
                "color": ET_COLORS.get(et, "#1B5E7B"),
            }
            for et, unit in et_set.items()
        ]

        return {
            "year_a": year_a,
            "year_b": year_b,
            "energy_types": et_meta,
            "months": months_meta,
            "rows": rows,
        }

    # ── Energiebilanz (CAFM-Anforderung) ──

    async def get_energy_balance(
        self,
        start_date: date,
        end_date: date,
        energy_types: list[str] | None = None,
        meter_ids: list[uuid.UUID] | None = None,
        site_id: uuid.UUID | None = None,
    ) -> dict:
        """
        Energiebilanz für einen Zeitraum – monatlich aufgeschlüsselt nach Energieträgern.

        Rückgabe:
          {
            "period_start": "2025-01-01", "period_end": "2025-12-31",
            "energy_types": [{"key": ..., "label": ..., "unit": ..., "color": ...}],
            "rows": [{
              "month": "2025-01",
              "label": "Jan 2025",
              "values": {"electricity": {"native": 1234.5, "kwh": 1234.5, "cost_net": 185.0}},
              "total_kwh": 1234.5,
              "total_cost_net": 185.0,
            }],
            "totals": {"electricity": {"native": ..., "kwh": ..., "cost_net": ...}, ...},
            "grand_total_kwh": ...,
            "grand_total_cost_net": ...,
          }
        """
        ET_LABELS: dict[str, str] = {
            "electricity": "Strom", "natural_gas": "Erdgas", "heating_oil": "Heizöl",
            "district_heating": "Fernwärme", "district_cooling": "Kälte",
            "water": "Wasser", "solar": "Solar", "lpg": "Flüssiggas",
            "wood_pellets": "Holzpellets", "compressed_air": "Druckluft",
            "steam": "Dampf", "other": "Sonstige",
        }
        ET_COLORS: dict[str, str] = {
            "electricity": "#F59E0B", "natural_gas": "#3B82F6", "heating_oil": "#8B5CF6",
            "district_heating": "#F97316", "district_cooling": "#0EA5E9",
            "water": "#06B6D4", "solar": "#10B981", "lpg": "#EC4899",
            "wood_pellets": "#84CC16", "compressed_air": "#6B7280",
            "steam": "#EF4444", "other": "#9CA3AF",
        }

        # Zähler laden
        if site_id and not meter_ids:
            meter_ids = await self._meter_ids_for_site(site_id)
        meter_query = select(Meter).where(Meter.is_active == True)  # noqa: E712
        if meter_ids:
            meter_query = meter_query.where(Meter.id.in_(meter_ids))
        if energy_types:
            meter_query = meter_query.where(Meter.energy_type.in_(energy_types))
        meters_result = await self.db.execute(meter_query)
        meters = list(meters_result.scalars().all())

        if not meters:
            return {
                "period_start": start_date.isoformat(),
                "period_end": end_date.isoformat(),
                "energy_types": [],
                "rows": [],
                "totals": {},
                "grand_total_kwh": 0,
                "grand_total_cost_net": 0,
            }

        # Energiearten ermitteln
        et_set: dict[str, str] = {}  # energy_type → primary_unit
        for m in meters:
            if m.energy_type not in et_set:
                et_set[m.energy_type] = m.unit or "kWh"

        # Alle Monate im Zeitraum generieren
        months: list[tuple[int, int]] = []  # (year, month)
        y, mo = start_date.year, start_date.month
        while (y, mo) <= (end_date.year, end_date.month):
            months.append((y, mo))
            mo += 1
            if mo > 12:
                mo = 1
                y += 1

        rows = []
        totals: dict[str, dict] = {et: {"native": 0.0, "kwh": 0.0, "cost_net": 0.0} for et in et_set}
        grand_total_kwh = 0.0
        grand_total_cost_net = 0.0

        for year, month_num in months:
            m_start = datetime(year, month_num, 1, tzinfo=timezone.utc)
            if month_num == 12:
                m_end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
            else:
                m_end = datetime(year, month_num + 1, 1, tzinfo=timezone.utc)

            values: dict[str, dict] = {}
            row_total_kwh = 0.0
            row_total_cost = 0.0

            for et, primary_unit in et_set.items():
                et_meters = [m for m in meters if m.energy_type == et]
                native_total = Decimal("0")
                cost_total = Decimal("0")

                for meter in et_meters:
                    q = select(
                        func.sum(MeterReading.consumption),
                        func.sum(MeterReading.cost_net),
                    ).where(
                        MeterReading.meter_id == meter.id,
                        MeterReading.timestamp >= m_start,
                        MeterReading.timestamp < m_end,
                        MeterReading.consumption.isnot(None),
                    )
                    row = (await self.db.execute(q)).one()
                    native_total += row[0] or Decimal("0")
                    cost_total += row[1] or Decimal("0")

                conv = CONVERSION_FACTORS.get(primary_unit, Decimal("1"))
                kwh_val = float(native_total * conv)
                native_val = float(native_total)
                cost_val = float(cost_total)

                values[et] = {"native": round(native_val, 2), "kwh": round(kwh_val, 2), "cost_net": round(cost_val, 2)}
                totals[et]["native"] += native_val
                totals[et]["kwh"] += kwh_val
                totals[et]["cost_net"] += cost_val
                row_total_kwh += kwh_val
                row_total_cost += cost_val

            grand_total_kwh += row_total_kwh
            grand_total_cost_net += row_total_cost

            rows.append({
                "month": f"{year}-{month_num:02d}",
                "label": f"{MONTH_LABELS[month_num - 1]} {year}",
                "values": values,
                "total_kwh": round(row_total_kwh, 2),
                "total_cost_net": round(row_total_cost, 2),
            })

        et_meta = [
            {
                "key": et,
                "label": ET_LABELS.get(et, et),
                "unit": unit,
                "color": ET_COLORS.get(et, "#1B5E7B"),
            }
            for et, unit in et_set.items()
        ]

        return {
            "period_start": start_date.isoformat(),
            "period_end": end_date.isoformat(),
            "energy_types": et_meta,
            "rows": rows,
            "totals": {et: {k: round(v, 2) for k, v in t.items()} for et, t in totals.items()},
            "grand_total_kwh": round(grand_total_kwh, 2),
            "grand_total_cost_net": round(grand_total_cost_net, 2),
        }

    async def get_cost_allocation(
        self,
        start_date: date,
        end_date: date,
        meter_ids: list[uuid.UUID] | None = None,
        site_id: uuid.UUID | None = None,
    ) -> dict:
        """
        Kostenumlage auf Nutzungseinheiten basierend auf MeterUnitAllocation.

        Liest alle aktiven Zähler-Nutzungseinheit-Zuordnungen,
        berechnet den anteiligen Verbrauch und die anteiligen Kosten
        je Nutzungseinheit (allocation_type + factor berücksichtigt).

        Rückgabe: Liste der Nutzungseinheiten mit anteiligen kWh und Kosten,
        sortiert nach Gesamtkosten absteigend.
        """
        # Alle MeterUnitAllocations mit ihren Nutzungseinheiten laden
        if site_id and not meter_ids:
            meter_ids = await self._meter_ids_for_site(site_id)
        alloc_q = (
            select(MeterUnitAllocation)
            .options(
                selectinload(MeterUnitAllocation.meter),
                selectinload(MeterUnitAllocation.usage_unit),
            )
        )
        if meter_ids:
            alloc_q = alloc_q.where(MeterUnitAllocation.meter_id.in_(meter_ids))
        alloc_result = await self.db.execute(alloc_q)
        allocations = alloc_result.scalars().all()

        if not allocations:
            return {
                "period_start": start_date.isoformat(),
                "period_end": end_date.isoformat(),
                "units": [],
                "grand_total_kwh": 0.0,
                "grand_total_cost_net": 0.0,
                "data_available": False,
            }

        # Verbrauch + Kosten je Zähler im Zeitraum
        meter_ids_in_allocs = list({a.meter_id for a in allocations})
        reading_q = (
            select(
                MeterReading.meter_id,
                func.sum(MeterReading.consumption).label("total_kwh"),
                func.sum(MeterReading.cost_net).label("total_cost_net"),
                func.sum(MeterReading.cost_gross).label("total_cost_gross"),
            )
            .where(
                MeterReading.meter_id.in_(meter_ids_in_allocs),
                MeterReading.timestamp >= start_date,
                MeterReading.timestamp < end_date,
            )
            .group_by(MeterReading.meter_id)
        )
        reading_result = await self.db.execute(reading_q)
        meter_data: dict[uuid.UUID, dict] = {
            row.meter_id: {
                "kwh": Decimal(str(row.total_kwh or 0)),
                "cost_net": Decimal(str(row.total_cost_net or 0)),
                "cost_gross": Decimal(str(row.total_cost_gross or 0)),
            }
            for row in reading_result.all()
        }

        # Anteile je Nutzungseinheit aggregieren
        unit_totals: dict[uuid.UUID, dict] = {}
        for alloc in allocations:
            md = meter_data.get(alloc.meter_id)
            if not md:
                continue

            sign = Decimal("-1") if alloc.allocation_type == "subtract" else Decimal("1")
            factor = alloc.factor or Decimal("1")
            kwh_share = md["kwh"] * factor * sign
            cost_net_share = md["cost_net"] * factor * sign
            cost_gross_share = md["cost_gross"] * factor * sign

            uid = alloc.usage_unit_id
            if uid not in unit_totals:
                unit = alloc.usage_unit
                unit_totals[uid] = {
                    "usage_unit_id": str(uid),
                    "usage_unit_name": unit.name if unit else str(uid),
                    "code": unit.code if unit else None,
                    "area_m2": float(unit.area_m2) if unit and unit.area_m2 else None,
                    "tenant_name": unit.tenant_name if unit else None,
                    "kwh": Decimal("0"),
                    "cost_net": Decimal("0"),
                    "cost_gross": Decimal("0"),
                    "meter_count": 0,
                }
            unit_totals[uid]["kwh"] += kwh_share
            unit_totals[uid]["cost_net"] += cost_net_share
            unit_totals[uid]["cost_gross"] += cost_gross_share
            unit_totals[uid]["meter_count"] += 1

        # Kostenumlage je m² berechnen (wenn Fläche vorhanden)
        units_list = []
        for u in unit_totals.values():
            kwh = float(u["kwh"])
            cost_net = float(u["cost_net"])
            area = u["area_m2"]
            units_list.append({
                "usage_unit_id": u["usage_unit_id"],
                "usage_unit_name": u["usage_unit_name"],
                "code": u["code"],
                "area_m2": area,
                "tenant_name": u["tenant_name"],
                "kwh": round(kwh, 2),
                "cost_net": round(cost_net, 2),
                "cost_gross": round(float(u["cost_gross"]), 2),
                "kwh_per_m2": round(kwh / area, 2) if area and area > 0 else None,
                "cost_per_m2": round(cost_net / area, 2) if area and area > 0 else None,
                "meter_count": u["meter_count"],
            })

        units_list.sort(key=lambda x: x["cost_net"], reverse=True)

        grand_kwh = round(sum(u["kwh"] for u in units_list), 2)
        grand_cost = round(sum(u["cost_net"] for u in units_list), 2)

        return {
            "period_start": start_date.isoformat(),
            "period_end": end_date.isoformat(),
            "units": units_list,
            "grand_total_kwh": grand_kwh,
            "grand_total_cost_net": grand_cost,
            "data_available": grand_cost != 0 or grand_kwh != 0,
        }

    async def get_load_profile(
        self,
        meter_ids: list[uuid.UUID],
        start_date: date,
        end_date: date,
        max_demand_kw_contract: float | None = None,
    ) -> dict:
        """
        Lastprofil und Peak-Erkennung für einen oder mehrere Zähler.

        Berechnet die Leistung (kW) aus dem Verbrauch und dem Zeitdelta
        zwischen aufeinanderfolgenden Ablesungen (LAG-Funktion).
        Ergebnis: Zeitreihe, Spitzenlast und Tages-Peaks.

        Bei mehr als 2000 Datenpunkten wird auf stündliche Maxima aggregiert,
        um die API-Antwort schlank zu halten.
        """
        from sqlalchemy import literal_column

        start_dt = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc)
        end_dt = datetime.combine(
            end_date + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
        )

        # LAG-Abfrage: Zeitdelta und Leistung je Ablesung
        # demand_kw = consumption_kwh / delta_stunden
        raw_sql = text("""
            WITH ranked AS (
                SELECT
                    meter_id,
                    timestamp,
                    consumption,
                    LAG(timestamp) OVER (PARTITION BY meter_id ORDER BY timestamp) AS prev_ts
                FROM meter_readings
                WHERE meter_id = ANY(:meter_ids)
                  AND timestamp >= :start_dt
                  AND timestamp < :end_dt
                  AND consumption IS NOT NULL
                  AND consumption > 0
            )
            SELECT
                meter_id,
                timestamp,
                consumption,
                EXTRACT(EPOCH FROM (timestamp - prev_ts)) / 3600.0 AS delta_hours,
                CASE
                    WHEN prev_ts IS NOT NULL
                         AND EXTRACT(EPOCH FROM (timestamp - prev_ts)) BETWEEN 1 AND 7200
                    THEN consumption / (EXTRACT(EPOCH FROM (timestamp - prev_ts)) / 3600.0)
                    ELSE NULL
                END AS demand_kw
            FROM ranked
            ORDER BY timestamp
        """)

        result = await self.db.execute(
            raw_sql,
            {
                "meter_ids": [str(m) for m in meter_ids],
                "start_dt": start_dt,
                "end_dt": end_dt,
            },
        )
        rows = result.fetchall()

        if not rows:
            return {
                "period_start": start_date.isoformat(),
                "period_end": end_date.isoformat(),
                "meter_count": len(meter_ids),
                "data_points": [],
                "peak_demand_kw": None,
                "peak_timestamp": None,
                "avg_demand_kw": None,
                "daily_peaks": [],
                "total_kwh": 0.0,
                "resolution_minutes": None,
                "max_demand_kw_contract": max_demand_kw_contract,
                "contract_exceeded": False,
            }

        # Rohdaten → Python
        points = []
        for row in rows:
            points.append({
                "ts": row.timestamp,
                "consumption": float(row.consumption),
                "demand_kw": float(row.demand_kw) if row.demand_kw is not None else None,
            })

        # Mittleres Intervall schätzen (für Auflösungsangabe)
        intervals = [
            (points[i]["ts"] - points[i - 1]["ts"]).total_seconds() / 60
            for i in range(1, min(50, len(points)))
            if points[i]["demand_kw"] is not None
        ]
        avg_interval_min = round(sum(intervals) / len(intervals)) if intervals else None

        # Peak-Statistiken
        demand_values = [p["demand_kw"] for p in points if p["demand_kw"] is not None]
        peak_demand_kw = max(demand_values) if demand_values else None
        avg_demand_kw = round(sum(demand_values) / len(demand_values), 3) if demand_values else None
        peak_ts = None
        if peak_demand_kw is not None:
            peak_ts = next(
                p["ts"].isoformat() for p in points if p["demand_kw"] == peak_demand_kw
            )

        total_kwh = round(sum(p["consumption"] for p in points), 2)

        # Tages-Peaks (Spitzenlast je Tag)
        daily: dict[str, float] = {}
        for p in points:
            if p["demand_kw"] is None:
                continue
            day_key = p["ts"].strftime("%Y-%m-%d")
            daily[day_key] = max(daily.get(day_key, 0.0), p["demand_kw"])
        daily_peaks = [
            {"date": d, "peak_kw": round(v, 3)}
            for d, v in sorted(daily.items())
        ]

        # Wenn zu viele Punkte: auf stündliche Maxima aggregieren
        MAX_POINTS = 2000
        if len(points) > MAX_POINTS:
            hourly: dict[str, dict] = {}
            for p in points:
                h_key = p["ts"].strftime("%Y-%m-%dT%H:00:00+00:00")
                if h_key not in hourly:
                    hourly[h_key] = {"ts": h_key, "demand_kw": None, "consumption": 0.0}
                hourly[h_key]["consumption"] += p["consumption"]
                if p["demand_kw"] is not None:
                    current = hourly[h_key]["demand_kw"]
                    hourly[h_key]["demand_kw"] = max(current, p["demand_kw"]) if current else p["demand_kw"]
            chart_points = [
                {"ts": v["ts"], "consumption": round(v["consumption"], 4), "demand_kw": round(v["demand_kw"], 3) if v["demand_kw"] else None}
                for v in sorted(hourly.values(), key=lambda x: x["ts"])
            ]
        else:
            chart_points = [
                {"ts": p["ts"].isoformat(), "consumption": p["consumption"], "demand_kw": round(p["demand_kw"], 3) if p["demand_kw"] else None}
                for p in points
            ]

        contract_exceeded = bool(
            peak_demand_kw is not None
            and max_demand_kw_contract is not None
            and peak_demand_kw > max_demand_kw_contract
        )

        return {
            "period_start": start_date.isoformat(),
            "period_end": end_date.isoformat(),
            "meter_count": len(meter_ids),
            "data_points": chart_points,
            "peak_demand_kw": round(peak_demand_kw, 3) if peak_demand_kw else None,
            "peak_timestamp": peak_ts,
            "avg_demand_kw": avg_demand_kw,
            "daily_peaks": daily_peaks,
            "total_kwh": total_kwh,
            "resolution_minutes": avg_interval_min,
            "max_demand_kw_contract": max_demand_kw_contract,
            "contract_exceeded": contract_exceeded,
        }

    # ── Teilzähler-Beitrag (Donut-Chart) ──

    async def get_submeter_contribution(
        self,
        root_meter_id: uuid.UUID,
        start_date: date,
        end_date: date,
    ) -> dict:
        """
        Verbrauchsanteile der direkten Unterzähler eines Hauptzählers.

        Rückgabe:
          {
            "root": {"id": ..., "name": ..., "unit": ..., "total_kwh": ...},
            "children": [{"id": ..., "name": ..., "kwh": ..., "share_percent": ...}, ...],
            "unaccounted_kwh": ...,   # root - Summe Kinder
            "unaccounted_percent": ...
          }
        """
        start_dt = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc)
        end_dt = datetime.combine(end_date + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)

        # Hauptzähler laden
        root_meter = await self.db.get(Meter, root_meter_id)
        if not root_meter:
            return {"root": None, "children": [], "unaccounted_kwh": 0, "unaccounted_percent": 0}

        conv_root = CONVERSION_FACTORS.get(root_meter.unit or "kWh", Decimal("1"))

        # Verbrauch Hauptzähler
        root_q = select(func.sum(MeterReading.consumption)).where(
            MeterReading.meter_id == root_meter_id,
            MeterReading.timestamp >= start_dt,
            MeterReading.timestamp < end_dt,
            MeterReading.consumption.isnot(None),
        )
        root_sum_raw = (await self.db.execute(root_q)).scalar() or Decimal("0")
        root_kwh = float(root_sum_raw * conv_root)

        # Direkte Unterzähler
        children_q = select(Meter).where(
            Meter.parent_meter_id == root_meter_id,
            Meter.is_active == True,  # noqa: E712
        )
        children = list((await self.db.execute(children_q)).scalars().all())

        child_results = []
        child_total_kwh = 0.0
        for child in children:
            conv = CONVERSION_FACTORS.get(child.unit or "kWh", Decimal("1"))
            cq = select(func.sum(MeterReading.consumption)).where(
                MeterReading.meter_id == child.id,
                MeterReading.timestamp >= start_dt,
                MeterReading.timestamp < end_dt,
                MeterReading.consumption.isnot(None),
            )
            c_raw = (await self.db.execute(cq)).scalar() or Decimal("0")
            c_kwh = float(c_raw * conv)
            child_total_kwh += c_kwh
            child_results.append({
                "id": str(child.id),
                "name": AnalyticsService._meter_label(child),
                "kwh": round(c_kwh, 2),
                "share_percent": 0.0,  # Berechnung nach Schleife
            })

        # Anteile berechnen
        base = root_kwh if root_kwh > 0 else child_total_kwh
        for c in child_results:
            c["share_percent"] = round(c["kwh"] / base * 100, 1) if base > 0 else 0.0

        unaccounted = max(0.0, root_kwh - child_total_kwh)
        unaccounted_pct = round(unaccounted / root_kwh * 100, 1) if root_kwh > 0 else 0.0

        return {
            "root": {
                "id": str(root_meter_id),
                "name": AnalyticsService._meter_label(root_meter),
                "unit": root_meter.unit,
                "total_kwh": round(root_kwh, 2),
            },
            "children": sorted(child_results, key=lambda x: -x["kwh"]),
            "unaccounted_kwh": round(unaccounted, 2),
            "unaccounted_percent": unaccounted_pct,
        }

    # ── Wetter-Regression (Streudiagramm Temperatur vs. Verbrauch) ──

    async def get_weather_regression(
        self,
        meter_id: uuid.UUID,
        start_date: date | None = None,
        end_date: date | None = None,
    ) -> dict:
        """
        Lineare Regression: Tagesverbrauch vs. Außentemperatur.

        Verbindet tägliche Messwerte mit Wetterdaten des Standorts.
        Rückgabe: Streuplot-Punkte + Regressionslinie (Steigung, Achsenabschnitt, R²).
        """
        from app.models.weather import WeatherRecord, WeatherStation

        meter = await self.db.get(Meter, meter_id)
        if not meter:
            return {"points": [], "regression": None, "meter_name": "", "unit": ""}

        today = date.today()
        if not start_date:
            start_date = date(today.year - 1, today.month, today.day)
        if not end_date:
            end_date = today

        start_dt = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc)
        end_dt = datetime.combine(end_date + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
        conv = CONVERSION_FACTORS.get(meter.unit or "kWh", Decimal("1"))

        # Tagesverbrauch des Zählers
        daily_q = (
            select(
                func.date_trunc("day", MeterReading.timestamp).label("day"),
                func.sum(MeterReading.consumption).label("consumption"),
            )
            .where(
                MeterReading.meter_id == meter_id,
                MeterReading.timestamp >= start_dt,
                MeterReading.timestamp < end_dt,
                MeterReading.consumption.isnot(None),
                MeterReading.consumption > 0,
            )
            .group_by(text("day"))
            .order_by(text("day"))
        )
        daily_rows = (await self.db.execute(daily_q)).all()
        daily_map: dict[date, float] = {
            r.day.date(): float((r.consumption or Decimal("0")) * conv)
            for r in daily_rows
        }

        # Wetterstation des Standorts ermitteln
        weather_station_id: uuid.UUID | None = None
        if meter.site_id:
            site = await self.db.get(Site, meter.site_id)
            if site:
                weather_station_id = site.weather_station_id

        if not weather_station_id:
            # Fallback: erste aktive Station
            station_q = select(WeatherStation.id).where(
                WeatherStation.is_active == True  # noqa: E712
            ).limit(1)
            weather_station_id = (await self.db.execute(station_q)).scalar()

        if not weather_station_id or not daily_map:
            return {"points": [], "regression": None, "meter_name": self._meter_label(meter), "unit": meter.unit}

        # Wetterdaten für Zeitraum
        weather_q = (
            select(WeatherRecord.date, WeatherRecord.temp_avg)
            .where(
                WeatherRecord.station_id == weather_station_id,
                WeatherRecord.date >= start_date,
                WeatherRecord.date <= end_date,
                WeatherRecord.temp_avg.isnot(None),
            )
            .order_by(WeatherRecord.date)
        )
        weather_rows = (await self.db.execute(weather_q)).all()
        weather_map: dict[date, float] = {r.date: float(r.temp_avg) for r in weather_rows}

        # Schnittmenge: nur Tage mit beiden Werten
        points = []
        for d, consumption in daily_map.items():
            if d in weather_map:
                points.append({
                    "date": d.isoformat(),
                    "temp": weather_map[d],
                    "consumption": round(consumption, 3),
                })

        if len(points) < 3:
            return {"points": points, "regression": None, "meter_name": self._meter_label(meter), "unit": meter.unit}

        # Lineare Regression (Least Squares, numpy-frei)
        n = len(points)
        xs = [p["temp"] for p in points]
        ys = [p["consumption"] for p in points]
        sum_x = sum(xs)
        sum_y = sum(ys)
        sum_xx = sum(x * x for x in xs)
        sum_xy = sum(xs[i] * ys[i] for i in range(n))
        denom = n * sum_xx - sum_x ** 2
        if denom == 0:
            return {"points": points, "regression": None, "meter_name": self._meter_label(meter), "unit": meter.unit}

        slope = (n * sum_xy - sum_x * sum_y) / denom
        intercept = (sum_y - slope * sum_x) / n

        # R²
        y_mean = sum_y / n
        ss_tot = sum((y - y_mean) ** 2 for y in ys)
        ss_res = sum((ys[i] - (slope * xs[i] + intercept)) ** 2 for i in range(n))
        r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0

        return {
            "meter_name": self._meter_label(meter),
            "unit": meter.unit or "kWh",
            "points": points,
            "regression": {
                "slope": round(slope, 4),
                "intercept": round(intercept, 3),
                "r2": round(r2, 4),
            },
        }
