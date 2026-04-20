"""
energy_review_service.py – Business Logic für die Energiebewertung.

Berechnung von EnPI, Baseline-Vergleich, SEU-Vorschläge und
Verwaltung relevanter Variablen (ISO 50001 Kap. 6.3–6.5).
"""

import uuid
from datetime import date
from decimal import Decimal

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.consumer import Consumer, meter_consumer
from app.models.energy_review import (
    EnergyBaseline,
    EnergyPerformanceIndicator,
    EnPIValue,
    RelevantVariable,
    RelevantVariableValue,
    SignificantEnergyUse,
)
from app.models.reading import MeterReading

logger = structlog.get_logger()


class EnergyReviewService:
    """Service für Energiebewertung nach ISO 50001."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ─────────────────────────────────────────────
    # Relevante Variablen
    # ─────────────────────────────────────────────

    async def list_variables(
        self, page: int = 1, page_size: int = 25, is_active: bool | None = True
    ) -> dict:
        """Alle relevanten Variablen auflisten."""
        query = select(RelevantVariable)
        if is_active is not None:
            query = query.where(RelevantVariable.is_active == is_active)
        query = query.order_by(RelevantVariable.name)

        # Total
        count_q = select(func.count()).select_from(query.subquery())
        total = (await self.db.execute(count_q)).scalar() or 0

        # Seite
        query = query.offset((page - 1) * page_size).limit(page_size)
        result = await self.db.execute(query)
        items = result.scalars().all()

        return {"items": items, "total": total, "page": page, "page_size": page_size}

    async def get_variable(self, variable_id: uuid.UUID) -> RelevantVariable:
        """Einzelne Variable laden."""
        variable = await self.db.get(RelevantVariable, variable_id)
        if not variable:
            raise ValueError("Variable nicht gefunden")
        return variable

    async def create_variable(self, data: dict) -> RelevantVariable:
        """Neue relevante Variable anlegen."""
        variable = RelevantVariable(**data)
        self.db.add(variable)
        await self.db.commit()
        await self.db.refresh(variable)
        return variable

    async def update_variable(
        self, variable_id: uuid.UUID, data: dict
    ) -> RelevantVariable:
        """Variable aktualisieren."""
        variable = await self.get_variable(variable_id)
        for key, value in data.items():
            if hasattr(variable, key):
                setattr(variable, key, value)
        await self.db.commit()
        await self.db.refresh(variable)
        return variable

    async def delete_variable(self, variable_id: uuid.UUID) -> None:
        """Variable deaktivieren (Soft-Delete)."""
        variable = await self.get_variable(variable_id)
        variable.is_active = False
        await self.db.commit()

    async def add_variable_value(
        self, variable_id: uuid.UUID, data: dict
    ) -> RelevantVariableValue:
        """Einen Messwert für eine Variable hinzufügen."""
        await self.get_variable(variable_id)  # Existenz prüfen
        value = RelevantVariableValue(variable_id=variable_id, **data)
        self.db.add(value)
        await self.db.commit()
        await self.db.refresh(value)
        return value

    async def list_variable_values(
        self,
        variable_id: uuid.UUID,
        period_start: date | None = None,
        period_end: date | None = None,
    ) -> list[RelevantVariableValue]:
        """Messwerte einer Variable laden."""
        query = (
            select(RelevantVariableValue)
            .where(RelevantVariableValue.variable_id == variable_id)
            .order_by(RelevantVariableValue.period_start.desc())
        )
        if period_start:
            query = query.where(RelevantVariableValue.period_start >= period_start)
        if period_end:
            query = query.where(RelevantVariableValue.period_end <= period_end)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_latest_variable_value(
        self, variable_id: uuid.UUID
    ) -> Decimal | None:
        """Letzten Wert einer Variable laden."""
        result = await self.db.execute(
            select(RelevantVariableValue.value)
            .where(RelevantVariableValue.variable_id == variable_id)
            .order_by(RelevantVariableValue.period_end.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def import_hdd(
        self, variable_id: uuid.UUID, station_id: uuid.UUID,
        period_start: date, period_end: date,
    ) -> int:
        """Heizgradtage aus MonthlyDegreeDays in Variable-Werte importieren."""
        from app.models.weather import MonthlyDegreeDays

        variable = await self.get_variable(variable_id)
        if variable.variable_type != "weather_hdd":
            raise ValueError("Variable ist nicht vom Typ weather_hdd")

        result = await self.db.execute(
            select(MonthlyDegreeDays)
            .where(
                MonthlyDegreeDays.station_id == station_id,
                MonthlyDegreeDays.month_start >= period_start,
                MonthlyDegreeDays.month_start <= period_end,
            )
            .order_by(MonthlyDegreeDays.month_start)
        )
        months = result.scalars().all()

        imported = 0
        for m in months:
            # Monatsenddatum berechnen
            if m.month_start.month == 12:
                month_end = date(m.month_start.year + 1, 1, 1)
            else:
                month_end = date(m.month_start.year, m.month_start.month + 1, 1)

            value = RelevantVariableValue(
                variable_id=variable_id,
                period_start=m.month_start,
                period_end=month_end,
                value=m.heating_degree_days or Decimal("0"),
                source="imported",
            )
            self.db.add(value)
            imported += 1

        await self.db.commit()
        return imported

    # ─────────────────────────────────────────────
    # Wesentliche Energieeinsätze (SEU)
    # ─────────────────────────────────────────────

    async def list_seus(
        self, page: int = 1, page_size: int = 25, is_active: bool | None = True
    ) -> dict:
        """Alle SEUs auflisten."""
        query = (
            select(SignificantEnergyUse)
            .options(selectinload(SignificantEnergyUse.consumer))
        )
        if is_active is not None:
            query = query.where(SignificantEnergyUse.is_active == is_active)
        query = query.order_by(
            SignificantEnergyUse.consumption_share_percent.desc().nullslast()
        )

        count_q = select(func.count()).select_from(
            select(SignificantEnergyUse.id)
            .where(SignificantEnergyUse.is_active == is_active if is_active is not None else True)
            .subquery()
        )
        total = (await self.db.execute(count_q)).scalar() or 0

        query = query.offset((page - 1) * page_size).limit(page_size)
        result = await self.db.execute(query)
        items = result.scalars().all()

        return {"items": items, "total": total, "page": page, "page_size": page_size}

    async def get_seu(self, seu_id: uuid.UUID) -> SignificantEnergyUse:
        """Einzelnen SEU laden."""
        result = await self.db.execute(
            select(SignificantEnergyUse)
            .options(
                selectinload(SignificantEnergyUse.consumer),
                selectinload(SignificantEnergyUse.relevant_variables),
            )
            .where(SignificantEnergyUse.id == seu_id)
        )
        seu = result.scalar_one_or_none()
        if not seu:
            raise ValueError("SEU nicht gefunden")
        return seu

    async def create_seu(self, data: dict) -> SignificantEnergyUse:
        """Neuen SEU anlegen."""
        seu = SignificantEnergyUse(**data)
        self.db.add(seu)
        await self.db.commit()
        await self.db.refresh(seu)
        return seu

    async def update_seu(
        self, seu_id: uuid.UUID, data: dict
    ) -> SignificantEnergyUse:
        """SEU aktualisieren."""
        seu = await self.get_seu(seu_id)
        for key, value in data.items():
            if hasattr(seu, key):
                setattr(seu, key, value)
        await self.db.commit()
        await self.db.refresh(seu)
        return seu

    async def delete_seu(self, seu_id: uuid.UUID) -> None:
        """SEU deaktivieren."""
        seu = await self.get_seu(seu_id)
        seu.is_active = False
        await self.db.commit()

    async def suggest_seus(self, threshold_percent: float = 5.0) -> list[dict]:
        """
        SEU-Vorschläge generieren basierend auf Verbrauchsanteil.

        Aggregiert den Energieverbrauch pro Verbraucher über die
        Zähler-Verbraucher-Zuordnung (meter_consumer) und schlägt
        alle Verbraucher vor, deren Anteil über dem Schwellwert liegt.
        """
        # Gesamtverbrauch aller Zähler (letzte 12 Monate)
        total_q = select(func.sum(MeterReading.consumption)).where(
            MeterReading.consumption.isnot(None)
        )
        total_consumption = (await self.db.execute(total_q)).scalar() or Decimal("0")

        if total_consumption <= 0:
            return []

        # Verbrauch pro Consumer über meter_consumer
        consumer_q = (
            select(
                Consumer.id,
                Consumer.name,
                Consumer.category,
                func.sum(MeterReading.consumption).label("total_kwh"),
            )
            .join(meter_consumer, meter_consumer.c.consumer_id == Consumer.id)
            .join(
                MeterReading,
                MeterReading.meter_id == meter_consumer.c.meter_id,
            )
            .where(
                Consumer.is_active == True,  # noqa: E712
                MeterReading.consumption.isnot(None),
            )
            .group_by(Consumer.id, Consumer.name, Consumer.category)
            .order_by(func.sum(MeterReading.consumption).desc())
        )
        result = await self.db.execute(consumer_q)

        # Bereits als SEU markierte Consumer
        existing_q = select(SignificantEnergyUse.consumer_id).where(
            SignificantEnergyUse.is_active == True  # noqa: E712
        )
        existing = {
            row for row in (await self.db.execute(existing_q)).scalars().all()
            if row is not None
        }

        suggestions = []
        for row in result.all():
            share = (row.total_kwh / total_consumption * 100) if total_consumption else Decimal("0")
            if share >= Decimal(str(threshold_percent)) and row.id not in existing:
                # Energieart aus Kategorie ableiten
                energy_type = "electricity"  # Standard
                cat = (row.category or "").lower()
                if "gas" in cat or "heiz" in cat:
                    energy_type = "natural_gas"
                elif "wasser" in cat or "water" in cat:
                    energy_type = "water"

                suggestions.append({
                    "consumer_id": row.id,
                    "consumer_name": row.name,
                    "energy_type": energy_type,
                    "consumption_kwh": round(row.total_kwh, 2),
                    "share_percent": round(share, 2),
                    "suggested_reason": f"Verbrauchsanteil {share:.1f}% (Schwelle: {threshold_percent}%)",
                })

        return suggestions

    async def recalculate_shares(self) -> int:
        """Verbrauchsanteile aller aktiven SEUs neu berechnen."""
        total_q = select(func.sum(MeterReading.consumption)).where(
            MeterReading.consumption.isnot(None)
        )
        total = (await self.db.execute(total_q)).scalar() or Decimal("0")
        if total <= 0:
            return 0

        result = await self.db.execute(
            select(SignificantEnergyUse)
            .options(selectinload(SignificantEnergyUse.consumer))
            .where(SignificantEnergyUse.is_active == True)  # noqa: E712
        )
        seus = result.scalars().all()
        updated = 0

        for seu in seus:
            if not seu.consumer_id:
                continue

            # Verbrauch des Consumers über zugeordnete Zähler
            consumption_q = (
                select(func.sum(MeterReading.consumption))
                .join(
                    meter_consumer,
                    meter_consumer.c.meter_id == MeterReading.meter_id,
                )
                .where(
                    meter_consumer.c.consumer_id == seu.consumer_id,
                    MeterReading.consumption.isnot(None),
                )
            )
            consumption = (await self.db.execute(consumption_q)).scalar() or Decimal("0")

            seu.annual_consumption_kwh = round(consumption, 4)
            seu.consumption_share_percent = round(consumption / total * 100, 2)
            updated += 1

        await self.db.commit()
        return updated

    # ─────────────────────────────────────────────
    # Energieleistungskennzahlen (EnPI)
    # ─────────────────────────────────────────────

    async def list_enpis(
        self, page: int = 1, page_size: int = 25, is_active: bool | None = True
    ) -> dict:
        """Alle EnPIs auflisten."""
        query = select(EnergyPerformanceIndicator)
        if is_active is not None:
            query = query.where(EnergyPerformanceIndicator.is_active == is_active)
        query = query.order_by(EnergyPerformanceIndicator.name)

        count_q = select(func.count()).select_from(query.subquery())
        total = (await self.db.execute(count_q)).scalar() or 0

        query = query.offset((page - 1) * page_size).limit(page_size)
        result = await self.db.execute(query)
        items = result.scalars().all()

        return {"items": items, "total": total, "page": page, "page_size": page_size}

    async def get_enpi(self, enpi_id: uuid.UUID) -> EnergyPerformanceIndicator:
        """Einzelnen EnPI laden."""
        enpi = await self.db.get(EnergyPerformanceIndicator, enpi_id)
        if not enpi:
            raise ValueError("EnPI nicht gefunden")
        return enpi

    async def create_enpi(self, data: dict) -> EnergyPerformanceIndicator:
        """Neuen EnPI anlegen."""
        enpi = EnergyPerformanceIndicator(**data)
        self.db.add(enpi)
        await self.db.commit()
        await self.db.refresh(enpi)
        return enpi

    async def update_enpi(
        self, enpi_id: uuid.UUID, data: dict
    ) -> EnergyPerformanceIndicator:
        """EnPI aktualisieren."""
        enpi = await self.get_enpi(enpi_id)
        for key, value in data.items():
            if hasattr(enpi, key):
                setattr(enpi, key, value)
        await self.db.commit()
        await self.db.refresh(enpi)
        return enpi

    async def delete_enpi(self, enpi_id: uuid.UUID) -> None:
        """EnPI deaktivieren."""
        enpi = await self.get_enpi(enpi_id)
        enpi.is_active = False
        await self.db.commit()

    async def calculate_enpi(
        self, enpi_id: uuid.UUID, period_start: date, period_end: date
    ) -> EnPIValue:
        """
        EnPI für einen Zeitraum berechnen und speichern.

        Numerator: Summe der Consumption-Werte der zugeordneten Zähler
        Denominator: Wert der Bezugsvariable oder fester Wert
        EnPI = Numerator / Denominator (bei 'specific'/'ratio')
        EnPI = Numerator (bei 'absolute')
        """
        enpi = await self.get_enpi(enpi_id)

        # Numerator: Verbrauch aus Zählern
        meter_ids = [uuid.UUID(m) for m in enpi.numerator_meter_ids if m]
        if not meter_ids:
            raise ValueError("Keine Zähler zugeordnet")

        consumption_q = select(func.sum(MeterReading.consumption)).where(
            MeterReading.meter_id.in_(meter_ids),
            MeterReading.timestamp >= period_start,
            MeterReading.timestamp < period_end,
            MeterReading.consumption.isnot(None),
        )
        numerator = (await self.db.execute(consumption_q)).scalar() or Decimal("0")

        # Denominator
        denominator = None
        if enpi.formula_type in ("specific", "ratio"):
            if enpi.denominator_fixed_value:
                denominator = enpi.denominator_fixed_value
            elif enpi.denominator_variable_id:
                # Werte im Zeitraum suchen (exakte Überlappung)
                var_q = select(func.sum(RelevantVariableValue.value)).where(
                    RelevantVariableValue.variable_id == enpi.denominator_variable_id,
                    RelevantVariableValue.period_start >= period_start,
                    RelevantVariableValue.period_end <= period_end,
                )
                denominator = (await self.db.execute(var_q)).scalar()

                # Fallback: letzten gültigen Wert nehmen (z.B. Fläche)
                if not denominator:
                    fallback_q = (
                        select(RelevantVariableValue.value)
                        .where(
                            RelevantVariableValue.variable_id == enpi.denominator_variable_id,
                            RelevantVariableValue.period_start <= period_end,
                        )
                        .order_by(RelevantVariableValue.period_start.desc())
                        .limit(1)
                    )
                    denominator = (await self.db.execute(fallback_q)).scalar()

            if not denominator or denominator == 0:
                raise ValueError("Kein Bezugswert (Denominator) verfügbar")

            enpi_value = numerator / denominator
        else:
            # absolute
            enpi_value = numerator

        # Bestehenden Wert für den Zeitraum ersetzen
        existing = await self.db.execute(
            select(EnPIValue).where(
                EnPIValue.enpi_id == enpi_id,
                EnPIValue.period_start == period_start,
                EnPIValue.period_end == period_end,
            )
        )
        old = existing.scalar_one_or_none()
        if old:
            old.numerator_value = numerator
            old.denominator_value = denominator
            old.enpi_value = round(enpi_value, 4)
            await self.db.commit()
            await self.db.refresh(old)
            return old

        value = EnPIValue(
            enpi_id=enpi_id,
            period_start=period_start,
            period_end=period_end,
            numerator_value=numerator,
            denominator_value=denominator,
            enpi_value=round(enpi_value, 4),
        )
        self.db.add(value)
        await self.db.commit()
        await self.db.refresh(value)

        logger.info(
            "enpi_calculated",
            enpi_id=str(enpi_id),
            period=f"{period_start} – {period_end}",
            value=float(enpi_value),
        )
        return value

    async def get_enpi_trend(
        self, enpi_id: uuid.UUID,
        period_start: date | None = None,
        period_end: date | None = None,
    ) -> list[dict]:
        """EnPI-Trend-Daten für Chart laden."""
        query = (
            select(EnPIValue)
            .where(EnPIValue.enpi_id == enpi_id)
            .order_by(EnPIValue.period_start)
        )
        if period_start:
            query = query.where(EnPIValue.period_start >= period_start)
        if period_end:
            query = query.where(EnPIValue.period_end <= period_end)

        result = await self.db.execute(query)
        values = result.scalars().all()

        # Aktuelle Baseline laden
        baseline_q = select(EnergyBaseline).where(
            EnergyBaseline.enpi_id == enpi_id,
            EnergyBaseline.is_current == True,  # noqa: E712
        )
        baseline = (await self.db.execute(baseline_q)).scalar_one_or_none()
        baseline_val = (
            baseline.adjusted_baseline_value or baseline.baseline_value
        ) if baseline else None

        return [
            {
                "period_start": v.period_start,
                "period_end": v.period_end,
                "enpi_value": v.enpi_value,
                "baseline_value": baseline_val,
            }
            for v in values
        ]

    async def calculate_all_enpis(
        self, period_start: date, period_end: date
    ) -> dict:
        """Alle aktiven EnPIs für einen Zeitraum berechnen."""
        result = await self.db.execute(
            select(EnergyPerformanceIndicator).where(
                EnergyPerformanceIndicator.is_active == True  # noqa: E712
            )
        )
        enpis = result.scalars().all()

        calculated = 0
        errors = 0
        for enpi in enpis:
            try:
                await self.calculate_enpi(enpi.id, period_start, period_end)
                calculated += 1
            except Exception as e:
                errors += 1
                logger.warning("enpi_calc_failed", enpi_id=str(enpi.id), error=str(e))

        return {"calculated": calculated, "errors": errors, "total": len(enpis)}

    async def get_latest_enpi_value(
        self, enpi_id: uuid.UUID
    ) -> Decimal | None:
        """Letzten berechneten EnPI-Wert laden (ignoriert Nullwerte ohne Verbrauch)."""
        result = await self.db.execute(
            select(EnPIValue.enpi_value)
            .where(
                EnPIValue.enpi_id == enpi_id,
                EnPIValue.numerator_value > 0,
            )
            .order_by(EnPIValue.period_end.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    # ─────────────────────────────────────────────
    # Energetische Ausgangsbasis (EnB / Baseline)
    # ─────────────────────────────────────────────

    async def list_baselines(
        self, enpi_id: uuid.UUID | None = None
    ) -> list[EnergyBaseline]:
        """Baselines auflisten, optional gefiltert nach EnPI."""
        query = select(EnergyBaseline).order_by(
            EnergyBaseline.enpi_id, EnergyBaseline.period_start.desc()
        )
        if enpi_id:
            query = query.where(EnergyBaseline.enpi_id == enpi_id)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_baseline(self, baseline_id: uuid.UUID) -> EnergyBaseline:
        """Einzelne Baseline laden."""
        baseline = await self.db.get(EnergyBaseline, baseline_id)
        if not baseline:
            raise ValueError("Baseline nicht gefunden")
        return baseline

    async def create_baseline(self, data: dict) -> EnergyBaseline:
        """
        Neue Baseline anlegen.

        Berechnet automatisch den Baseline-Wert aus den EnPI-Werten
        im angegebenen Zeitraum. Setzt vorherige Baselines des
        gleichen EnPI auf is_current=False.
        """
        enpi_id = data["enpi_id"]
        period_start = data["period_start"]
        period_end = data["period_end"]

        # EnPI-Wert für den Basiszeitraum berechnen/laden
        # Durchschnitt der EnPI-Werte im Zeitraum
        avg_q = select(func.avg(EnPIValue.enpi_value)).where(
            EnPIValue.enpi_id == enpi_id,
            EnPIValue.period_start >= period_start,
            EnPIValue.period_end <= period_end,
        )
        avg_value = (await self.db.execute(avg_q)).scalar()

        # Gesamtverbrauch im Basiszeitraum
        enpi = await self.get_enpi(enpi_id)
        meter_ids = [uuid.UUID(m) for m in enpi.numerator_meter_ids if m]
        total_q = select(func.sum(MeterReading.consumption)).where(
            MeterReading.meter_id.in_(meter_ids),
            MeterReading.timestamp >= period_start,
            MeterReading.timestamp < period_end,
            MeterReading.consumption.isnot(None),
        ) if meter_ids else select(func.count())  # Fallback
        total_consumption = (await self.db.execute(total_q)).scalar() or Decimal("0")

        if avg_value is None:
            raise ValueError(
                "Keine EnPI-Werte im Basiszeitraum. "
                "Bitte zuerst EnPI berechnen."
            )

        # Vorherige Baselines deaktivieren
        prev_result = await self.db.execute(
            select(EnergyBaseline).where(
                EnergyBaseline.enpi_id == enpi_id,
                EnergyBaseline.is_current == True,  # noqa: E712
            )
        )
        for prev in prev_result.scalars().all():
            prev.is_current = False

        baseline = EnergyBaseline(
            enpi_id=enpi_id,
            name=data.get("name", f"Baseline {period_start.year}"),
            period_start=period_start,
            period_end=period_end,
            baseline_value=round(Decimal(str(avg_value)), 4),
            total_consumption_kwh=round(total_consumption, 4),
            adjustment_factors=data.get("adjustment_factors"),
            is_current=True,
        )
        self.db.add(baseline)
        await self.db.commit()
        await self.db.refresh(baseline)
        return baseline

    async def update_baseline(
        self, baseline_id: uuid.UUID, data: dict
    ) -> EnergyBaseline:
        """Baseline aktualisieren."""
        baseline = await self.get_baseline(baseline_id)
        for key, value in data.items():
            if hasattr(baseline, key):
                setattr(baseline, key, value)
        await self.db.commit()
        await self.db.refresh(baseline)
        return baseline

    async def revise_baseline(
        self, baseline_id: uuid.UUID, revision_data: dict
    ) -> EnergyBaseline:
        """
        Baseline revidieren: alte Baseline ersetzen, neue anlegen.

        Erstellt eine neue Baseline mit dem gleichen EnPI und verknüpft
        die alte über superseded_by_id.
        """
        old = await self.get_baseline(baseline_id)
        old.is_current = False

        new_data = {
            "enpi_id": old.enpi_id,
            "period_start": revision_data.get("period_start", old.period_start),
            "period_end": revision_data.get("period_end", old.period_end),
            "name": revision_data.get("name", f"Revision {old.name}"),
            "adjustment_factors": revision_data.get("adjustment_factors"),
        }
        new_baseline = await self.create_baseline(new_data)

        old.superseded_by_id = new_baseline.id
        old.revision_reason = revision_data.get("revision_reason", "")
        await self.db.commit()

        return new_baseline

    async def get_comparison(
        self, enpi_id: uuid.UUID,
        current_period_start: date,
        current_period_end: date,
    ) -> dict:
        """
        Baseline vs. aktuellen EnPI-Wert vergleichen.

        Berechnet die prozentuale Verbesserung/Verschlechterung.
        """
        enpi = await self.get_enpi(enpi_id)

        # Aktuelle Baseline
        baseline_q = select(EnergyBaseline).where(
            EnergyBaseline.enpi_id == enpi_id,
            EnergyBaseline.is_current == True,  # noqa: E712
        )
        baseline = (await self.db.execute(baseline_q)).scalar_one_or_none()
        if not baseline:
            return {
                "enpi_id": enpi_id,
                "enpi_name": enpi.name,
                "baseline_value": None,
                "adjusted_baseline_value": None,
                "current_value": None,
                "improvement_percent": None,
                "target_value": enpi.target_value,
            }

        # Aktueller EnPI-Wert (Durchschnitt im Zeitraum)
        current_q = select(func.avg(EnPIValue.enpi_value)).where(
            EnPIValue.enpi_id == enpi_id,
            EnPIValue.period_start >= current_period_start,
            EnPIValue.period_end <= current_period_end,
        )
        current_value = (await self.db.execute(current_q)).scalar()

        base_val = baseline.adjusted_baseline_value or baseline.baseline_value
        improvement = None
        if current_value is not None and base_val and base_val != 0:
            if enpi.target_direction == "lower":
                # Weniger ist besser → positive Verbesserung wenn Wert gesunken
                improvement = round((1 - Decimal(str(current_value)) / base_val) * 100, 2)
            else:
                improvement = round((Decimal(str(current_value)) / base_val - 1) * 100, 2)

        return {
            "enpi_id": enpi_id,
            "enpi_name": enpi.name,
            "baseline_value": baseline.baseline_value,
            "adjusted_baseline_value": baseline.adjusted_baseline_value,
            "current_value": Decimal(str(current_value)) if current_value else None,
            "improvement_percent": improvement,
            "target_value": enpi.target_value,
        }
