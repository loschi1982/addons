"""
shelly.py – Shelly-Geräte-Integration.

Liest Energiedaten von Shelly-Geräten über deren lokale HTTP-API.
Unterstützt Shelly Plus und Pro Serie (Gen2+).
"""

from decimal import Decimal

import httpx
import structlog

logger = structlog.get_logger()


class ShellyClient:
    """Client für die Shelly HTTP-API."""

    def __init__(self, host: str, auth_key: str | None = None):
        self.host = host
        self.auth_key = auth_key
        self.base_url = f"http://{host}"

    async def get_status(self) -> dict:
        """Gerätestatus abrufen (Leistung, Energie, Temperatur)."""
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"{self.base_url}/rpc/Shelly.GetStatus")
            response.raise_for_status()
            return response.json()

    async def get_energy(self, channel: int = 0) -> dict:
        """
        Aktuelle Energiedaten eines Kanals abrufen.

        Returns:
            Dict mit: power (W), energy (Wh), voltage (V), current (A)
        """
        # TODO: Implementierung je nach Gerätetyp (EM, PM, Plug)
        raise NotImplementedError

    async def get_total_energy_kwh(self, channel: int = 0) -> Decimal:
        """Gesamtenergie in kWh abrufen."""
        # TODO: Implementierung
        raise NotImplementedError

    async def get_device_info(self) -> dict:
        """Geräteinformationen (Modell, Firmware, MAC) abrufen."""
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"{self.base_url}/rpc/Shelly.GetDeviceInfo")
            response.raise_for_status()
            return response.json()
