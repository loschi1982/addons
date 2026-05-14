"""
test_co2_service.py – Integration-Tests für den CO₂-Service.

Testet Emissionsfaktor-Verwaltung und Export-Funktionen.
"""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.co2_service import CO2Service


@pytest.mark.asyncio
async def test_list_factors_empty(db_session: AsyncSession):
    """Leere DB gibt leere Faktor-Liste zurück."""
    service = CO2Service(db_session)
    factors = await service.list_factors()
    assert isinstance(factors, list)


@pytest.mark.asyncio
async def test_list_sources_empty(db_session: AsyncSession):
    """Leere DB gibt leere Quellen-Liste zurück."""
    service = CO2Service(db_session)
    sources = await service.list_sources()
    assert isinstance(sources, list)


@pytest.mark.asyncio
async def test_resolve_factor_not_found(db_session: AsyncSession):
    """Kein Faktor für unbekannten Energietyp."""
    from datetime import date

    service = CO2Service(db_session)
    factor = await service.resolve_factor("unknown_type", date(2024, 1, 1))
    assert factor is None


@pytest.mark.asyncio
async def test_export_ghg_csv_empty(db_session: AsyncSession):
    """GHG Export ohne Daten gibt Header + Zusammenfassung."""
    from datetime import date

    service = CO2Service(db_session)
    csv_data = await service.export_ghg_csv(date(2024, 1, 1), date(2024, 12, 31))

    assert isinstance(csv_data, str)
    assert "Scope" in csv_data
    assert "Energietyp" in csv_data
    assert "Zusammenfassung" in csv_data


@pytest.mark.asyncio
async def test_export_emas_csv_empty(db_session: AsyncSession):
    """EMAS Export ohne Daten gibt Header."""
    from datetime import date

    service = CO2Service(db_session)
    csv_data = await service.export_emas_csv(date(2024, 1, 1), date(2024, 12, 31))

    assert isinstance(csv_data, str)
    assert "EMAS" in csv_data
    assert "Energieträger" in csv_data


@pytest.mark.asyncio
async def test_export_ghg_csv_semicolon_separator(db_session: AsyncSession):
    """GHG CSV verwendet Semikolon als Trennzeichen."""
    from datetime import date

    service = CO2Service(db_session)
    csv_data = await service.export_ghg_csv(date(2024, 1, 1), date(2024, 12, 31))

    lines = csv_data.strip().split("\n")
    header = lines[0]
    assert ";" in header


@pytest.mark.asyncio
async def test_get_summary_empty(db_session: AsyncSession):
    """Zusammenfassung ohne Daten gibt Null-Werte."""
    from datetime import date

    service = CO2Service(db_session)
    summary = await service.get_summary(date(2024, 1, 1), date(2024, 12, 31))

    assert summary["total_co2_kg"] == 0
    assert summary["total_consumption_kwh"] == 0


@pytest.mark.asyncio
async def test_get_dashboard_empty(db_session: AsyncSession):
    """Dashboard ohne Daten gibt Struktur zurück."""
    service = CO2Service(db_session)
    dashboard = await service.get_dashboard(2024)

    assert "current_year" in dashboard
    assert "previous_year" in dashboard
    assert "monthly_trend" in dashboard
    assert len(dashboard["monthly_trend"]) == 12


