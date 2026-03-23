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

    def __init__(self, base_url: str = ""):
        self.base_url = base_url.rstrip("/") if base_url else BRIGHT_SKY_BASE_URL

    @classmethod
    async def from_settings(cls, db) -> "BrightSkyClient":
        """Client aus DB-Settings erstellen."""
        from app.services.settings_service import SettingsService
        svc = SettingsService(db)
        cfg = await svc.get("integrations_weather")
        if cfg and cfg.get("value"):
            val = cfg["value"]
            if val.get("base_url"):
                return cls(base_url=val["base_url"])
        return cls()

    async def check_connection(self) -> bool:
        """Verbindung zur BrightSky API testen."""
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"{self.base_url}/weather", params={
                "dwd_station_id": "01766",  # Dresden-Klotzsche als Test
                "date": "2024-01-01", "last_date": "2024-01-01",
            })
            return response.status_code == 200

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
                f"{self.base_url}/weather",
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
                f"{self.base_url}/current_weather",
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
