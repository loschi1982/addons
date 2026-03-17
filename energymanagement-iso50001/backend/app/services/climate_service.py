"""
climate_service.py – Innenraum-Klimadaten.

Verwaltet Klimasensoren und deren Messwerte (Temperatur, Luftfeuchtigkeit).
Berechnet Komfort-Scores und Zonen-Zusammenfassungen.
"""

import math
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import structlog
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.climate import ClimateReading, ClimateSensor, ClimateZoneSummary

logger = structlog.get_logger()


def calculate_dew_point(temperature_c: float, relative_humidity: float) -> float:
    """Taupunkt berechnen (Magnus-Formel)."""
    if relative_humidity <= 0:
        return 0.0
    a = 17.271
    b = 237.7
    gamma = (a * temperature_c / (b + temperature_c)) + math.log(relative_humidity / 100.0)
    return round((b * gamma) / (a - gamma), 2)


def calculate_comfort_score(
    temperature: float,
    humidity: float | None,
    target_temp_min: float = 20.0,
    target_temp_max: float = 24.0,
    target_humidity_min: float = 40.0,
    target_humidity_max: float = 60.0,
) -> Decimal:
    """
    Behaglichkeits-Score berechnen (0–100).

    100 = perfekt im Sollbereich, 0 = extrem außerhalb.
    Gewichtung: Temperatur 60%, Feuchte 40%.
    """
    # Temperatur-Score (0–100)
    temp_mid = (target_temp_min + target_temp_max) / 2
    temp_range = (target_temp_max - target_temp_min) / 2
    if target_temp_min <= temperature <= target_temp_max:
        temp_score = 100.0
    else:
        deviation = min(abs(temperature - target_temp_min), abs(temperature - target_temp_max))
        # Pro 1°C Abweichung 15 Punkte Abzug
        temp_score = max(0.0, 100.0 - deviation * 15)

    # Feuchte-Score
    if humidity is not None:
        if target_humidity_min <= humidity <= target_humidity_max:
            hum_score = 100.0
        else:
            deviation = min(
                abs(humidity - target_humidity_min), abs(humidity - target_humidity_max)
            )
            hum_score = max(0.0, 100.0 - deviation * 5)

        score = temp_score * 0.6 + hum_score * 0.4
    else:
        score = temp_score

    return Decimal(str(round(score, 1)))


