"""
test_electricity_maps.py – Tests für die Electricity Maps Integration.

Testet CO₂-Intensitäts-Abruf, History-Daten und
Graceful Degradation ohne API-Key.
"""

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.integrations.electricity_maps import ElectricityMapsClient


def _mock_response(status_code: int = 200, json_data: dict | None = None):
    """Erstellt ein gemocktes httpx.Response-Objekt."""
    resp = httpx.Response(
        status_code=status_code,
        json=json_data or {},
        request=httpx.Request("GET", "http://test"),
    )
    return resp


def _mock_settings(api_key: str = "test-api-key"):
    """Erstellt gemockte Settings."""
    return type("Settings", (), {"electricity_maps_api_key": api_key})()


@pytest.mark.asyncio
async def test_get_carbon_intensity():
    """CO₂-Intensität für Zone DE abrufen."""
    carbon_data = {
        "zone": "DE",
        "carbonIntensity": 385,
        "fossilFuelPercentage": 42.5,
        "datetime": "2024-01-15T12:00:00Z",
    }

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=_mock_response(200, carbon_data))

    with patch("app.integrations.electricity_maps.get_settings", return_value=_mock_settings()):
        client = ElectricityMapsClient()

    with patch("httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        result = await client.get_carbon_intensity(zone="DE")
        assert result is not None
        assert result["carbonIntensity"] == 385
        assert result["zone"] == "DE"


@pytest.mark.asyncio
async def test_get_carbon_intensity_no_api_key():
    """Ohne API-Key → None (Graceful Degradation)."""
    with patch("app.integrations.electricity_maps.get_settings", return_value=_mock_settings("")):
        client = ElectricityMapsClient()

    result = await client.get_carbon_intensity()
    assert result is None


@pytest.mark.asyncio
async def test_get_carbon_intensity_history():
    """Historische CO₂-Intensität abrufen."""
    history_data = {
        "history": [
            {"carbonIntensity": 350, "datetime": "2024-01-15T10:00:00Z"},
            {"carbonIntensity": 380, "datetime": "2024-01-15T11:00:00Z"},
            {"carbonIntensity": 420, "datetime": "2024-01-15T12:00:00Z"},
        ]
    }

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=_mock_response(200, history_data))

    with patch("app.integrations.electricity_maps.get_settings", return_value=_mock_settings()):
        client = ElectricityMapsClient()

    with patch("httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        result = await client.get_carbon_intensity_history(zone="DE")
        assert len(result) == 3
        assert result[0]["carbonIntensity"] == 350
        assert result[2]["carbonIntensity"] == 420


@pytest.mark.asyncio
async def test_get_carbon_intensity_history_no_api_key():
    """History ohne API-Key → leere Liste."""
    with patch("app.integrations.electricity_maps.get_settings", return_value=_mock_settings("")):
        client = ElectricityMapsClient()

    result = await client.get_carbon_intensity_history()
    assert result == []


@pytest.mark.asyncio
async def test_auth_header_set_with_key():
    """Auth-Header wird gesetzt wenn API-Key vorhanden."""
    with patch("app.integrations.electricity_maps.get_settings", return_value=_mock_settings("my-key-123")):
        client = ElectricityMapsClient()

    assert client.headers == {"auth-token": "my-key-123"}


@pytest.mark.asyncio
async def test_auth_header_empty_without_key():
    """Kein Auth-Header ohne API-Key."""
    with patch("app.integrations.electricity_maps.get_settings", return_value=_mock_settings("")):
        client = ElectricityMapsClient()

    assert client.headers == {}
