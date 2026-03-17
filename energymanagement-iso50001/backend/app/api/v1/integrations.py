"""
integrations.py – Endpunkte für externe Integrationen.

Entity-Picker für Home Assistant, Verbindungstests für
Shelly/Modbus/KNX, manuelles Polling einzelner Zähler.
"""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.user import User
from app.schemas.common import MessageResponse

router = APIRouter()


# ---------------------------------------------------------------------------
# Home Assistant
# ---------------------------------------------------------------------------

@router.get("/ha/entities")
async def list_ha_entities(
    domain: str | None = Query(None, description="z.B. sensor, input_number"),
    device_class: str | None = Query(None, description="z.B. energy, temperature"),
    current_user: User = Depends(get_current_user),
):
    """
    Alle HA-Entitäten auflisten für den Entity-Picker.

    Filtert optional nach Domain und device_class.
    """
    from app.integrations.homeassistant import HomeAssistantClient

    client = HomeAssistantClient()
    if device_class:
        entities = await client.list_entities(domain=domain, device_class=device_class)
    elif domain:
        entities = await client.list_entities(domain=domain)
    else:
        # Nur energierelevante Entitäten zurückgeben
        entities = await client.list_energy_entities()

    return {"entities": entities, "count": len(entities)}


@router.get("/ha/entity/{entity_id:path}")
async def get_ha_entity_state(
    entity_id: str,
    current_user: User = Depends(get_current_user),
):
    """Aktuellen Zustand einer HA-Entität abrufen."""
    from app.integrations.homeassistant import HomeAssistantClient

    client = HomeAssistantClient()
    state = await client.get_entity_state(entity_id)
    return state


@router.get("/ha/history/{entity_id:path}")
async def get_ha_entity_history(
    entity_id: str,
    start_time: str = Query(..., description="ISO-Format, z.B. 2024-01-01T00:00:00Z"),
    end_time: str | None = Query(None),
    current_user: User = Depends(get_current_user),
):
    """Historische Werte einer HA-Entität abrufen."""
    from app.integrations.homeassistant import HomeAssistantClient

    client = HomeAssistantClient()
    data_points = await client.import_history(entity_id, start_time, end_time)
    return {"entity_id": entity_id, "data_points": data_points, "count": len(data_points)}


@router.get("/ha/status")
async def check_ha_connection(
    current_user: User = Depends(get_current_user),
):
    """Prüft ob die Verbindung zu Home Assistant funktioniert."""
    from app.integrations.homeassistant import HomeAssistantClient

    client = HomeAssistantClient()
    connected = await client.check_connection()
    return {"connected": connected}


# ---------------------------------------------------------------------------
# Shelly
# ---------------------------------------------------------------------------

@router.post("/shelly/test")
async def test_shelly_connection(
    host: str = Query(..., description="IP-Adresse des Shelly-Geräts"),
    current_user: User = require_permission("meters", "create"),
):
    """Verbindung zu einem Shelly-Gerät testen."""
    from app.integrations.shelly import ShellyClient

    client = ShellyClient(host)
    try:
        info = await client.get_device_info()
        energy = await client.get_energy()
        return {
            "connected": True,
            "device_info": info,
            "current_energy": energy,
        }
    except Exception as e:
        return {"connected": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Modbus
# ---------------------------------------------------------------------------

@router.post("/modbus/test")
async def test_modbus_connection(
    host: str = Query(...),
    port: int = Query(502),
    unit_id: int = Query(1),
    register: int = Query(0, description="Test-Register-Adresse"),
    current_user: User = require_permission("meters", "create"),
):
    """Verbindung zu einem Modbus-Gerät testen."""
    from app.integrations.modbus import ModbusClient

    client = ModbusClient(host, port, unit_id)
    try:
        connected = await client.check_connection()
        return {"connected": connected}
    except Exception as e:
        return {"connected": False, "error": str(e)}


# ---------------------------------------------------------------------------
# KNX
# ---------------------------------------------------------------------------

@router.post("/knx/test")
async def test_knx_connection(
    gateway_ip: str = Query(...),
    gateway_port: int = Query(3671),
    current_user: User = require_permission("meters", "create"),
):
    """Verbindung zu einem KNX/IP-Gateway testen."""
    from app.integrations.knx import KNXClient

    client = KNXClient(gateway_ip, gateway_port)
    try:
        connected = await client.check_connection()
        return {"connected": connected}
    except Exception as e:
        return {"connected": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Manuelles Polling
# ---------------------------------------------------------------------------

@router.post("/poll/{meter_id}")
async def poll_single_meter(
    meter_id: uuid.UUID,
    current_user: User = require_permission("readings", "create"),
    db: AsyncSession = Depends(get_db),
):
    """Einzelnen Zähler manuell abfragen."""
    from app.integrations.polling_manager import PollingManager

    manager = PollingManager(db)
    result = await manager.poll_single_meter(meter_id)
    return result


@router.post("/poll")
async def poll_all_meters(
    current_user: User = require_permission("readings", "create"),
    db: AsyncSession = Depends(get_db),
):
    """Alle automatischen Zähler sofort abfragen."""
    from app.integrations.polling_manager import PollingManager

    manager = PollingManager(db)
    result = await manager.poll_all_meters()
    return result
