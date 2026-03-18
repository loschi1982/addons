"""
test_homeassistant.py – Tests für die Home Assistant Integration.

Testet Entity-Listing, Filterung, State-Parsing und
History-Import mit gemockten HTTP-Responses.
"""

from decimal import Decimal
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.integrations.homeassistant import HomeAssistantClient


def _mock_response(status_code: int = 200, json_data=None):
    """Erstellt ein gemocktes httpx.Response-Objekt."""
    resp = httpx.Response(
        status_code=status_code,
        json=json_data if json_data is not None else {},
        request=httpx.Request("GET", "http://test"),
    )
    return resp


def _mock_settings():
    """Erstellt gemockte Settings."""
    settings = type("Settings", (), {
        "ha_base_url": "http://supervisor/core",
        "ha_supervisor_token": "test-token",
    })()
    return settings


SAMPLE_ENTITIES = [
    {
        "entity_id": "sensor.stromzaehler_total",
        "state": "12345.6",
        "attributes": {
            "friendly_name": "Stromzähler Total",
            "unit_of_measurement": "kWh",
            "device_class": "energy",
            "state_class": "total_increasing",
            "icon": "mdi:flash",
        },
    },
    {
        "entity_id": "sensor.temperatur_aussen",
        "state": "18.5",
        "attributes": {
            "friendly_name": "Außentemperatur",
            "unit_of_measurement": "°C",
            "device_class": "temperature",
            "state_class": "measurement",
        },
    },
    {
        "entity_id": "sensor.luftfeuchtigkeit",
        "state": "65",
        "attributes": {
            "friendly_name": "Luftfeuchtigkeit",
            "unit_of_measurement": "%",
            "device_class": "humidity",
            "state_class": "measurement",
        },
    },
    {
        "entity_id": "light.wohnzimmer",
        "state": "on",
        "attributes": {
            "friendly_name": "Wohnzimmer Licht",
            "brightness": 200,
        },
    },
    {
        "entity_id": "sensor.gasverbrauch",
        "state": "5432.1",
        "attributes": {
            "friendly_name": "Gasverbrauch",
            "unit_of_measurement": "m³",
            "device_class": "gas",
            "state_class": "total_increasing",
        },
    },
]


@pytest.mark.asyncio
async def test_list_entities_all():
    """Alle Entitäten auflisten."""
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=_mock_response(200, SAMPLE_ENTITIES))

    with patch("app.integrations.homeassistant.get_settings", return_value=_mock_settings()):
        client = HomeAssistantClient()

    with patch("httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        entities = await client.list_entities()
        assert len(entities) == 5
        assert entities[0]["entity_id"] == "sensor.stromzaehler_total"
        assert entities[0]["friendly_name"] == "Stromzähler Total"


@pytest.mark.asyncio
async def test_list_entities_filter_domain():
    """Entitäten nach Domain filtern."""
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=_mock_response(200, SAMPLE_ENTITIES))

    with patch("app.integrations.homeassistant.get_settings", return_value=_mock_settings()):
        client = HomeAssistantClient()

    with patch("httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        entities = await client.list_entities(domain="sensor")
        # 4 sensor.* Entitäten (ohne light.wohnzimmer)
        assert len(entities) == 4
        for e in entities:
            assert e["entity_id"].startswith("sensor.")


@pytest.mark.asyncio
async def test_list_entities_filter_device_class():
    """Entitäten nach device_class filtern."""
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=_mock_response(200, SAMPLE_ENTITIES))

    with patch("app.integrations.homeassistant.get_settings", return_value=_mock_settings()):
        client = HomeAssistantClient()

    with patch("httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        entities = await client.list_entities(device_class="energy")
        assert len(entities) == 1
        assert entities[0]["entity_id"] == "sensor.stromzaehler_total"


@pytest.mark.asyncio
async def test_get_entity_value():
    """Numerischen Wert einer Entität abrufen."""
    state_data = {
        "entity_id": "sensor.stromzaehler_total",
        "state": "12345.6",
        "attributes": {},
    }

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=_mock_response(200, state_data))

    with patch("app.integrations.homeassistant.get_settings", return_value=_mock_settings()):
        client = HomeAssistantClient()

    with patch("httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        value = await client.get_entity_value("sensor.stromzaehler_total")
        assert value == Decimal("12345.6")


@pytest.mark.asyncio
async def test_get_entity_value_non_numeric():
    """Nicht-numerischer Wert → None."""
    state_data = {
        "entity_id": "sensor.status",
        "state": "unavailable",
        "attributes": {},
    }

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=_mock_response(200, state_data))

    with patch("app.integrations.homeassistant.get_settings", return_value=_mock_settings()):
        client = HomeAssistantClient()

    with patch("httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        value = await client.get_entity_value("sensor.status")
        assert value is None


@pytest.mark.asyncio
async def test_import_history():
    """Historische Daten importieren und in Datenpunkte umwandeln."""
    history_data = [[
        {
            "state": "10000.0",
            "last_changed": "2024-01-01T00:00:00+00:00",
        },
        {
            "state": "10500.5",
            "last_changed": "2024-01-02T00:00:00+00:00",
        },
        {
            "state": "unavailable",
            "last_changed": "2024-01-03T00:00:00+00:00",
        },
    ]]

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=_mock_response(200, history_data))

    with patch("app.integrations.homeassistant.get_settings", return_value=_mock_settings()):
        client = HomeAssistantClient()

    with patch("httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        data_points = await client.import_history(
            "sensor.stromzaehler_total",
            "2024-01-01T00:00:00Z",
            "2024-01-03T00:00:00Z",
        )
        # 2 gültige Datenpunkte (unavailable wird übersprungen)
        assert len(data_points) == 2
        assert data_points[0]["value"] == 10000.0
        assert data_points[1]["value"] == 10500.5
        assert "timestamp" in data_points[0]


@pytest.mark.asyncio
async def test_check_connection_success():
    """Verbindungsprüfung erfolgreich."""
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=_mock_response(200, {"message": "API running."}))

    with patch("app.integrations.homeassistant.get_settings", return_value=_mock_settings()):
        client = HomeAssistantClient()

    with patch("httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        assert await client.check_connection() is True


@pytest.mark.asyncio
async def test_check_connection_failure():
    """Verbindungsprüfung fehlgeschlagen."""
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(side_effect=httpx.ConnectError("refused"))

    with patch("app.integrations.homeassistant.get_settings", return_value=_mock_settings()):
        client = HomeAssistantClient()

    with patch("httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        assert await client.check_connection() is False
