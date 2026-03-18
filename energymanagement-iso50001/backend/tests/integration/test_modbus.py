"""
test_modbus.py – Tests für die Modbus-Integration.

Testet Byte-Konvertierung, Datentypen, Skalierung und
Fehlerbehandlung mit gemockten Modbus-Responses.
"""

import struct
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.integrations.modbus import ModbusClient


def _registers_from_float32(value: float, byte_order: str = "big") -> list[int]:
    """Hilfsfunktion: float32 → zwei 16-bit Register."""
    fmt = ">f" if byte_order == "big" else "<f"
    raw = struct.pack(fmt, value)
    # Register sind immer Big-Endian 16-bit
    reg1 = struct.unpack(">H", raw[0:2])[0]
    reg2 = struct.unpack(">H", raw[2:4])[0]
    return [reg1, reg2]


def _registers_from_int16(value: int) -> list[int]:
    """Hilfsfunktion: int16 → ein 16-bit Register."""
    raw = struct.pack(">h", value)
    return [struct.unpack(">H", raw)[0]]


def _registers_from_uint32(value: int, byte_order: str = "big") -> list[int]:
    """Hilfsfunktion: uint32 → zwei 16-bit Register."""
    fmt = ">I" if byte_order == "big" else "<I"
    raw = struct.pack(fmt, value)
    reg1 = struct.unpack(">H", raw[0:2])[0]
    reg2 = struct.unpack(">H", raw[2:4])[0]
    return [reg1, reg2]


def _mock_result(registers: list[int], is_error: bool = False):
    """Erstellt ein gemocktes Modbus-Ergebnis."""
    result = MagicMock()
    result.isError.return_value = is_error
    result.registers = registers
    return result


@pytest.mark.asyncio
async def test_read_value_float32():
    """Float32-Wert aus zwei Registern lesen."""
    client = ModbusClient("192.168.1.100")
    registers = _registers_from_float32(230.5)

    mock_modbus = AsyncMock()
    mock_modbus.connect = AsyncMock(return_value=True)
    mock_modbus.read_holding_registers = AsyncMock(return_value=_mock_result(registers))
    client._client = mock_modbus

    value = await client.read_value(address=100, data_type="float32")
    assert abs(float(value) - 230.5) < 0.01


@pytest.mark.asyncio
async def test_read_value_int16():
    """Int16-Wert aus einem Register lesen."""
    client = ModbusClient("192.168.1.100")
    registers = _registers_from_int16(-500)

    mock_modbus = AsyncMock()
    mock_modbus.read_holding_registers = AsyncMock(return_value=_mock_result(registers))
    client._client = mock_modbus

    value = await client.read_value(address=200, data_type="int16")
    assert value == Decimal("-500")


@pytest.mark.asyncio
async def test_read_value_uint32():
    """Uint32-Wert aus zwei Registern lesen."""
    client = ModbusClient("192.168.1.100")
    registers = _registers_from_uint32(100000)

    mock_modbus = AsyncMock()
    mock_modbus.read_holding_registers = AsyncMock(return_value=_mock_result(registers))
    client._client = mock_modbus

    value = await client.read_value(address=300, data_type="uint32")
    assert value == Decimal("100000")


@pytest.mark.asyncio
async def test_read_value_with_scale_and_offset():
    """Skalierung und Offset korrekt anwenden."""
    client = ModbusClient("192.168.1.100")
    # Rohwert 1000, scale=0.1, offset=5 → 1000 * 0.1 + 5 = 105
    registers = _registers_from_float32(1000.0)

    mock_modbus = AsyncMock()
    mock_modbus.read_holding_registers = AsyncMock(return_value=_mock_result(registers))
    client._client = mock_modbus

    value = await client.read_value(
        address=100, data_type="float32", scale=0.1, offset=5.0
    )
    assert abs(float(value) - 105.0) < 0.01


@pytest.mark.asyncio
async def test_read_value_input_registers():
    """Input-Register (Function Code 04) lesen."""
    client = ModbusClient("192.168.1.100")
    registers = _registers_from_float32(42.0)

    mock_modbus = AsyncMock()
    mock_modbus.read_input_registers = AsyncMock(return_value=_mock_result(registers))
    client._client = mock_modbus

    value = await client.read_value(
        address=100, data_type="float32", function_code=4
    )
    assert abs(float(value) - 42.0) < 0.01


@pytest.mark.asyncio
async def test_read_value_invalid_data_type():
    """Unbekannter Datentyp → ValueError."""
    client = ModbusClient("192.168.1.100")
    client._client = AsyncMock()

    with pytest.raises(ValueError, match="Unbekannter Datentyp"):
        await client.read_value(address=100, data_type="float128")


@pytest.mark.asyncio
async def test_read_holding_registers_error():
    """Modbus-Fehler beim Lesen → IOError."""
    client = ModbusClient("192.168.1.100")

    mock_modbus = AsyncMock()
    mock_modbus.read_holding_registers = AsyncMock(
        return_value=_mock_result([], is_error=True)
    )
    client._client = mock_modbus

    with pytest.raises(IOError, match="Modbus-Fehler"):
        await client.read_holding_registers(address=100, count=2)


@pytest.mark.asyncio
async def test_check_connection_success():
    """Verbindungsprüfung erfolgreich."""
    client = ModbusClient("192.168.1.100")

    with patch("app.integrations.modbus.ModbusClient.connect", new_callable=AsyncMock):
        mock_modbus = AsyncMock()
        mock_modbus.read_holding_registers = AsyncMock(
            return_value=_mock_result([0])
        )
        mock_modbus.close = MagicMock()
        client._client = mock_modbus

        result = await client.check_connection()
        assert result is True


@pytest.mark.asyncio
async def test_check_connection_failure():
    """Verbindungsprüfung fehlgeschlagen."""
    client = ModbusClient("10.0.0.99")

    with patch.object(client, "connect", side_effect=ConnectionError("refused")):
        result = await client.check_connection()
        assert result is False


@pytest.mark.asyncio
async def test_read_energy_kwh():
    """Energie in kWh lesen (Wrapper-Methode)."""
    client = ModbusClient("192.168.1.100")
    registers = _registers_from_float32(12345.6)

    mock_modbus = AsyncMock()
    mock_modbus.read_holding_registers = AsyncMock(return_value=_mock_result(registers))
    client._client = mock_modbus

    value = await client.read_energy_kwh(register_address=100)
    assert abs(float(value) - 12345.6) < 0.1
