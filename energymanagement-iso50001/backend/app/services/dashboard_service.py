"""
dashboard_service.py – Dashboard-Daten aggregieren.

Stellt KPI-Karten, Energieaufschlüsselung, Top-Verbraucher,
Zeitreihen und Warnungen für die Dashboard-Übersicht bereit.
"""

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.emission import CO2Calculation
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


class DashboardService:
    """Service für Dashboard-Daten."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_dashboard(
        self,
        period_start: date | None = None,
        period_end: date | None = None,
        granularity: str = "monthly",
    ) -> dict:
        """Komplette Dashboard-Daten zusammenstellen."""
        today = date.today()
        if not period_start:
            period_start = date(today.year, 1, 1)
        if not period_end:
            period_end = today

        # Vorjahreszeitraum für Trends
        prev_start = date(period_start.year - 1, period_start.month, period_start.day)
        prev_end = date(period_end.year - 1, period_end.month, period_end.day)

        try:
            kpi_cards = await self._build_kpi_cards(period_start, period_end, prev_start, prev_end)
        except Exception as e:
            logger.error("dashboard_kpi_error", error=str(e))
            kpi_cards = []

        try:
            breakdown = await self._get_energy_breakdown(period_start, period_end)
        except Exception as e:
            logger.error("dashboard_breakdown_error", error=str(e))
            breakdown = []

        try:
            chart = await self._get_consumption_chart(period_start, period_end, granularity)
        except Exception as e:
            logger.error("dashboard_chart_error", error=str(e))
            chart = []

        try:
            top_consumers = await self._get_top_consumers(period_start, period_end)
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

    async def _build_kpi_cards(
        self, start: date, end: date, prev_start: date, prev_end: date
    ) -> list[dict]:
        """KPI-Karten berechnen."""
        cards = []

        # 1. Gesamtverbrauch
        consumption = await self._total_consumption(start, end)
        prev_consumption = await self._total_consumption(prev_start, prev_end)
        trend = self._calc_trend(consumption, prev_consumption)

        cards.append({
            "label": "Gesamtverbrauch",
            "value": consumption,
            "unit": "kWh",
            "trend_percent": trend,
            "trend_direction": self._trend_dir(trend),
            "comparison_value": prev_consumption,
            "comparison_label": "Vorjahr",
        })

        # 2. CO₂-Emissionen
        co2 = await self._total_co2(start, end)
        prev_co2 = await self._total_co2(prev_start, prev_end)
        co2_trend = self._calc_trend(co2, prev_co2)

        cards.append({
            "label": "CO₂-Emissionen",
            "value": co2,
            "unit": "kg CO₂",
            "trend_percent": co2_trend,
            "trend_direction": self._trend_dir(co2_trend),
            "comparison_value": prev_co2,
            "comparison_label": "Vorjahr",
        })

        # 3. Geschätzte Kosten
        cost = await self._total_cost(start, end)
        prev_cost = await self._total_cost(prev_start, prev_end)
        cost_trend = self._calc_trend(cost, prev_cost)

        cards.append({
            "label": "Energiekosten",
            "value": cost,
            "unit": "€",
            "trend_percent": cost_trend,
            "trend_direction": self._trend_dir(cost_trend),
            "comparison_value": prev_cost,
            "comparison_label": "Vorjahr",
        })

        # 4. Aktive Zähler
        meter_count = await self._active_meter_count()
        cards.append({
            "label": "Aktive Zähler",
            "value": Decimal(str(meter_count)),
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

    async def _total_consumption(self, start: date, end: date) -> Decimal:
        """Gesamtverbrauch in kWh (nur Hauptzähler)."""
        query = (
            select(
                Meter.unit,
                func.sum(MeterReading.consumption).label("total"),
            )
            .join(MeterReading, MeterReading.meter_id == Meter.id)
            .where(
                Meter.is_active == True,  # noqa: E712
                Meter.is_feed_in != True,  # Einspeisezähler ausschließen
                Meter.parent_meter_id.is_(None),
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
        total = Decimal("0")
        for row in result.all():
            conv = CONVERSION_FACTORS.get(row.unit, Decimal("1"))
            total += (row.total or Decimal("0")) * conv
        return Decimal(str(round(float(total), 1)))

    async def _total_co2(self, start: date, end: date) -> Decimal:
        """Gesamt-CO₂ in kg."""
        result = await self.db.execute(
            select(func.sum(CO2Calculation.co2_kg)).where(
                CO2Calculation.period_start >= start,
                CO2Calculation.period_end <= end,
            )
        )
        return Decimal(str(round(float(result.scalar() or Decimal("0")), 1)))

    async def _total_cost(self, start: date, end: date) -> Decimal:
        """Geschätzte Gesamtkosten aus Tarif-Informationen."""
        meters_result = await self.db.execute(
            select(Meter).where(
                Meter.is_active == True,  # noqa: E712
                Meter.is_feed_in != True,  # Einspeisezähler ausschließen
                Meter.tariff_info.isnot(None),
            )
        )
        meters = list(meters_result.scalars().all())

        total_cost = Decimal("0")
        for meter in meters:
            tariff = meter.tariff_info or {}
            price_per_kwh = Decimal(str(tariff.get("price_per_kwh", 0)))
            if price_per_kwh <= 0:
                continue

            result = await self.db.execute(
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
            consumption = result.scalar() or Decimal("0")
            conv = CONVERSION_FACTORS.get(meter.unit, Decimal("1"))
            total_cost += consumption * conv * price_per_kwh

        return Decimal(str(round(float(total_cost), 2)))

    async def _active_meter_count(self) -> int:
        result = await self.db.execute(
            select(func.count(Meter.id)).where(Meter.is_active == True)  # noqa: E712
        )
        return result.scalar() or 0

    async def _get_energy_breakdown(self, start: date, end: date) -> list[dict]:
        """Verbrauch nach Energietyp aufschlüsseln (mit Originaleinheiten)."""
        query = (
            select(
                Meter.energy_type,
                Meter.unit,
                func.sum(MeterReading.consumption).label("consumption"),
            )
            .join(MeterReading, MeterReading.meter_id == Meter.id)
            .where(
                Meter.is_active == True,  # noqa: E712
                Meter.is_feed_in != True,  # Einspeisezähler ausschließen
                Meter.parent_meter_id.is_(None),  # Keine Unterzähler-Doppelzählung
                MeterReading.timestamp >= datetime.combine(
                    start, datetime.min.time(), tzinfo=timezone.utc
                ),
                MeterReading.timestamp < datetime.combine(
                    end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
                ),
            )
            .group_by(Meter.energy_type, Meter.unit)
        )
        result = await self.db.execute(query)
        rows = result.all()

        # Pro Energietyp: kWh-Summe + Originalwerte tracken
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
                }
            groups[row.energy_type]["kwh"] += kwh
            # Originalwert nur akkumulieren wenn gleiche Einheit
            if groups[row.energy_type]["original_unit"] == row.unit:
                groups[row.energy_type]["original_value"] += raw

        total = sum(g["kwh"] for g in groups.values())
        return [
            {
                "energy_type": et,
                "consumption_kwh": info["kwh"],
                "original_value": info["original_value"],
                "original_unit": info["original_unit"],
                "share_percent": Decimal(str(round(float(info["kwh"] / total * 100), 1))) if total > 0 else Decimal("0"),
            }
            for et, info in sorted(groups.items(), key=lambda x: -x[1]["kwh"])
        ]

    async def _get_consumption_chart(
        self, start: date, end: date, granularity: str
    ) -> list[dict]:
        """Verbrauchszeitreihe für die Hauptzähler."""
        trunc_map = {"daily": "day", "weekly": "week", "monthly": "month", "yearly": "year"}
        trunc = trunc_map.get(granularity, "month")

        meters_result = await self.db.execute(
            select(Meter).where(
                Meter.is_active == True,  # noqa: E712
                Meter.is_feed_in != True,  # Einspeisezähler ausschließen
                Meter.parent_meter_id.is_(None),
            )
        )
        meters = list(meters_result.scalars().all())

        charts = []
        for meter in meters:
            query = (
                select(
                    func.date_trunc(trunc, MeterReading.timestamp).label("period"),
                    func.sum(MeterReading.consumption).label("consumption"),
                )
                .where(
                    MeterReading.meter_id == meter.id,
                    MeterReading.timestamp >= datetime.combine(
                        start, datetime.min.time(), tzinfo=timezone.utc
                    ),
                    MeterReading.timestamp < datetime.combine(
                        end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
                    ),
                )
                .group_by(func.date_trunc(trunc, MeterReading.timestamp))
                .order_by(func.date_trunc(trunc, MeterReading.timestamp))
            )
            result = await self.db.execute(query)
            rows = result.all()

            conv = CONVERSION_FACTORS.get(meter.unit, Decimal("1"))
            data = [
                {
                    "label": row.period.strftime("%b %Y") if row.period else "",
                    "value": (row.consumption or Decimal("0")) * conv,
                }
                for row in rows
            ]

            charts.append({
                "meter_id": meter.id,
                "meter_name": meter.name,
                "energy_type": meter.energy_type,
                "unit": "kWh",
                "data": data,
            })

        return charts

    async def _get_top_consumers(self, start: date, end: date) -> list[dict]:
        """Top-5 Verbraucher nach Verbrauch."""
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
                Meter.is_feed_in != True,  # Einspeisezähler ausschließen
                Meter.parent_meter_id.is_(None),  # Keine Unterzähler-Doppelzählung
                MeterReading.timestamp >= datetime.combine(
                    start, datetime.min.time(), tzinfo=timezone.utc
                ),
                MeterReading.timestamp < datetime.combine(
                    end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
                ),
            )
            .group_by(Meter.id, Meter.name, Meter.energy_type, Meter.unit)
            .order_by(func.sum(MeterReading.consumption).desc())
            .limit(5)
        )
        result = await self.db.execute(query)
        return [
            {
                "meter_id": str(row.id),
                "name": row.name,
                "energy_type": row.energy_type,
                "consumption_kwh": float(
                    (row.consumption or Decimal("0")) * CONVERSION_FACTORS.get(row.unit, Decimal("1"))
                ),
            }
            for row in result.all()
        ]

    async def _get_alerts(self) -> list[dict]:
        """Aktive Warnungen (Zähler ohne aktuelle Daten)."""
        alerts = []
        cutoff = datetime.now(timezone.utc) - timedelta(days=7)

        meters_result = await self.db.execute(
            select(Meter).where(Meter.is_active == True)  # noqa: E712
        )
        for meter in meters_result.scalars().all():
            last_reading = await self.db.execute(
                select(func.max(MeterReading.timestamp)).where(
                    MeterReading.meter_id == meter.id
                )
            )
            last_ts = last_reading.scalar()
            if last_ts and last_ts.tzinfo is None:
                last_ts = last_ts.replace(tzinfo=timezone.utc)
            if not last_ts or last_ts < cutoff:
                alerts.append({
                    "type": "no_data",
                    "severity": "warnung",
                    "message": f"Zähler '{meter.name}' hat seit >7 Tagen keine Daten",
                    "meter_id": str(meter.id),
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
    def _calc_trend(current: Decimal, previous: Decimal) -> Decimal | None:
        if previous > 0:
            return Decimal(str(round(float((current - previous) / previous * 100), 1)))
        return None

    @staticmethod
    def _trend_dir(trend: Decimal | None) -> str | None:
        if trend is None:
            return None
        if trend > 0:
            return "up"
        if trend < 0:
            return "down"
        return "stable"
