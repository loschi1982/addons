"""
test_api_emissions.py – API-Tests für CO₂-Emissionen-Endpunkte.
"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_get_dashboard_unauthorized(client: AsyncClient):
    """CO₂-Dashboard ohne Auth → 401."""
    response = await client.get("/api/v1/emissions/dashboard")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_dashboard(client: AsyncClient, auth_headers: dict):
    """CO₂-Dashboard → 200."""
    response = await client.get(
        "/api/v1/emissions/dashboard", headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert "current_year" in data
    assert "monthly_trend" in data


@pytest.mark.asyncio
async def test_export_ghg(client: AsyncClient, auth_headers: dict):
    """GHG Protocol CSV-Export → 200 + CSV."""
    response = await client.get(
        "/api/v1/emissions/export?start_date=2024-01-01&end_date=2024-12-31&format=ghg",
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]
    assert "Scope" in response.text


@pytest.mark.asyncio
async def test_export_emas(client: AsyncClient, auth_headers: dict):
    """EMAS CSV-Export → 200 + CSV."""
    response = await client.get(
        "/api/v1/emissions/export?start_date=2024-01-01&end_date=2024-12-31&format=emas",
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]
    assert "EMAS" in response.text


@pytest.mark.asyncio
async def test_export_invalid_format(client: AsyncClient, auth_headers: dict):
    """Ungültiges Export-Format → 422."""
    response = await client.get(
        "/api/v1/emissions/export?start_date=2024-01-01&end_date=2024-12-31&format=invalid",
        headers=auth_headers,
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_export_missing_dates(client: AsyncClient, auth_headers: dict):
    """Export ohne Datumsangabe → 422."""
    response = await client.get(
        "/api/v1/emissions/export", headers=auth_headers
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_list_factors(client: AsyncClient, auth_headers: dict):
    """Emissionsfaktoren auflisten → 200."""
    response = await client.get(
        "/api/v1/emissions/factors", headers=auth_headers
    )
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.asyncio
async def test_list_sources(client: AsyncClient, auth_headers: dict):
    """Emissionsfaktor-Quellen auflisten → 200."""
    response = await client.get(
        "/api/v1/emissions/factors/sources", headers=auth_headers
    )
    assert response.status_code == 200
