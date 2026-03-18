"""
homeassistant.py – Home Assistant Integration.

Liest Sensor-Entitäten über die HA Supervisor-API.
Wird im Add-on-Modus automatisch über das Supervisor-Token authentifiziert.

Funktionen:
- Entity-Liste mit Filterung nach Domain und device_class
- Aktuellen Wert einer Entity lesen
- Historische Werte importieren
- Unterstützte device_classes: energy, gas, water, power, temperature, humidity
"""

from datetime import datetime, timezone
from decimal import Decimal

import httpx
import structlog

from app.config import get_settings

logger = structlog.get_logger()

# Relevante device_classes für Energiemanagement
ENERGY_DEVICE_CLASSES = {"energy", "gas", "water", "power", "current", "voltage"}
CLIMATE_DEVICE_CLASSES = {"temperature", "humidity", "pressure"}
ALL_RELEVANT_CLASSES = ENERGY_DEVICE_CLASSES | CLIMATE_DEVICE_CLASSES


class HomeAssistantClient:
    """Client für die Home Assistant API."""

    def __init__(self):
        settings = get_settings()
        self.base_url = settings.ha_base_url
        self.token = settings.ha_supervisor_token
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    async def get_entity_state(self, entity_id: str) -> dict:
        """Aktuellen Zustand einer Entität abrufen."""
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{self.base_url}/api/states/{entity_id}",
                headers=self.headers,
            )
            response.raise_for_status()
            return response.json()

    async def get_entity_value(self, entity_id: str) -> Decimal | None:
        """Numerischen Wert einer Sensor-Entität abrufen."""
        state = await self.get_entity_state(entity_id)
        try:
            return Decimal(state["state"])
        except Exception:
            logger.warning("ha_entity_not_numeric", entity_id=entity_id, state=state.get("state"))
            return None

    async def get_entity_history(
        self, entity_id: str, start_time: str, end_time: str | None = None
    ) -> list[dict]:
        """
        Historische Werte einer Entität abrufen.

        Args:
            entity_id: z.B. "sensor.stromzaehler_total"
            start_time: ISO-Format, z.B. "2024-01-01T00:00:00Z"
            end_time: Optional, ISO-Format

        Returns:
            Liste von State-Objekten mit state, last_changed, attributes
        """
        params = {"filter_entity_id": entity_id}
        if end_time:
            params["end_time"] = end_time

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                f"{self.base_url}/api/history/period/{start_time}",
                headers=self.headers,
                params=params,
            )
            response.raise_for_status()
            data = response.json()
            return data[0] if data else []

    async def list_entities(
        self,
        domain: str | None = None,
        device_class: str | None = None,
    ) -> list[dict]:
        """
        Alle Entitäten auflisten, optional gefiltert.

        Args:
            domain: z.B. "sensor", "input_number"
            device_class: z.B. "energy", "temperature"

        Returns:
            Liste von Entities mit entity_id, friendly_name, state,
            unit_of_measurement, device_class, area_id
        """
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{self.base_url}/api/states",
                headers=self.headers,
            )
            response.raise_for_status()
            entities = response.json()

        # Filtern
        if domain:
            entities = [e for e in entities if e["entity_id"].startswith(f"{domain}.")]

        if device_class:
            entities = [
                e for e in entities
                if e.get("attributes", {}).get("device_class") == device_class
            ]

        # In vereinfachtes Format umwandeln
        result = []
        for e in entities:
            attrs = e.get("attributes", {})
            result.append({
                "entity_id": e["entity_id"],
                "friendly_name": attrs.get("friendly_name", e["entity_id"]),
                "state": e.get("state"),
                "unit_of_measurement": attrs.get("unit_of_measurement"),
                "device_class": attrs.get("device_class"),
                "state_class": attrs.get("state_class"),
                "icon": attrs.get("icon"),
            })

        return result

    async def list_energy_entities(self) -> list[dict]:
        """Alle energierelevanten Entitäten auflisten."""
        all_entities = await self.list_entities(domain="sensor")
        return [
            e for e in all_entities
            if e.get("device_class") in ALL_RELEVANT_CLASSES
            or e.get("state_class") in ("total", "total_increasing", "measurement")
        ]

    async def import_history(
        self,
        entity_id: str,
        start_time: str,
        end_time: str | None = None,
    ) -> list[dict]:
        """
        Historische Daten einer Entity als importierbare Datenpunkte liefern.

        Returns:
            Liste von {timestamp, value} Dicts
        """
        history = await self.get_entity_history(entity_id, start_time, end_time)

        data_points = []
        for state_obj in history:
            try:
                value = Decimal(state_obj["state"])
                ts = state_obj.get("last_changed", state_obj.get("last_updated"))
                if ts and value is not None:
                    data_points.append({
                        "timestamp": ts,
                        "value": float(value),
                    })
            except (ValueError, TypeError, KeyError, ArithmeticError):
                continue

        return data_points

    async def check_connection(self) -> bool:
        """Prüft ob die Verbindung zu HA funktioniert."""
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                response = await client.get(
                    f"{self.base_url}/api/",
                    headers=self.headers,
                )
                return response.status_code == 200
        except Exception:
            return False
