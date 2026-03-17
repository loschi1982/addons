"""
homeassistant.py – Home Assistant Integration.

Liest Sensor-Entitäten über die HA Supervisor-API oder WebSocket-API.
Wird im Add-on-Modus automatisch über das Supervisor-Token authentifiziert.
"""

from decimal import Decimal

import httpx
import structlog

from app.config import get_settings

logger = structlog.get_logger()


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
        """Historische Werte einer Entität abrufen."""
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

    async def list_entities(self, domain: str | None = None) -> list[dict]:
        """Alle Entitäten auflisten, optional gefiltert nach Domain."""
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{self.base_url}/api/states",
                headers=self.headers,
            )
            response.raise_for_status()
            entities = response.json()

            if domain:
                entities = [e for e in entities if e["entity_id"].startswith(f"{domain}.")]

            return entities
