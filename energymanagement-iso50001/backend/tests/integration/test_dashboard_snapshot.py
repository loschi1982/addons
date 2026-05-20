"""Tests für DashboardService Snapshot-Persistierung."""

import uuid
from datetime import date

import pytest

from app.models.snapshot import DashboardSnapshot
from app.services.dashboard_service import DashboardService


@pytest.mark.asyncio
async def test_dashboard_snapshot_upsert_and_load(db_session):
    """Snapshot wird gespeichert und kann wieder gelesen werden – auch mit site_id=NULL."""
    service = DashboardService(db_session)

    payload = {
        "period_start": "2026-01-01",
        "period_end": "2026-05-20",
        "kpi_cards": [{"label": "Strom", "value": 1234.5, "unit": "kWh"}],
        "energy_breakdown": [],
        "consumption_chart": [],
        "top_consumers": [],
        "enpi_overview": [],
        "alerts": [],
        "plausibility_warnings": [],
    }

    # Insert (Gesamt-Ansicht, site_id=NULL)
    await service._upsert_dashboard_snapshot(None, "current_ytd", "monthly", payload)
    snap = await service._load_dashboard_snapshot(None, "current_ytd", "monthly")
    assert snap is not None
    assert snap["kpi_cards"][0]["label"] == "Strom"
    assert snap["kpi_cards"][0]["value"] == 1234.5

    # Update (gleicher Schlüssel, neuer Payload)
    payload["kpi_cards"][0]["value"] = 2000.0
    await service._upsert_dashboard_snapshot(None, "current_ytd", "monthly", payload)
    snap2 = await service._load_dashboard_snapshot(None, "current_ytd", "monthly")
    assert snap2["kpi_cards"][0]["value"] == 2000.0


@pytest.mark.asyncio
async def test_dashboard_snapshot_site_isolation(db_session):
    """Snapshots für unterschiedliche site_id sind unabhängig."""
    service = DashboardService(db_session)
    site_a = uuid.uuid4()
    site_b = uuid.uuid4()

    await service._upsert_dashboard_snapshot(
        site_a, "current_ytd", "monthly", {"marker": "A"},
    )
    await service._upsert_dashboard_snapshot(
        site_b, "current_ytd", "monthly", {"marker": "B"},
    )
    await service._upsert_dashboard_snapshot(
        None, "current_ytd", "monthly", {"marker": "Gesamt"},
    )

    assert (await service._load_dashboard_snapshot(site_a, "current_ytd", "monthly"))["marker"] == "A"
    assert (await service._load_dashboard_snapshot(site_b, "current_ytd", "monthly"))["marker"] == "B"
    assert (await service._load_dashboard_snapshot(None, "current_ytd", "monthly"))["marker"] == "Gesamt"


@pytest.mark.asyncio
async def test_dashboard_snapshot_missing_returns_none(db_session):
    """Nicht-existenter Snapshot liefert None (kein Fehler)."""
    service = DashboardService(db_session)
    assert await service._load_dashboard_snapshot(None, "current_ytd", "monthly") is None
