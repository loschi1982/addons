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

        async with httpx.AsyncClient(timeout=10) as client:
            # Gen2 zuerst probieren (längerer Timeout für Docker-Netzwerk)
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

        Probiert alle bekannten Endpunkte durch (Gen2 EM → Gen2 Switch →
        Gen1 /meter/ → Gen1 /emeter/), unabhängig von der erkannten Generation.

        Returns:
            Dict mit: power (W), energy_wh (Wh), voltage (V), current (A)
        """
        async with httpx.AsyncClient(timeout=10) as client:
            # 1. Gen2 EM (Shelly Pro 3EM)
            try:
                phase = ["a", "b", "c"][channel] if channel < 3 else "a"
                return await self._get_em_energy(client, phase)
            except (httpx.HTTPStatusError, httpx.HTTPError):
                pass

            # 2. Gen2 Switch (Shelly Plus 1PM, Plug S Plus, PM Mini)
            try:
                resp = await client.get(
                    f"{self.base_url}/rpc/Switch.GetStatus",
                    params={"id": channel},
                )
                resp.raise_for_status()
                data = resp.json()
                return {
                    "power": data.get("apower", 0),
                    "energy_wh": data.get("aenergy", {}).get("total", 0),
                    "voltage": data.get("voltage", 0),
                    "current": data.get("current", 0),
                }
            except (httpx.HTTPStatusError, httpx.HTTPError):
                pass

            # 3. Gen1 /meter/ (Shelly 1PM, 2.5)
            try:
                resp = await client.get(f"{self.base_url}/meter/{channel}")
                resp.raise_for_status()
                data = resp.json()
                return {
                    "power": data.get("power", 0),
                    "energy_wh": data.get("total", 0),
                    "voltage": data.get("voltage", 0),
                    "current": data.get("current", 0),
                }
            except (httpx.HTTPStatusError, httpx.HTTPError):
                pass

            # 4. Gen1 /emeter/ (Shelly EM, 3EM Gen1)
            resp = await client.get(f"{self.base_url}/emeter/{channel}")
            resp.raise_for_status()
            data = resp.json()
            return {
                "power": data.get("power", 0),
                "energy_wh": data.get("total", 0),
                "voltage": data.get("voltage", 0),
                "current": data.get("current", 0),
            }

    async def _get_em_energy(self, client: httpx.AsyncClient, phase: str = "a") -> dict:
        """
        Energiedaten einer Phase vom EM/EMData-Komponenten lesen (Shelly Pro 3EM).

        EM.GetStatus liefert Echtzeit-Werte (Leistung, Spannung, Strom).
        EMData.GetStatus liefert kumulierte Energie (Wh).

        Args:
            phase: "a", "b" oder "c"
        """
        em_resp = await client.get(
            f"{self.base_url}/rpc/EM.GetStatus", params={"id": 0}
        )
        em_resp.raise_for_status()
        em = em_resp.json()

        emd_resp = await client.get(
            f"{self.base_url}/rpc/EMData.GetStatus", params={"id": 0}
        )
        emd = emd_resp.json() if emd_resp.status_code == 200 else {}

        return {
            "power": em.get(f"{phase}_act_power", 0),
            "energy_wh": emd.get(f"{phase}_total_act_energy", 0),
            "voltage": em.get(f"{phase}_voltage", 0),
            "current": em.get(f"{phase}_current", 0),
        }

    async def _get_em_totals(self, client: httpx.AsyncClient) -> dict:
        """
        Summierte Werte aller Phasen vom EM/EMData lesen (Shelly Pro 3EM).

        Nutzt die totalen Felder direkt statt einzelne Phasen zu summieren.
        Gibt auch die Rückspeisung zurück (total_act_ret) für PV-Erkennung.
        """
        em_resp = await client.get(
            f"{self.base_url}/rpc/EM.GetStatus", params={"id": 0}
        )
        em_resp.raise_for_status()
        em = em_resp.json()

        emd_resp = await client.get(
            f"{self.base_url}/rpc/EMData.GetStatus", params={"id": 0}
        )
        emd = emd_resp.json() if emd_resp.status_code == 200 else {}

        return {
            "power": em.get("total_act_power", 0),
            "energy_wh": emd.get("total_act", 0),
            "energy_ret_wh": emd.get("total_act_ret", 0),
            "voltage": em.get("a_voltage", 0),
            "current": em.get("total_current", 0),
        }

    async def get_total_energy_kwh(self, channel: int = 0) -> Decimal:
        """Gesamtenergie in kWh abrufen."""
        energy = await self.get_energy(channel)
        wh = Decimal(str(energy.get("energy_wh", 0)))
        return wh / 1000

    async def get_balanced_power(self, channels: list[int] | None = None) -> dict:
        """
        Saldierende Messung: Gesamtleistung und -energie über alle Phasen.

        Positive Werte = Verbrauch (Bezug), negative Werte = Einspeisung.
        Typisch für 3-Phasen-Zähler (Shelly 3EM, Pro 3EM) mit PV-Anlage.

        Bei Gen2-EM-Geräten werden die totalen Felder direkt gelesen
        (effizienter als pro Kanal). Netto-Energie = Bezug - Rückspeisung.

        Returns:
            Dict mit: power (W), energy_wh (Wh) – saldiert
        """
        gen = await self.detect_generation()

        if gen == 2:
            async with httpx.AsyncClient(timeout=10) as client:
                # Prüfen ob EM-Komponente vorhanden ist (Pro 3EM)
                try:
                    totals = await self._get_em_totals(client)
                    # Netto-Energie: Bezug minus Rückspeisung
                    net_energy = totals["energy_wh"] - totals.get("energy_ret_wh", 0)
                    return {
                        "power": totals["power"],
                        "energy_wh": net_energy,
                    }
                except httpx.HTTPStatusError:
                    pass  # Kein EM-Gerät, Fallback auf Kanal-Summierung

        # Fallback: Gen1 oder Gen2 ohne EM – pro Kanal summieren
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
        Saldierte Gesamtenergie in kWh über alle Phasen.

        Bei PV-Einspeisung wird die Rückspeisung abgezogen (Netto-Verbrauch).
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
