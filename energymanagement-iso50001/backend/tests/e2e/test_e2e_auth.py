"""
test_e2e_auth.py – E2E-Test: Vollständiger Authentifizierungs-Workflow.

Testet den kompletten Auth-Lebenszyklus:
Login → Profil abrufen → Passwort ändern → Neu einloggen → Logout.
"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_auth_full_workflow(client: AsyncClient, test_user):
    """Kompletter Auth-Workflow: Login → Profil → Passwort ändern → Re-Login."""

    # 1. Login mit korrekten Credentials
    login_resp = await client.post(
        "/api/v1/auth/login",
        json={"username": "testuser", "password": "TestPass123!"},
    )
    assert login_resp.status_code == 200
    tokens = login_resp.json()
    assert "access_token" in tokens
    assert "refresh_token" in tokens
    access_token = tokens["access_token"]
    refresh_token = tokens["refresh_token"]
    headers = {"Authorization": f"Bearer {access_token}"}

    # 2. Profil abrufen
    profile_resp = await client.get("/api/v1/auth/me", headers=headers)
    assert profile_resp.status_code == 200
    profile = profile_resp.json()
    assert profile["username"] == "testuser"
    assert profile["email"] == "test@example.com"

    # 3. Passwort ändern
    pw_resp = await client.put(
        "/api/v1/auth/me/password",
        json={
            "current_password": "TestPass123!",
            "new_password": "NewSecurePass456!",
        },
        headers=headers,
    )
    assert pw_resp.status_code == 200

    # 4. Login mit neuem Passwort
    relogin_resp = await client.post(
        "/api/v1/auth/login",
        json={"username": "testuser", "password": "NewSecurePass456!"},
    )
    assert relogin_resp.status_code == 200
    assert "access_token" in relogin_resp.json()

    # 5. Login mit altem Passwort schlägt fehl
    old_pw_resp = await client.post(
        "/api/v1/auth/login",
        json={"username": "testuser", "password": "TestPass123!"},
    )
    assert old_pw_resp.status_code == 401


@pytest.mark.asyncio
async def test_auth_unauthorized_access(client: AsyncClient):
    """Geschützte Endpunkte ohne Token → 401."""
    endpoints = [
        ("GET", "/api/v1/auth/me"),
        ("GET", "/api/v1/sites"),
        ("GET", "/api/v1/meters"),
        ("GET", "/api/v1/consumers"),
        ("GET", "/api/v1/dashboard"),
        ("GET", "/api/v1/iso/context"),
        ("GET", "/api/v1/settings"),
    ]
    for _method, url in endpoints:
        resp = await client.get(url)
        assert resp.status_code == 401, f"GET {url} sollte 401 liefern"


@pytest.mark.asyncio
async def test_auth_invalid_token(client: AsyncClient):
    """Ungültiger Token → 401."""
    headers = {"Authorization": "Bearer invalid.token.here"}
    resp = await client.get("/api/v1/auth/me", headers=headers)
    assert resp.status_code == 401
