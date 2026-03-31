"""
economics_service.py – Wirtschaftlichkeitsanalyse und Amortisationsrechnung.

Berechnet Amortisationszeiten, ROI und NPV für:
- Aktionspläne (ActionPlan) mit Investitionskosten und Einsparungserwartungen
- Verbraucher (Consumer) mit Anschaffungskosten und Lebenszyklus

Energiepreis-Kaskade (höchste Qualität zuerst):
  1. EnergyInvoice: Ø der letzten 12 Monate (effektiver kWh-Preis)
  2. MeterReading: cost_net / Verbrauch der letzten 12 Monate
  3. Meter.tariff_info: price_per_kwh (Planwert)
  4. Fallback: 0.30 €/kWh mit Hinweis
"""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

logger = structlog.get_logger()

# Standardmäßiger Fallback-Preis wenn keine Tarifdaten vorhanden
FALLBACK_PRICE_PER_KWH = 0.30
DEFAULT_DISCOUNT_RATE = 0.04  # 4% Kalkulationszinssatz für NPV
DEFAULT_PRICE_INCREASE_RATE = 0.03  # 3% jährliche Energiepreissteigerung

# Brennwert-Umrechnungsfaktoren (native Einheit → kWh)
CONVERSION_FACTORS: dict[str, float] = {
    "m³": 10.3, "l": 9.8, "kg": 4.8, "MWh": 1000.0, "kWh": 1.0,
}


def _calc_amortization(
    investment: float,
    annual_savings_eur: float,
    annual_maintenance_cost: float = 0.0,
    price_increase_rate: float = DEFAULT_PRICE_INCREASE_RATE,
    discount_rate: float = DEFAULT_DISCOUNT_RATE,
    lifetime_years: int = 20,
) -> dict:
    """
    Amortisationsrechnung für eine Investition.

    Gibt zurück:
    - simple_payback_years: Einfache Amortisationszeit (ohne Zinsen/Inflation)
    - dynamic_payback_years: Dynamische Amortisationszeit (mit Preissteigerung)
    - npv: Kapitalwert über Nutzungsdauer
    - roi_pct: Return on Investment in %
    - annual_savings_net: Jährliche Nettoeinsparung (Einsparung - Wartung)
    - break_even_year: Absolutes Jahr des Break-Even (None wenn >lifetime_years)
    """
    net_savings = annual_savings_eur - annual_maintenance_cost
    if net_savings <= 0:
        return {
            "simple_payback_years": None,
            "dynamic_payback_years": None,
            "npv": round(-investment, 2),
            "roi_pct": -100.0,
            "annual_savings_net": round(net_savings, 2),
            "break_even_year": None,
            "profitable": False,
        }

    # Einfache Amortisationszeit
    simple_payback = investment / net_savings

    # Dynamische Amortisationszeit mit Preissteigerung
    cumulative = 0.0
    dynamic_payback = None
    npv = -investment
    for year in range(1, lifetime_years + 1):
        year_savings = net_savings * ((1 + price_increase_rate) ** (year - 1))
        cumulative += year_savings
        npv += year_savings / ((1 + discount_rate) ** year)
        if dynamic_payback is None and cumulative >= investment:
            # Lineare Interpolation für den genauen Monat
            prev_cumulative = cumulative - year_savings
            fraction = (investment - prev_cumulative) / year_savings
            dynamic_payback = (year - 1) + fraction

    # ROI über Nutzungsdauer
    total_savings = sum(
        net_savings * ((1 + price_increase_rate) ** y)
        for y in range(lifetime_years)
    )
    roi_pct = ((total_savings - investment) / investment * 100) if investment > 0 else 0.0

    # Break-Even-Jahr (Kalenderjahr)
    break_even_year = None
    if dynamic_payback is not None:
        break_even_year = date.today().year + math.ceil(dynamic_payback)

    return {
        "simple_payback_years": round(simple_payback, 2),
        "dynamic_payback_years": round(dynamic_payback, 2) if dynamic_payback is not None else None,
        "npv": round(npv, 2),
        "roi_pct": round(roi_pct, 1),
        "annual_savings_net": round(net_savings, 2),
        "break_even_year": break_even_year,
        "profitable": npv > 0,
    }


