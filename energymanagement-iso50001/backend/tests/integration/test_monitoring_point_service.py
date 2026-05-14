"""
test_monitoring_point_service.py – Tests für den MonitoringPointService.

Testet CRUD und Subtree-Aufbau für jeden Scope-Typ (site, building,
usage_unit, meter).
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meter import Meter
from app.models.monitoring_point import MonitoringPoint
from app.models.reading import MeterReading
from app.models.site import Building, Site, UsageUnit
from app.services.monitoring_point_service import MonitoringPointNotFound, MonitoringPointService


@pytest_asyncio.fixture
async def site_with_meters(db_session: AsyncSession):
    """Site → Building → UsageUnit + 3 Zähler mit Readings."""
    site = Site(id=uuid.uuid4(), name="Test-Standort")
    db_session.add(site)
    await db_session.flush()

    bld = Building(id=uuid.uuid4(), name="Test-Gebäude", site_id=site.id)
    db_session.add(bld)
    await db_session.flush()

    unit = UsageUnit(id=uuid.uuid4(), name="Test-Einheit", building_id=bld.id, usage_type="office")
    db_session.add(unit)
    await db_session.flush()

    # 3 Zähler: 2 Strom (1 am Site, 1 an Unit), 1 Gas am Building
    m_strom_site = Meter(
        id=uuid.uuid4(), name="Strom Site", energy_type="electricity", unit="kWh",
        data_source="manual", is_active=True, site_id=site.id,
    )
    m_strom_unit = Meter(
        id=uuid.uuid4(), name="Strom Unit", energy_type="electricity", unit="kWh",
        data_source="manual", is_active=True, usage_unit_id=unit.id,
    )
    m_gas_bld = Meter(
        id=uuid.uuid4(), name="Gas Building", energy_type="gas", unit="m³",
        data_source="manual", is_active=True, building_id=bld.id,
    )
    db_session.add_all([m_strom_site, m_strom_unit, m_gas_bld])
    await db_session.flush()

    # Readings (Q1 2024)
    for m, val in [(m_strom_site, 1000), (m_strom_unit, 500), (m_gas_bld, 200)]:
        db_session.add(MeterReading(
            meter_id=m.id,
            timestamp=datetime(2024, 1, 15, tzinfo=timezone.utc),
            value=Decimal(val), consumption=Decimal(val), source="manual",
        ))
    await db_session.commit()

    return {"site": site, "building": bld, "unit": unit,
            "m_strom_site": m_strom_site, "m_strom_unit": m_strom_unit, "m_gas_bld": m_gas_bld}


@pytest.mark.asyncio
async def test_create_and_list_site_scope(db_session: AsyncSession, site_with_meters):
    """Site-Scope: alle Meter unter Site/Building/Unit zählen."""
    svc = MonitoringPointService(db_session)
    mp = await svc.create_point("Test Site", "site", site_with_meters["site"].id, None)
    assert mp.scope_type == "site"
    assert mp.site_id == site_with_meters["site"].id

    items = await svc.list_points()
    found = next(i for i in items if i["id"] == mp.id)
    # Alle 3 Meter (Strom Site + Strom Unit + Gas Building)
    assert found["meter_count"] == 3
    assert found["energy_type"] is None
    assert found["scope_name"] == "Test-Standort"


@pytest.mark.asyncio
async def test_site_scope_with_energy_filter(db_session: AsyncSession, site_with_meters):
    """Site + electricity-Filter: nur 2 Strom-Zähler."""
    svc = MonitoringPointService(db_session)
    mp = await svc.create_point("Test Strom", "site", site_with_meters["site"].id, "electricity")
    items = await svc.list_points()
    found = next(i for i in items if i["id"] == mp.id)
    assert found["meter_count"] == 2
    assert found["energy_type"] == "electricity"


@pytest.mark.asyncio
async def test_building_scope(db_session: AsyncSession, site_with_meters):
    """Building-Scope: Gas (am Building) + Strom (an Unit im Building) = 2."""
    svc = MonitoringPointService(db_session)
    mp = await svc.create_point("Gebäude X", "building", site_with_meters["building"].id, None)
    items = await svc.list_points()
    found = next(i for i in items if i["id"] == mp.id)
    assert found["meter_count"] == 2  # Strom Unit + Gas Building, nicht Strom Site


@pytest.mark.asyncio
async def test_unit_scope(db_session: AsyncSession, site_with_meters):
    """UsageUnit-Scope: nur 1 Zähler (Strom Unit)."""
    svc = MonitoringPointService(db_session)
    mp = await svc.create_point("Einheit X", "usage_unit", site_with_meters["unit"].id, None)
    items = await svc.list_points()
    found = next(i for i in items if i["id"] == mp.id)
    assert found["meter_count"] == 1


@pytest.mark.asyncio
async def test_meter_scope(db_session: AsyncSession, site_with_meters):
    """Meter-Scope: genau dieser eine Zähler."""
    svc = MonitoringPointService(db_session)
    mp = await svc.create_point("Einzelzähler", "meter", site_with_meters["m_strom_site"].id, None)
    items = await svc.list_points()
    found = next(i for i in items if i["id"] == mp.id)
    assert found["meter_count"] == 1
    assert found["energy_type"] is None  # bei Meter-Scope wird energy_type ignoriert


@pytest.mark.asyncio
async def test_subtree_meter_scope_delegates(db_session: AsyncSession, site_with_meters):
    """Subtree für Meter-Scope: liefert direkt den MeterService-Subtree (kein virtual_root)."""
    svc = MonitoringPointService(db_session)
    mp = await svc.create_point("M", "meter", site_with_meters["m_strom_site"].id, None)
    tree = await svc.get_subtree(mp.id, date(2024, 1, 1), date(2024, 3, 31))
    assert tree.get("is_virtual_root") is not True
    assert tree["consumption"] == 1000


@pytest.mark.asyncio
async def test_subtree_site_scope_synthetic_root(db_session: AsyncSession, site_with_meters):
    """Subtree für Site-Scope: synthetische Wurzel über alle Hauptzähler."""
    svc = MonitoringPointService(db_session)
    mp = await svc.create_point("S", "site", site_with_meters["site"].id, None)
    tree = await svc.get_subtree(mp.id, date(2024, 1, 1), date(2024, 3, 31))
    assert tree["is_virtual_root"] is True
    assert tree["scope"]["type"] == "site"
    # 3 Roots als Children
    assert len(tree["children"]) == 3
    # Aggregat-kWh: 1000 (Strom Site) + 500 (Strom Unit) + 200 m³ * 10.3 = 3560 kWh
    assert tree["consumption"] == pytest.approx(3560.0, abs=1.0)


@pytest.mark.asyncio
async def test_subtree_site_with_energy_filter(db_session: AsyncSession, site_with_meters):
    """Subtree für Site + electricity: nur 2 Strom-Roots, 1500 kWh."""
    svc = MonitoringPointService(db_session)
    mp = await svc.create_point("S/E", "site", site_with_meters["site"].id, "electricity")
    tree = await svc.get_subtree(mp.id, date(2024, 1, 1), date(2024, 3, 31))
    assert len(tree["children"]) == 2
    assert tree["consumption"] == pytest.approx(1500.0, abs=1.0)


@pytest.mark.asyncio
async def test_delete(db_session: AsyncSession, site_with_meters):
    svc = MonitoringPointService(db_session)
    mp = await svc.create_point("delete me", "site", site_with_meters["site"].id, None)
    await svc.delete_point(mp.id)
    with pytest.raises(MonitoringPointNotFound):
        await svc.get_subtree(mp.id)
