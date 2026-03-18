"""
test_analytics_service.py – Integration-Tests für den Analytics-Service.

Testet Benchmarking, Anomalie-Erkennung und Dashboard-Daten.
"""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.analytics_service import AnalyticsService


@pytest.mark.asyncio
async def test_get_benchmarks_empty(db_session: AsyncSession):
    """Benchmarks ohne Daten gibt leere Struktur."""
    service = AnalyticsService(db_session)
    result = await service.get_benchmarks(2024)

    assert isinstance(result, dict)
    assert result["year"] == 2024
    assert result["meters"] == []
    assert result["buildings"] == []


@pytest.mark.asyncio
async def test_get_benchmarks_default_year(db_session: AsyncSession):
    """Ohne Year-Parameter wird aktuelles Jahr verwendet."""
    from datetime import date

    service = AnalyticsService(db_session)
    result = await service.get_benchmarks()

    assert result["year"] == date.today().year


@pytest.mark.asyncio
async def test_get_anomalies_empty(db_session: AsyncSession):
    """Anomalien ohne Daten gibt leere Liste."""
    service = AnalyticsService(db_session)
    result = await service.get_anomalies()
    assert isinstance(result, list)


@pytest.mark.asyncio
async def test_get_anomalies_with_params(db_session: AsyncSession):
    """Anomalien mit benutzerdefinierten Parametern."""
    service = AnalyticsService(db_session)
    result = await service.get_anomalies(threshold=3.0, days=14)
    assert isinstance(result, list)
