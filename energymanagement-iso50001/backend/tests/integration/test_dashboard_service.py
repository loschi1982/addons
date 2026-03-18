"""
test_dashboard_service.py – Tests für den Dashboard-Service.

Testet KPI-Karten, Energieaufschlüsselung, Top-Verbraucher und Alerts.
Hinweis: _get_consumption_chart nutzt date_trunc (PostgreSQL) und
wird hier nicht getestet.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meter import Meter
from app.models.reading import MeterReading
from app.services.dashboard_service import DashboardService


@pytest_asyncio.fixture
async def meters_with_readings(db_session: AsyncSession):
    """Erzeugt Testdaten: 2 Zähler mit Ablesungen."""
    m1 = Meter(
        id=uuid.uuid4(),
        name="Stromzähler Haupt",
        energy_type="electricity",
        unit="kWh",
        data_source="manual",
        is_active=True,
    )
    m2 = Meter(
        id=uuid.uuid4(),
        name="Gaszähler",
        energy_type="gas",
        unit="m³",
        data_source="manual",
        is_active=True,
    )
    db_session.add_all([m1, m2])
    await db_session.flush()

    # Strom-Ablesungen: 10000 → 12000 → 15000
    for ts, val in [
        (datetime(2024, 1, 1, tzinfo=timezone.utc), Decimal("10000")),
        (datetime(2024, 2, 1, tzinfo=timezone.utc), Decimal("12000")),
        (datetime(2024, 3, 1, tzinfo=timezone.utc), Decimal("15000")),
    ]:
        db_session.add(MeterReading(
            meter_id=m1.id, timestamp=ts, value=val,
            consumption=None if val == Decimal("10000") else val - Decimal("10000") if val == Decimal("12000") else Decimal("3000"),
            source="manual",
        ))

    # Gas-Ablesungen: 500 → 600
    db_session.add(MeterReading(
        meter_id=m2.id,
        timestamp=datetime(2024, 1, 15, tzinfo=timezone.utc),
        value=Decimal("500"), consumption=None, source="manual",
    ))
    db_session.add(MeterReading(
        meter_id=m2.id,
        timestamp=datetime(2024, 2, 15, tzinfo=timezone.utc),
        value=Decimal("600"), consumption=Decimal("100"), source="manual",
    ))

    await db_session.commit()
    return m1, m2


@pytest.mark.asyncio
async def test_total_consumption(db_session: AsyncSession, meters_with_readings):
    """Gesamtverbrauch korrekt berechnen (inkl. Einheiten-Umrechnung)."""
    service = DashboardService(db_session)
    total = await service._total_consumption(date(2024, 1, 1), date(2024, 4, 1))
    # Strom: 2000 + 3000 = 5000 kWh, Gas: 100 m³ × 10.3 = 1030 kWh
    assert float(total) == pytest.approx(6030.0, abs=1)


@pytest.mark.asyncio
async def test_active_meter_count(db_session: AsyncSession, meters_with_readings):
    """Aktive Zähler zählen."""
    service = DashboardService(db_session)
    count = await service._active_meter_count()
    assert count == 2


@pytest.mark.asyncio
async def test_energy_breakdown(db_session: AsyncSession, meters_with_readings):
    """Energieaufschlüsselung nach Typ."""
    service = DashboardService(db_session)
    breakdown = await service._get_energy_breakdown(date(2024, 1, 1), date(2024, 4, 1))
    assert len(breakdown) == 2
    types = {b["energy_type"] for b in breakdown}
    assert types == {"electricity", "gas"}

    # Anteile sollten sich auf 100% addieren
    total_share = sum(float(b["share_percent"]) for b in breakdown)
    assert total_share == pytest.approx(100.0, abs=0.2)


@pytest.mark.asyncio
async def test_top_consumers(db_session: AsyncSession, meters_with_readings):
    """Top-5 Verbraucher korrekt sortiert."""
    service = DashboardService(db_session)
    top = await service._get_top_consumers(date(2024, 1, 1), date(2024, 4, 1))
    assert len(top) == 2
    # Strom (5000 kWh) sollte vor Gas (1030 kWh) stehen
    assert top[0]["energy_type"] == "electricity"
    assert top[0]["consumption_kwh"] > top[1]["consumption_kwh"]


@pytest.mark.asyncio
async def test_alerts_stale_meter(db_session: AsyncSession):
    """Zähler ohne aktuelle Daten generiert Alert."""
    m = Meter(
        id=uuid.uuid4(), name="Alter Zähler",
        energy_type="electricity", unit="kWh",
        data_source="manual", is_active=True,
    )
    db_session.add(m)
    # Ablesung von vor 30 Tagen
    db_session.add(MeterReading(
        meter_id=m.id,
        timestamp=datetime(2024, 1, 1, tzinfo=timezone.utc),
        value=Decimal("100"), source="manual",
    ))
    await db_session.commit()

    service = DashboardService(db_session)
    alerts = await service._get_alerts()
    assert len(alerts) >= 1
    assert alerts[0]["type"] == "no_data"
    assert "Alter Zähler" in alerts[0]["message"]


@pytest.mark.asyncio
async def test_calc_trend():
    """Trend-Berechnung: positiv, negativ, keine Vorjahresdaten."""
    assert DashboardService._calc_trend(Decimal("110"), Decimal("100")) == Decimal("10.0")
    assert DashboardService._calc_trend(Decimal("90"), Decimal("100")) == Decimal("-10.0")
    assert DashboardService._calc_trend(Decimal("100"), Decimal("0")) is None


@pytest.mark.asyncio
async def test_trend_direction():
    """Trend-Richtung: up, down, stable, None."""
    assert DashboardService._trend_dir(Decimal("5")) == "up"
    assert DashboardService._trend_dir(Decimal("-3")) == "down"
    assert DashboardService._trend_dir(Decimal("0")) == "stable"
    assert DashboardService._trend_dir(None) is None
