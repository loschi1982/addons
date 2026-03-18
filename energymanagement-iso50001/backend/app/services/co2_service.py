"""
co2_service.py – CO₂-Emissionsberechnung.

Berechnet CO₂-Emissionen aus Energieverbräuchen und Emissionsfaktoren.
Unterstützt verschiedene Quellen (BAFA, UBA, Electricity Maps, manuell)
mit Prioritätskaskade für die Faktor-Auflösung.
"""

import csv
import io
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import structlog
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cached

from app.models.emission import CO2Calculation, EmissionFactor, EmissionFactorSource
from app.models.meter import Meter
from app.models.reading import MeterReading
from app.models.site import Building, Site, UsageUnit

logger = structlog.get_logger()

# Brennwert-Umrechnungsfaktoren nach kWh
CONVERSION_FACTORS: dict[str, Decimal] = {
    "m³": Decimal("10.3"),     # Erdgas: ~10,3 kWh/m³
    "l": Decimal("9.8"),       # Heizöl: ~9,8 kWh/l
    "kg": Decimal("4.8"),      # Holzpellets: ~4,8 kWh/kg
    "MWh": Decimal("1000"),    # MWh → kWh
    "kWh": Decimal("1"),
}


class CO2Service:
    """Service für CO₂-Emissionsberechnung und -Verwaltung."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ── Emissionsfaktor-Quellen ──

    async def list_sources(self) -> list:
        """Verfügbare Emissionsfaktor-Quellen auflisten."""
        result = await self.db.execute(
            select(EmissionFactorSource).order_by(EmissionFactorSource.name)
        )
        return list(result.scalars().all())

    # ── Emissionsfaktoren ──

    async def list_factors(
        self,
        energy_type: str | None = None,
        year: int | None = None,
        source_id: uuid.UUID | None = None,
    ) -> list:
        """Emissionsfaktoren auflisten."""
        query = select(EmissionFactor)
        if energy_type:
            query = query.where(EmissionFactor.energy_type == energy_type)
        if year:
            query = query.where(EmissionFactor.year == year)
        if source_id:
            query = query.where(EmissionFactor.source_id == source_id)
        query = query.order_by(EmissionFactor.energy_type, EmissionFactor.year.desc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def create_factor(self, data: dict) -> EmissionFactor:
        """Neuen Emissionsfaktor anlegen."""
        factor = EmissionFactor(**data)
        self.db.add(factor)
        await self.db.commit()
        await self.db.refresh(factor)
        return factor

    async def resolve_factor(
        self, energy_type: str, period_start: date, region: str = "DE"
    ) -> EmissionFactor | None:
        """
        Passenden Emissionsfaktor auflösen.

        Priorität:
        1. Monatlicher Faktor für das genaue Jahr/Monat
        2. Jährlicher Faktor für das Jahr
        3. Default-Faktor (neuester verfügbarer)
        """
        year = period_start.year
        month = period_start.month

        # 1. Monatlicher Faktor
        result = await self.db.execute(
            select(EmissionFactor).where(
                EmissionFactor.energy_type == energy_type,
                EmissionFactor.year == year,
                EmissionFactor.month == month,
                EmissionFactor.region == region,
            ).limit(1)
        )
        factor = result.scalar_one_or_none()
        if factor:
            return factor

        # 2. Jährlicher Faktor
        result = await self.db.execute(
            select(EmissionFactor).where(
                EmissionFactor.energy_type == energy_type,
                EmissionFactor.year == year,
                EmissionFactor.month.is_(None),
                EmissionFactor.region == region,
            ).limit(1)
        )
        factor = result.scalar_one_or_none()
        if factor:
            return factor

        # 3. Neuester verfügbarer Faktor
        result = await self.db.execute(
            select(EmissionFactor)
            .where(
                EmissionFactor.energy_type == energy_type,
                EmissionFactor.region == region,
            )
            .order_by(EmissionFactor.year.desc().nullslast())
            .limit(1)
        )
        return result.scalar_one_or_none()

    # ── CO₂-Berechnung ──

    async def calculate_emissions(
        self,
        meter_id: uuid.UUID,
        start_date: date,
        end_date: date,
    ) -> CO2Calculation | None:
        """
        CO₂-Emissionen für einen Zähler und Zeitraum berechnen.

        Formel: CO₂ (kg) = Verbrauch (kWh) × Faktor (g/kWh) / 1000
        """
        meter = await self.db.get(Meter, meter_id)
        if not meter:
            raise ValueError("Zähler nicht gefunden")

        # Verbrauch im Zeitraum berechnen
        consumption_result = await self.db.execute(
            select(func.sum(MeterReading.consumption)).where(
                MeterReading.meter_id == meter_id,
                MeterReading.timestamp >= datetime.combine(
                    start_date, datetime.min.time(), tzinfo=timezone.utc
                ),
                MeterReading.timestamp < datetime.combine(
                    end_date, datetime.min.time(), tzinfo=timezone.utc
                ),
            )
        )
        raw_consumption = consumption_result.scalar() or Decimal("0")
        if raw_consumption <= 0:
            return None

        # In kWh umrechnen
        conv = CONVERSION_FACTORS.get(meter.unit, Decimal("1"))
        consumption_kwh = raw_consumption * conv

        # Emissionsfaktor auflösen
        factor = await self.resolve_factor(meter.energy_type, start_date)
        if not factor:
            logger.warning(
                "no_emission_factor",
                energy_type=meter.energy_type,
                period=str(start_date),
            )
            return None

        # CO₂ berechnen
        co2_kg = consumption_kwh * factor.co2_g_per_kwh / Decimal("1000")
        co2eq_kg = (
            consumption_kwh * factor.co2eq_g_per_kwh / Decimal("1000")
            if factor.co2eq_g_per_kwh
            else None
        )

        calc = CO2Calculation(
            meter_id=meter_id,
            period_start=start_date,
            period_end=end_date,
            consumption_kwh=consumption_kwh,
            emission_factor_id=factor.id,
            co2_kg=Decimal(str(round(float(co2_kg), 4))),
            co2eq_kg=Decimal(str(round(float(co2eq_kg), 4))) if co2eq_kg else None,
            calculation_method="annual_avg",
        )
        self.db.add(calc)
        await self.db.commit()
        await self.db.refresh(calc)
        return calc

    async def calculate_all_meters(
        self, start_date: date, end_date: date
    ) -> dict:
        """CO₂-Emissionen für alle aktiven Zähler berechnen."""
        result = await self.db.execute(
            select(Meter).where(Meter.is_active == True)  # noqa: E712
        )
        meters = result.scalars().all()

        calculated = 0
        errors = 0
        for meter in meters:
            try:
                calc = await self.calculate_emissions(meter.id, start_date, end_date)
                if calc:
                    calculated += 1
            except Exception as e:
                errors += 1
                logger.error("co2_calc_failed", meter_id=str(meter.id), error=str(e))

        return {"calculated": calculated, "errors": errors}

    # ── Dashboard & Zusammenfassung ──

    async def get_summary(self, start_date: date, end_date: date) -> dict:
        """CO₂-Zusammenfassung für einen Zeitraum."""
        # Gesamt-CO₂
        total_result = await self.db.execute(
            select(
                func.sum(CO2Calculation.co2_kg),
                func.sum(CO2Calculation.consumption_kwh),
            ).where(
                CO2Calculation.period_start >= start_date,
                CO2Calculation.period_end <= end_date,
            )
        )
        total_co2, total_kwh = total_result.one()
        total_co2 = total_co2 or Decimal("0")
        total_kwh = total_kwh or Decimal("0")

        avg_factor = (
            total_co2 * Decimal("1000") / total_kwh if total_kwh > 0 else Decimal("0")
        )

        # Nach Energietyp aufschlüsseln
        by_type_result = await self.db.execute(
            select(
                Meter.energy_type,
                func.sum(CO2Calculation.co2_kg),
                func.sum(CO2Calculation.consumption_kwh),
            )
            .join(Meter, Meter.id == CO2Calculation.meter_id)
            .where(
                CO2Calculation.period_start >= start_date,
                CO2Calculation.period_end <= end_date,
            )
            .group_by(Meter.energy_type)
        )
        by_energy_type = [
            {
                "energy_type": et,
                "co2_kg": float(co2 or 0),
                "consumption_kwh": float(kwh or 0),
            }
            for et, co2, kwh in by_type_result.all()
        ]

        # Nach Scope aufschlüsseln
        by_scope_result = await self.db.execute(
            select(
                EmissionFactor.scope,
                func.sum(CO2Calculation.co2_kg),
            )
            .join(EmissionFactor, EmissionFactor.id == CO2Calculation.emission_factor_id)
            .where(
                CO2Calculation.period_start >= start_date,
                CO2Calculation.period_end <= end_date,
            )
            .group_by(EmissionFactor.scope)
        )
        by_scope = [
            {"scope": scope, "co2_kg": float(co2 or 0)}
            for scope, co2 in by_scope_result.all()
        ]

        # Trend vs. Vorjahreszeitraum
        days_delta = (end_date - start_date).days
        prev_start = date(start_date.year - 1, start_date.month, start_date.day)
        prev_end = date(end_date.year - 1, end_date.month, end_date.day)
        prev_result = await self.db.execute(
            select(func.sum(CO2Calculation.co2_kg)).where(
                CO2Calculation.period_start >= prev_start,
                CO2Calculation.period_end <= prev_end,
            )
        )
        prev_co2 = prev_result.scalar() or Decimal("0")
        trend = None
        if prev_co2 > 0:
            trend = Decimal(str(round(float((total_co2 - prev_co2) / prev_co2 * 100), 1)))

        return {
            "period_start": start_date,
            "period_end": end_date,
            "total_co2_kg": total_co2,
            "total_consumption_kwh": total_kwh,
            "avg_co2_g_per_kwh": Decimal(str(round(float(avg_factor), 1))),
            "by_energy_type": by_energy_type,
            "by_scope": by_scope,
            "trend_vs_previous": trend,
        }

    @cached("co2_dashboard", ttl=600)
    async def get_dashboard(self, year: int | None = None) -> dict:
        """CO₂-Dashboard-Daten zusammenstellen."""
        if not year:
            year = date.today().year

        current_start = date(year, 1, 1)
        current_end = date(year, 12, 31)
        prev_start = date(year - 1, 1, 1)
        prev_end = date(year - 1, 12, 31)

        current_year = await self.get_summary(current_start, current_end)
        previous_year = await self.get_summary(prev_start, prev_end)

        # Monatlicher Trend
        monthly_trend = []
        for month in range(1, 13):
            m_start = date(year, month, 1)
            if month == 12:
                m_end = date(year + 1, 1, 1)
            else:
                m_end = date(year, month + 1, 1)

            result = await self.db.execute(
                select(func.sum(CO2Calculation.co2_kg)).where(
                    CO2Calculation.period_start >= m_start,
                    CO2Calculation.period_end < m_end,
                )
            )
            co2 = result.scalar() or Decimal("0")
            monthly_trend.append({
                "month": month,
                "year": year,
                "co2_kg": float(co2),
            })

        # Scope-Aufschlüsselung
        scope_result = await self.db.execute(
            select(
                EmissionFactor.scope,
                func.sum(CO2Calculation.co2_kg),
            )
            .join(EmissionFactor, EmissionFactor.id == CO2Calculation.emission_factor_id)
            .where(
                CO2Calculation.period_start >= current_start,
                CO2Calculation.period_end <= current_end,
            )
            .group_by(EmissionFactor.scope)
        )
        scope_breakdown = {
            scope: float(co2 or 0) for scope, co2 in scope_result.all()
        }

        return {
            "current_year": current_year,
            "previous_year": previous_year,
            "monthly_trend": monthly_trend,
            "by_building": [],
            "scope_breakdown": scope_breakdown,
        }

    # ── Export ──

    async def _get_export_data(
        self, start_date: date, end_date: date
    ) -> list[dict]:
        """Detaillierte CO₂-Daten für Export zusammenstellen."""
        query = (
            select(
                CO2Calculation.period_start,
                CO2Calculation.period_end,
                CO2Calculation.consumption_kwh,
                CO2Calculation.co2_kg,
                CO2Calculation.co2eq_kg,
                CO2Calculation.calculation_method,
                Meter.name.label("meter_name"),
                Meter.energy_type,
                Meter.unit,
                EmissionFactor.co2_g_per_kwh,
                EmissionFactor.scope,
                EmissionFactor.region,
                UsageUnit.name.label("unit_name"),
                Building.name.label("building_name"),
                Site.name.label("site_name"),
            )
            .join(Meter, Meter.id == CO2Calculation.meter_id)
            .join(
                EmissionFactor,
                EmissionFactor.id == CO2Calculation.emission_factor_id,
            )
            .outerjoin(UsageUnit, UsageUnit.id == Meter.usage_unit_id)
            .outerjoin(Building, Building.id == UsageUnit.building_id)
            .outerjoin(Site, Site.id == Building.site_id)
            .where(
                CO2Calculation.period_start >= start_date,
                CO2Calculation.period_end <= end_date,
            )
            .order_by(
                EmissionFactor.scope, Meter.energy_type,
                CO2Calculation.period_start,
            )
        )
        result = await self.db.execute(query)
        return [row._asdict() for row in result.all()]

    async def export_ghg_csv(
        self, start_date: date, end_date: date
    ) -> str:
        """
        CO₂-Bilanz als GHG Protocol CSV exportieren.

        Spalten nach GHG Corporate Standard:
        Scope, Quelle, Energietyp, Verbrauch (kWh), Faktor (g/kWh),
        CO₂ (kg), CO₂eq (kg), Standort, Zeitraum.
        """
        rows = await self._get_export_data(start_date, end_date)

        output = io.StringIO()
        writer = csv.writer(output, delimiter=";")

        # Header
        writer.writerow([
            "Scope", "Energietyp", "Quelle (Zähler)", "Standort",
            "Gebäude", "Nutzungseinheit", "Region",
            "Zeitraum von", "Zeitraum bis",
            "Verbrauch (kWh)", "Emissionsfaktor (g CO₂/kWh)",
            "CO₂ (kg)", "CO₂eq (kg)", "Berechnungsmethode",
        ])

        # Daten
        scope_totals: dict[str, float] = {}
        for row in rows:
            scope = row["scope"] or "scope_2"
            co2 = float(row["co2_kg"] or 0)
            scope_totals[scope] = scope_totals.get(scope, 0) + co2

            writer.writerow([
                scope,
                row["energy_type"],
                row["meter_name"],
                row["site_name"] or "",
                row["building_name"] or "",
                row["unit_name"] or "",
                row["region"],
                str(row["period_start"]),
                str(row["period_end"]),
                f"{float(row['consumption_kwh'] or 0):.2f}",
                f"{float(row['co2_g_per_kwh'] or 0):.1f}",
                f"{co2:.4f}",
                f"{float(row['co2eq_kg'] or 0):.4f}" if row["co2eq_kg"] else "",
                row["calculation_method"] or "",
            ])

        # Summenzeilen
        writer.writerow([])
        writer.writerow(["Zusammenfassung"])
        total_co2 = 0.0
        for scope in sorted(scope_totals.keys()):
            writer.writerow([scope, "", "", "", "", "", "", "", "",
                             "", "", f"{scope_totals[scope]:.4f}", "", ""])
            total_co2 += scope_totals[scope]
        writer.writerow(["Gesamt", "", "", "", "", "", "", "", "",
                         "", "", f"{total_co2:.4f}", "", ""])

        return output.getvalue()

    async def export_emas_csv(
        self, start_date: date, end_date: date
    ) -> str:
        """
        CO₂-Bilanz als EMAS-Kernindikatoren CSV exportieren.

        EMAS (Eco-Management and Audit Scheme) erfordert:
        - Energieeffizienz (kWh gesamt)
        - CO₂-Emissionen gesamt (t CO₂)
        - Aufschlüsselung nach Energieträger
        """
        rows = await self._get_export_data(start_date, end_date)

        # Aggregation nach Energietyp
        by_type: dict[str, dict] = {}
        for row in rows:
            et = row["energy_type"]
            if et not in by_type:
                by_type[et] = {"kwh": 0.0, "co2_kg": 0.0}
            by_type[et]["kwh"] += float(row["consumption_kwh"] or 0)
            by_type[et]["co2_kg"] += float(row["co2_kg"] or 0)

        output = io.StringIO()
        writer = csv.writer(output, delimiter=";")

        writer.writerow(["EMAS Kernindikator: Energieeffizienz und Emissionen"])
        writer.writerow([
            f"Berichtszeitraum: {start_date} bis {end_date}"
        ])
        writer.writerow([])
        writer.writerow([
            "Energieträger", "Verbrauch (kWh)", "Verbrauch (MWh)",
            "CO₂-Emissionen (kg)", "CO₂-Emissionen (t)",
            "Anteil Verbrauch (%)", "Anteil Emissionen (%)",
        ])

        total_kwh = sum(d["kwh"] for d in by_type.values())
        total_co2 = sum(d["co2_kg"] for d in by_type.values())

        for et in sorted(by_type.keys()):
            d = by_type[et]
            kwh_pct = (d["kwh"] / total_kwh * 100) if total_kwh > 0 else 0
            co2_pct = (d["co2_kg"] / total_co2 * 100) if total_co2 > 0 else 0
            writer.writerow([
                et,
                f"{d['kwh']:.2f}",
                f"{d['kwh'] / 1000:.2f}",
                f"{d['co2_kg']:.4f}",
                f"{d['co2_kg'] / 1000:.4f}",
                f"{kwh_pct:.1f}",
                f"{co2_pct:.1f}",
            ])

        writer.writerow([])
        writer.writerow([
            "Gesamt",
            f"{total_kwh:.2f}",
            f"{total_kwh / 1000:.2f}",
            f"{total_co2:.4f}",
            f"{total_co2 / 1000:.4f}",
            "100.0", "100.0",
        ])

        return output.getvalue()
