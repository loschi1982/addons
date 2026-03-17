"""
knx.py – KNX-Integration.

Liest Energiedaten über KNX/IP (via xknx-Bibliothek).
KNX wird häufig in Gewerbegebäuden für Gebäudeautomation eingesetzt.

Unterstützte Verbindungsmodi:
- KNX/IP Tunneling (Punkt-zu-Punkt, Standard)
- KNX/IP Routing (Multicast, für mehrere Clients)

Datentypen (DPT):
- DPT 12: 4-Byte Zählerwert (Unsigned)
- DPT 13: 4-Byte Zählerwert (Signed)
- DPT 14: 4-Byte Fließkomma
- DPT 9: 2-Byte Fließkomma (Temperatur, etc.)
"""

from decimal import Decimal

import structlog

logger = structlog.get_logger()


class KNXClient:
    """Client für KNX/IP-Kommunikation."""

    def __init__(
        self,
        gateway_ip: str,
        gateway_port: int = 3671,
        local_ip: str | None = None,
    ):
        self.gateway_ip = gateway_ip
        self.gateway_port = gateway_port
        self.local_ip = local_ip
        self._xknx = None

    async def connect(self) -> None:
        """Verbindung zum KNX/IP-Gateway herstellen."""
        try:
            from xknx import XKNX
            from xknx.io import ConnectionConfig, ConnectionType

            connection_config = ConnectionConfig(
                connection_type=ConnectionType.TUNNELING,
                gateway_ip=self.gateway_ip,
                gateway_port=self.gateway_port,
            )
            if self.local_ip:
                connection_config.local_ip = self.local_ip

            self._xknx = XKNX(connection_config=connection_config)
            await self._xknx.start()
            logger.info(
                "knx_connected",
                gateway=f"{self.gateway_ip}:{self.gateway_port}",
            )
        except ImportError:
            raise ImportError(
                "xknx nicht installiert – KNX-Integration nicht verfügbar"
            )

    async def disconnect(self) -> None:
        """Verbindung trennen."""
        if self._xknx:
            await self._xknx.stop()
            self._xknx = None
            logger.info("knx_disconnected")

    async def read_group_address(
        self, group_address: str, dpt: str = "DPT-13"
    ) -> Decimal:
        """
        Wert von einer KNX-Gruppenadresse lesen.

        Args:
            group_address: z.B. "1/2/3"
            dpt: Datentyp-Profil, z.B. "DPT-9", "DPT-12", "DPT-13", "DPT-14"

        Returns:
            Gelesener Wert als Decimal
        """
        if not self._xknx:
            await self.connect()

        from xknx.devices import Sensor
        from xknx.remote_value import RemoteValueSensor

        sensor = Sensor(
            self._xknx,
            name="energy_sensor",
            group_address_state=group_address,
            value_type=self._dpt_to_value_type(dpt),
        )
        await sensor.sync()
        value = sensor.resolve_state()

        if value is None:
            raise IOError(f"Kein Wert von KNX-Adresse {group_address}")

        return Decimal(str(value))

    async def subscribe_group_address(
        self, group_address: str, callback, dpt: str = "DPT-13"
    ) -> None:
        """
        Änderungen auf einer Gruppenadresse abonnieren.

        Der Callback wird bei jeder Wertänderung aufgerufen mit
        dem neuen Wert als Decimal.
        """
        if not self._xknx:
            await self.connect()

        from xknx.devices import Sensor

        async def _on_update(device):
            value = device.resolve_state()
            if value is not None:
                await callback(Decimal(str(value)))

        sensor = Sensor(
            self._xknx,
            name=f"sub_{group_address}",
            group_address_state=group_address,
            value_type=self._dpt_to_value_type(dpt),
        )
        sensor.register_device_updated_cb(_on_update)

    async def check_connection(self) -> bool:
        """Prüft ob das KNX/IP-Gateway erreichbar ist."""
        try:
            await self.connect()
            return True
        except Exception:
            return False
        finally:
            await self.disconnect()

    @staticmethod
    def _dpt_to_value_type(dpt: str) -> str:
        """KNX DPT in xknx value_type umwandeln."""
        mapping = {
            "DPT-9": "temperature",
            "DPT-12": "counter_pulses",
            "DPT-13": "delta_time_sec",
            "DPT-14": "electric_current",
        }
        return mapping.get(dpt, "counter_pulses")
