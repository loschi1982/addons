"""
bright_sky.py – DWD Bright Sky API Integration.

Bright Sky ist eine kostenlose, offene API für DWD-Wetterdaten.
Wird für Gradtagszahlen-Berechnung und Witterungskorrektur genutzt.
"""

from datetime import date
from decimal import Decimal

import httpx
import structlog

logger = structlog.get_logger()

BRIGHT_SKY_BASE_URL = "https://api.brightsky.dev"


class BrightSkyClient:
    """Client für die Bright Sky API (DWD-Wetterdaten)."""

    async def get_weather(
        self,
        dwd_station_id: str,
        start_date: date,
        end_date: date,
    ) -> list[dict]:
        """
        Tageswetterdaten für eine DWD-Station abrufen.

        Returns:
            Liste von Tages-Datensätzen mit: date, temperature_avg,
            temperature_min, temperature_max, sunshine_duration
        """
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                f"{BRIGHT_SKY_BASE_URL}/weather",
                params={
                    "dwd_station_id": dwd_station_id,
                    "date": start_date.isoformat(),
                    "last_date": end_date.isoformat(),
                },
            )
            response.raise_for_status()
            data = response.json()
            return data.get("weather", [])

    async def get_nearest_station(
        self, latitude: Decimal, longitude: Decimal
    ) -> dict | None:
        """Nächste DWD-Station zu gegebenen Koordinaten finden."""
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{BRIGHT_SKY_BASE_URL}/current_weather",
                params={"lat": str(latitude), "lon": str(longitude)},
            )
            response.raise_for_status()
            data = response.json()
            sources = data.get("sources", [])
            return sources[0] if sources else None

    @staticmethod
    def calculate_hdd(temp_avg: Decimal, indoor_temp: Decimal = Decimal("20.0"), heating_limit: Decimal = Decimal("15.0")) -> Decimal:
        """
        Heizgradtage (HDD) für einen Tag berechnen.

        HDD = max(0, Innentemp - Außentemp) wenn Außentemp < Heizgrenze
        """
        if temp_avg >= heating_limit:
            return Decimal("0")
        return max(Decimal("0"), indoor_temp - temp_avg)

    @staticmethod
    def calculate_cdd(temp_avg: Decimal, cooling_limit: Decimal = Decimal("24.0")) -> Decimal:
        """
        Kühlgradtage (CDD) für einen Tag berechnen.

        CDD = max(0, Außentemp - Kühlgrenze)
        """
        return max(Decimal("0"), temp_avg - cooling_limit)
