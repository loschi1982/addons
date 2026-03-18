"""
test_api_analytics.py – API-Tests für Analyse-Endpunkte.
"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_get_benchmarks_unauthorized(client: AsyncClient):
    """Benchmarks ohne Auth → 401."""
    response = await client.get("/api/v1/analytics/benchmarks")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_benchmarks(client: AsyncClient, auth_headers: dict):
    """Benchmarks → 200 mit Struktur."""
    response = await client.get(
        "/api/v1/analytics/benchmarks", headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert "year" in data
    assert "meters" in data
    assert "buildings" in data


@pytest.mark.asyncio
async def test_get_benchmarks_with_year(client: AsyncClient, auth_headers: dict):
    """Benchmarks für bestimmtes Jahr."""
    response = await client.get(
        "/api/v1/analytics/benchmarks?year=2023", headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data["year"] == 2023


@pytest.mark.asyncio
async def test_get_anomalies(client: AsyncClient, auth_headers: dict):
    """Anomalien → 200."""
    response = await client.get(
        "/api/v1/analytics/anomalies", headers=auth_headers
    )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_get_anomalies_with_params(client: AsyncClient, auth_headers: dict):
    """Anomalien mit Parametern → 200."""
    response = await client.get(
        "/api/v1/analytics/anomalies?threshold=3.0&days=14",
        headers=auth_headers,
    )
    assert response.status_code == 200
