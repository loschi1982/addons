"""
modbus.py – Modbus TCP/RTU Integration.

Liest Zählerstände und Momentanwerte von Modbus-fähigen
Energiezählern (z.B. Janitza, Siemens, ABB).
"""

from decimal import Decimal

import structlog

logger = structlog.get_logger()


class ModbusClient:
    """Client für Modbus TCP-Kommunikation mit Energiezählern."""

    def __init__(self, host: str, port: int = 502, unit_id: int = 1):
        self.host = host
        self.port = port
        self.unit_id = unit_id

    async def connect(self) -> None:
        """Verbindung zum Modbus-Gerät herstellen."""
        # TODO: pymodbus AsyncModbusTcpClient verwenden
        raise NotImplementedError

    async def disconnect(self) -> None:
        """Verbindung trennen."""
        raise NotImplementedError

    async def read_register(self, address: int, count: int = 1) -> list[int]:
        """Holding-Register lesen."""
        # TODO: Implementierung mit pymodbus
        raise NotImplementedError

    async def read_energy_kwh(self, register_address: int, data_type: str = "float32") -> Decimal:
        """
        Energie in kWh aus dem konfigurierten Register lesen.

        data_type: "float32", "float64", "uint32", "int32"
        """
        raise NotImplementedError

    async def read_power_kw(self, register_address: int) -> Decimal:
        """Momentanleistung in kW lesen."""
        raise NotImplementedError
