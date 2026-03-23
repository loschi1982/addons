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
    current_user: User = Depends(require_permission("meters", "create")),
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
    current_user: User = Depends(require_permission("meters", "create")),
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
    current_user: User = Depends(require_permission("meters", "create")),
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
# MQTT
# ---------------------------------------------------------------------------

@router.post("/mqtt/test")
async def test_mqtt_connection(
    broker_host: str = Query(..., description="MQTT-Broker Hostname/IP"),
    port: int = Query(1883),
    username: str = Query(""),
    password: str = Query(""),
    current_user: User = Depends(require_permission("meters", "create")),
):
    """Verbindung zu einem MQTT-Broker testen."""
    from app.integrations.mqtt import MQTTClient

    client = MQTTClient(broker_host, port, username, password)
    try:
        connected = await client.check_connection()
        return {"connected": connected}
    except Exception as e:
        return {"connected": False, "error": str(e)}


@router.get("/mqtt/discover")
async def discover_mqtt_sensors(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """MQTT-Sensoren über HA/Tasmota Discovery finden."""
    from app.integrations.mqtt import MQTTClient

    client = await MQTTClient.from_settings(db)
    if not client.broker_host:
        return {"sensors": [], "error": "MQTT nicht konfiguriert"}

    sensors = await client.discover_sensors(timeout=5.0)
    return {"sensors": sensors, "count": len(sensors)}


# ---------------------------------------------------------------------------
# BACnet
# ---------------------------------------------------------------------------

@router.post("/bacnet/test")
async def test_bacnet_connection(
    current_user: User = Depends(require_permission("meters", "create")),
    db: AsyncSession = Depends(get_db),
):
    """BACnet/IP-Netzwerk testen."""
    from app.integrations.bacnet import BACnetClient

    client = await BACnetClient.from_settings(db)
    try:
        connected = await client.check_connection()
        return {"connected": connected}
    except Exception as e:
        return {"connected": False, "error": str(e)}
    finally:
        await client.disconnect()


@router.get("/bacnet/discover")
async def discover_bacnet_devices(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """BACnet-Geräte im Netzwerk finden (Who-Is Broadcast)."""
    from app.integrations.bacnet import BACnetClient

    client = await BACnetClient.from_settings(db)
    try:
        devices = await client.discover_devices(timeout=5.0)
        return {"devices": devices, "count": len(devices)}
    except Exception as e:
        return {"devices": [], "error": str(e)}
    finally:
        await client.disconnect()


@router.get("/bacnet/device/{device_address}/objects")
async def list_bacnet_objects(
    device_address: str,
    device_id: int = Query(..., description="BACnet Device-ID"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle Objekte eines BACnet-Geräts auflisten."""
    from app.integrations.bacnet import BACnetClient

    client = await BACnetClient.from_settings(db)
    try:
        objects = await client.list_objects(device_address, device_id)
        return {"objects": objects, "count": len(objects)}
    except Exception as e:
        return {"objects": [], "error": str(e)}
    finally:
        await client.disconnect()


# ---------------------------------------------------------------------------
# Discovery – Alle Integrationen durchsuchen
# ---------------------------------------------------------------------------

@router.get("/discover")
async def discover_all_devices(
    integration: str | None = Query(None, description="Filter: ha, shelly, mqtt, bacnet"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Alle konfigurierten Integrationen nach verfügbaren Sensoren/Zählern durchsuchen.

    Liefert eine kategorisierte Liste aller entdeckten Geräte mit Angabe,
    ob sie bereits im System konfiguriert sind.
    """
    from sqlalchemy import select as sa_select

    from app.models.climate import ClimateSensor
    from app.models.meter import Meter

    devices: list[dict] = []
    integrations_scanned: list[str] = []

    # Bereits konfigurierte Entity-IDs laden
    configured_meter_entities: set[str] = set()
    configured_climate_entities: set[str] = set()

    meters_result = await db.execute(
        sa_select(Meter.data_source, Meter.source_config).where(Meter.is_active == True)  # noqa: E712
    )
    for ds, sc in meters_result.all():
        if sc and isinstance(sc, dict):
            eid = sc.get("entity_id") or sc.get("topic") or sc.get("shelly_host", "")
            if eid:
                configured_meter_entities.add(eid)

    climate_result = await db.execute(
        sa_select(ClimateSensor.ha_entity_id_temp, ClimateSensor.ha_entity_id_humidity)
        .where(ClimateSensor.is_active == True)  # noqa: E712
    )
    for temp_id, hum_id in climate_result.all():
        if temp_id:
            configured_climate_entities.add(temp_id)
        if hum_id:
            configured_climate_entities.add(hum_id)

    all_configured = configured_meter_entities | configured_climate_entities

    # ── Home Assistant ──
    if not integration or integration == "ha":
        try:
            from app.integrations.homeassistant import HomeAssistantClient
            ha = await HomeAssistantClient.from_settings(db)
            if ha.token and ha.base_url:
                entities = await ha.list_entities(domain="sensor")
                integrations_scanned.append("homeassistant")
                for e in entities:
                    attrs = e
                    device_class = attrs.get("device_class", "")
                    unit = attrs.get("unit_of_measurement", "")
                    cat = _classify_sensor(device_class, unit)
                    if not cat:
                        continue
                    entity_id = attrs.get("entity_id", "")
                    devices.append({
                        "integration": "homeassistant",
                        "entity_id": entity_id,
                        "name": attrs.get("friendly_name", entity_id),
                        "category": cat["category"],
                        "subcategory": device_class,
                        "energy_type": cat.get("energy_type"),
                        "unit": unit or "",
                        "current_value": attrs.get("state"),
                        "already_configured": entity_id in all_configured,
                    })
        except Exception:
            pass

    # ── MQTT ──
    if not integration or integration == "mqtt":
        try:
            from app.integrations.mqtt import MQTTClient
            mqtt = await MQTTClient.from_settings(db)
            if mqtt.broker_host:
                sensors = await mqtt.discover_sensors(timeout=5.0)
                integrations_scanned.append("mqtt")
                for s in sensors:
                    cat = _classify_sensor(s.get("device_class", ""), s.get("unit", ""))
                    if not cat:
                        # Unklassifizierte MQTT-Sensoren trotzdem anzeigen
                        cat = {"category": "other", "energy_type": None}
                    topic = s.get("topic", "")
                    devices.append({
                        "integration": "mqtt",
                        "entity_id": topic,
                        "name": s.get("name", topic),
                        "category": cat["category"],
                        "subcategory": s.get("device_class", ""),
                        "energy_type": cat.get("energy_type"),
                        "unit": s.get("unit", ""),
                        "current_value": None,
                        "device_name": s.get("device_name", ""),
                        "already_configured": topic in all_configured,
                    })
        except Exception:
            pass

    # ── BACnet ──
    if not integration or integration == "bacnet":
        try:
            from app.integrations.bacnet import BACnetClient
            bacnet = await BACnetClient.from_settings(db)
            bac_devices = await bacnet.discover_devices(timeout=5.0)
            integrations_scanned.append("bacnet")
            for dev in bac_devices:
                try:
                    objects = await bacnet.list_objects(dev["address"], dev["device_id"])
                    for obj in objects:
                        cat = _classify_sensor("", obj.get("unit", ""))
                        if not cat:
                            cat = {"category": "other", "energy_type": None}
                        obj_ref = f"bacnet://{dev['address']}/{obj['object_id']}"
                        devices.append({
                            "integration": "bacnet",
                            "entity_id": obj_ref,
                            "name": obj.get("name", obj["object_id"]),
                            "category": cat["category"],
                            "subcategory": obj.get("object_type", ""),
                            "energy_type": cat.get("energy_type"),
                            "unit": obj.get("unit", ""),
                            "current_value": obj.get("value"),
                            "device_name": dev.get("name", ""),
                            "already_configured": obj_ref in all_configured,
                        })
                except Exception:
                    pass
            await bacnet.disconnect()
        except Exception:
            pass

    # ── Shelly ──
    if not integration or integration == "shelly":
        # Shelly-Hosts aus bestehenden Zählern scannen
        try:
            from app.integrations.shelly import ShellyClient
            shelly_hosts: set[str] = set()
            for sc in [m.source_config for m in (await db.execute(
                sa_select(Meter).where(Meter.data_source == "shelly", Meter.is_active == True)  # noqa: E712
            )).scalars().all()]:
                if sc:
                    host = sc.get("shelly_host", sc.get("ip", ""))
                    if host:
                        shelly_hosts.add(host)
            if shelly_hosts:
                integrations_scanned.append("shelly")
            for host in shelly_hosts:
                try:
                    client = ShellyClient(host)
                    info = await client.get_device_info()
                    energy = await client.get_energy()
                    devices.append({
                        "integration": "shelly",
                        "entity_id": host,
                        "name": info.get("name") or f"Shelly {info.get('model', '')} ({host})",
                        "category": "meter",
                        "subcategory": "energy",
                        "energy_type": "electricity",
                        "unit": "W",
                        "current_value": energy.get("power"),
                        "device_name": info.get("model", ""),
                        "already_configured": host in all_configured,
                    })
                except Exception:
                    pass
        except Exception:
            pass

    return {
        "devices": devices,
        "integrations_scanned": integrations_scanned,
        "total": len(devices),
    }


def _classify_sensor(device_class: str, unit: str) -> dict | None:
    """Sensor nach device_class oder Einheit klassifizieren."""
    dc = (device_class or "").lower()
    u = (unit or "").lower()

    # Energiezähler
    if dc in ("energy", "gas", "water") or u in ("kwh", "wh", "mwh", "m³"):
        energy_map = {"energy": "electricity", "gas": "gas", "water": "water"}
        etype = energy_map.get(dc)
        if not etype:
            etype = "gas" if "m³" in u and dc != "water" else "electricity"
        return {"category": "meter", "energy_type": etype}

    # Leistung
    if dc in ("power", "current", "voltage") or u in ("w", "kw", "a", "v"):
        return {"category": "meter", "energy_type": "electricity"}

    # Klima
    if dc in ("temperature",) or u in ("°c", "°f"):
        return {"category": "climate", "energy_type": None}
    if dc in ("humidity",) or (u == "%" and dc == "humidity"):
        return {"category": "climate", "energy_type": None}
    if dc in ("pressure",) or u in ("hpa", "pa", "bar", "mbar"):
        return {"category": "climate", "energy_type": None}

    return None


# ---------------------------------------------------------------------------
# Manuelles Polling
# ---------------------------------------------------------------------------

@router.post("/poll/{meter_id}")
async def poll_single_meter(
    meter_id: uuid.UUID,
    current_user: User = Depends(require_permission("readings", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Einzelnen Zähler manuell abfragen."""
    from app.integrations.polling_manager import PollingManager

    manager = PollingManager(db)
    result = await manager.poll_single_meter(meter_id)
    return result


@router.post("/poll")
async def poll_all_meters(
    current_user: User = Depends(require_permission("readings", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Alle automatischen Zähler sofort abfragen."""
    from app.integrations.polling_manager import PollingManager

    manager = PollingManager(db)
    result = await manager.poll_all_meters()
    return result
