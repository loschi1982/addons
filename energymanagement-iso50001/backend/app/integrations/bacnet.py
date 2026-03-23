"""
bacnet.py – BACnet/IP-Integration.

Liest Datenpunkte von BACnet-Geräten über das BACnet/IP-Protokoll.
Unterstützt:
- Who-Is Device Discovery (Broadcast)
- Object-Liste pro Gerät auslesen
- Einzelne Property-Werte lesen (presentValue)

Verwendet BAC0 als BACnet-Stack.

Relevante BACnet-Objekttypen:
- analogInput (AI): Messwerte (Temperatur, Feuchte, Energie)
- analogValue (AV): Berechnete/konfigurierbare Werte
- analogOutput (AO): Stellgrößen
- multiStateInput (MI): Betriebszustände
"""

import asyncio
from decimal import Decimal

import structlog

logger = structlog.get_logger()

# BACnet Engineering Units → lesbare Einheiten
BACNET_UNITS = {
    62: "°C",       # degreesCelsius
    64: "°F",       # degreesFahrenheit
    98: "%",        # percent
    35: "kWh",      # kilowattHours
    42: "W",        # watts
    43: "kW",       # kilowatts
    18: "m³/h",     # cubicMetersPerHour
    82: "Pa",       # pascals
    85: "bar",      # bars
    19: "m³",       # cubicMeters
    95: "no unit",  # noUnits
}

# BACnet-Objekttypen
OBJECT_TYPES = {
    "analogInput": 0,
    "analogOutput": 1,
    "analogValue": 2,
    "binaryInput": 3,
    "binaryOutput": 4,
    "binaryValue": 5,
    "multiStateInput": 13,
    "multiStateOutput": 14,
    "multiStateValue": 19,
}