class ClimateService:
    """Service für Klimasensoren und Komfort-Analyse."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_sensors(
        self,
        zone: str | None = None,
        is_active: bool | None = True,
        page: int = 1,
        page_size: int = 25,
    ) -> dict:
        """Klimasensoren auflisten."""
        query = select(ClimateSensor)
        if zone:
            query = query.where(ClimateSensor.zone == zone)
        if is_active is not None:
            query = query.where(ClimateSensor.is_active == is_active)

        # Total
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.db.execute(count_query)).scalar() or 0

        query = query.order_by(ClimateSensor.name).offset((page - 1) * page_size).limit(page_size)
        result = await self.db.execute(query)

        return {
            "items": list(result.scalars().all()),
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    async def create_sensor(self, data: dict) -> ClimateSensor:
        """Neuen Klimasensor anlegen."""
        sensor = ClimateSensor(**data)
        self.db.add(sensor)
        await self.db.commit()
        await self.db.refresh(sensor)
        return sensor

    async def get_sensor(self, sensor_id: uuid.UUID) -> ClimateSensor:
        """Klimasensor abrufen."""
        sensor = await self.db.get(ClimateSensor, sensor_id)
        if not sensor:
            raise ValueError("Klimasensor nicht gefunden")
        return sensor

    async def update_sensor(self, sensor_id: uuid.UUID, data: dict) -> ClimateSensor:
        """Klimasensor aktualisieren."""
        sensor = await self.db.get(ClimateSensor, sensor_id)
        if not sensor:
            raise ValueError("Klimasensor nicht gefunden")
        for key, value in data.items():
            if hasattr(sensor, key):
                setattr(sensor, key, value)
        await self.db.commit()
        await self.db.refresh(sensor)
        return sensor

    async def delete_sensor(self, sensor_id: uuid.UUID) -> None:
        """Klimasensor deaktivieren."""
        sensor = await self.db.get(ClimateSensor, sensor_id)
        if not sensor:
            raise ValueError("Klimasensor nicht gefunden")
        sensor.is_active = False
        await self.db.commit()

    async def create_reading(self, data: dict) -> ClimateReading:
        """Klimamesswert erfassen (inkl. Taupunkt-Berechnung)."""
        temp = data.get("temperature")
        humidity = data.get("humidity")

        # Taupunkt automatisch berechnen
        dew_point = None
        if temp is not None and humidity is not None:
            dew_point = Decimal(
                str(calculate_dew_point(float(temp), float(humidity)))
            )

        reading = ClimateReading(
            sensor_id=data["sensor_id"],
            timestamp=data.get("timestamp", datetime.now(timezone.utc)),
            temperature=temp,
            humidity=humidity,
            dew_point=dew_point,
            source=data.get("source", "manual"),
            quality=data.get("quality", "measured"),
        )
        self.db.add(reading)
        await self.db.commit()
        await self.db.refresh(reading)
        return reading

    async def list_readings(
        self,
        sensor_id: uuid.UUID | None = None,
        start: datetime | None = None,
        end: datetime | None = None,
        page: int = 1,
        page_size: int = 100,
    ) -> dict:
        """Klimamesswerte auflisten."""
        query = select(ClimateReading)
        if sensor_id:
            query = query.where(ClimateReading.sensor_id == sensor_id)
        if start:
            query = query.where(ClimateReading.timestamp >= start)
        if end:
            query = query.where(ClimateReading.timestamp <= end)

        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.db.execute(count_query)).scalar() or 0

        query = (
            query.order_by(ClimateReading.timestamp.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        result = await self.db.execute(query)

        return {
            "items": list(result.scalars().all()),
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    async def get_comfort_dashboard(
        self, period_start: date | None = None, period_end: date | None = None
    ) -> dict:
        """Komfort-Dashboard-Daten berechnen."""
        from datetime import timedelta

        if not period_end:
            period_end = date.today()
        if not period_start:
            period_start = period_end - timedelta(days=30)

        # Aktuelle Messwerte je Sensor (letzter Wert)
        sensors_result = await self.db.execute(
            select(ClimateSensor).where(ClimateSensor.is_active == True)  # noqa: E712
        )
        sensors = sensors_result.scalars().all()

        current_readings = []
        alerts = []

        for sensor in sensors:
            # Letzten Messwert laden
            reading_result = await self.db.execute(
                select(ClimateReading)
                .where(ClimateReading.sensor_id == sensor.id)
                .order_by(ClimateReading.timestamp.desc())
                .limit(1)
            )
            reading = reading_result.scalar_one_or_none()
            if reading:
                current_readings.append(reading)

                # Comfort-Score berechnen
                if reading.temperature is not None:
                    score = calculate_comfort_score(
                        float(reading.temperature),
                        float(reading.humidity) if reading.humidity else None,
                        float(sensor.target_temp_min or 20),
                        float(sensor.target_temp_max or 24),
                        float(sensor.target_humidity_min or 40),
                        float(sensor.target_humidity_max or 60),
                    )

                    if float(score) < 50:
                        alerts.append({
                            "sensor_id": str(sensor.id),
                            "sensor_name": sensor.name,
                            "zone": sensor.zone,
                            "comfort_score": float(score),
                            "temperature": float(reading.temperature),
                            "humidity": float(reading.humidity) if reading.humidity else None,
                            "type": "low_comfort",
                            "message": f"Niedriger Komfort-Score ({score}) in {sensor.name}",
                        })

        # Zonen-Zusammenfassungen
        zones = await self.get_zone_summaries(period_start, period_end)

        return {
            "zones": zones,
            "current_readings": current_readings,
            "alerts": alerts,
        }

    async def get_zone_summaries(self, period_start: date, period_end: date) -> list:
        """Zonen-Zusammenfassungen berechnen."""
        # Alle aktiven Zonen ermitteln
        zone_result = await self.db.execute(
            select(ClimateSensor.zone)
            .where(
                ClimateSensor.is_active == True,  # noqa: E712
                ClimateSensor.zone.isnot(None),
            )
            .distinct()
        )
        zones = [z for (z,) in zone_result.all()]

        summaries = []
        for zone in zones:
            # Sensor-IDs in dieser Zone
            sensor_result = await self.db.execute(
                select(ClimateSensor.id).where(
                    ClimateSensor.zone == zone,
                    ClimateSensor.is_active == True,  # noqa: E712
                )
            )
            sensor_ids = [sid for (sid,) in sensor_result.all()]
            if not sensor_ids:
                continue

            start_dt = datetime.combine(period_start, datetime.min.time(), tzinfo=timezone.utc)
            end_dt = datetime.combine(period_end, datetime.min.time(), tzinfo=timezone.utc)

            # Aggregation
            agg_result = await self.db.execute(
                select(
                    func.avg(ClimateReading.temperature),
                    func.min(ClimateReading.temperature),
                    func.max(ClimateReading.temperature),
                    func.avg(ClimateReading.humidity),
                    func.min(ClimateReading.humidity),
                    func.max(ClimateReading.humidity),
                    func.count(),
                ).where(
                    ClimateReading.sensor_id.in_(sensor_ids),
                    ClimateReading.timestamp >= start_dt,
                    ClimateReading.timestamp <= end_dt,
                )
            )
            row = agg_result.one()
            avg_t, min_t, max_t, avg_h, min_h, max_h, count = row

            if not count or count == 0:
                continue

            # Comfort-Score für die Zone
            comfort = calculate_comfort_score(
                float(avg_t) if avg_t else 22.0,
                float(avg_h) if avg_h else None,
            )

            summaries.append({
                "zone": zone,
                "period_start": period_start,
                "period_end": period_end,
                "avg_temperature": Decimal(str(round(float(avg_t), 2))) if avg_t else Decimal("0"),
                "min_temperature": Decimal(str(round(float(min_t), 2))) if min_t else Decimal("0"),
                "max_temperature": Decimal(str(round(float(max_t), 2))) if max_t else Decimal("0"),
                "avg_humidity": Decimal(str(round(float(avg_h), 1))) if avg_h else Decimal("0"),
                "min_humidity": Decimal(str(round(float(min_h), 1))) if min_h else Decimal("0"),
                "max_humidity": Decimal(str(round(float(max_h), 1))) if max_h else Decimal("0"),
                "hours_below_target_temp": Decimal("0"),
                "hours_above_target_temp": Decimal("0"),
                "hours_outside_target_humidity": Decimal("0"),
                "comfort_score": comfort,
            })

        return summaries
