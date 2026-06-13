"""
co2_service.py – CO₂-Emissionsberechnung.

Berechnet CO₂-Emissionen aus Energieverbräuchen und Emissionsfaktoren.
Unterstützt verschiedene Quellen (BAFA, UBA, Electricity Maps, manuell)
mit Prioritätskaskade für die Faktor-Auflösung.
"""

import csv
import io
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import structlog
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.cache import cached

from app.models.district_heating_provider import DistrictHeatingProvider
from app.models.emission import CO2Calculation, EmissionFactor, EmissionFactorSource
from app.models.meter import Meter
from app.models.reading import MeterReading
from app.models.settings import AppSetting
from app.models.site import Building, Site, UsageUnit
from app.services.meter_hierarchy import (
    resolve_authoritative_meter_ids,
    resolve_authoritative_pairs_by_month,
)

logger = structlog.get_logger()


def normalize_scope(scope: str | None) -> str:
    """GHG-Scope-Bezeichner vereinheitlichen.

    In den Faktor-Daten kommen historisch gemischte Schreibweisen vor
    ("scope2" ohne Unterstrich neben "scope_2"). Das führt sonst zu
    doppelten Scope-Zeilen in der Auswertung. Hier wird auf die
    kanonische Form scope_1 / scope_2 / scope_3 gemappt.
    """
    if not scope:
        return "scope_2"
    s = str(scope).strip().lower().replace(" ", "").replace("-", "_")
    if s in ("scope1", "scope_1", "1"):
        return "scope_1"
    if s in ("scope2", "scope_2", "2"):
        return "scope_2"
    if s in ("scope3", "scope_3", "3"):
        return "scope_3"
    return s


# Brennwert-Umrechnungsfaktoren nach kWh
CONVERSION_FACTORS: dict[str, Decimal] = {
    "m³": Decimal("10.3"),     # Erdgas: ~10,3 kWh/m³
    "l": Decimal("9.8"),       # Heizöl: ~9,8 kWh/l
    "kg": Decimal("4.8"),      # Holzpellets: ~4,8 kWh/kg
    "MWh": Decimal("1000"),    # MWh → kWh
    "kWh": Decimal("1"),
}

