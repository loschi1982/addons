"""
reading_service.py – Zählerstand-Verwaltung und Verbrauchsberechnung.

Zählerstände werden erfasst und der Verbrauch als Differenz
aufeinanderfolgender Stände berechnet. Plausibilitätsprüfungen
warnen bei ungewöhnlichen Werten.

Plausibilitätsregeln:
- Warnung bei Sprüngen > 3× Standardabweichung
- Warnung bei Rückgang (außer Zählerwechsel)
- Chronologie: Stände müssen monoton steigend sein
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import structlog
from sqlalchemy import and_, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import EnergyManagementError
from app.models.meter import Meter
from app.models.reading import MeterReading
from app.models.settings import AppSetting
from app.models.snapshot import MeterConsumptionStat, MeterMonthlyConsumption

# Schlüssel + Default-Parameter der vorberechneten Ausreißerliste.
OUTLIER_SNAPSHOT_KEY = "outlier_snapshot_default"
OUTLIER_DEFAULT_FACTOR = 10.0
OUTLIER_DEFAULT_MIN_VALUE = 100.0
# Pro Energieart die Top-N (nach Faktor) ablegen, damit auch der Energieart-
# Filter im Endpunkt vollständig ist. Der Endpunkt liefert max. 500 Zeilen.
OUTLIER_PER_TYPE_LIMIT = 500
OUTLIER_PER_METER_LIMIT = 500

logger = structlog.get_logger()


class ReadingService:
    """Service für Zählerstände und Verbrauchsberechnung."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def recompute_consumption_stats(self) -> int:
        """Median des Verbrauchs je Zähler vorberechnen (für Ausreißererkennung).

        Berechnet den percentile_cont-Median über alle gültigen Readings je
        Zähler in EINER Query und ersetzt die `meter_consumption_stats`-Tabelle
        atomar (DELETE + INSERT in einer Transaktion). Der teure Median-Sort
        läuft damit offline (Celery) statt bei jedem Seitenaufruf live.
        """
        rows = (await self.db.execute(text(
            """
            SELECT meter_id,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY consumption) AS median,
                   count(*) AS cnt
            FROM meter_readings
            WHERE consumption > 0 AND quality <> 'outlier'
            GROUP BY meter_id
            """
        ))).all()

        # Atomarer Tausch: DELETE + INSERT in einer Transaktion → Leser sehen
        # via MVCC bis zum Commit den alten Stand, nie eine leere Tabelle.
        await self.db.execute(text("DELETE FROM meter_consumption_stats"))
        now = datetime.now(timezone.utc)
        for r in rows:
            self.db.add(MeterConsumptionStat(
                meter_id=r.meter_id,
                median_consumption=r.median,
                reading_count=int(r.cnt or 0),
                computed_at=now,
            ))
        await self.db.commit()
        logger.info("consumption_stats_recomputed", meters=len(rows))
        return len(rows)

    async def recompute_monthly_consumption(self) -> int:
        """Verbrauch + Kosten je (Zähler, Jahr, Monat) vorberechnen.

        Eine GROUP-BY-Query über alle Readings (offline), atomarer Tausch der
        Tabelle meter_monthly_consumption. Quelle für Monatsvergleich,
        Energiebilanz und die Per-Monat-Auswahl (meter_ids_with_data_by_month).
        Session-TZ ist UTC → EXTRACT(year/month) liefert UTC-Kalendermonate,
        konsistent zu date_trunc('month', timestamp) in den Aggregationen.
        """
        rows = (await self.db.execute(text(
            """
            SELECT mr.meter_id,
                   m.energy_type,
                   m.unit,
                   EXTRACT(YEAR FROM mr.timestamp)::int  AS yr,
                   EXTRACT(MONTH FROM mr.timestamp)::int AS mo,
                   SUM(mr.consumption) AS cons,
                   SUM(mr.cost_net)    AS cost
            FROM meter_readings mr
            JOIN meters m ON m.id = mr.meter_id
            WHERE mr.consumption IS NOT NULL
            GROUP BY mr.meter_id, m.energy_type, m.unit,
                     EXTRACT(YEAR FROM mr.timestamp), EXTRACT(MONTH FROM mr.timestamp)
            """
        ))).all()

        # Atomarer Tausch (DELETE + INSERT in einer Transaktion → Leser sehen
        # via MVCC bis zum Commit den alten Stand, nie eine leere Tabelle).
        await self.db.execute(text("DELETE FROM meter_monthly_consumption"))
        now = datetime.now(timezone.utc)
        for r in rows:
            self.db.add(MeterMonthlyConsumption(
                meter_id=r.meter_id,
                energy_type=r.energy_type,
                unit=r.unit or "kWh",
                year=int(r.yr),
                month=int(r.mo),
                consumption_native=r.cons or 0,
                cost_net=r.cost,
                computed_at=now,
            ))
        await self.db.commit()
        logger.info("monthly_consumption_recomputed", rows=len(rows))
        return len(rows)

    async def recompute_outlier_snapshot(
        self,
        factor: float = OUTLIER_DEFAULT_FACTOR,
        min_value: float = OUTLIER_DEFAULT_MIN_VALUE,
    ) -> int:
        """Default-Ausreißerliste vorberechnen und in AppSetting ablegen.

        Findet die Ausreißer-Readings (consumption > max(median×Faktor, min_value))
        über die vorberechnete Median-Tabelle und legt je Energieart die Top-N
        (nach Faktor) als JSON ab – so ist auch der Energieart-Filter im Endpunkt
        vollständig. Der /readings/outliers-Endpunkt liefert für die Default-
        Parameter dann direkt aus diesem Snapshot (Sub-Sekunde), statt über alle
        Timescale-Chunks zu scannen. Muss NACH recompute_consumption_stats laufen.
        """
        rows = (await self.db.execute(text(
            """
            WITH ranked AS (
                SELECT mr.id, s.meter_id, m.name AS meter_name, m.energy_type,
                       mr.timestamp, mr.value, mr.consumption, mr.quality,
                       s.median_consumption AS median,
                       ROW_NUMBER() OVER (
                           PARTITION BY m.energy_type
                           ORDER BY mr.consumption / s.median_consumption DESC
                       ) AS rn
                FROM meter_consumption_stats s
                JOIN meters m ON m.id = s.meter_id
                JOIN LATERAL (
                    SELECT r.id, r.timestamp, r.value, r.consumption, r.quality
                    FROM meter_readings r
                    WHERE r.meter_id = s.meter_id
                      AND r.quality <> 'outlier'
                      AND r.consumption > GREATEST(s.median_consumption * :factor, :min_value)
                    ORDER BY r.consumption DESC
                    LIMIT :per_meter_limit
                ) mr ON true
                WHERE s.median_consumption >= 1
                  AND m.is_active = true
                  AND m.is_feed_in IS NOT TRUE
            )
            SELECT id, meter_id, meter_name, energy_type, timestamp, value,
                   consumption, quality, median
            FROM ranked
            WHERE rn <= :per_type_limit
            ORDER BY (consumption / median) DESC
            """
        ), {
            "factor": factor,
            "min_value": min_value,
            "per_meter_limit": OUTLIER_PER_METER_LIMIT,
            "per_type_limit": OUTLIER_PER_TYPE_LIMIT,
        })).all()

        items = []
        for r in rows:
            median = float(r.median or 0)
            cons = float(r.consumption or 0)
            items.append({
                "reading_id": str(r.id),
                "meter_id": str(r.meter_id),
                "meter_name": r.meter_name,
                "energy_type": r.energy_type,
                "timestamp": r.timestamp.isoformat(),
                "value": float(r.value or 0),
                "consumption": cons,
                "median_consumption": round(median, 2),
                "factor": round(cons / median, 1) if median > 0 else 0,
                "quality": r.quality or "measured",
            })

        payload = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "factor": factor,
            "min_value": min_value,
            "items": items,
        }
        setting = (await self.db.execute(
            select(AppSetting).where(AppSetting.key == OUTLIER_SNAPSHOT_KEY)
        )).scalar_one_or_none()
        if setting:
            setting.value = payload
        else:
            self.db.add(AppSetting(
                key=OUTLIER_SNAPSHOT_KEY,
                value=payload,
                category="internal",
                description="Vorberechnete Ausreißerliste (Default-Parameter) für /readings/outliers",
            ))
        await self.db.commit()
        logger.info("outlier_snapshot_recomputed", outliers=len(items))
        return len(items)

    async def prune_outlier_snapshot(self, reading_ids: set[str]) -> None:
        """Aktionierte Readings (Flag/Delete) aus dem vorberechneten Ausreißer-
        Snapshot entfernen, damit sie nach der Aktion nicht beim nächsten Laden
        wieder auftauchen (bis zur nächsten vollständigen Vorberechnung)."""
        if not reading_ids:
            return
        setting = (await self.db.execute(
            select(AppSetting).where(AppSetting.key == OUTLIER_SNAPSHOT_KEY)
        )).scalar_one_or_none()
        if not setting or not setting.value:
            return
        payload = dict(setting.value)
        items = payload.get("items") or []
        filtered = [it for it in items if it.get("reading_id") not in reading_ids]
        if len(filtered) != len(items):
            payload["items"] = filtered
            setting.value = payload  # Neuzuweisung → ORM erkennt die Änderung
            await self.db.commit()

    async def list_readings(
        self,
        meter_id: uuid.UUID | None = None,
        start_date: date | None = None,
        end_date: date | None = None,
        source: str | None = None,
        page: int = 1,
        page_size: int = 25,
    ) -> dict:
        """Zählerstände auflisten mit Filtern und Pagination."""
        query = select(MeterReading)

        if meter_id:
            query = query.where(MeterReading.meter_id == meter_id)
        if start_date:
            query = query.where(MeterReading.timestamp >= datetime.combine(
                start_date, datetime.min.time(), tzinfo=timezone.utc
            ))
        if end_date:
            query = query.where(MeterReading.timestamp <= datetime.combine(
                end_date, datetime.max.time(), tzinfo=timezone.utc
            ))
        if source:
            query = query.where(MeterReading.source == source)

        # Gesamtanzahl
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.db.execute(count_query)).scalar() or 0

        # Pagination (neueste zuerst)
        offset = (page - 1) * page_size
        query = query.offset(offset).limit(page_size).order_by(
            MeterReading.timestamp.desc()
        )

        result = await self.db.execute(query)
        readings = result.scalars().all()

        return {
            "items": list(readings),
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    async def create_reading(self, data: dict) -> MeterReading:
        """
        Zählerstand erfassen und Verbrauch berechnen.

        1. Zähler prüfen
        2. Plausibilitätsprüfung
        3. Verbrauch als Differenz zum Vorgänger berechnen
        4. Speichern
        """
        meter_id = data["meter_id"]
        value = Decimal(str(data["value"])) if data.get("value") is not None else None
        timestamp = data["timestamp"]
        quality = data.get("quality", "measured")

        # Zähler muss existieren
        meter = await self.db.get(Meter, meter_id)
        if not meter:
            raise EnergyManagementError(
                "Zähler nicht gefunden",
                error_code="METER_NOT_FOUND",
                status_code=404,
            )

        # Duplikat-Prüfung: gleicher Zähler + gleicher Zeitstempel
        existing = await self.db.scalar(
            select(func.count(MeterReading.id)).where(
                MeterReading.meter_id == meter_id,
                MeterReading.timestamp == timestamp,
            )
        )
        if existing:
            raise EnergyManagementError(
                f"Für diesen Zähler existiert bereits ein Messwert zum Zeitpunkt {timestamp}",
                error_code="DUPLICATE_READING",
                status_code=409,
            )

        # Verbrauch-Direkteingabe (z.B. aus Monatsabrechnung ohne Zählerstand)
        consumption_direct = data.get("consumption_direct")
        if consumption_direct is not None and data.get("value") is None:
            consumption = Decimal(str(consumption_direct))
            # Letzten bekannten Stand laden und Zählerstand schätzen
            prev = await self._get_previous_reading(meter_id, timestamp)
            value = (prev.value + consumption) if prev else consumption
            quality = "estimated"
            warnings = []
        # Lieferungsbasiert: Wert IST der Verbrauch (keine Differenz)
        elif meter.is_delivery_based:
            warnings = []
            consumption = value
        else:
            # Plausibilitätsprüfung
            warnings = await self._check_plausibility(meter_id, value, timestamp)
            # Verbrauch berechnen (Differenz zum vorherigen Stand)
            consumption = await self._calculate_consumption(meter_id, value, timestamp)

        # Kosten: Netto aus Brutto + MwSt berechnen
        cost_gross = Decimal(str(data["cost_gross"])) if data.get("cost_gross") else None
        vat_rate = Decimal(str(data["vat_rate"])) if data.get("vat_rate") else None
        cost_net = None
        if cost_gross is not None and vat_rate is not None:
            cost_net = (cost_gross / (1 + vat_rate / 100)).quantize(Decimal("0.01"))

        reading = MeterReading(
            meter_id=meter_id,
            timestamp=timestamp,
            value=value,
            consumption=consumption,
            source=data.get("source", "manual"),
            quality=quality,
            cost_gross=cost_gross,
            vat_rate=vat_rate,
            cost_net=cost_net,
            notes=data.get("notes"),
        )
        self.db.add(reading)

        # Nachfolger-Verbrauch aktualisieren (falls bereits ein späterer Wert existiert)
        await self._update_successor_consumption(meter_id, timestamp, value)

        await self.db.commit()

        if warnings:
            logger.warning(
                "reading_plausibility_warnings",
                meter_id=str(meter_id),
                warnings=warnings,
            )

        return reading

    async def create_readings_bulk(self, readings_data: list[dict]) -> list[MeterReading]:
        """Mehrere Zählerstände auf einmal erfassen. Duplikate werden übersprungen."""
        results = []
        for data in readings_data:
            try:
                reading = await self.create_reading(data)
                results.append(reading)
            except EnergyManagementError as e:
                if e.error_code == "DUPLICATE_READING":
                    logger.info("duplicate_reading_skipped", timestamp=str(data.get("timestamp")))
                    continue
                raise
        return results

    async def get_reading(self, reading_id: uuid.UUID) -> MeterReading:
        """Einzelnen Zählerstand laden."""
        reading = await self.db.get(MeterReading, reading_id)
        if not reading:
            raise EnergyManagementError(
                "Zählerstand nicht gefunden",
                error_code="READING_NOT_FOUND",
                status_code=404,
            )
        return reading

    async def update_reading(self, reading_id: uuid.UUID, data: dict) -> MeterReading:
        """
        Zählerstand korrigieren und Verbrauch neu berechnen.

        Aktualisiert auch den Verbrauch des Nachfolgers.
        """
        reading = await self.get_reading(reading_id)

        if "value" in data and data["value"] is not None:
            reading.value = Decimal(str(data["value"]))
            # Verbrauch neu berechnen
            reading.consumption = await self._calculate_consumption(
                reading.meter_id, reading.value, reading.timestamp
            )
            # Nachfolger aktualisieren
            await self._update_successor_consumption(
                reading.meter_id, reading.timestamp, reading.value
            )

        if "timestamp" in data and data["timestamp"] is not None:
            reading.timestamp = data["timestamp"]
        if "quality" in data and data["quality"] is not None:
            reading.quality = data["quality"]
        if "notes" in data:
            reading.notes = data["notes"]

        # Kosten aktualisieren
        if "cost_gross" in data:
            reading.cost_gross = Decimal(str(data["cost_gross"])) if data["cost_gross"] else None
        if "vat_rate" in data:
            reading.vat_rate = Decimal(str(data["vat_rate"])) if data["vat_rate"] else None
        if reading.cost_gross is not None and reading.vat_rate is not None:
            reading.cost_net = (reading.cost_gross / (1 + reading.vat_rate / 100)).quantize(Decimal("0.01"))
        else:
            reading.cost_net = None

        await self.db.commit()
        return reading

    async def delete_reading(self, reading_id: uuid.UUID) -> None:
        """Zählerstand löschen und Nachfolger-Verbrauch neu berechnen."""
        reading = await self.get_reading(reading_id)
        meter_id = reading.meter_id
        timestamp = reading.timestamp

        await self.db.delete(reading)

        # Nachfolger-Verbrauch aktualisieren
        successor = await self._get_next_reading(meter_id, timestamp)
        if successor:
            predecessor = await self._get_previous_reading(meter_id, successor.timestamp)
            if predecessor:
                successor.consumption = successor.value - predecessor.value
            else:
                successor.consumption = None

        await self.db.commit()

    async def get_consumption_summary(
        self,
        meter_ids: list[uuid.UUID],
        start_date: date,
        end_date: date,
        granularity: str = "monthly",
    ) -> list[dict]:
        """
        Verbrauchszusammenfassung für Zeitraum berechnen.

        Aggregiert die Verbrauchswerte (consumption) nach Granularität.
        """
        results = []

        for meter_id in meter_ids:
            meter = await self.db.get(Meter, meter_id)
            if not meter:
                continue

            # Alle Readings im Zeitraum
            query = select(MeterReading).where(
                MeterReading.meter_id == meter_id,
                MeterReading.timestamp >= datetime.combine(
                    start_date, datetime.min.time(), tzinfo=timezone.utc
                ),
                MeterReading.timestamp <= datetime.combine(
                    end_date, datetime.max.time(), tzinfo=timezone.utc
                ),
                MeterReading.consumption.isnot(None),
            ).order_by(MeterReading.timestamp)

            result = await self.db.execute(query)
            readings = result.scalars().all()

            total = sum(r.consumption for r in readings if r.consumption)
            data_points = [
                {
                    "timestamp": r.timestamp.isoformat(),
                    "value": float(r.consumption),
                    "unit": meter.unit,
                }
                for r in readings
                if r.consumption
            ]

            days = (end_date - start_date).days or 1
            daily_values = [float(r.consumption) for r in readings if r.consumption]

            results.append({
                "meter_id": meter_id,
                "meter_name": meter.name,
                "energy_type": meter.energy_type,
                "period_start": start_date,
                "period_end": end_date,
                "total_consumption": total,
                "unit": meter.unit,
                "data_points": data_points,
                "avg_daily": total / days if total else None,
                "min_daily": min(daily_values) if daily_values else None,
                "max_daily": max(daily_values) if daily_values else None,
            })

        return results

    # ── Plausibilitätsprüfung ──

    async def _check_plausibility(
        self, meter_id: uuid.UUID, value: Decimal, timestamp: datetime
    ) -> list[dict]:
        """
        Plausibilitätsprüfung: Rückgang, Ausreißer, Lücken.

        Returns:
            Liste von Warnungen (leer wenn alles OK)
        """
        warnings = []

        # Vorherigen Stand laden
        prev = await self._get_previous_reading(meter_id, timestamp)

        if prev:
            # Rückgang-Prüfung (Zählerstand darf nicht sinken)
            if value < prev.value:
                warnings.append({
                    "type": "value_decrease",
                    "message": f"Zählerstand sinkt von {prev.value} auf {value} – "
                               f"möglicherweise Zählerwechsel?",
                    "previous_value": float(prev.value),
                    "new_value": float(value),
                })

            # Ausreißer-Prüfung (> 3× durchschnittlicher Verbrauch)
            avg_consumption = await self._get_avg_consumption(meter_id)
            if avg_consumption and avg_consumption > 0:
                diff = value - prev.value
                if diff > 0 and diff > avg_consumption * 3:
                    warnings.append({
                        "type": "outlier",
                        "message": f"Verbrauch {diff} ist > 3× Durchschnitt ({avg_consumption})",
                        "consumption": float(diff),
                        "avg_consumption": float(avg_consumption),
                    })

        return warnings

    async def _calculate_consumption(
        self, meter_id: uuid.UUID, value: Decimal, timestamp: datetime
    ) -> Decimal | None:
        """Verbrauch als Differenz zum vorherigen Stand berechnen."""
        prev = await self._get_previous_reading(meter_id, timestamp)
        if prev is None:
            return None

        diff = value - prev.value
        # Negativer Verbrauch = vermutlich Zählerwechsel → consumption = None
        if diff < 0:
            return None
        return diff

    async def _update_successor_consumption(
        self, meter_id: uuid.UUID, timestamp: datetime, value: Decimal
    ) -> None:
        """Verbrauch des nachfolgenden Stands aktualisieren."""
        successor = await self._get_next_reading(meter_id, timestamp)
        if successor:
            diff = successor.value - value
            successor.consumption = diff if diff >= 0 else None

    async def _get_previous_reading(
        self, meter_id: uuid.UUID, timestamp: datetime
    ) -> MeterReading | None:
        """Vorherigen Zählerstand laden."""
        result = await self.db.execute(
            select(MeterReading)
            .where(
                MeterReading.meter_id == meter_id,
                MeterReading.timestamp < timestamp,
            )
            .order_by(MeterReading.timestamp.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _get_next_reading(
        self, meter_id: uuid.UUID, timestamp: datetime
    ) -> MeterReading | None:
        """Nachfolgenden Zählerstand laden."""
        result = await self.db.execute(
            select(MeterReading)
            .where(
                MeterReading.meter_id == meter_id,
                MeterReading.timestamp > timestamp,
            )
            .order_by(MeterReading.timestamp.asc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _get_avg_consumption(self, meter_id: uuid.UUID) -> Decimal | None:
        """Durchschnittlichen Verbrauch pro Ablesung berechnen."""
        result = await self.db.execute(
            select(func.avg(MeterReading.consumption)).where(
                MeterReading.meter_id == meter_id,
                MeterReading.consumption.isnot(None),
                MeterReading.consumption > 0,
            )
        )
        avg = result.scalar()
        return Decimal(str(avg)) if avg else None