# ── UPSERT + Backfill ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_calculate_emissions_upsert(db_session: AsyncSession):
    """Zweimaliger Aufruf für gleiche Period erzeugt nur einen Eintrag (UPSERT)."""
    from datetime import date, datetime, timezone
    from decimal import Decimal
    from sqlalchemy import func, select

    from app.models.emission import CO2Calculation, EmissionFactor, EmissionFactorSource
    from app.models.meter import Meter
    from app.models.reading import MeterReading

    src = EmissionFactorSource(id=uuid.uuid4(), name="Test", source_type="bafa")
    db_session.add(src)
    await db_session.flush()
    factor = EmissionFactor(
        id=uuid.uuid4(), energy_type="electricity", year=2024,
        co2_g_per_kwh=Decimal("400"), region="DE", source_id=src.id,
    )
    m = Meter(
        id=uuid.uuid4(), name="Test-Z", energy_type="electricity", unit="kWh",
        data_source="manual", is_active=True,
    )
    db_session.add_all([factor, m])
    await db_session.flush()
    db_session.add(MeterReading(
        meter_id=m.id, timestamp=datetime(2024, 1, 15, tzinfo=timezone.utc),
        value=Decimal("1000"), consumption=Decimal("1000"), source="manual",
    ))
    await db_session.commit()

    svc = CO2Service(db_session)
    c1 = await svc.calculate_emissions(m.id, date(2024, 1, 1), date(2024, 1, 31))
    assert c1 is not None
    assert c1.co2_kg == Decimal("400.0000")
    # Faktor ändern und nochmal berechnen
    factor.co2_g_per_kwh = Decimal("100")
    await db_session.commit()
    c2 = await svc.calculate_emissions(m.id, date(2024, 1, 1), date(2024, 1, 31))
    assert c2 is not None
    assert c2.id == c1.id  # gleicher Eintrag aktualisiert
    assert c2.co2_kg == Decimal("100.0000")
    # Nur ein Eintrag in DB
    n = (await db_session.execute(
        select(func.count(CO2Calculation.id)).where(CO2Calculation.meter_id == m.id)
    )).scalar()
    assert n == 1


@pytest.mark.asyncio
async def test_backfill_all_multiple_months(db_session: AsyncSession):
    """Backfill über 3 Monate erzeugt 3 Calcs pro Zähler."""
    from datetime import date, datetime, timezone
    from decimal import Decimal
    from sqlalchemy import func, select

    from app.models.emission import CO2Calculation, EmissionFactor, EmissionFactorSource
    from app.models.meter import Meter
    from app.models.reading import MeterReading

    src = EmissionFactorSource(id=uuid.uuid4(), name="Test", source_type="bafa")
    db_session.add(src)
    await db_session.flush()
    factor = EmissionFactor(
        id=uuid.uuid4(), energy_type="district_heating", year=2024,
        co2_g_per_kwh=Decimal("64"), region="DE", source_id=src.id,
    )
    m = Meter(
        id=uuid.uuid4(), name="FW-Z", energy_type="district_heating", unit="kWh",
        data_source="manual", is_active=True,
    )
    db_session.add_all([factor, m])
    await db_session.flush()
    # Pro Monat einen Reading
    for month in [1, 2, 3]:
        db_session.add(MeterReading(
            meter_id=m.id, timestamp=datetime(2024, month, 15, tzinfo=timezone.utc),
            value=Decimal("500"), consumption=Decimal("500"), source="manual",
        ))
    await db_session.commit()

    svc = CO2Service(db_session)
    result = await svc.backfill_all(date(2024, 1, 1), date(2024, 3, 31), ["district_heating"])
    assert result["months"] == 3
    assert result["calculated"] == 3
    n = (await db_session.execute(
        select(func.count(CO2Calculation.id)).where(CO2Calculation.meter_id == m.id)
    )).scalar()
    assert n == 3


@pytest.mark.asyncio
async def test_find_oldest_reading_date(db_session: AsyncSession):
    """find_oldest_reading_date liefert ältestes Reading-Datum."""
    from datetime import date, datetime, timezone
    from decimal import Decimal

    from app.models.meter import Meter
    from app.models.reading import MeterReading

    m = Meter(
        id=uuid.uuid4(), name="X", energy_type="electricity", unit="kWh",
        data_source="manual", is_active=True,
    )
    db_session.add(m)
    await db_session.flush()
    db_session.add(MeterReading(
        meter_id=m.id, timestamp=datetime(2022, 6, 1, tzinfo=timezone.utc),
        value=Decimal("0"), consumption=Decimal("100"), source="manual",
    ))
    db_session.add(MeterReading(
        meter_id=m.id, timestamp=datetime(2024, 1, 1, tzinfo=timezone.utc),
        value=Decimal("0"), consumption=Decimal("100"), source="manual",
    ))
    await db_session.commit()

    svc = CO2Service(db_session)
    oldest = await svc.find_oldest_reading_date()
    assert oldest == date(2022, 6, 1)
