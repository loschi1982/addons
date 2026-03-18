"""
test_climate_service.py – Tests für den Klima-Service.

Testet Taupunkt-Berechnung, Komfort-Score, Sensor-CRUD und
Zonen-Zusammenfassungen.
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.climate import ClimateReading, ClimateSensor
from app.services.climate_service import (
    ClimateService,
    calculate_comfort_score,
    calculate_dew_point,
)


# ── Reine Funktionen (kein DB-Zugriff) ──


def test_dew_point_normal():
    """Taupunkt bei 20°C, 50% Feuchte."""
    dp = calculate_dew_point(20.0, 50.0)
    assert 9.0 < dp < 10.0  # ~9.3°C


def test_dew_point_high_humidity():
    """Taupunkt bei hoher Feuchte ≈ Temperatur."""
    dp = calculate_dew_point(20.0, 95.0)
    assert dp > 18.0


def test_dew_point_zero_humidity():
    """Null Feuchte → 0."""
    dp = calculate_dew_point(20.0, 0.0)
    assert dp == 0.0


def test_comfort_score_perfect():
    """Im Sollbereich → 100."""
    score = calculate_comfort_score(22.0, 50.0)
    assert score == Decimal("100.0")


def test_comfort_score_too_cold():
    """Unter Sollbereich → Abzug."""
    score = calculate_comfort_score(15.0, 50.0)
    assert float(score) < 60.0


def test_comfort_score_too_hot():
    """Über Sollbereich → Abzug."""
    score = calculate_comfort_score(30.0, 50.0)
    assert float(score) < 50.0


def test_comfort_score_no_humidity():
    """Ohne Feuchte: nur Temperatur-Score."""
    score = calculate_comfort_score(22.0, None)
    assert score == Decimal("100.0")


def test_comfort_score_dry_air():
    """Trockene Luft → Feuchte-Score sinkt."""
    score = calculate_comfort_score(22.0, 20.0)
    # Temp = 100, Humidity = 100 - 20*5 = 0 → 0.6*100 + 0.4*0 = 60
    assert float(score) == pytest.approx(60.0, abs=1)


# ── DB-Tests ──


@pytest_asyncio.fixture
async def climate_sensor(db_session: AsyncSession):
    """Erstellt einen Test-Klimasensor."""
    sensor = ClimateSensor(
        id=uuid.uuid4(),
        name="Büro EG Sensor",
        sensor_type="temperature_humidity",
        zone="EG",
        ha_entity_id_temp="sensor.buero_eg_temp",
        data_source="homeassistant",
        target_temp_min=Decimal("20"),
        target_temp_max=Decimal("24"),
        target_humidity_min=Decimal("40"),
        target_humidity_max=Decimal("60"),
        is_active=True,
    )
    db_session.add(sensor)
    await db_session.commit()
    return sensor


@pytest.mark.asyncio
async def test_list_sensors(db_session: AsyncSession, climate_sensor):
    """Sensoren auflisten."""
    service = ClimateService(db_session)
    result = await service.list_sensors()
    assert result["total"] == 1
    assert result["items"][0].name == "Büro EG Sensor"


@pytest.mark.asyncio
async def test_list_sensors_filter_zone(db_session: AsyncSession, climate_sensor):
    """Sensoren nach Zone filtern."""
    service = ClimateService(db_session)
    result = await service.list_sensors(zone="EG")
    assert result["total"] == 1
    result2 = await service.list_sensors(zone="OG")
    assert result2["total"] == 0


@pytest.mark.asyncio
async def test_create_sensor(db_session: AsyncSession):
    """Neuen Sensor anlegen."""
    service = ClimateService(db_session)
    sensor = await service.create_sensor({
        "name": "Serverraum",
        "sensor_type": "temperature",
        "zone": "KG",
        "data_source": "manual",
    })
    assert sensor.name == "Serverraum"
    assert sensor.id is not None


@pytest.mark.asyncio
async def test_update_sensor(db_session: AsyncSession, climate_sensor):
    """Sensor aktualisieren."""
    service = ClimateService(db_session)
    updated = await service.update_sensor(climate_sensor.id, {"name": "Büro EG (neu)"})
    assert updated.name == "Büro EG (neu)"


@pytest.mark.asyncio
async def test_delete_sensor(db_session: AsyncSession, climate_sensor):
    """Sensor deaktivieren (Soft-Delete)."""
    service = ClimateService(db_session)
    await service.delete_sensor(climate_sensor.id)
    result = await service.list_sensors(is_active=True)
    assert result["total"] == 0


@pytest.mark.asyncio
async def test_create_reading_with_dew_point(db_session: AsyncSession, climate_sensor):
    """Messwert mit automatischer Taupunkt-Berechnung."""
    service = ClimateService(db_session)
    reading = await service.create_reading({
        "sensor_id": climate_sensor.id,
        "temperature": Decimal("22.0"),
        "humidity": Decimal("50.0"),
        "source": "manual",
    })
    assert reading.temperature == Decimal("22.0")
    assert reading.dew_point is not None
    assert 10.0 < float(reading.dew_point) < 12.0  # ~11.09°C bei 22°C/50%


@pytest.mark.asyncio
async def test_list_readings(db_session: AsyncSession, climate_sensor):
    """Messwerte auflisten."""
    service = ClimateService(db_session)
    await service.create_reading({
        "sensor_id": climate_sensor.id,
        "temperature": Decimal("21.0"),
    })
    await service.create_reading({
        "sensor_id": climate_sensor.id,
        "temperature": Decimal("23.0"),
    })
    result = await service.list_readings(sensor_id=climate_sensor.id)
    assert result["total"] == 2
