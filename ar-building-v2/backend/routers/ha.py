# Router für den Home Assistant Proxy.
# Leitet Anfragen an die HA-API weiter und gibt die Sensor-Daten zurück.
# Das verhindert CORS-Probleme und schützt den HA-Token vor dem Browser.

import ssl
import aiohttp
from fastapi import APIRouter, Depends, HTTPException

from backend.auth import require_any_role
from backend.config import load_settings

# HA betreibt oft selbstsignierte Zertifikate auf dem lokalen Netz.
# Wir verschlüsseln die Verbindung, verzichten aber auf Zertifikatsvalidierung.
# check_hostname=False ist nötig wenn CN/SAN nicht mit der IP übereinstimmt.
_HA_SSL = ssl.create_default_context()
_HA_SSL.check_hostname = False
_HA_SSL.verify_mode = ssl.CERT_NONE

router = APIRouter()


def ha_sensor_from_state(state: dict) -> dict:
    """Wandelt ein HA-State-Objekt in unser HASensor-Schema um."""
    attrs = state.get("attributes", {})
    return {
        "entity_id": state.get("entity_id", ""),
        "state": state.get("state", ""),
        "unit": attrs.get("unit_of_measurement"),
        "friendly_name": attrs.get("friendly_name", state.get("entity_id", "")),
    }


@router.get("/sensors")
async def list_sensors(_user=Depends(require_any_role())):
    """Gibt alle verfügbaren HA-Sensoren zurück.
    Ruft intern die HA-API auf und gibt die Daten gefiltert weiter."""
    settings = load_settings()
    ha_url = settings.get("ha_url", "").rstrip("/")
    ha_token = settings.get("ha_token", "")

    if not ha_url or not ha_token:
        raise HTTPException(status_code=503, detail="Home Assistant not configured")

    headers = {"Authorization": f"Bearer {ha_token}"}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{ha_url}/api/states", headers=headers, ssl=_HA_SSL
            ) as resp:
                if resp.status != 200:
                    raise HTTPException(status_code=502, detail="HA API error")
                states = await resp.json()
    except aiohttp.ClientError as e:
        raise HTTPException(
            status_code=503, detail=f"Cannot reach Home Assistant: {e}"
        ) from e

    # Nur Sensor-Entitäten zurückgeben (entity_id beginnt mit "sensor.").
    sensors = [
        ha_sensor_from_state(s)
        for s in states
        if s.get("entity_id", "").startswith("sensor.")
    ]
    return sensors


@router.get("/sensors/{entity_id:path}")
async def get_sensor(entity_id: str, _user=Depends(require_any_role())):
    """Gibt den aktuellen Wert eines einzelnen HA-Sensors zurück.
    entity_id ist z.B. 'sensor.temperature_foyer'."""
    settings = load_settings()
    ha_url = settings.get("ha_url", "").rstrip("/")
    ha_token = settings.get("ha_token", "")

    if not ha_url or not ha_token:
        raise HTTPException(status_code=503, detail="Home Assistant not configured")

    headers = {"Authorization": f"Bearer {ha_token}"}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{ha_url}/api/states/{entity_id}", headers=headers, ssl=_HA_SSL
            ) as resp:
                if resp.status == 404:
                    raise HTTPException(status_code=404, detail="Sensor not found")
                if resp.status != 200:
                    raise HTTPException(status_code=502, detail="HA API error")
                state = await resp.json()
    except aiohttp.ClientError as e:
        raise HTTPException(
            status_code=503, detail=f"Cannot reach Home Assistant: {e}"
        ) from e

    return ha_sensor_from_state(state)
