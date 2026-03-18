"""
websocket.py – WebSocket-Endpunkte für Live-Updates.

Stellt Echtzeit-Verbindungen für Dashboard-Updates und
individuelle Zähler-Monitoring bereit.
"""

import asyncio
import uuid
from datetime import datetime, timezone

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import func, select

from app.core.database import async_session_factory
from app.models.meter import Meter
from app.models.reading import MeterReading

logger = structlog.get_logger()
router = APIRouter()


class ConnectionManager:
    """Verwaltet aktive WebSocket-Verbindungen."""

    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self.meter_connections: dict[str, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, meter_id: str | None = None):
        await websocket.accept()
        self.active_connections.append(websocket)
        if meter_id:
            if meter_id not in self.meter_connections:
                self.meter_connections[meter_id] = []
            self.meter_connections[meter_id].append(websocket)

    def disconnect(self, websocket: WebSocket, meter_id: str | None = None):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        if meter_id and meter_id in self.meter_connections:
            if websocket in self.meter_connections[meter_id]:
                self.meter_connections[meter_id].remove(websocket)

    async def broadcast(self, message: dict):
        """Nachricht an alle verbundenen Clients senden."""
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass

    async def send_to_meter(self, meter_id: str, message: dict):
        """Nachricht an alle Clients senden, die einen bestimmten Zähler beobachten."""
        connections = self.meter_connections.get(meter_id, [])
        for connection in connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass


manager = ConnectionManager()


async def _get_live_data() -> dict:
    """Aktuelle Zusammenfassung für das Live-Dashboard."""
    async with async_session_factory() as db:
        # Aktive Zähler mit letztem Wert
        meters_result = await db.execute(
            select(Meter).where(Meter.is_active == True)  # noqa: E712
        )
        meters = list(meters_result.scalars().all())

        meter_data = []
        for meter in meters:
            last_reading = await db.execute(
                select(MeterReading)
                .where(MeterReading.meter_id == meter.id)
                .order_by(MeterReading.timestamp.desc())
                .limit(1)
            )
            reading = last_reading.scalar_one_or_none()

            meter_data.append({
                "meter_id": str(meter.id),
                "name": meter.name,
                "energy_type": meter.energy_type,
                "last_value": float(reading.value) if reading else None,
                "last_consumption": float(reading.consumption) if reading and reading.consumption else None,
                "last_timestamp": reading.timestamp.isoformat() if reading else None,
                "unit": meter.unit,
            })

        return {
            "type": "live_update",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "meters": meter_data,
            "total_meters": len(meters),
        }


async def _get_meter_data(meter_id: str) -> dict:
    """Aktuelle Daten für einen einzelnen Zähler."""
    async with async_session_factory() as db:
        meter = await db.get(Meter, uuid.UUID(meter_id))
        if not meter:
            return {"type": "error", "message": "Zähler nicht gefunden"}

        # Letzte 10 Messwerte
        readings_result = await db.execute(
            select(MeterReading)
            .where(MeterReading.meter_id == meter.id)
            .order_by(MeterReading.timestamp.desc())
            .limit(10)
        )
        readings = list(readings_result.scalars().all())

        return {
            "type": "meter_update",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "meter_id": meter_id,
            "name": meter.name,
            "energy_type": meter.energy_type,
            "unit": meter.unit,
            "readings": [
                {
                    "timestamp": r.timestamp.isoformat(),
                    "value": float(r.value),
                    "consumption": float(r.consumption) if r.consumption else None,
                }
                for r in readings
            ],
        }


@router.websocket("/live")
async def websocket_live(websocket: WebSocket):
    """
    WebSocket für Live-Dashboard-Updates.

    Sendet alle 10 Sekunden aktuelle Zähler-Zusammenfassungen.
    """
    await manager.connect(websocket)
    try:
        # Initial-Daten senden
        data = await _get_live_data()
        await websocket.send_json(data)

        while True:
            # Auf Client-Nachrichten warten (mit Timeout für periodische Updates)
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
                if msg == "refresh":
                    data = await _get_live_data()
                    await websocket.send_json(data)
            except asyncio.TimeoutError:
                # Periodisches Update senden
                data = await _get_live_data()
                await websocket.send_json(data)
    except WebSocketDisconnect:
        manager.disconnect(websocket)


@router.websocket("/meter/{meter_id}")
async def websocket_meter(websocket: WebSocket, meter_id: str):
    """
    WebSocket für Live-Updates eines einzelnen Zählers.

    Sendet alle 5 Sekunden aktuelle Messwerte.
    """
    await manager.connect(websocket, meter_id)
    try:
        data = await _get_meter_data(meter_id)
        await websocket.send_json(data)

        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
                if msg == "refresh":
                    data = await _get_meter_data(meter_id)
                    await websocket.send_json(data)
            except asyncio.TimeoutError:
                data = await _get_meter_data(meter_id)
                await websocket.send_json(data)
    except WebSocketDisconnect:
        manager.disconnect(websocket, meter_id)
