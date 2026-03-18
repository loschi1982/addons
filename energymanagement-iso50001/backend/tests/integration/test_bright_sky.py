"""
test_bright_sky.py – Tests für die BrightSky-Integration.

Testet Wetterdaten-Abruf, Stationssuche und
Gradtagszahlen-Berechnung (HDD/CDD) mit gemockten HTTP-Responses.
"""

from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.integrations.bright_sky import BrightSkyClient


def _mock_response(status_code: int = 200, json_data: dict | None = None):
    """Erstellt ein gemocktes httpx.Response-Objekt."""
    resp = httpx.Response(
        status_code=status_code,
        json=json_data or {},
        request=httpx.Request("GET", "http://test"),
    )
    return resp


# ── Gradtagszahlen (reine Funktionen, kein Mocking nötig) ──


def test_hdd_below_heating_limit():
    """HDD bei Außentemperatur unter Heizgrenze."""
    hdd = BrightSkyClient.calculate_hdd(Decimal("5.0"))
    # HDD = 20 - 5 = 15
    assert hdd == Decimal("15.0")


def test_hdd_above_heating_limit():
    """HDD = 0 wenn Außentemperatur über Heizgrenze."""
    hdd = BrightSkyClient.calculate_hdd(Decimal("18.0"))
    assert hdd == Decimal("0")


def test_hdd_custom_limits():
    """HDD mit benutzerdefinierten Grenzwerten."""
    hdd = BrightSkyClient.calculate_hdd(
        Decimal("10.0"),
        indoor_temp=Decimal("22.0"),
        heating_limit=Decimal("12.0"),
    )
    # HDD = 22 - 10 = 12
    assert hdd == Decimal("12.0")


def test_cdd_above_cooling_limit():
    """CDD bei Außentemperatur über Kühlgrenze."""
    cdd = BrightSkyClient.calculate_cdd(Decimal("28.0"))
    # CDD = 28 - 24 = 4
    assert cdd == Decimal("4.0")


def test_cdd_below_cooling_limit():
    """CDD = 0 wenn Außentemperatur unter Kühlgrenze."""
    cdd = BrightSkyClient.calculate_cdd(Decimal("20.0"))
    assert cdd == Decimal("0")


def test_cdd_custom_limit():
    """CDD mit benutzerdefinierter Kühlgrenze."""
    cdd = BrightSkyClient.calculate_cdd(
        Decimal("30.0"), cooling_limit=Decimal("26.0")
    )
    assert cdd == Decimal("4.0")


# ── Wetterdaten-Abruf (gemockte HTTP-Responses) ──


@pytest.mark.asyncio
async def test_get_weather():
    """Wetterdaten für eine DWD-Station abrufen."""
    weather_data = {
        "weather": [
            {
                "timestamp": "2024-01-01T00:00:00+00:00",
                "temperature": 3.5,
                "sunshine_duration": 120,
            },
            {
                "timestamp": "2024-01-02T00:00:00+00:00",
                "temperature": -1.2,
                "sunshine_duration": 0,
            },
        ]
    }

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=_mock_response(200, weather_data))

    client = BrightSkyClient()

    with patch("httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        result = await client.get_weather(
            dwd_station_id="01766",
            start_date=date(2024, 1, 1),
            end_date=date(2024, 1, 2),
        )
        assert len(result) == 2
        assert result[0]["temperature"] == 3.5
        assert result[1]["temperature"] == -1.2


@pytest.mark.asyncio
async def test_get_nearest_station():
    """Nächste DWD-Station zu Koordinaten finden."""
    station_data = {
        "sources": [
            {
                "id": 1766,
                "dwd_station_id": "01766",
                "station_name": "München-Stadt",
                "distance": 2.5,
            }
        ]
    }

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=_mock_response(200, station_data))

    client = BrightSkyClient()

    with patch("httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        station = await client.get_nearest_station(
            latitude=Decimal("48.1351"), longitude=Decimal("11.5820")
        )
        assert station is not None
        assert station["dwd_station_id"] == "01766"
        assert station["station_name"] == "München-Stadt"


@pytest.mark.asyncio
async def test_get_nearest_station_none():
    """Keine Station gefunden → None."""
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=_mock_response(200, {"sources": []}))

    client = BrightSkyClient()

    with patch("httpx.AsyncClient") as mock_cls:
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        station = await client.get_nearest_station(
            latitude=Decimal("0.0"), longitude=Decimal("0.0")
        )
        assert station is None
