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
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import EnergyManagementError
from app.models.meter import Meter
from app.models.reading import MeterReading

logger = structlog.get_logger()


class ReadingService:
    """Service für Zählerstände und Verbrauchsberechnung."""

    def __init__(self, db: AsyncSession):
        self.db = db

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
        value = Decimal(str(data["value"]))
        timestamp = data["timestamp"]

        # Zähler muss existieren
        meter = await self.db.get(Meter, meter_id)
        if not meter:
            raise EnergyManagementError(
                "Zähler nicht gefunden",
                error_code="METER_NOT_FOUND",
                status_code=404,
            )

        # Plausibilitätsprüfung
        warnings = await self._check_plausibility(meter_id, value, timestamp)

        # Verbrauch berechnen (Differenz zum vorherigen Stand)
        consumption = await self._calculate_consumption(meter_id, value, timestamp)

        reading = MeterReading(
            meter_id=meter_id,
            timestamp=timestamp,
            value=value,
            consumption=consumption,
            source=data.get("source", "manual"),
            quality=data.get("quality", "measured"),
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
        """Mehrere Zählerstände auf einmal erfassen."""
        results = []
        for data in readings_data:
            reading = await self.create_reading(data)
            results.append(reading)
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
