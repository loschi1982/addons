"""
shelly.py – Shelly-Geräte-Integration.

Liest Energiedaten von Shelly-Geräten über deren lokale HTTP-API.
Unterstützt Gen1 (Shelly 1, 2.5, EM) und Gen2+ (Plus, Pro Serie).

Gen1-API: /status, /meter/0
Gen2-API: /rpc/Shelly.GetStatus, /rpc/Switch.GetStatus?id=0

Metriken: Leistung (W), Energie (Wh/kWh), Spannung (V), Strom (A)
"""

from decimal import Decimal

import httpx
import structlog

logger = structlog.get_logger()


class ShellyClient:
    """Client für die Shelly HTTP-API (Gen1 + Gen2)."""

    def __init__(self, host: str, auth_key: str | None = None):
        self.host = host
        self.auth_key = auth_key
        self.base_url = f"http://{host}"
        self._gen: int | None = None  # 1 oder 2, wird beim ersten Aufruf erkannt

    async def detect_generation(self) -> int:
        """
        Erkennt ob das Gerät Gen1 oder Gen2 ist.

        Gen2-Geräte antworten auf /rpc/Shelly.GetDeviceInfo,
        Gen1-Geräte auf /settings.
        """
        if self._gen:
            return self._gen

        async with httpx.AsyncClient(timeout=5) as client:
            # Gen2 zuerst probieren
            try:
                resp = await client.get(f"{self.base_url}/rpc/Shelly.GetDeviceInfo")
                if resp.status_code == 200:
                    self._gen = 2
                    return 2
            except httpx.HTTPError:
                pass

            # Gen1 probieren
            try:
                resp = await client.get(f"{self.base_url}/settings")
                if resp.status_code == 200:
                    self._gen = 1
                    return 1
            except httpx.HTTPError:
                pass

        raise ConnectionError(f"Shelly-Gerät unter {self.host} nicht erreichbar")

    async def get_status(self) -> dict:
        """Gerätestatus abrufen (Leistung, Energie, Temperatur)."""
        gen = await self.detect_generation()
        async with httpx.AsyncClient(timeout=10) as client:
            if gen == 2:
                response = await client.get(f"{self.base_url}/rpc/Shelly.GetStatus")
            else:
                response = await client.get(f"{self.base_url}/status")
            response.raise_for_status()
            return response.json()

    async def get_energy(self, channel: int = 0) -> dict:
        """
        Aktuelle Energiedaten eines Kanals abrufen.

        Returns:
            Dict mit: power (W), energy_wh (Wh), voltage (V), current (A)
        """
        gen = await self.detect_generation()
        async with httpx.AsyncClient(timeout=10) as client:
            if gen == 2:
                # Gen2: Switch oder EM-Komponente
                resp = await client.get(
                    f"{self.base_url}/rpc/Switch.GetStatus",
                    params={"id": channel},
                )
                if resp.status_code != 200:
                    # Fallback: EM-Komponente (Shelly Pro 3EM)
                    resp = await client.get(
                        f"{self.base_url}/rpc/EM.GetStatus",
                        params={"id": channel},
                    )
                resp.raise_for_status()
                data = resp.json()
                return {
                    "power": data.get("apower", data.get("act_power", 0)),
                    "energy_wh": data.get("aenergy", {}).get("total", 0),
                    "voltage": data.get("voltage", 0),
                    "current": data.get("current", 0),
                }
            else:
                # Gen1: /meter/<channel>
                resp = await client.get(f"{self.base_url}/meter/{channel}")
                resp.raise_for_status()
                data = resp.json()
                return {
                    "power": data.get("power", 0),
                    "energy_wh": data.get("total", 0),
                    "voltage": data.get("voltage", 0),
                    "current": data.get("current", 0),
                }

    async def get_total_energy_kwh(self, channel: int = 0) -> Decimal:
        """Gesamtenergie in kWh abrufen."""
        energy = await self.get_energy(channel)
        wh = Decimal(str(energy.get("energy_wh", 0)))
        return wh / 1000

    async def get_balanced_power(self, channels: list[int] | None = None) -> dict:
        """
        Saldierende Messung: Summiert Leistung und Energie über alle Kanäle.

        Positive Werte = Verbrauch (Bezug), negative Werte = Einspeisung.
        Typisch für 3-Phasen-Zähler (Shelly 3EM, Pro 3EM) mit PV-Anlage.

        Args:
            channels: Kanalliste, Default [0, 1, 2] für 3-Phasen-Messung

        Returns:
            Dict mit: power (W), energy_wh (Wh) – saldiert über alle Kanäle
        """
        if channels is None:
            channels = [0, 1, 2]

        total_power = Decimal("0")
        total_energy_wh = Decimal("0")

        for ch in channels:
            try:
                data = await self.get_energy(ch)
                total_power += Decimal(str(data.get("power", 0)))
                total_energy_wh += Decimal(str(data.get("energy_wh", 0)))
            except Exception as e:
                logger.warning(
                    "shelly_channel_read_failed",
                    host=self.host,
                    channel=ch,
                    error=str(e),
                )

        return {
            "power": float(total_power),
            "energy_wh": float(total_energy_wh),
        }

    async def get_balanced_energy_kwh(self, channels: list[int] | None = None) -> Decimal:
        """
        Saldierte Gesamtenergie in kWh über alle Kanäle.

        Summiert die Energie aller angegebenen Kanäle (Default: 0, 1, 2).
        Bei PV-Einspeisung wird der Gesamtwert entsprechend reduziert.
        """
        data = await self.get_balanced_power(channels)
        wh = Decimal(str(data.get("energy_wh", 0)))
        return wh / 1000

    async def get_device_info(self) -> dict:
        """
        Geräteinformationen abrufen.

        Returns:
            Dict mit: model, firmware, mac, gen, name
        """
        gen = await self.detect_generation()
        async with httpx.AsyncClient(timeout=10) as client:
            if gen == 2:
                resp = await client.get(f"{self.base_url}/rpc/Shelly.GetDeviceInfo")
                resp.raise_for_status()
                data = resp.json()
                return {
                    "model": data.get("model", "unknown"),
                    "firmware": data.get("fw_id", ""),
                    "mac": data.get("mac", ""),
                    "gen": 2,
                    "name": data.get("name", ""),
                }
            else:
                resp = await client.get(f"{self.base_url}/settings")
                resp.raise_for_status()
                data = resp.json()
                device = data.get("device", {})
                return {
                    "model": device.get("type", "unknown"),
                    "firmware": data.get("fw", ""),
                    "mac": device.get("mac", ""),
                    "gen": 1,
                    "name": data.get("name", ""),
                }

    async def check_connection(self) -> bool:
        """Prüft ob das Shelly-Gerät erreichbar ist."""
        try:
            await self.detect_generation()
            return True
        except Exception:
            return False
