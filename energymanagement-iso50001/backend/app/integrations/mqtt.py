"""
mqtt.py – MQTT-Integration.

Liest Sensorwerte von einem MQTT-Broker. Unterstützt:
- Einmaliges Lesen eines Topics (für Polling)
- HA MQTT Discovery (homeassistant/sensor/+/config)
- Tasmota Discovery (tasmota/discovery/+/config)
- Generisches Topic-Scanning

Metriken: Beliebige numerische Werte (Energie, Temperatur, Feuchte, etc.)
"""

import json
from decimal import Decimal

import structlog

logger = structlog.get_logger()


class MQTTClient:
    """Client für MQTT-Broker."""

    def __init__(
        self,
        broker_host: str,
        port: int = 1883,
        username: str = "",
        password: str = "",
    ):
        self.broker_host = broker_host
        self.port = port
        self.username = username
        self.password = password

    @classmethod
    async def from_settings(cls, db) -> "MQTTClient":
        """Client aus DB-Settings erstellen."""
        from app.services.settings_service import SettingsService
        svc = SettingsService(db)
        cfg = await svc.get("integrations_mqtt")
        if cfg and cfg.get("value"):
            val = cfg["value"]
            return cls(
                broker_host=val.get("broker_host", ""),
                port=val.get("port", 1883),
                username=val.get("username", ""),
                password=val.get("password", ""),
            )
        return cls(broker_host="")

    async def check_connection(self) -> bool:
        """Verbindung zum MQTT-Broker testen."""
        import aiomqtt

        if not self.broker_host:
            return False
        try:
            async with aiomqtt.Client(
                hostname=self.broker_host,
                port=self.port,
                username=self.username or None,
                password=self.password or None,
                timeout=5,
            ):
                return True
        except Exception as e:
            logger.warning("mqtt_connection_failed", host=self.broker_host, error=str(e))
            return False

    async def read_value(self, topic: str, timeout: float = 5.0) -> Decimal | None:
        """
        Topic einmalig lesen und numerischen Wert zurückgeben.

        Abonniert das Topic, wartet auf die erste Nachricht und gibt
        den Wert als Decimal zurück. Für JSON-Payloads wird versucht,
        einen numerischen Wert zu extrahieren.
        """
        import asyncio

        import aiomqtt

        try:
            async with aiomqtt.Client(
                hostname=self.broker_host,
                port=self.port,
                username=self.username or None,
                password=self.password or None,
                timeout=timeout,
            ) as client:
                await client.subscribe(topic)
                async for message in client.messages:
                    payload = message.payload.decode("utf-8", errors="replace").strip()
                    return self._parse_value(payload)
        except asyncio.TimeoutError:
            logger.warning("mqtt_read_timeout", topic=topic, timeout=timeout)
            return None
        except Exception as e:
            logger.warning("mqtt_read_failed", topic=topic, error=str(e))
            return None

    def _parse_value(self, payload: str) -> Decimal | None:
        """Payload als Decimal parsen (plain number oder JSON)."""
        # Versuch 1: Direkt als Zahl
        try:
            return Decimal(payload)
        except Exception:
            pass

        # Versuch 2: JSON – ersten numerischen Wert extrahieren
        try:
            data = json.loads(payload)
            if isinstance(data, dict):
                # Typische Schlüssel für Messwerte
                for key in ("value", "val", "state", "total", "energy",
                            "power", "temperature", "humidity", "temp", "hum"):
                    if key in data:
                        return Decimal(str(data[key]))
                # Ersten numerischen Wert nehmen
                for v in data.values():
                    if isinstance(v, (int, float)):
                        return Decimal(str(v))
        except (json.JSONDecodeError, TypeError, ValueError):
            pass

        return None

    async def discover_sensors(self, timeout: float = 5.0) -> list[dict]:
        """
        Verfügbare Sensoren über MQTT Discovery finden.

        Scannt:
        1. HA MQTT Discovery: homeassistant/+/+/config
        2. Tasmota Discovery: tasmota/discovery/+/config
        3. Generische Topics mit numerischen Payloads

        Returns:
            Liste von Sensor-Dicts mit: topic, name, unit, device_class, value
        """
        import asyncio

        import aiomqtt

        if not self.broker_host:
            return []

        sensors: list[dict] = []
        seen_topics: set[str] = set()

        try:
            async with aiomqtt.Client(
                hostname=self.broker_host,
                port=self.port,
                username=self.username or None,
                password=self.password or None,
                timeout=timeout,
            ) as client:
                # HA MQTT Discovery abonnieren
                await client.subscribe("homeassistant/+/+/config")
                await client.subscribe("homeassistant/+/+/+/config")
                # Tasmota Discovery
                await client.subscribe("tasmota/discovery/+/config")

                try:
                    async with asyncio.timeout(timeout):
                        async for message in client.messages:
                            topic = str(message.topic)
                            if topic in seen_topics:
                                continue
                            seen_topics.add(topic)

                            payload = message.payload.decode("utf-8", errors="replace")
                            sensor = self._parse_discovery_message(topic, payload)
                            if sensor:
                                sensors.append(sensor)
                except asyncio.TimeoutError:
                    pass  # Timeout erreicht, gesammelte Sensoren zurückgeben

        except Exception as e:
            logger.warning("mqtt_discovery_failed", error=str(e))

        logger.info("mqtt_discovery_complete", sensors_found=len(sensors))
        return sensors

    def _parse_discovery_message(self, topic: str, payload: str) -> dict | None:
        """Discovery-Nachricht parsen (HA oder Tasmota Format)."""
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            return None

        if not isinstance(data, dict):
            return None

        # HA MQTT Discovery Format
        if topic.startswith("homeassistant/"):
            state_topic = data.get("stat_t") or data.get("state_topic", "")
            if not state_topic:
                return None
            return {
                "topic": state_topic,
                "name": data.get("name", data.get("unique_id", state_topic)),
                "unit": data.get("unit_of_meas") or data.get("unit_of_measurement", ""),
                "device_class": data.get("dev_cla") or data.get("device_class", ""),
                "device_name": (data.get("dev") or data.get("device", {})).get("name", ""),
                "unique_id": data.get("uniq_id") or data.get("unique_id", ""),
            }

        # Tasmota Discovery Format
        if topic.startswith("tasmota/discovery/"):
            return {
                "topic": data.get("t", ""),  # Topic-Prefix
                "name": data.get("fn", [data.get("hn", "Tasmota")])[0],
                "unit": "",
                "device_class": "",
                "device_name": data.get("hn", ""),
                "unique_id": data.get("mac", ""),
            }

        return None
