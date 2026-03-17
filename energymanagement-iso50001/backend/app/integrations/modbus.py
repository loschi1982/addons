"""
modbus.py – Modbus TCP/RTU Integration.

Liest Zählerstände und Momentanwerte von Modbus-fähigen
Energiezählern (z.B. Janitza, Siemens, ABB).

Unterstützte Protokolle: Modbus TCP, Modbus RTU (über Serial-Gateway)
Unterstützte Datentypen: INT16, INT32, UINT16, UINT32, FLOAT32, FLOAT64
Function Codes: 03 (Holding Registers), 04 (Input Registers)
"""

import struct
from decimal import Decimal

import structlog

logger = structlog.get_logger()


class ModbusClient:
    """Client für Modbus TCP-Kommunikation mit Energiezählern."""

    def __init__(self, host: str, port: int = 502, unit_id: int = 1):
        self.host = host
        self.port = port
        self.unit_id = unit_id
        self._client = None

    async def connect(self) -> None:
        """Verbindung zum Modbus-Gerät herstellen."""
        try:
            from pymodbus.client import AsyncModbusTcpClient
            self._client = AsyncModbusTcpClient(
                host=self.host,
                port=self.port,
            )
            connected = await self._client.connect()
            if not connected:
                raise ConnectionError(
                    f"Modbus-Verbindung zu {self.host}:{self.port} fehlgeschlagen"
                )
            logger.info("modbus_connected", host=self.host, port=self.port)
        except ImportError:
            raise ImportError(
                "pymodbus nicht installiert – Modbus-Integration nicht verfügbar"
            )

    async def disconnect(self) -> None:
        """Verbindung trennen."""
        if self._client:
            self._client.close()
            self._client = None
            logger.info("modbus_disconnected", host=self.host)

    async def read_holding_registers(
        self, address: int, count: int = 1
    ) -> list[int]:
        """Holding-Register lesen (Function Code 03)."""
        if not self._client:
            await self.connect()

        result = await self._client.read_holding_registers(
            address=address, count=count, slave=self.unit_id
        )
        if result.isError():
            raise IOError(f"Modbus-Fehler beim Lesen von Register {address}: {result}")
        return list(result.registers)

    async def read_input_registers(
        self, address: int, count: int = 1
    ) -> list[int]:
        """Input-Register lesen (Function Code 04)."""
        if not self._client:
            await self.connect()

        result = await self._client.read_input_registers(
            address=address, count=count, slave=self.unit_id
        )
        if result.isError():
            raise IOError(f"Modbus-Fehler beim Lesen von Register {address}: {result}")
        return list(result.registers)

    async def read_value(
        self,
        address: int,
        data_type: str = "float32",
        function_code: int = 3,
        byte_order: str = "big",
        scale: float = 1.0,
        offset: float = 0.0,
    ) -> Decimal:
        """
        Einen Wert aus Modbus-Registern lesen und konvertieren.

        Args:
            address: Register-Startadresse
            data_type: Datentyp (int16, int32, uint16, uint32, float32, float64)
            function_code: 3 = Holding, 4 = Input
            byte_order: "big" oder "little"
            scale: Skalierungsfaktor (Wert × scale)
            offset: Offset (Wert + offset)

        Returns:
            Konvertierter Wert als Decimal
        """
        # Register-Anzahl je nach Datentyp
        type_config = {
            "int16": (1, ">h", "<h"),
            "uint16": (1, ">H", "<H"),
            "int32": (2, ">i", "<i"),
            "uint32": (2, ">I", "<I"),
            "float32": (2, ">f", "<f"),
            "float64": (4, ">d", "<d"),
        }

        if data_type not in type_config:
            raise ValueError(f"Unbekannter Datentyp: {data_type}")

        count, fmt_big, fmt_little = type_config[data_type]
        fmt = fmt_big if byte_order == "big" else fmt_little

        if function_code == 4:
            registers = await self.read_input_registers(address, count)
        else:
            registers = await self.read_holding_registers(address, count)

        # Register zu Bytes konvertieren
        raw_bytes = b""
        for reg in registers:
            raw_bytes += struct.pack(">H", reg)  # Register sind immer Big-Endian 16-bit

        # Bytes nach Datentyp interpretieren
        value = struct.unpack(fmt, raw_bytes)[0]

        # Skalierung und Offset
        result = float(value) * scale + offset
        return Decimal(str(round(result, 4)))

    async def read_energy_kwh(
        self, register_address: int, data_type: str = "float32",
        **kwargs
    ) -> Decimal:
        """Energie in kWh aus dem konfigurierten Register lesen."""
        return await self.read_value(register_address, data_type, **kwargs)

    async def read_power_kw(
        self, register_address: int, data_type: str = "float32",
        **kwargs
    ) -> Decimal:
        """Momentanleistung in kW lesen."""
        return await self.read_value(register_address, data_type, **kwargs)

    async def check_connection(self) -> bool:
        """Prüft ob das Modbus-Gerät erreichbar ist."""
        try:
            await self.connect()
            # Test: Register 0 lesen
            await self.read_holding_registers(0, 1)
            return True
        except Exception:
            return False
        finally:
            await self.disconnect()
