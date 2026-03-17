"""
electricity_maps.py – Electricity Maps API Integration.

Liefert die Echtzeit-CO₂-Intensität des Stromnetzes nach Region.
Wird für genauere CO₂-Bilanzierung verwendet (stündliche Faktoren
statt Jahresdurchschnitt).
"""

from decimal import Decimal

import httpx
import structlog

from app.config import get_settings

logger = structlog.get_logger()

ELECTRICITY_MAPS_BASE_URL = "https://api.electricitymap.org/v3"


class ElectricityMapsClient:
    """Client für die Electricity Maps API."""

    def __init__(self):
        settings = get_settings()
        self.api_key = settings.electricity_maps_api_key
        self.headers = {"auth-token": self.api_key} if self.api_key else {}

    async def get_carbon_intensity(self, zone: str = "DE") -> dict | None:
        """
        Aktuelle CO₂-Intensität für eine Zone abrufen.

        Returns:
            Dict mit: carbonIntensity (gCO₂/kWh), fossilFuelPercentage, etc.
        """
        if not self.api_key:
            logger.warning("electricity_maps_no_api_key")
            return None

        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{ELECTRICITY_MAPS_BASE_URL}/carbon-intensity/latest",
                params={"zone": zone},
                headers=self.headers,
            )
            response.raise_for_status()
            return response.json()

    async def get_carbon_intensity_history(
        self, zone: str = "DE", datetime_str: str | None = None
    ) -> list[dict]:
        """Historische CO₂-Intensität abrufen (letzte 24h)."""
        if not self.api_key:
            return []

        params = {"zone": zone}
        if datetime_str:
            params["datetime"] = datetime_str

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                f"{ELECTRICITY_MAPS_BASE_URL}/carbon-intensity/history",
                params=params,
                headers=self.headers,
            )
            response.raise_for_status()
            data = response.json()
            return data.get("history", [])