# Nicht-Energieträger: gehen nicht in den kWh-Gesamtverbrauch und die
# durchschnittliche CO₂-Intensität ein (Wasser ist kein Energieträger).
NON_ENERGY_TYPES: set[str] = {"water"}


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
        query = select(EmissionFactor).options(selectinload(EmissionFactor.source))
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

    async def _get_district_heating_provider_factor(self) -> Decimal | None:
        """CO₂-Faktor des konfigurierten Fernwärmeversorgers (g CO₂/kWh)."""
        result = await self.db.execute(
            select(AppSetting.value).where(AppSetting.key == "district_heating_provider")
        )
        setting = result.scalar_one_or_none()
        if not setting or not setting.get("provider_id"):
            return None
        provider = await self.db.get(DistrictHeatingProvider, setting["provider_id"])
        if provider:
            return provider.co2_g_per_kwh
        return None

    async def resolve_factor(
        self, energy_type: str, period_start: date, region: str = "DE"
    ) -> EmissionFactor | None:
        """
        Passenden Emissionsfaktor auflösen.

        Sonderfälle:
        - district_cooling: Kein CO₂-Faktor berechenbar → None
        - district_heating: Versorger-Faktor (FW 309) hat Vorrang

        Priorität (Standard):
        1. Monatlicher Faktor für das genaue Jahr/Monat
        2. Jährlicher Faktor für das Jahr
        3. Default-Faktor (neuester verfügbarer)
        """
        # Kälte: kein CO₂-Faktor berechenbar
        if energy_type == "district_cooling":
            return None

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

        # Periode auf den vollen Kalendermonat von start_date normalisieren.
        # So entsteht je (Zähler, Monat) genau EINE kanonische Zeile → idempotenter
        # UPSERT, keine mehrmonatigen Sammelzeilen und keine Duplikate mit täglich
        # wechselndem Enddatum (die sonst die Monatsaggregation im Dashboard
        # massiv verfälschen).
        from calendar import monthrange as _monthrange
        _y, _m = start_date.year, start_date.month
        start_date = date(_y, _m, 1)
        end_date = date(_y, _m, _monthrange(_y, _m)[1])

        # Verbrauch im Zeitraum berechnen
        consumption_result = await self.db.execute(
            select(func.sum(MeterReading.consumption)).where(
                MeterReading.meter_id == meter_id,
                MeterReading.timestamp >= datetime.combine(
                    start_date, datetime.min.time(), tzinfo=timezone.utc
                ),
                MeterReading.timestamp < datetime.combine(
                    end_date + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
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

        # Fernwärme: Versorger-spezifischen Faktor verwenden (FW 309)
        effective_co2 = factor.co2_g_per_kwh
        if meter.energy_type == "district_heating":
            provider_factor = await self._get_district_heating_provider_factor()
            if provider_factor is not None:
                effective_co2 = provider_factor

        # CO₂ berechnen
        co2_kg = consumption_kwh * effective_co2 / Decimal("1000")
        co2eq_kg = (
            consumption_kwh * factor.co2eq_g_per_kwh / Decimal("1000")
            if factor.co2eq_g_per_kwh
            else None
        )

        # UPSERT: existierenden Eintrag für (meter, period) updaten, sonst neu anlegen
        existing = (await self.db.execute(
            select(CO2Calculation).where(
                CO2Calculation.meter_id == meter_id,
                CO2Calculation.period_start == start_date,
                CO2Calculation.period_end == end_date,
            )
        )).scalar_one_or_none()

        new_co2_kg = Decimal(str(round(float(co2_kg), 4)))
        new_co2eq_kg = Decimal(str(round(float(co2eq_kg), 4))) if co2eq_kg else None

        if existing is not None:
            existing.consumption_kwh = consumption_kwh
            existing.emission_factor_id = factor.id
            existing.co2_kg = new_co2_kg
            existing.co2eq_kg = new_co2eq_kg
            existing.calculation_method = "annual_avg"
            calc = existing
        else:
            calc = CO2Calculation(
                meter_id=meter_id,
                period_start=start_date,
                period_end=end_date,
                consumption_kwh=consumption_kwh,
                emission_factor_id=factor.id,
                co2_kg=new_co2_kg,
                co2eq_kg=new_co2eq_kg,
                calculation_method="annual_avg",
            )
            self.db.add(calc)
        await self.db.commit()
        await self.db.refresh(calc)
        return calc

    async def calculate_all_meters(
        self,
        start_date: date,
        end_date: date,
        energy_types: list[str] | None = None,
        meter_ids: list[uuid.UUID] | None = None,
    ) -> dict:
        """CO₂-Emissionen für alle aktiven Zähler berechnen.

        Optional auf bestimmte Energiearten oder Zähler begrenzen. Nur IDs werden
        vorab geladen, um Expired-Attribute-Probleme nach commit() zu vermeiden.
        """
        q = select(Meter.id).where(Meter.is_active == True)  # noqa: E712
        if energy_types:
            q = q.where(Meter.energy_type.in_(energy_types))
        if meter_ids:
            q = q.where(Meter.id.in_(meter_ids))
        result = await self.db.execute(q)
        meter_ids = [row[0] for row in result.all()]

        calculated = 0
        skipped = 0
        errors = 0
        for mid in meter_ids:
            try:
                calc = await self.calculate_emissions(mid, start_date, end_date)
                if calc:
                    calculated += 1
                else:
                    skipped += 1
            except Exception as e:
                errors += 1
                logger.error("co2_calc_failed", meter_id=str(mid), error=str(e))

        return {"calculated": calculated, "skipped": skipped, "errors": errors}

    async def find_oldest_reading_date(
        self, energy_types: list[str] | None = None
    ) -> date | None:
        """Ältestes Reading-Datum für aktive Zähler (optional gefiltert)."""
        q = (
            select(func.min(MeterReading.timestamp))
            .join(Meter, Meter.id == MeterReading.meter_id)
            .where(Meter.is_active == True)  # noqa: E712
        )
        if energy_types:
            q = q.where(Meter.energy_type.in_(energy_types))
        ts = (await self.db.execute(q)).scalar()
        return ts.date() if ts else None

    async def _purge_noncanonical_co2(self) -> int:
        """CO₂-Zeilen mit nicht-kanonischem Zeitraum löschen.

        „Kanonisch" = period_start ist Monatserster UND period_end ist
        Monatsletzter desselben Monats. Nicht-kanonische Zeilen entstanden durch
        Aufrufe über mehrere Monate (z.B. Jahresanfang..heute) oder mit täglich
        wechselndem Enddatum; sie verfälschen die Monatsaggregation (z.B. ein
        Jahreswert, der komplett im Januar gebucht wird). Einmaliges Aufräumen.
        """
        from sqlalchemy import text as _text
        res = await self.db.execute(_text(
            """
            DELETE FROM co2_calculations
            WHERE period_start <> date_trunc('month', period_start)::date
               OR period_end <> (date_trunc('month', period_start)
                                 + interval '1 month' - interval '1 day')::date
            """
        ))
        await self.db.commit()
        return res.rowcount or 0

    async def backfill_all(
        self,
        period_start: date,
        period_end: date,
        energy_types: list[str] | None = None,
        meter_ids: list[uuid.UUID] | None = None,
    ) -> dict:
        """CO₂-Berechnungen monatsweise für den gesamten Zeitraum nachholen.

        Iteriert pro Kalendermonat von period_start bis period_end. Nutzt
        die idempotente `calculate_emissions` (UPSERT) — sicher mehrfach
        ausführbar. Räumt vorab nicht-kanonische Alt-Zeilen auf.
        """
        from calendar import monthrange

        purged = await self._purge_noncanonical_co2()
        if purged:
            logger.info("co2_purged_noncanonical", deleted=purged)

        months: list[tuple[int, int]] = []
        y, m = period_start.year, period_start.month
        while (y, m) <= (period_end.year, period_end.month):
            months.append((y, m))
            m += 1
            if m > 12:
                m = 1
                y += 1

        per_month: list[dict] = []
        total_calculated = 0
        total_skipped = 0
        total_errors = 0
        for y, m in months:
            month_start = date(y, m, 1)
            last_day = monthrange(y, m)[1]
            month_end = date(y, m, last_day)
            # Beschneide auf angeforderten Zeitraum
            if month_start < period_start:
                month_start = period_start
            if month_end > period_end:
                month_end = period_end
            r = await self.calculate_all_meters(month_start, month_end, energy_types, meter_ids)
            per_month.append({"year": y, "month": m, **r})
            total_calculated += r.get("calculated", 0)
            total_skipped += r.get("skipped", 0)
            total_errors += r.get("errors", 0)
            logger.info(
                "co2_backfill_month",
                year=y, month=m,
                calculated=r.get("calculated"), skipped=r.get("skipped"), errors=r.get("errors"),
            )

        return {
            "months": len(months),
            "calculated": total_calculated,
            "skipped": total_skipped,
            "errors": total_errors,
            "purged_noncanonical": purged,
            "per_month": per_month,
        }

    # ── Dashboard & Zusammenfassung ──

    async def get_summary(self, start_date: date, end_date: date) -> dict:
        """CO₂-Zusammenfassung für einen Zeitraum.

        Aggregiert nur über die je Strang maßgeblichen Zähler (tiefste Ebene mit
        Daten), damit Eltern- und Kindzähler nicht doppelt gezählt werden.
        """
        # Je MONAT maßgebliche (Zähler, Monat)-Paare – damit ein Hauptzähler mit
        # nur teilweise vorhandenen Daten seine Unterzähler nicht für leere Monate
        # verdrängt (analog Dashboard). CO2Calculation ist je (Zähler, Monat); wir
        # filtern die Zeilen in Python gegen die Paare.
        pairs = await resolve_authoritative_pairs_by_month(self.db, start_date, end_date)

        rows = (await self.db.execute(
            select(
                CO2Calculation.meter_id,
                CO2Calculation.period_start,
                CO2Calculation.co2_kg,
                CO2Calculation.consumption_kwh,
                Meter.energy_type,
                EmissionFactor.scope,
            )
            .join(Meter, Meter.id == CO2Calculation.meter_id)
            .join(EmissionFactor, EmissionFactor.id == CO2Calculation.emission_factor_id, isouter=True)
            .where(
                CO2Calculation.period_start >= start_date,
                CO2Calculation.period_end <= end_date,
                # Nur kanonische Monatszeilen (Start/Ende im selben Monat) –
                # schützt vor mehrmonatigen Alt-Sammelzeilen, die sonst doppelt
                # bzw. überhöht zählen würden.
                func.date_trunc("month", CO2Calculation.period_start)
                == func.date_trunc("month", CO2Calculation.period_end),
            )
        )).all()

        total_co2 = Decimal("0")
        total_kwh = Decimal("0")
        by_type_acc: dict[str, dict] = {}
        scope_sums: dict[str, float] = {}
        for r in rows:
            if (r.meter_id, (r.period_start.year, r.period_start.month)) not in pairs:
                continue
            co2 = r.co2_kg or Decimal("0")
            kwh = r.consumption_kwh or Decimal("0")
            total_co2 += co2
            if r.energy_type not in NON_ENERGY_TYPES:
                total_kwh += kwh
            acc = by_type_acc.setdefault(r.energy_type, {"co2": Decimal("0"), "kwh": Decimal("0")})
            acc["co2"] += co2
            acc["kwh"] += kwh
            sk = normalize_scope(r.scope)
            scope_sums[sk] = scope_sums.get(sk, 0.0) + float(co2)

        avg_factor = (
            total_co2 * Decimal("1000") / total_kwh if total_kwh > 0 else Decimal("0")
        )
        by_energy_type = [
            {"energy_type": et, "co2_kg": float(v["co2"]), "consumption_kwh": float(v["kwh"])}
            for et, v in by_type_acc.items()
        ]
        by_scope = [
            {"scope": s, "co2_kg": c} for s, c in sorted(scope_sums.items())
        ]

        # Trend vs. Vorjahreszeitraum (ebenfalls pro Monat maßgeblich)
        prev_start = date(start_date.year - 1, start_date.month, start_date.day)
        prev_end = date(end_date.year - 1, end_date.month, end_date.day)
        prev_pairs = await resolve_authoritative_pairs_by_month(self.db, prev_start, prev_end)
        prev_rows = (await self.db.execute(
            select(CO2Calculation.meter_id, CO2Calculation.period_start, CO2Calculation.co2_kg)
            .where(
                CO2Calculation.period_start >= prev_start,
                CO2Calculation.period_end <= prev_end,
                func.date_trunc("month", CO2Calculation.period_start)
                == func.date_trunc("month", CO2Calculation.period_end),
            )
        )).all()
        prev_co2 = Decimal("0")
        for r in prev_rows:
            if (r.meter_id, (r.period_start.year, r.period_start.month)) in prev_pairs:
                prev_co2 += r.co2_kg or Decimal("0")
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

        # Je Monat maßgebliche (Zähler, Monat)-Paare (Monatstrend + Scope, ohne
        # Doppelzählung – Hauptzähler verdrängt Unterzähler nur in eigenen Monaten).
        year_pairs = await resolve_authoritative_pairs_by_month(self.db, current_start, current_end)
        year_rows = (await self.db.execute(
            select(
                CO2Calculation.meter_id,
                CO2Calculation.period_start,
                CO2Calculation.co2_kg,
                EmissionFactor.scope,
            )
            .join(EmissionFactor, EmissionFactor.id == CO2Calculation.emission_factor_id, isouter=True)
            .where(
                CO2Calculation.period_start >= current_start,
                CO2Calculation.period_end <= current_end,
                # Nur kanonische Monatszeilen → mehrmonatige Alt-Sammelzeilen
                # (deren Wert sonst komplett im Startmonat landet) ausschließen.
                func.date_trunc("month", CO2Calculation.period_start)
                == func.date_trunc("month", CO2Calculation.period_end),
            )
        )).all()

        monthly_co2: dict[int, Decimal] = {m: Decimal("0") for m in range(1, 13)}
        scope_breakdown: dict[str, float] = {}
        for r in year_rows:
            if (r.meter_id, (r.period_start.year, r.period_start.month)) not in year_pairs:
                continue
            co2 = r.co2_kg or Decimal("0")
            if r.period_start.year == year and 1 <= r.period_start.month <= 12:
                monthly_co2[r.period_start.month] += co2
            sk = normalize_scope(r.scope)
            scope_breakdown[sk] = scope_breakdown.get(sk, 0.0) + float(co2)

        monthly_trend = [
            {"month": m, "year": year, "co2_kg": float(monthly_co2[m])}
            for m in range(1, 13)
        ]

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
