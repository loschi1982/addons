"""
polling_manager.py – Zentraler Polling-Manager für automatische Datenerfassung.

Koordiniert das periodische Abrufen von Zählerständen aus
verschiedenen Quellen (Shelly, Modbus, KNX, Home Assistant).
Wird als Celery-Beat-Task im Hintergrund ausgeführt.

Ablauf:
1. Alle aktiven Zähler mit automatischer Datenquelle laden
2. Für jeden Zähler den passenden Client erstellen
3. Wert abrufen und als MeterReading speichern
4. Fehler loggen und mit nächstem Zähler fortfahren
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meter import Meter
from app.models.reading import MeterReading

logger = structlog.get_logger()

# Datenquellen die automatisch abgefragt werden
AUTO_SOURCES = {"shelly", "modbus", "knx", "homeassistant", "mqtt", "bacnet"}


class PollingManager:
    """Koordiniert das automatische Polling aller konfigurierten Zähler."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def poll_all_meters(self) -> dict:
        """
        Alle aktiven Zähler mit automatischer Datenquelle abfragen.

        Returns:
            Dict mit polled, success, errors, details
        """
        # Alle aktiven Zähler mit automatischer Datenquelle laden
        result = await self.db.execute(
            select(Meter).where(
                Meter.is_active == True,  # noqa: E712
                Meter.data_source.in_(AUTO_SOURCES),
            )
        )
        meters = result.scalars().all()

        polled = 0
        success = 0
        errors = 0
        details = []

        for meter in meters:
            polled += 1
            try:
                poll_result = await self.poll_single_meter(meter.id)
                if poll_result.get("success"):
                    success += 1
                else:
                    errors += 1
                details.append(poll_result)
            except Exception as e:
                errors += 1
                details.append({
                    "meter_id": str(meter.id),
                    "meter_name": meter.name,
                    "success": False,
                    "error": str(e),
                })
                logger.error(
                    "poll_meter_failed",
                    meter_id=str(meter.id),
                    error=str(e),
                )

        # Virtuelle Zähler nach den physischen berechnen
        virtual_result = await self._calculate_virtual_meters()
        polled += virtual_result["polled"]
        success += virtual_result["success"]
        errors += virtual_result["errors"]
        details.extend(virtual_result["details"])

        logger.info(
            "poll_all_complete",
            polled=polled,
            success=success,
            errors=errors,
        )

        return {
            "polled": polled,
            "success": success,
            "errors": errors,
            "details": details,
        }

    async def poll_single_meter(self, meter_id: uuid.UUID) -> dict:
        """
        Einzelnen Zähler abfragen und Reading speichern.

        Ruft je nach data_source den passenden Client auf,
        liest den aktuellen Wert und speichert ihn als MeterReading.
        """
        meter = await self.db.get(Meter, meter_id)
        if not meter:
            return {"meter_id": str(meter_id), "success": False, "error": "Zähler nicht gefunden"}

        # Virtuelle Zähler direkt berechnen
        if meter.is_virtual:
            return await self._calc_single_virtual(meter)

        if meter.data_source not in AUTO_SOURCES:
            return {"meter_id": str(meter_id), "success": False, "error": "Keine automatische Quelle"}

        dispatch = {
            "shelly": self._poll_shelly,
            "modbus": self._poll_modbus,
            "knx": self._poll_knx,
            "homeassistant": self._poll_ha_entity,
            "mqtt": self._poll_mqtt,
            "bacnet": self._poll_bacnet,
        }

        handler = dispatch.get(meter.data_source)
        if not handler:
            return {"meter_id": str(meter_id), "success": False, "error": f"Unbekannte Quelle: {meter.data_source}"}

        return await handler(meter)

    async def _poll_shelly(self, meter: Meter) -> dict:
        """Shelly-Gerät abfragen und Reading speichern."""
        from app.integrations.shelly import ShellyClient

        config = meter.source_config or {}
        host = config.get("shelly_host", config.get("ip", ""))
        channel = config.get("channel", 0)
        mode = config.get("mode", "single")  # "single" oder "balanced"

        if not host:
            return self._error_result(meter, "Keine Shelly-IP konfiguriert")

        client = ShellyClient(host)

        if mode == "balanced":
            # Saldierende Messung: alle Kanäle summieren
            channels = config.get("channels", [0, 1, 2])
            value = await client.get_balanced_energy_kwh(channels)
        else:
            # Einzelkanal-Messung (Standard)
            value = await client.get_total_energy_kwh(channel)

        return await self._save_reading(meter, value, "shelly")

    async def _poll_modbus(self, meter: Meter) -> dict:
        """Modbus-Gerät abfragen und Reading speichern."""
        from app.integrations.modbus import ModbusClient

        config = meter.source_config or {}
        host = config.get("modbus_host", config.get("host", ""))
        port = config.get("modbus_port", config.get("port", 502))
        unit_id = config.get("unit_id", 1)

        if not host:
            return self._error_result(meter, "Kein Modbus-Host konfiguriert")

        registers = config.get("registers", [])
        if not registers:
            return self._error_result(meter, "Keine Modbus-Register konfiguriert")

        client = ModbusClient(host, port, unit_id)
        try:
            await client.connect()

            # Erstes Register als Energiewert lesen
            reg = registers[0]
            value = await client.read_value(
                address=reg.get("address", 0),
                data_type=reg.get("data_type", "float32"),
                function_code=reg.get("function_code", 3),
                byte_order=reg.get("byte_order", "big"),
                scale=reg.get("scale", 1.0),
                offset=reg.get("offset", 0.0),
            )

            return await self._save_reading(meter, value, "modbus")
        finally:
            await client.disconnect()

    async def _poll_knx(self, meter: Meter) -> dict:
        """KNX-Gruppenadresse abfragen und Reading speichern."""
        from app.integrations.knx import KNXClient

        config = meter.source_config or {}
        gateway = config.get("knx_gateway_host", config.get("gateway_ip", ""))
        port = config.get("knx_gateway_port", 3671)
        group_address = config.get("group_address", "")
        dpt = config.get("dpt", "DPT-13")

        if not gateway or not group_address:
            return self._error_result(meter, "KNX-Gateway oder Gruppenadresse fehlt")

        client = KNXClient(gateway, port, local_ip=config.get("local_ip"))
        try:
            await client.connect()
            value = await client.read_group_address(group_address, dpt)
            return await self._save_reading(meter, value, "knx")
        finally:
            await client.disconnect()

    async def _poll_ha_entity(self, meter: Meter) -> dict:
        """Home Assistant Entität abfragen und Reading speichern."""
        from app.integrations.homeassistant import HomeAssistantClient

        config = meter.source_config or {}
        entity_id = config.get("entity_id", "")

        if not entity_id:
            return self._error_result(meter, "Keine HA-Entity-ID konfiguriert")

        client = HomeAssistantClient()
        value = await client.get_entity_value(entity_id)

        if value is None:
            return self._error_result(meter, f"Kein numerischer Wert von {entity_id}")

        return await self._save_reading(meter, value, "homeassistant")

    async def _poll_mqtt(self, meter: Meter) -> dict:
        """MQTT-Topic abfragen und Reading speichern."""
        from app.integrations.mqtt import MQTTClient

        config = meter.source_config or {}
        broker = config.get("broker_host", config.get("host", ""))
        topic = config.get("topic", "")

        if not broker or not topic:
            return self._error_result(meter, "MQTT-Broker oder Topic nicht konfiguriert")

        client = MQTTClient(
            broker_host=broker,
            port=config.get("port", 1883),
            username=config.get("username", ""),
            password=config.get("password", ""),
        )
        value = await client.read_value(topic, timeout=config.get("timeout", 5.0))

        if value is None:
            return self._error_result(meter, f"Kein numerischer Wert von Topic {topic}")

        return await self._save_reading(meter, value, "mqtt")

    async def _poll_bacnet(self, meter: Meter) -> dict:
        """BACnet-Objekt abfragen und Reading speichern."""
        from app.integrations.bacnet import BACnetClient

        config = meter.source_config or {}
        device_address = config.get("device_address", config.get("host", ""))
        object_type = config.get("object_type", "analogInput")
        object_instance = config.get("object_instance", 0)

        if not device_address:
            return self._error_result(meter, "BACnet-Geräteadresse nicht konfiguriert")

        client = BACnetClient(
            interface=config.get("interface"),
            port=config.get("port", 47808),
        )
        try:
            value = await client.read_property(
                device_address, object_type, object_instance
            )
            if value is None:
                return self._error_result(
                    meter, f"Kein Wert von {device_address} {object_type},{object_instance}"
                )
            return await self._save_reading(meter, value, "bacnet")
        finally:
            await client.disconnect()

    async def _save_reading(
        self, meter: Meter, value: Decimal, source: str
    ) -> dict:
        """
        Neuen Zählerstand speichern und Verbrauch berechnen.

        Prüft zuerst ob sich der Wert seit dem letzten Reading geändert hat.
        Bei saldierender Messung (mode=balanced) sind negative Werte erlaubt
        (Einspeisung, z.B. durch PV-Anlage).
        """
        now = datetime.now(timezone.utc)

        # Letzten Stand laden
        result = await self.db.execute(
            select(MeterReading)
            .where(MeterReading.meter_id == meter.id)
            .order_by(MeterReading.timestamp.desc())
            .limit(1)
        )
        last_reading = result.scalar_one_or_none()

        # Nur speichern wenn sich der Wert geändert hat (auf 3 Dezimalen runden)
        rounded_value = round(value, 3)
        if last_reading and round(last_reading.value, 3) == rounded_value:
            return {
                "meter_id": str(meter.id),
                "meter_name": meter.name,
                "success": True,
                "skipped": True,
                "reason": "Wert unverändert",
            }
        value = rounded_value

        # Verbrauch berechnen
        consumption = None
        if meter.is_delivery_based:
            # Lieferungsbasiert: Wert IST der Verbrauch
            consumption = value
        elif last_reading:
            diff = value - last_reading.value
            # Bei saldierender Messung negative Werte erlauben (Einspeisung)
            config = meter.source_config or {}
            is_balanced = config.get("mode") == "balanced"
            consumption = diff if (diff >= 0 or is_balanced) else None

        reading = MeterReading(
            meter_id=meter.id,
            timestamp=now,
            value=value,
            consumption=consumption,
            source=source,
            quality="measured",
        )
        self.db.add(reading)
        await self.db.commit()

        logger.debug(
            "poll_reading_saved",
            meter_id=str(meter.id),
            value=float(value),
            consumption=float(consumption) if consumption else None,
        )

        return {
            "meter_id": str(meter.id),
            "meter_name": meter.name,
            "success": True,
            "value": float(value),
            "consumption": float(consumption) if consumption else None,
        }

    async def _calculate_virtual_meters(self) -> dict:
        """
        Alle virtuellen Zähler berechnen.

        Unterstützte Formeln (virtual_config.type):
        - "difference": source_meter_id minus subtract_meter_ids[]
        - "sum": Summe aller source_meter_ids[]

        Liest jeweils den letzten Zählerstand der Quellzähler.
        """
        result = await self.db.execute(
            select(Meter).where(
                Meter.is_active == True,  # noqa: E712
                Meter.is_virtual == True,  # noqa: E712
            )
        )
        virtual_meters = result.scalars().all()

        polled = 0
        success = 0
        errors = 0
        details = []

        for meter in virtual_meters:
            polled += 1
            try:
                calc_result = await self._calc_single_virtual(meter)
                if calc_result.get("success"):
                    success += 1
                else:
                    errors += 1
                details.append(calc_result)
            except Exception as e:
                errors += 1
                details.append(self._error_result(meter, str(e)))
                logger.error(
                    "virtual_meter_calc_failed",
                    meter_id=str(meter.id),
                    error=str(e),
                )

        return {"polled": polled, "success": success, "errors": errors, "details": details}

    async def _calc_single_virtual(self, meter: Meter) -> dict:
        """Einen virtuellen Zähler berechnen."""
        config = meter.virtual_config or {}
        calc_type = config.get("type", "difference")

        if calc_type == "difference":
            return await self._calc_difference(meter, config)
        elif calc_type == "sum":
            return await self._calc_sum(meter, config)
        else:
            return self._error_result(meter, f"Unbekannter Formeltyp: {calc_type}")

    async def _get_latest_value(self, meter_id: uuid.UUID) -> Decimal | None:
        """Letzten Zählerstand eines Zählers laden."""
        result = await self.db.execute(
            select(MeterReading)
            .where(MeterReading.meter_id == meter_id)
            .order_by(MeterReading.timestamp.desc())
            .limit(1)
        )
        reading = result.scalar_one_or_none()
        return reading.value if reading else None

    async def _calc_difference(self, meter: Meter, config: dict) -> dict:
        """
        Differenzmessung: Quellzähler minus Abzugszähler.

        Beispiel: Standort-Zähler minus Einlieger-Zähler = Haupthaus-Verbrauch
        """
        source_id = config.get("source_meter_id")
        subtract_ids = config.get("subtract_meter_ids", [])

        if not source_id:
            return self._error_result(meter, "Kein Quellzähler konfiguriert")

        source_value = await self._get_latest_value(uuid.UUID(source_id))
        if source_value is None:
            return self._error_result(meter, "Kein Messwert vom Quellzähler")

        total_subtract = Decimal("0")
        for sub_id in subtract_ids:
            sub_value = await self._get_latest_value(uuid.UUID(sub_id))
            if sub_value is not None:
                total_subtract += sub_value

        calculated = source_value - total_subtract
        return await self._save_reading(meter, calculated, "virtual")

    async def _calc_sum(self, meter: Meter, config: dict) -> dict:
        """
        Summenmessung: Alle Quellzähler aufsummieren.

        Beispiel: PV-Haupthaus + Balkonkraftwerk = PV-Gesamt
        """
        source_ids = config.get("source_meter_ids", [])
        if not source_ids:
            return self._error_result(meter, "Keine Quellzähler konfiguriert")

        total = Decimal("0")
        found_any = False
        for src_id in source_ids:
            value = await self._get_latest_value(uuid.UUID(src_id))
            if value is not None:
                total += value
                found_any = True

        if not found_any:
            return self._error_result(meter, "Keine Messwerte von Quellzählern")

        return await self._save_reading(meter, total, "virtual")

    @staticmethod
    def _error_result(meter: Meter, error: str) -> dict:
        """Fehler-Ergebnis für einen Zähler."""
        return {
            "meter_id": str(meter.id),
            "meter_name": meter.name,
            "success": False,
            "error": error,
        }
