"""
test_api_auth.py – API-Tests für Authentifizierung.
"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_login_wrong_credentials(client: AsyncClient):
    """Login mit falschen Daten → 401."""
    response = await client.post(
        "/api/v1/auth/login",
        json={"username": "wronguser", "password": "wrongpassword123"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_login_success(client: AsyncClient, test_user):
    """Login mit korrekten Daten → 200 + Token."""
    response = await client.post(
        "/api/v1/auth/login",
        json={"username": "testuser", "password": "TestPass123!"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_profile_unauthorized(client: AsyncClient):
    """Profil ohne Token → 401."""
    response = await client.get("/api/v1/auth/me")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_profile_authorized(client: AsyncClient, auth_headers: dict):
    """Profil mit Token → 200."""
    response = await client.get("/api/v1/auth/me", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["username"] == "testuser"


@pytest.mark.asyncio
async def test_invalid_token(client: AsyncClient):
    """Ungültiger Token → 401."""
    response = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": "Bearer invalid.token.here"},
    )
    assert response.status_code == 401
