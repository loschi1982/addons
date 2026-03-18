"""
test_api_settings.py – API-Tests für Settings-Endpunkte.
"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_get_settings_unauthorized(client: AsyncClient):
    """Settings ohne Auth → 401."""
    response = await client.get("/api/v1/settings")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_settings_authenticated(client: AsyncClient, auth_headers: dict):
    """Settings mit Auth → 200 + Defaults."""
    response = await client.get("/api/v1/settings", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert "organization" in data
    assert "branding" in data


@pytest.mark.asyncio
async def test_get_single_setting(client: AsyncClient, auth_headers: dict):
    """Einzelne Einstellung abrufen."""
    response = await client.get("/api/v1/settings/branding", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["key"] == "branding"


@pytest.mark.asyncio
async def test_get_nonexistent_setting(client: AsyncClient, auth_headers: dict):
    """Nicht existierende Einstellung → value=None."""
    response = await client.get(
        "/api/v1/settings/nonexistent_xyz", headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data["value"] is None
