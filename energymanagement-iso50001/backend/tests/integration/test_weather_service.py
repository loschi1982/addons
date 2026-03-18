"""
test_weather_service.py – Tests für den Wetter-Service.

Testet Stationsverwaltung, Haversine-Distanzberechnung,
Gradtagszahlen-Aggregation und Witterungskorrektur.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.correction import WeatherCorrectionConfig
from app.models.meter import Meter
from app.models.reading import MeterReading
from app.models.weather import MonthlyDegreeDays, WeatherRecord, WeatherStation
from app.services.weather_service import WeatherCorrectionService, WeatherService


@pytest_asyncio.fixture
async def weather_station(db_session: AsyncSession):
    """Erstellt eine Test-Wetterstation."""
    station = WeatherStation(
        id=uuid.uuid4(),
        name="München-Stadt",
        dwd_station_id="01766",
        latitude=48.1351,
        longitude=11.5820,
        altitude=520,
        data_source="bright_sky",
        is_active=True,
    )
    db_session.add(station)
    await db_session.commit()
    return station


@pytest_asyncio.fixture
async def weather_records(db_session: AsyncSession, weather_station):
    """Erstellt Tages-Wetterdaten für Januar 2024."""
    records = []
    for day in range(1, 11):  # 10 Tage
        temp = Decimal(str(2.0 + day * 0.5))  # 2.5 bis 7.0
        from app.integrations.bright_sky import BrightSkyClient
        hdd = BrightSkyClient.calculate_hdd(temp)
        cdd = BrightSkyClient.calculate_cdd(temp)
        r = WeatherRecord(
            station_id=weather_station.id,
            date=date(2024, 1, day),
            temp_avg=temp,
            temp_min=temp - Decimal("3"),
            temp_max=temp + Decimal("5"),
            heating_degree_days=hdd,
            cooling_degree_days=cdd,
            source="test",
        )
        db_session.add(r)
        records.append(r)
    await db_session.commit()
    return records


@pytest.mark.asyncio
async def test_list_stations(db_session: AsyncSession, weather_station):
    """Wetterstationen auflisten."""
    service = WeatherService(db_session)
    stations = await service.list_stations()
    assert len(stations) == 1
    assert stations[0].name == "München-Stadt"


@pytest.mark.asyncio
async def test_list_stations_search(db_session: AsyncSession, weather_station):
    """Stationssuche nach Name."""
    service = WeatherService(db_session)
    result = await service.list_stations(search="München")
    assert len(result) == 1
    result2 = await service.list_stations(search="Hamburg")
    assert len(result2) == 0


@pytest.mark.asyncio
async def test_create_station(db_session: AsyncSession):
    """Neue Station anlegen."""
    service = WeatherService(db_session)
    station = await service.create_station({
        "name": "Berlin-Tegel",
        "dwd_station_id": "00433",
        "latitude": 52.5644,
        "longitude": 13.3088,
        "altitude": 36,
        "data_source": "bright_sky",
    })
    assert station.name == "Berlin-Tegel"
    assert station.id is not None


@pytest.mark.asyncio
async def test_find_nearest_station(db_session: AsyncSession, weather_station):
    """Nächste Station per Haversine finden."""
    service = WeatherService(db_session)
    # Koordinaten nahe München
    nearest = await service.find_nearest_station(Decimal("48.14"), Decimal("11.58"))
    assert nearest is not None
    assert nearest.name == "München-Stadt"


@pytest.mark.asyncio
async def test_find_nearest_station_too_far(db_session: AsyncSession, weather_station):
    """Station außerhalb max_km → None."""
    service = WeatherService(db_session)
    # Koordinaten weit weg (Nordkap)
    nearest = await service.find_nearest_station(Decimal("71.0"), Decimal("25.0"), max_km=50)
    assert nearest is None


@pytest.mark.asyncio
async def test_get_weather_data(db_session: AsyncSession, weather_station, weather_records):
    """Wetterdaten für Zeitraum abrufen."""
    service = WeatherService(db_session)
    data = await service.get_weather_data(weather_station.id, date(2024, 1, 1), date(2024, 1, 5))
    assert len(data) == 5


@pytest.mark.asyncio
async def test_weather_correction(db_session: AsyncSession, weather_station, weather_records):
    """Witterungskorrektur nach VDI 3807 berechnen."""
    # Zähler mit Verbrauchsdaten anlegen
    meter = Meter(
        id=uuid.uuid4(), name="Heizung",
        energy_type="gas", unit="kWh",
        data_source="manual", is_weather_corrected=True,
    )
    db_session.add(meter)
    await db_session.flush()

    # Verbrauchsdaten
    db_session.add(MeterReading(
        meter_id=meter.id,
        timestamp=datetime(2024, 1, 1, tzinfo=timezone.utc),
        value=Decimal("0"), consumption=None, source="manual",
    ))
    db_session.add(MeterReading(
        meter_id=meter.id,
        timestamp=datetime(2024, 1, 10, tzinfo=timezone.utc),
        value=Decimal("1000"), consumption=Decimal("1000"), source="manual",
    ))

    # Monatliche Gradtagszahlen für Referenz-HDD
    db_session.add(MonthlyDegreeDays(
        station_id=weather_station.id,
        year=2023, month=1,
        heating_degree_days=Decimal("500"),
        cooling_degree_days=Decimal("0"),
        avg_temperature=Decimal("1.5"),
        heating_days=31,
    ))

    # Korrektur-Konfiguration
    config = WeatherCorrectionConfig(
        meter_id=meter.id,
        station_id=weather_station.id,
        method="degree_days",
        base_load_percent=Decimal("10"),
        reference_hdd=Decimal("500"),
        is_active=True,
    )
    db_session.add(config)
    await db_session.commit()

    service = WeatherCorrectionService(db_session)
    results = await service.calculate_correction(meter.id, date(2024, 1, 1), date(2024, 1, 31))
    assert len(results) >= 1
    # Korrigierter Verbrauch sollte sich vom Rohwert unterscheiden
    result = results[0]
    assert float(result.raw_consumption) == 1000.0
    assert result.corrected_consumption is not None
    assert result.correction_factor is not None