class BACnetClient:
    """Client für BACnet/IP-Geräte."""

    def __init__(self, interface: str | None = None, port: int = 47808):
        """
        Args:
            interface: Netzwerk-Interface oder IP-Adresse für BACnet-Kommunikation.
                       None = automatische Erkennung.
            port: BACnet UDP-Port (Standard: 47808 = 0xBAC0).
        """
        self.interface = interface
        self.port = port
        self._network = None

    @classmethod
    async def from_settings(cls, db) -> "BACnetClient":
        """Client aus DB-Settings erstellen."""
        from app.services.settings_service import SettingsService
        svc = SettingsService(db)
        cfg = await svc.get("integrations_bacnet")
        if cfg and cfg.get("value"):
            val = cfg["value"]
            return cls(
                interface=val.get("interface"),
                port=val.get("port", 47808),
            )
        return cls()

    def _get_network(self):
        """BAC0-Netzwerk lazy initialisieren."""
        if self._network is None:
            import BAC0

            ip = self.interface or ""
            try:
                self._network = BAC0.lite(ip=ip, port=self.port)
            except Exception as e:
                logger.error("bacnet_init_failed", error=str(e))
                raise ConnectionError(f"BACnet-Initialisierung fehlgeschlagen: {e}")
        return self._network

    async def check_connection(self) -> bool:
        """BACnet-Stack initialisierbar?"""
        try:
            net = await asyncio.to_thread(self._get_network)
            return net is not None
        except Exception:
            return False

    async def discover_devices(self, timeout: float = 5.0) -> list[dict]:
        """
        Who-Is Broadcast senden und alle antwortenden Geräte auflisten.

        Returns:
            Liste von Geräte-Dicts: [{device_id, address, name, vendor}, ...]
        """
        try:
            net = await asyncio.to_thread(self._get_network)

            # Who-Is Broadcast
            await asyncio.to_thread(net.whois)
            # Kurz warten auf I-Am Responses
            await asyncio.sleep(min(timeout, 3.0))

            devices = []
            discovered = getattr(net, "discoveredDevices", None) or {}

            for device_id, info in discovered.items():
                address = info if isinstance(info, str) else str(info)
                # Gerätename und Vendor lesen
                name = ""
                vendor = ""
                try:
                    name = await asyncio.to_thread(
                        net.read, f"{address} device {device_id} objectName"
                    )
                except Exception:
                    pass
                try:
                    vendor = await asyncio.to_thread(
                        net.read, f"{address} device {device_id} vendorName"
                    )
                except Exception:
                    pass

                devices.append({
                    "device_id": device_id,
                    "address": address,
                    "name": str(name) if name else f"Device {device_id}",
                    "vendor": str(vendor) if vendor else "",
                })

            logger.info("bacnet_discovery_complete", devices_found=len(devices))
            return devices

        except Exception as e:
            logger.warning("bacnet_discovery_failed", error=str(e))
            return []

    async def list_objects(
        self, device_address: str, device_id: int
    ) -> list[dict]:
        """
        Alle relevanten BACnet-Objekte eines Geräts auflisten.

        Liest die Object-Liste des Geräts und für jedes Objekt
        Name, Einheit und aktuellen Wert.

        Returns:
            Liste von Objekt-Dicts: [{object_id, object_type, name, unit, value}, ...]
        """
        try:
            net = await asyncio.to_thread(self._get_network)

            # Objektliste lesen
            object_list = await asyncio.to_thread(
                net.read, f"{device_address} device {device_id} objectList"
            )

            if not object_list:
                return []

            objects = []
            # Nur relevante Objekttypen (Analog + MultiState Input)
            relevant_types = {"analogInput", "analogOutput", "analogValue", "multiStateInput"}

            for obj_type, obj_instance in object_list:
                type_name = str(obj_type)
                if type_name not in relevant_types:
                    continue

                obj_id = f"{type_name},{obj_instance}"
                name = ""
                unit = ""
                value = None

                try:
                    name = await asyncio.to_thread(
                        net.read, f"{device_address} {type_name} {obj_instance} objectName"
                    )
                except Exception:
                    pass

                try:
                    raw_value = await asyncio.to_thread(
                        net.read, f"{device_address} {type_name} {obj_instance} presentValue"
                    )
                    value = float(raw_value) if raw_value is not None else None
                except Exception:
                    pass

                try:
                    units_code = await asyncio.to_thread(
                        net.read, f"{device_address} {type_name} {obj_instance} units"
                    )
                    unit = BACNET_UNITS.get(int(units_code), str(units_code)) if units_code else ""
                except Exception:
                    pass

                objects.append({
                    "object_id": obj_id,
                    "object_type": type_name,
                    "name": str(name) if name else obj_id,
                    "unit": unit,
                    "value": value,
                })

            logger.info("bacnet_objects_listed",
                        device=device_address, count=len(objects))
            return objects

        except Exception as e:
            logger.warning("bacnet_list_objects_failed",
                           device=device_address, error=str(e))
            return []

    async def read_property(
        self,
        device_address: str,
        object_type: str,
        object_instance: int,
        property_name: str = "presentValue",
    ) -> Decimal | None:
        """
        Einzelnen BACnet-Property-Wert lesen.

        Args:
            device_address: IP-Adresse des BACnet-Geräts
            object_type: z.B. "analogInput", "analogValue"
            object_instance: Objekt-Instanznummer
            property_name: BACnet-Property (default: "presentValue")

        Returns:
            Wert als Decimal oder None bei Fehler
        """
        try:
            net = await asyncio.to_thread(self._get_network)
            value = await asyncio.to_thread(
                net.read,
                f"{device_address} {object_type} {object_instance} {property_name}",
            )
            if value is not None:
                return Decimal(str(value))
            return None
        except Exception as e:
            logger.warning(
                "bacnet_read_failed",
                device=device_address,
                object=f"{object_type},{object_instance}",
                error=str(e),
            )
            return None

    async def disconnect(self):
        """BACnet-Netzwerk sauber beenden."""
        if self._network:
            try:
                await asyncio.to_thread(self._network.disconnect)
            except Exception:
                pass
            self._network = None