class EconomicsService:
    """Service für Wirtschaftlichkeitsanalysen und Amortisationsrechnung."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_price_per_kwh(
        self,
        meter_ids: list | None = None,
        energy_type: str | None = None,
    ) -> tuple[float, str]:
        """
        Energiepreis per kWh aus Daten-Kaskade bestimmen.

        Rückgabe: (preis_eur, quelle) – Quelle ist 'invoice', 'readings',
        'tariff_info' oder 'fallback'.
        """
        from app.models.invoice import EnergyInvoice
        from app.models.meter import Meter
        from app.models.reading import MeterReading

        twelve_months_ago = date.today() - timedelta(days=365)

        # ── 1. EnergyInvoice (letzten 12 Monate, Ø effektiver Preis) ──
        try:
            inv_query = select(
                func.avg(EnergyInvoice.effective_price_per_kwh)
            ).where(
                EnergyInvoice.effective_price_per_kwh.isnot(None),
                EnergyInvoice.effective_price_per_kwh > 0,
                EnergyInvoice.billing_date >= twelve_months_ago,
            )
            if meter_ids:
                inv_query = inv_query.where(EnergyInvoice.meter_id.in_(meter_ids))
            inv_result = await self.db.execute(inv_query)
            avg_inv_price = inv_result.scalar()
            if avg_inv_price and float(avg_inv_price) > 0:
                return round(float(avg_inv_price), 4), "invoice"
        except Exception as e:
            logger.warning("economics_invoice_price_failed", error=str(e))

        # ── 2. MeterReading: cost_net / Verbrauch ──
        try:
            start_dt = datetime.combine(twelve_months_ago, datetime.min.time(), tzinfo=timezone.utc)
            reading_query = (
                select(
                    Meter.unit,
                    func.sum(MeterReading.cost_net).label("total_cost"),
                    func.sum(MeterReading.consumption).label("total_consumption"),
                )
                .join(Meter, Meter.id == MeterReading.meter_id)
                .where(
                    MeterReading.timestamp >= start_dt,
                    MeterReading.cost_net.isnot(None),
                    MeterReading.cost_net > 0,
                    MeterReading.consumption.isnot(None),
                    MeterReading.consumption > 0,
                )
                .group_by(Meter.unit)
            )
            if meter_ids:
                reading_query = reading_query.where(MeterReading.meter_id.in_(meter_ids))
            reading_result = await self.db.execute(reading_query)
            total_cost_eur = 0.0
            total_kwh = 0.0
            for row in reading_result.all():
                conv = CONVERSION_FACTORS.get(row.unit or "kWh", 1.0)
                total_cost_eur += float(row.total_cost or 0)
                total_kwh += float(row.total_consumption or 0) * conv
            if total_kwh > 0 and total_cost_eur > 0:
                return round(total_cost_eur / total_kwh, 4), "readings"
        except Exception as e:
            logger.warning("economics_readings_price_failed", error=str(e))

        # ── 3. Meter.tariff_info ──
        try:
            tariff_query = select(Meter.tariff_info).where(
                Meter.is_active == True,  # noqa: E712
                Meter.tariff_info.isnot(None),
            )
            if meter_ids:
                tariff_query = tariff_query.where(Meter.id.in_(meter_ids))
            elif energy_type:
                tariff_query = tariff_query.where(Meter.energy_type == energy_type)
            tariff_result = await self.db.execute(tariff_query.limit(1))
            tariff_info = tariff_result.scalar()
            if tariff_info and isinstance(tariff_info, dict):
                price = tariff_info.get("price_per_kwh")
                if price and float(price) > 0:
                    return round(float(price), 4), "tariff_info"
        except Exception as e:
            logger.warning("economics_tariff_price_failed", error=str(e))

        # ── 4. Fallback ──
        return FALLBACK_PRICE_PER_KWH, "fallback"

    async def get_price_increase_rate(self, meter_ids: list | None = None) -> float:
        """Jährliche Energiepreissteigerungsrate aus tariff_info oder Standard."""
        from app.models.meter import Meter
        try:
            tariff_query = select(Meter.tariff_info).where(
                Meter.is_active == True,  # noqa: E712
                Meter.tariff_info.isnot(None),
            )
            if meter_ids:
                tariff_query = tariff_query.where(Meter.id.in_(meter_ids))
            result = await self.db.execute(tariff_query.limit(5))
            for row in result.all():
                info = row[0]
                if isinstance(info, dict):
                    rate = info.get("price_increase_rate_pct")
                    if rate is not None:
                        return float(rate) / 100.0
        except Exception:
            pass
        return DEFAULT_PRICE_INCREASE_RATE

    async def get_amortization_overview(self) -> list[dict]:
        """
        Amortisationsübersicht für alle Aktionspläne und Verbraucher
        mit hinterlegten Investitionskosten.
        """
        items: list[dict] = []

        # ── Aktionspläne ──
        from app.models.iso import ActionPlan, EnergyObjective

        ap_result = await self.db.execute(
            select(ActionPlan)
            .options(selectinload(ActionPlan.objective))
            .where(ActionPlan.investment_cost.isnot(None), ActionPlan.investment_cost > 0)
            .order_by(ActionPlan.target_date)
        )
        action_plans = list(ap_result.scalars().all())

        for ap in action_plans:
            investment = float(ap.investment_cost)
            maintenance = float(ap.annual_maintenance_cost or 0) if hasattr(ap, "annual_maintenance_cost") else 0.0

            # Zähler-IDs aus verknüpftem Ziel
            meter_ids = None
            if ap.objective and ap.objective.related_meter_ids:
                meter_ids = [str(m) for m in ap.objective.related_meter_ids]

            price_per_kwh, price_source = await self.get_price_per_kwh(meter_ids)
            price_increase = await self.get_price_increase_rate(meter_ids)

            # Jahreseinsparung in €
            if ap.expected_savings_eur and float(ap.expected_savings_eur) > 0:
                annual_savings_eur = float(ap.expected_savings_eur)
            elif ap.expected_savings_kwh and float(ap.expected_savings_kwh) > 0:
                annual_savings_eur = float(ap.expected_savings_kwh) * price_per_kwh
            else:
                annual_savings_eur = 0.0

            lifetime = 20  # Standard-Nutzungsdauer für Maßnahmen

            amort = _calc_amortization(
                investment=investment,
                annual_savings_eur=annual_savings_eur,
                annual_maintenance_cost=maintenance,
                price_increase_rate=price_increase,
                lifetime_years=lifetime,
            )

            items.append({
                "type": "action_plan",
                "id": str(ap.id),
                "title": ap.title,
                "objective_title": ap.objective.title if ap.objective else None,
                "status": ap.status,
                "investment_total": investment,
                "expected_savings_kwh_pa": float(ap.expected_savings_kwh or 0),
                "expected_savings_eur_pa": annual_savings_eur,
                "expected_savings_co2_kg_pa": float(ap.expected_savings_co2_kg or 0),
                "actual_savings_kwh": float(ap.actual_savings_kwh or 0) if ap.actual_savings_kwh else None,
                "price_per_kwh": price_per_kwh,
                "price_source": price_source,
                "price_increase_rate_pct": round(price_increase * 100, 1),
                "target_date": ap.target_date.isoformat() if ap.target_date else None,
                "completion_date": ap.completion_date.isoformat() if ap.completion_date else None,
                "responsible": ap.responsible_person,
                **amort,
            })

        # ── Verbraucher ──
        from app.models.consumer import Consumer

        consumer_result = await self.db.execute(
            select(Consumer)
            .options(selectinload(Consumer.meters))
            .where(Consumer.purchase_cost.isnot(None), Consumer.purchase_cost > 0)
            .order_by(Consumer.commissioned_at.desc().nullslast())
        )
        consumers = list(consumer_result.scalars().all())

        for c in consumers:
            investment = float(c.purchase_cost) + float(c.installation_cost or 0)
            annual_maintenance = float(c.annual_maintenance_cost or 0)
            lifetime = c.expected_lifetime_years or 15

            meter_ids = [str(m.id) for m in c.meters] if c.meters else None
            price_per_kwh, price_source = await self.get_price_per_kwh(meter_ids)
            price_increase = await self.get_price_increase_rate(meter_ids)

            # Jahreseinsparung schätzen: aus rated_power × operating_hours × preis
            # (vereinfacht – echter Ansatz wäre YoY-Vergleich mit Vorgänger)
            annual_kwh_est = 0.0
            if c.rated_power and c.operating_hours:
                annual_kwh_est = float(c.rated_power) * float(c.operating_hours)

            annual_savings_eur = annual_kwh_est * price_per_kwh if annual_kwh_est > 0 else 0.0

            amort = _calc_amortization(
                investment=investment,
                annual_savings_eur=annual_savings_eur,
                annual_maintenance_cost=annual_maintenance,
                price_increase_rate=price_increase,
                lifetime_years=lifetime,
            )

            items.append({
                "type": "consumer",
                "id": str(c.id),
                "title": c.name,
                "category": c.category,
                "status": "active" if not c.decommissioned_at else "decommissioned",
                "investment_total": investment,
                "purchase_cost": float(c.purchase_cost),
                "installation_cost": float(c.installation_cost or 0),
                "annual_maintenance_cost": annual_maintenance,
                "expected_lifetime_years": lifetime,
                "annual_kwh_estimate": round(annual_kwh_est, 1),
                "expected_savings_eur_pa": annual_savings_eur,
                "price_per_kwh": price_per_kwh,
                "price_source": price_source,
                "price_increase_rate_pct": round(price_increase * 100, 1),
                "commissioned_at": c.commissioned_at.isoformat() if c.commissioned_at else None,
                **amort,
            })

        # Nach Amortisationszeit sortieren (None ans Ende)
        items.sort(key=lambda x: (
            x.get("simple_payback_years") is None,
            x.get("simple_payback_years") or 9999,
        ))
        return items
