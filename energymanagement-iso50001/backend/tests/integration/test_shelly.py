"""
test_shelly.py – Tests für die Shelly-Integration.

Testet Generationserkennung, Energiedaten-Parsing und
Geräteinfo-Extraktion mit gemockten HTTP-Responses.
"""

from decimal import Decimal
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.integrations.shelly import ShellyClient


def _mock_response(status_code: int = 200, json_data: dict | None = None):
    """Erstellt ein gemocktes httpx.Response-Objekt."""
    resp = httpx.Response(
        status_code=status_code,
        json=json_data or {},
        request=httpx.Request("GET", "http://test"),
    )
    return resp


@pytest.mark.asyncio
async def test_detect_gen2():
    """Gen2-Erkennung: /rpc/Shelly.GetDeviceInfo antwortet mit 200."""
    client = ShellyClient("192.168.1.42")
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=_mock_response(200, {"gen": 2}))

    with patch("httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        gen = await client.detect_generation()
        assert gen == 2
        assert client._gen == 2


@pytest.mark.asyncio
async def test_detect_gen1():
    """Gen1-Erkennung: Gen2-Endpunkt schlägt fehl, /settings antwortet."""
    client = ShellyClient("192.168.1.10")

    call_count = 0

    async def mock_get(url, **kwargs):
        nonlocal call_count
        call_count += 1
        if "GetDeviceInfo" in url:
            return _mock_response(404)
        return _mock_response(200, {"device": {"type": "SHSW-25"}})

    mock_client = AsyncMock()
    mock_client.get = mock_get

    with patch("httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        gen = await client.detect_generation()
        assert gen == 1


@pytest.mark.asyncio
async def test_detect_unreachable():
    """Gerät nicht erreichbar → ConnectionError."""
    client = ShellyClient("10.0.0.99")
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(side_effect=httpx.ConnectError("Connection refused"))

    with patch("httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        with pytest.raises(ConnectionError, match="nicht erreichbar"):
            await client.detect_generation()


@pytest.mark.asyncio
async def test_get_energy_gen2():
    """Gen2: Energiedaten vom Switch-Endpunkt parsen."""
    client = ShellyClient("192.168.1.42")
    client._gen = 2  # Generation bereits bekannt

    gen2_switch_data = {
        "apower": 150.5,
        "aenergy": {"total": 12345.6},
        "voltage": 230.1,
        "current": 0.65,
    }

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=_mock_response(200, gen2_switch_data))

    with patch("httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        energy = await client.get_energy(channel=0)
        assert energy["power"] == 150.5
        assert energy["energy_wh"] == 12345.6
        assert energy["voltage"] == 230.1
        assert energy["current"] == 0.65


@pytest.mark.asyncio
async def test_get_energy_gen1():
    """Gen1: Energiedaten vom /meter-Endpunkt parsen."""
    client = ShellyClient("192.168.1.10")
    client._gen = 1

    gen1_meter_data = {
        "power": 85.3,
        "total": 98765,
        "voltage": 229.5,
        "current": 0.37,
    }

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=_mock_response(200, gen1_meter_data))

    with patch("httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        energy = await client.get_energy(channel=0)
        assert energy["power"] == 85.3
        assert energy["energy_wh"] == 98765
        assert energy["voltage"] == 229.5


@pytest.mark.asyncio
async def test_get_total_energy_kwh():
    """Gesamtenergie in kWh konvertiert Wh korrekt."""
    client = ShellyClient("192.168.1.42")
    client._gen = 2

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=_mock_response(200, {
        "apower": 0, "aenergy": {"total": 5000}, "voltage": 230, "current": 0,
    }))

    with patch("httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        kwh = await client.get_total_energy_kwh()
        assert kwh == Decimal("5")


@pytest.mark.asyncio
async def test_get_device_info_gen2():
    """Gen2: Geräteinfo parsen."""
    client = ShellyClient("192.168.1.42")
    client._gen = 2

    device_data = {
        "model": "SNSW-102P16EU",
        "fw_id": "20240101-001",
        "mac": "AABBCCDDEEFF",
        "name": "Keller Strom",
    }

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=_mock_response(200, device_data))

    with patch("httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        info = await client.get_device_info()
        assert info["model"] == "SNSW-102P16EU"
        assert info["gen"] == 2
        assert info["mac"] == "AABBCCDDEEFF"


@pytest.mark.asyncio
async def test_check_connection_success():
    """Verbindungsprüfung erfolgreich."""
    client = ShellyClient("192.168.1.42")
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=_mock_response(200, {"gen": 2}))

    with patch("httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        assert await client.check_connection() is True


@pytest.mark.asyncio
async def test_check_connection_failure():
    """Verbindungsprüfung fehlgeschlagen."""
    client = ShellyClient("10.0.0.99")
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(side_effect=httpx.ConnectError("refused"))

    with patch("httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        assert await client.check_connection() is False
