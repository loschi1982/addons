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
    """Top-Verbraucher pro Energietyp gruppiert."""
    service = DashboardService(db_session)
    top = await service._get_top_consumers(date(2024, 1, 1), date(2024, 4, 1))
    # Struktur: list[{energy_type, energy_type_label, meters: [...]}]
    assert len(top) == 2
    et_set = {g["energy_type"] for g in top}
    assert et_set == {"electricity", "gas"}
    # Jede Gruppe hat mindestens einen Zähler-Eintrag
    for g in top:
        assert g["meters"]
        assert "consumption_kwh" in g["meters"][0]


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


@pytest.mark.asyncio
async def test_virtual_net_meter_in_top_consumers(db_session: AsyncSession):
    """Cross-Site-Netto: Brutto-Source wird ausgeschlossen, Virtual-Netto verwendet.

    Setup: 2 Sites (Konzert, Gemeinsam). Konzert-Hauptzähler hat einen Cross-Site-Submeter.
    Der virtuelle Netto-Zähler ersetzt den Brutto-Hauptzähler in Top-Consumers.
    """
    from app.models.site import Site

    site_konzert = Site(id=uuid.uuid4(), name="Konzert")
    site_gemeinsam = Site(id=uuid.uuid4(), name="Gemeinsam")
    db_session.add_all([site_konzert, site_gemeinsam])
    await db_session.flush()

    # Brutto-Hauptzähler (Konzert, 1000 kWh)
    brutto = Meter(
        id=uuid.uuid4(), name="HZ_Konzert", energy_type="electricity", unit="kWh",
        data_source="manual", is_active=True, site_id=site_konzert.id,
    )
    # Cross-Site-Submeter (Gemeinsam, 300 kWh, hängt unter brutto)
    sub = Meter(
        id=uuid.uuid4(), name="UZ_Gemeinsam", energy_type="electricity", unit="kWh",
        data_source="manual", is_active=True, site_id=site_gemeinsam.id,
        parent_meter_id=brutto.id,
    )
    # Virtual-Netto-Zähler
    netto = Meter(
        id=uuid.uuid4(), name="HZ_Konzert - Netto Konzert", energy_type="electricity", unit="kWh",
        data_source="virtual", is_active=True, site_id=site_konzert.id,
        is_virtual=True,
        virtual_config={
            "type": "difference",
            "source_meter_id": str(brutto.id),
            "subtract_meter_ids": [str(sub.id)],
        },
    )
    db_session.add_all([brutto, sub, netto])
    await db_session.flush()

    db_session.add(MeterReading(
        meter_id=brutto.id, timestamp=datetime(2024, 1, 15, tzinfo=timezone.utc),
        value=Decimal("1000"), consumption=Decimal("1000"), source="manual",
    ))
    db_session.add(MeterReading(
        meter_id=sub.id, timestamp=datetime(2024, 1, 15, tzinfo=timezone.utc),
        value=Decimal("300"), consumption=Decimal("300"), source="manual",
    ))
    await db_session.commit()

    service = DashboardService(db_session)
    ms = await service._resolve_meter_set(date(2024, 1, 1), date(2024, 12, 31), site_konzert.id)
    assert brutto.id not in ms["physical_ids"]  # Source ausgeschlossen
    assert len(ms["virtual_meters"]) == 1

    # Top-Consumers für Konzert
    top = await service._get_top_consumers(
        date(2024, 1, 1), date(2024, 12, 31),
        ms["physical_ids"], ms["virtual_meters"], ms["allocation_factors"],
    )
    # Konzert hat KEINE physical-electricity-Zähler, nur den Virtual-Netto
    elec = next((g for g in top if g["energy_type"] == "electricity"), None)
    assert elec is not None
    assert len(elec["meters"]) == 1
    assert "Netto" in elec["meters"][0]["name"]
    # Netto = 1000 - 300 = 700 kWh
    assert elec["meters"][0]["consumption_kwh"] == pytest.approx(700.0, abs=0.5)

    # Total Consumption Konzert: 700 kWh (Netto), nicht 1000 (Brutto)
    total = await service._total_consumption(
        date(2024, 1, 1), date(2024, 12, 31),
        ms["physical_ids"], ms["virtual_meters"], ms["allocation_factors"],
    )
    assert float(total) == pytest.approx(700.0, abs=0.5)


