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
