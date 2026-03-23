"""
weather_service.py – Wetterdaten und Witterungskorrektur.

Bezieht Wetterdaten vom DWD (Bright Sky API), berechnet Gradtagszahlen
und führt die Witterungskorrektur des Heizenergieverbrauchs durch.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import structlog
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.bright_sky import BrightSkyClient
from app.models.correction import WeatherCorrectedConsumption, WeatherCorrectionConfig
from app.models.reading import MeterReading
from app.models.weather import MonthlyDegreeDays, WeatherRecord, WeatherStation

logger = structlog.get_logger()


class WeatherService:
    """Service für Wetterdaten und Gradtagszahlen."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_stations(self, search: str | None = None) -> list:
        """Wetterstationen auflisten."""
        query = select(WeatherStation).where(WeatherStation.is_active == True)  # noqa: E712
        if search:
            query = query.where(WeatherStation.name.ilike(f"%{search}%"))
        query = query.order_by(WeatherStation.name)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def create_station(self, data: dict) -> WeatherStation:
        """Neue Wetterstation anlegen."""
        station = WeatherStation(**data)
        self.db.add(station)
        await self.db.commit()
        await self.db.refresh(station)
        return station

    async def find_nearest_station(
        self, lat: Decimal, lon: Decimal, max_km: int = 50
    ) -> WeatherStation | None:
        """Nächste Wetterstation zu gegebenen Koordinaten finden.

        Berechnet die Distanz per Haversine-Approximation
        (ausreichend für Entfernungen < 500 km).
        """
        result = await self.db.execute(
            select(WeatherStation).where(WeatherStation.is_active == True)  # noqa: E712
        )
        stations = result.scalars().all()
        if not stations:
            return None

        import math
        best = None
        best_dist = float("inf")
        lat_f = float(lat)
        lon_f = float(lon)

        for s in stations:
            # Vereinfachte Distanzberechnung (Großkreis)
            dlat = math.radians(s.latitude - lat_f)
            dlon = math.radians(s.longitude - lon_f)
            a = (
                math.sin(dlat / 2) ** 2
                + math.cos(math.radians(lat_f))
                * math.cos(math.radians(s.latitude))
                * math.sin(dlon / 2) ** 2
            )
            dist = 6371 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
            if dist < best_dist and dist <= max_km:
                best_dist = dist
                best = s

        return best

    async def get_weather_data(
        self, station_id: uuid.UUID, start_date: date, end_date: date
    ) -> list:
        """Wetterdaten für Station und Zeitraum abrufen."""
        result = await self.db.execute(
            select(WeatherRecord)
            .where(
                WeatherRecord.station_id == station_id,
                WeatherRecord.date >= start_date,
                WeatherRecord.date <= end_date,
            )
            .order_by(WeatherRecord.date)
        )
        return list(result.scalars().all())

    async def get_degree_days(
        self, station_id: uuid.UUID, start_date: date, end_date: date
    ) -> dict:
        """Gradtagszahlen für Zeitraum berechnen/abrufen."""
        station = await self.db.get(WeatherStation, station_id)
        if not station:
            raise ValueError("Wetterstation nicht gefunden")

        # Monatliche Gradtagszahlen aus der Tabelle laden
        result = await self.db.execute(
            select(MonthlyDegreeDays)
            .where(
                MonthlyDegreeDays.station_id == station_id,
                and_(
                    (MonthlyDegreeDays.year * 100 + MonthlyDegreeDays.month)
                    >= (start_date.year * 100 + start_date.month),
                    (MonthlyDegreeDays.year * 100 + MonthlyDegreeDays.month)
                    <= (end_date.year * 100 + end_date.month),
                ),
            )
            .order_by(MonthlyDegreeDays.year, MonthlyDegreeDays.month)
        )
        monthly = list(result.scalars().all())

        total_hdd = sum(m.heating_degree_days for m in monthly)
        total_cdd = sum(m.cooling_degree_days for m in monthly)

        return {
            "station_id": station.id,
            "station_name": station.name,
            "period_start": start_date,
            "period_end": end_date,
            "total_hdd": total_hdd,
            "total_cdd": total_cdd,
            "monthly_data": monthly,
        }

    async def fetch_from_dwd(
        self, station_id: uuid.UUID, start_date: date, end_date: date
    ) -> int:
        """Wetterdaten vom DWD via Bright Sky API abrufen und speichern."""
        station = await self.db.get(WeatherStation, station_id)
        if not station:
            raise ValueError("Wetterstation nicht gefunden")

        if not station.dwd_station_id:
            raise ValueError("Keine DWD-Stations-ID konfiguriert")

        client = BrightSkyClient()
        raw_data = await client.get_weather(
            station.dwd_station_id, start_date, end_date
        )

        # Rohdaten gruppieren nach Tag (API liefert stündlich)
        daily: dict[date, list] = {}
        for entry in raw_data:
            ts = entry.get("timestamp", "")
            if not ts:
                continue
            day = datetime.fromisoformat(ts.replace("Z", "+00:00")).date()
            daily.setdefault(day, []).append(entry)

        saved = 0
        for day, entries in sorted(daily.items()):
            # Prüfen ob Daten für diesen Tag bereits existieren
            existing = await self.db.execute(
                select(WeatherRecord).where(
                    WeatherRecord.station_id == station_id,
                    WeatherRecord.date == day,
                )
            )
            if existing.scalar_one_or_none():
                continue

            # Tageswerte berechnen
            temps = [e.get("temperature") for e in entries if e.get("temperature") is not None]
            if not temps:
                continue

            temp_avg = Decimal(str(round(sum(temps) / len(temps), 2)))
            temp_min = Decimal(str(min(temps)))
            temp_max = Decimal(str(max(temps)))

            sunshine = [e.get("sunshine") for e in entries if e.get("sunshine") is not None]
            sunshine_hours = Decimal(str(round(sum(sunshine) / 60, 1))) if sunshine else None

            precip = [e.get("precipitation") for e in entries if e.get("precipitation") is not None]
            precip_mm = Decimal(str(round(sum(precip), 1))) if precip else None

            winds = [e.get("wind_speed") for e in entries if e.get("wind_speed") is not None]
            wind_avg = Decimal(str(round(sum(winds) / len(winds), 1))) if winds else None

            hdd = BrightSkyClient.calculate_hdd(temp_avg)
            cdd = BrightSkyClient.calculate_cdd(temp_avg)

            record = WeatherRecord(
                station_id=station_id,
                date=day,
                temp_avg=temp_avg,
                temp_min=temp_min,
                temp_max=temp_max,
                heating_degree_days=hdd,
                cooling_degree_days=cdd,
                sunshine_hours=sunshine_hours,
                precipitation_mm=precip_mm,
                wind_speed_avg=wind_avg,
                source="bright_sky",
            )
            self.db.add(record)
            saved += 1

        await self.db.commit()

        # Monatliche Gradtagszahlen aktualisieren
        await self._update_monthly_degree_days(station_id, start_date, end_date)

        logger.info(
            "weather_data_fetched",
            station_id=str(station_id),
            days_saved=saved,
        )
        return saved

    async def _update_monthly_degree_days(
        self, station_id: uuid.UUID, start_date: date, end_date: date
    ) -> None:
        """Monatliche Gradtagszahlen aus Tageswerten aggregieren."""
        # Betroffene Monate ermitteln
        current = date(start_date.year, start_date.month, 1)
        end_month = date(end_date.year, end_date.month, 1)

        while current <= end_month:
            # Nächsten Monat berechnen
            if current.month == 12:
                next_month = date(current.year + 1, 1, 1)
            else:
                next_month = date(current.year, current.month + 1, 1)

            # Tageswerte des Monats aggregieren
            result = await self.db.execute(
                select(
                    func.sum(WeatherRecord.heating_degree_days),
                    func.sum(WeatherRecord.cooling_degree_days),
                    func.avg(WeatherRecord.temp_avg),
                    func.count(),
                ).where(
                    WeatherRecord.station_id == station_id,
                    WeatherRecord.date >= current,
                    WeatherRecord.date < next_month,
                )
            )
            row = result.one()
            sum_hdd, sum_cdd, avg_temp, count = row

            if count and count > 0:
                # Heiztage zählen (Tagesmittel < 15°C)
                ht_result = await self.db.execute(
                    select(func.count()).where(
                        WeatherRecord.station_id == station_id,
                        WeatherRecord.date >= current,
                        WeatherRecord.date < next_month,
                        WeatherRecord.temp_avg < Decimal("15.0"),
                    )
                )
                heating_days = ht_result.scalar() or 0

                # Langjaehriges Mittel berechnen (gleicher Monat, alle verfügbaren Jahre)
                ltm_result = await self.db.execute(
                    select(func.avg(MonthlyDegreeDays.heating_degree_days)).where(
                        MonthlyDegreeDays.station_id == station_id,
                        MonthlyDegreeDays.month == current.month,
                        MonthlyDegreeDays.year != current.year,
                    )
                )
                long_term_avg = ltm_result.scalar()

                # Vorhandenen Eintrag prüfen
                existing = await self.db.execute(
                    select(MonthlyDegreeDays).where(
                        MonthlyDegreeDays.station_id == station_id,
                        MonthlyDegreeDays.year == current.year,
                        MonthlyDegreeDays.month == current.month,
                    )
                )
                entry = existing.scalar_one_or_none()

                if entry:
                    entry.heating_degree_days = Decimal(str(round(float(sum_hdd), 2)))
                    entry.cooling_degree_days = Decimal(str(round(float(sum_cdd), 2)))
                    entry.avg_temperature = Decimal(str(round(float(avg_temp), 2)))
                    entry.heating_days = heating_days
                    entry.long_term_avg_hdd = (
                        Decimal(str(round(float(long_term_avg), 2))) if long_term_avg else None
                    )
                else:
                    entry = MonthlyDegreeDays(
                        station_id=station_id,
                        year=current.year,
                        month=current.month,
                        heating_degree_days=Decimal(str(round(float(sum_hdd), 2))),
                        cooling_degree_days=Decimal(str(round(float(sum_cdd), 2))),
                        avg_temperature=Decimal(str(round(float(avg_temp), 2))),
                        heating_days=heating_days,
                        long_term_avg_hdd=(
                            Decimal(str(round(float(long_term_avg), 2))) if long_term_avg else None
                        ),
                    )
                    self.db.add(entry)

            current = next_month

        await self.db.commit()

    async def fetch_all_active_stations(self) -> int:
        """Täglicher Batch: Vortageswerte für alle aktiven Stationen abrufen."""
        from datetime import timedelta

        yesterday = date.today() - timedelta(days=1)
        result = await self.db.execute(
            select(WeatherStation).where(
                WeatherStation.is_active == True,  # noqa: E712
                WeatherStation.dwd_station_id.isnot(None),
            )
        )
        stations = result.scalars().all()
        total = 0
        for station in stations:
            try:
                count = await self.fetch_from_dwd(station.id, yesterday, yesterday)
                total += count
            except Exception as e:
                logger.error("weather_fetch_failed", station_id=str(station.id), error=str(e))
        return total