@pytest.mark.asyncio
async def test_allocation_factor_in_top_consumers(db_session: AsyncSession):
    """MeterUnitAllocation: Zähler trägt anteilig zu Site bei.

    Zähler mit Allocation 60% zu Site-A, 40% zu Site-B (add). Bei Site-A-Filter
    soll nur 60% des Verbrauchs aggregiert werden.
    """
    from app.models.allocation import MeterUnitAllocation
    from app.models.site import Building, Site, UsageUnit

    site_a = Site(id=uuid.uuid4(), name="Site A")
    site_b = Site(id=uuid.uuid4(), name="Site B")
    db_session.add_all([site_a, site_b])
    await db_session.flush()

    bld_a = Building(id=uuid.uuid4(), name="Gebäude A", site_id=site_a.id)
    bld_b = Building(id=uuid.uuid4(), name="Gebäude B", site_id=site_b.id)
    db_session.add_all([bld_a, bld_b])
    await db_session.flush()

    unit_a = UsageUnit(id=uuid.uuid4(), name="Unit A", building_id=bld_a.id, usage_type="office")
    unit_b = UsageUnit(id=uuid.uuid4(), name="Unit B", building_id=bld_b.id, usage_type="office")
    db_session.add_all([unit_a, unit_b])
    await db_session.flush()

    # Zähler in Site A, aber mit Allocation 60/40
    m = Meter(
        id=uuid.uuid4(), name="Geteilter Zähler", energy_type="electricity", unit="kWh",
        data_source="manual", is_active=True, site_id=site_a.id,
    )
    db_session.add(m)
    await db_session.flush()

    db_session.add_all([
        MeterUnitAllocation(
            id=uuid.uuid4(), meter_id=m.id, usage_unit_id=unit_a.id,
            allocation_type="add", factor=Decimal("0.6"),
        ),
        MeterUnitAllocation(
            id=uuid.uuid4(), meter_id=m.id, usage_unit_id=unit_b.id,
            allocation_type="add", factor=Decimal("0.4"),
        ),
    ])
    db_session.add(MeterReading(
        meter_id=m.id, timestamp=datetime(2024, 1, 15, tzinfo=timezone.utc),
        value=Decimal("1000"), consumption=Decimal("1000"), source="manual",
    ))
    await db_session.commit()

    service = DashboardService(db_session)

    # Site A: Allocation-Faktor = 0.6
    ms_a = await service._resolve_meter_set(date(2024, 1, 1), date(2024, 12, 31), site_a.id)
    assert ms_a["allocation_factors"].get(m.id) == pytest.approx(Decimal("0.6"), abs=Decimal("0.01"))
    total_a = await service._total_consumption(
        date(2024, 1, 1), date(2024, 12, 31),
        ms_a["physical_ids"], ms_a["virtual_meters"], ms_a["allocation_factors"],
    )
    assert float(total_a) == pytest.approx(600.0, abs=1)

    # Site B: Allocation-Faktor = 0.4 (Zähler wird via Allocation einbezogen)
    ms_b = await service._resolve_meter_set(date(2024, 1, 1), date(2024, 12, 31), site_b.id)
    assert m.id in ms_b["physical_ids"]
    assert ms_b["allocation_factors"].get(m.id) == pytest.approx(Decimal("0.4"), abs=Decimal("0.01"))
    total_b = await service._total_consumption(
        date(2024, 1, 1), date(2024, 12, 31),
        ms_b["physical_ids"], ms_b["virtual_meters"], ms_b["allocation_factors"],
    )
    assert float(total_b) == pytest.approx(400.0, abs=1)
