"""
test_report_service.py – Tests für den Berichts-Service.

Testet Bericht-CRUD, Daten-Snapshot, CO₂-Zusammenfassung,
automatische Befunde/Empfehlungen und PDF-Generierung (HTML-Fallback).
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.emission import CO2Calculation, EmissionFactor
from app.models.meter import Meter
from app.models.reading import MeterReading
from app.models.report import AuditReport
from app.services.report_service import ReportService


@pytest_asyncio.fixture
async def report_meters(db_session: AsyncSession):
    """Erzeugt 2 Zähler mit Verbrauchsdaten für Berichtstests."""
    m1 = Meter(
        id=uuid.uuid4(),
        name="Strom Hauptzähler",
        energy_type="electricity",
        unit="kWh",
        data_source="manual",
        is_active=True,
    )
    m2 = Meter(
        id=uuid.uuid4(),
        name="Gas Heizung",
        energy_type="gas",
        unit="m³",
        data_source="manual",
        is_active=True,
    )
    db_session.add_all([m1, m2])
    await db_session.flush()

    # Strom: 10000 → 15000 (5000 kWh)
    db_session.add(MeterReading(
        meter_id=m1.id,
        timestamp=datetime(2024, 1, 1, tzinfo=timezone.utc),
        value=Decimal("10000"), consumption=None, source="manual",
    ))
    db_session.add(MeterReading(
        meter_id=m1.id,
        timestamp=datetime(2024, 6, 30, tzinfo=timezone.utc),
        value=Decimal("15000"), consumption=Decimal("5000"), source="manual",
    ))

    # Gas: 1000 → 1200 (200 m³ × 10.3 = 2060 kWh)
    db_session.add(MeterReading(
        meter_id=m2.id,
        timestamp=datetime(2024, 1, 15, tzinfo=timezone.utc),
        value=Decimal("1000"), consumption=None, source="manual",
    ))
    db_session.add(MeterReading(
        meter_id=m2.id,
        timestamp=datetime(2024, 3, 15, tzinfo=timezone.utc),
        value=Decimal("1200"), consumption=Decimal("200"), source="manual",
    ))

    await db_session.commit()
    return m1, m2


@pytest.mark.asyncio
async def test_create_report(db_session: AsyncSession, report_meters):
    """Bericht mit Daten-Snapshot erstellen."""
    service = ReportService(db_session)
    report = await service.create_report({
        "title": "Jahresbericht 2024",
        "report_type": "annual",
        "period_start": date(2024, 1, 1),
        "period_end": date(2024, 12, 31),
    })
    assert report.id is not None
    assert report.title == "Jahresbericht 2024"
    assert report.status == "ready"
    assert report.data_snapshot is not None
    assert report.data_snapshot["meter_count"] == 2


@pytest.mark.asyncio
async def test_report_snapshot_consumption(db_session: AsyncSession, report_meters):
    """Daten-Snapshot berechnet Gesamtverbrauch korrekt."""
    service = ReportService(db_session)
    report = await service.create_report({
        "title": "Test",
        "report_type": "annual",
        "period_start": date(2024, 1, 1),
        "period_end": date(2024, 12, 31),
    })
    snapshot = report.data_snapshot
    # Strom: 5000 kWh + Gas: 200 m³ × 10.3 = 2060 kWh = 7060 kWh
    assert snapshot["total_consumption_kwh"] == pytest.approx(7060.0, abs=1)


@pytest.mark.asyncio
async def test_report_energy_balance(db_session: AsyncSession, report_meters):
    """Energiebilanz nach Typ aufgeschlüsselt."""
    service = ReportService(db_session)
    report = await service.create_report({
        "title": "Test",
        "report_type": "annual",
        "period_start": date(2024, 1, 1),
        "period_end": date(2024, 12, 31),
    })
    balance = report.data_snapshot["energy_balance"]
    types = {b["energy_type"] for b in balance}
    assert types == {"electricity", "gas"}
    total_share = sum(b["share_percent"] for b in balance)
    assert total_share == pytest.approx(100.0, abs=0.2)


@pytest.mark.asyncio
async def test_report_top_consumers(db_session: AsyncSession, report_meters):
    """Top-Verbraucher korrekt sortiert."""
    service = ReportService(db_session)
    report = await service.create_report({
        "title": "Test",
        "report_type": "annual",
        "period_start": date(2024, 1, 1),
        "period_end": date(2024, 12, 31),
    })
    top = report.data_snapshot["top_consumers"]
    assert len(top) == 2
    # Strom (5000 kWh) vor Gas (2060 kWh)
    assert top[0]["energy_type"] == "electricity"


@pytest.mark.asyncio
async def test_report_with_meter_filter(db_session: AsyncSession, report_meters):
    """Bericht nur für bestimmte Zähler."""
    m1, _ = report_meters
    service = ReportService(db_session)
    report = await service.create_report({
        "title": "Nur Strom",
        "report_type": "custom",
        "period_start": date(2024, 1, 1),
        "period_end": date(2024, 12, 31),
        "meter_ids": [m1.id],
    })
    assert report.data_snapshot["meter_count"] == 1
    assert report.data_snapshot["total_consumption_kwh"] == pytest.approx(5000.0, abs=1)


@pytest.mark.asyncio
async def test_list_reports(db_session: AsyncSession, report_meters):
    """Berichte auflisten mit Pagination."""
    service = ReportService(db_session)
    await service.create_report({
        "title": "Bericht 1",
        "report_type": "annual",
        "period_start": date(2024, 1, 1),
        "period_end": date(2024, 12, 31),
    })
    await service.create_report({
        "title": "Bericht 2",
        "report_type": "quarterly",
        "period_start": date(2024, 1, 1),
        "period_end": date(2024, 3, 31),
    })
    result = await service.list_reports()
    assert result["total"] == 2

    # Nach Typ filtern
    result2 = await service.list_reports(report_type="annual")
    assert result2["total"] == 1


@pytest.mark.asyncio
async def test_get_report(db_session: AsyncSession, report_meters):
    """Einzelnen Bericht laden."""
    service = ReportService(db_session)
    report = await service.create_report({
        "title": "Detail-Test",
        "report_type": "annual",
        "period_start": date(2024, 1, 1),
        "period_end": date(2024, 12, 31),
    })
    loaded = await service.get_report(report.id)
    assert loaded is not None
    assert loaded.title == "Detail-Test"


@pytest.mark.asyncio
async def test_update_report(db_session: AsyncSession, report_meters):
    """Bericht aktualisieren."""
    service = ReportService(db_session)
    report = await service.create_report({
        "title": "Alt",
        "report_type": "annual",
        "period_start": date(2024, 1, 1),
        "period_end": date(2024, 12, 31),
    })
    updated = await service.update_report(report.id, {"title": "Neu"})
    assert updated.title == "Neu"


@pytest.mark.asyncio
async def test_delete_report(db_session: AsyncSession, report_meters):
    """Bericht löschen."""
    service = ReportService(db_session)
    report = await service.create_report({
        "title": "Zu löschen",
        "report_type": "annual",
        "period_start": date(2024, 1, 1),
        "period_end": date(2024, 12, 31),
    })
    assert await service.delete_report(report.id) is True
    assert await service.get_report(report.id) is None


@pytest.mark.asyncio
async def test_report_status(db_session: AsyncSession, report_meters):
    """Berichtsstatus abfragen."""
    service = ReportService(db_session)
    report = await service.create_report({
        "title": "Status-Test",
        "report_type": "annual",
        "period_start": date(2024, 1, 1),
        "period_end": date(2024, 12, 31),
    })
    status = await service.get_report_status(report.id)
    assert status["status"] == "ready"
    assert status["report_id"] == report.id


@pytest.mark.asyncio
async def test_generate_findings_dominant_energy():
    """Befund bei dominantem Energieträger (>70%)."""
    service = ReportService.__new__(ReportService)
    snapshot = {
        "energy_balance": [
            {"energy_type": "electricity", "consumption_kwh": 9000, "share_percent": 90.0},
            {"energy_type": "gas", "consumption_kwh": 1000, "share_percent": 10.0},
        ],
        "monthly_trend": [],
    }
    findings = await service._generate_findings(snapshot, None)
    assert any(f["category"] == "energy_mix" for f in findings)


@pytest.mark.asyncio
async def test_generate_findings_data_gaps():
    """Befund bei fehlenden Monatsdaten."""
    service = ReportService.__new__(ReportService)
    snapshot = {
        "energy_balance": [],
        "monthly_trend": [
            {"month": 1, "consumption_kwh": 100},
            {"month": 2, "consumption_kwh": 0},
            {"month": 3, "consumption_kwh": 150},
        ],
    }
    findings = await service._generate_findings(snapshot, None)
    assert any(f["category"] == "data_quality" for f in findings)


@pytest.mark.asyncio
async def test_generate_recommendations():
    """Empfehlungen basierend auf Befunden."""
    service = ReportService.__new__(ReportService)
    findings = [
        {"title": "Test", "category": "energy_mix", "severity": "mittel"},
        {"title": "Test", "category": "data_quality", "severity": "mittel"},
    ]
    recommendations = await service._generate_recommendations(findings)
    assert len(recommendations) == 2
    titles = {r["title"] for r in recommendations}
    assert "Energiemix diversifizieren" in titles
    assert "Datenerfassung verbessern" in titles


@pytest.mark.asyncio
async def test_generate_summary():
    """Zusammenfassung automatisch generieren."""
    service = ReportService.__new__(ReportService)
    snapshot = {
        "period_start": "2024-01-01",
        "period_end": "2024-12-31",
        "total_consumption_kwh": 5000,
        "meter_count": 3,
        "energy_balance": [
            {"energy_type": "electricity", "consumption_kwh": 5000, "share_percent": 100.0},
        ],
    }
    summary = await service._generate_summary(snapshot, None)
    assert "5,000" in summary or "5.000" in summary or "5000" in summary
    assert "3" in summary


@pytest.mark.asyncio
async def test_render_builtin_template(db_session: AsyncSession, report_meters):
    """Eingebautes HTML-Template rendern."""
    service = ReportService(db_session)
    report = await service.create_report({
        "title": "PDF-Test",
        "report_type": "annual",
        "period_start": date(2024, 1, 1),
        "period_end": date(2024, 12, 31),
    })
    html = service._render_builtin_template(report)
    assert "PDF-Test" in html
    assert "ISO 50001" in html
    assert "<table>" in html