class WeatherCorrectionService:
    """Service für Witterungskorrektur des Heizenergieverbrauchs."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_configs(self) -> list:
        """Witterungskorrektur-Konfigurationen auflisten."""
        result = await self.db.execute(
            select(WeatherCorrectionConfig).where(
                WeatherCorrectionConfig.is_active == True  # noqa: E712
            )
        )
        return list(result.scalars().all())

    async def create_config(self, data: dict) -> WeatherCorrectionConfig:
        """Witterungskorrektur für einen Zähler konfigurieren."""
        config = WeatherCorrectionConfig(**data)
        self.db.add(config)
        await self.db.commit()
        await self.db.refresh(config)
        return config

    async def calculate_correction(
        self, meter_id: uuid.UUID, start_date: date, end_date: date
    ) -> list:
        """
        Witterungskorrektur berechnen.

        Formel (Gradtagszahl-Methode, VDI 3807):
        Q_korr = Q_base + Q_weather × (GTZ_ref / GTZ_ist)
        Q_base    = raw_consumption × base_load_percent / 100
        Q_weather = raw_consumption - Q_base
        """
        # Konfiguration laden
        result = await self.db.execute(
            select(WeatherCorrectionConfig).where(
                WeatherCorrectionConfig.meter_id == meter_id,
                WeatherCorrectionConfig.is_active == True,  # noqa: E712
            )
        )
        config = result.scalar_one_or_none()
        if not config:
            raise ValueError("Keine Witterungskorrektur-Konfiguration für diesen Zähler")

        weather_svc = WeatherService(self.db)
        results = []

        # Monatsweise berechnen
        current = date(start_date.year, start_date.month, 1)
        while current <= end_date:
            if current.month == 12:
                next_month = date(current.year + 1, 1, 1)
            else:
                next_month = date(current.year, current.month + 1, 1)

            period_end = min(next_month, end_date)

            # Verbrauch im Zeitraum berechnen (Summe consumption aus MeterReading)
            cons_result = await self.db.execute(
                select(func.sum(MeterReading.consumption)).where(
                    MeterReading.meter_id == meter_id,
                    MeterReading.timestamp >= datetime.combine(current, datetime.min.time(), tzinfo=timezone.utc),
                    MeterReading.timestamp < datetime.combine(period_end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc),
                )
            )
            raw_consumption = cons_result.scalar() or Decimal("0")

            if raw_consumption == 0:
                current = next_month
                continue

            # Ist-Gradtagszahlen des Monats
            degree_data = await weather_svc.get_degree_days(
                config.station_id, current, period_end
            )
            actual_hdd = degree_data["total_hdd"]

            # Referenz-Gradtagszahlen
            reference_hdd = config.reference_hdd
            if not reference_hdd:
                # Aus langjährigem Mittel berechnen
                ltm_result = await self.db.execute(
                    select(func.avg(MonthlyDegreeDays.heating_degree_days)).where(
                        MonthlyDegreeDays.station_id == config.station_id,
                        MonthlyDegreeDays.month == current.month,
                    )
                )
                reference_hdd = ltm_result.scalar() or actual_hdd

            # Korrekturfaktor berechnen
            if actual_hdd == 0:
                # Sommer: Kein Heizbedarf → Rohwert unverändert
                correction_factor = Decimal("1.0")
                corrected = raw_consumption
            else:
                base_load_pct = config.base_load_percent or Decimal("0")
                q_base = raw_consumption * base_load_pct / Decimal("100")
                q_weather = raw_consumption - q_base
                correction_factor = Decimal(str(round(float(reference_hdd) / float(actual_hdd), 6)))
                corrected = q_base + q_weather * correction_factor

            # Ergebnis speichern
            corrected_entry = WeatherCorrectedConsumption(
                meter_id=meter_id,
                period_start=current,
                period_end=period_end,
                raw_consumption=raw_consumption,
                corrected_consumption=Decimal(str(round(float(corrected), 4))),
                correction_factor=correction_factor,
                actual_hdd=actual_hdd,
                reference_hdd=reference_hdd,
                method=config.method,
            )
            self.db.add(corrected_entry)
            results.append(corrected_entry)

            current = next_month

        await self.db.commit()
        return results

    async def get_corrected_consumption(
        self, meter_id: uuid.UUID, start_date: date, end_date: date
    ) -> list:
        """Gespeicherte witterungskorrigierte Verbrauchsdaten abrufen."""
        result = await self.db.execute(
            select(WeatherCorrectedConsumption)
            .where(
                WeatherCorrectedConsumption.meter_id == meter_id,
                WeatherCorrectedConsumption.period_start >= start_date,
                WeatherCorrectedConsumption.period_end <= end_date,
            )
            .order_by(WeatherCorrectedConsumption.period_start)
        )
        return list(result.scalars().all())
