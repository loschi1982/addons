"""
meters.py – Endpunkte für Zähler-CRUD.

Zähler können hierarchisch organisiert sein (Haupt-/Unterzähler).
Die Baumansicht zeigt die Struktur visuell an.
"""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.user import User
from app.schemas.common import DeleteResponse, PaginatedResponse
from app.schemas.meter import (
    MeterCreate,
    MeterDetailResponse,
    MeterResponse,
    MeterTreeNode,
    MeterUpdate,
)
from app.services.meter_service import MeterService

router = APIRouter()


def _meter_to_response(meter) -> MeterResponse:
    """Hilfsfunktion: Meter-Objekt → MeterResponse."""
    return MeterResponse(
        id=meter.id,
        name=meter.name,
        meter_number=meter.meter_number,
        energy_type=meter.energy_type,
        unit=meter.unit,
        data_source=meter.data_source,
        source_config=meter.source_config,
        location=meter.location,
        site_id=meter.site_id,
        building_id=meter.building_id,
        usage_unit_id=meter.usage_unit_id,
        parent_meter_id=meter.parent_meter_id,
        is_submeter=meter.is_submeter,
        is_virtual=meter.is_virtual,
        is_feed_in=meter.is_feed_in,
        is_weather_corrected=meter.is_weather_corrected,
        co2_factor_override=meter.co2_factor_override,
        tariff_info=meter.tariff_info,
        virtual_config=meter.virtual_config,
        notes=getattr(meter, 'notes', None),
        is_active=meter.is_active,
        created_at=meter.created_at,
    )


@router.get("", response_model=PaginatedResponse[MeterResponse])
async def list_meters(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    energy_type: str | None = None,
    data_source: str | None = None,
    site_id: uuid.UUID | None = None,
    building_id: uuid.UUID | None = None,
    usage_unit_id: uuid.UUID | None = None,
    is_active: bool | None = True,
    search: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle Zähler auflisten mit Filtern."""
    service = MeterService(db)
    result = await service.list_meters(
        page=page,
        page_size=page_size,
        energy_type=energy_type,
        data_source=data_source,
        site_id=site_id,
        building_id=building_id,
        usage_unit_id=usage_unit_id,
        is_active=is_active,
        search=search,
    )

    total = result["total"]
    return PaginatedResponse(
        items=[_meter_to_response(m) for m in result["items"]],
        total=total,
        page=result["page"],
        page_size=result["page_size"],
        total_pages=(total + page_size - 1) // page_size if total > 0 else 0,
    )


@router.post("", response_model=MeterResponse, status_code=201)
async def create_meter(
    request: MeterCreate,
    current_user: User = Depends(require_permission("meters", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Neuen Zähler anlegen."""
    service = MeterService(db)
    meter = await service.create_meter(request.model_dump())
    return _meter_to_response(meter)


@router.get("/tree", response_model=list[MeterTreeNode])
async def get_meter_tree(
    energy_type: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Zählerbaum als hierarchische Struktur abrufen."""
    service = MeterService(db)
    return await service.get_meter_tree(energy_type)


@router.post("/poll-all")
async def poll_all_meters(
    current_user: User = Depends(require_permission("meters", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Alle automatischen Zähler manuell abfragen."""
    from app.integrations.polling_manager import PollingManager

    manager = PollingManager(db)
    return await manager.poll_all_meters()


@router.get("/{meter_id}", response_model=MeterDetailResponse)
async def get_meter(
    meter_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Einzelnen Zähler mit Details abrufen."""
    service = MeterService(db)
    meter = await service.get_meter(meter_id)

    # Unterzähler laden
    sub_meters = await service.get_sub_meters(meter_id)

    return MeterDetailResponse(
        **_meter_to_response(meter).model_dump(),
        sub_meters=[_meter_to_response(sm) for sm in sub_meters],
        consumers=[],  # Verbraucher-Zuordnung später
    )


@router.put("/{meter_id}", response_model=MeterResponse)
async def update_meter(
    meter_id: uuid.UUID,
    request: MeterUpdate,
    current_user: User = Depends(require_permission("meters", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Zähler aktualisieren."""
    service = MeterService(db)
    meter = await service.update_meter(
        meter_id, request.model_dump(exclude_unset=True)
    )
    return _meter_to_response(meter)


@router.delete("/{meter_id}", response_model=DeleteResponse)
async def delete_meter(
    meter_id: uuid.UUID,
    current_user: User = Depends(require_permission("meters", "delete")),
    db: AsyncSession = Depends(get_db),
):
    """Zähler deaktivieren (Soft-Delete)."""
    service = MeterService(db)
    await service.delete_meter(meter_id)
    return DeleteResponse(id=meter_id)


@router.post("/{meter_id}/poll")
async def poll_meter(
    meter_id: uuid.UUID,
    current_user: User = Depends(require_permission("meters", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Zähler manuell abfragen und Reading speichern."""
    from app.integrations.polling_manager import PollingManager

    manager = PollingManager(db)
    return await manager.poll_single_meter(meter_id)


@router.get("/{meter_id}/test-connection")
async def test_meter_connection(
    meter_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Verbindung zum Zähler-Gerät testen und aktuelle Werte abrufen."""
    service = MeterService(db)
    meter = await service.get_meter(meter_id)

    if meter.data_source != "shelly":
        return {"success": False, "error": f"Verbindungstest nur für Shelly unterstützt (ist: {meter.data_source})"}

    from app.integrations.shelly import ShellyClient

    config = meter.source_config or {}
    host = config.get("shelly_host", config.get("ip", ""))
    if not host:
        return {"success": False, "error": "Keine IP-Adresse konfiguriert"}

    client = ShellyClient(host)
    try:
        info = await client.get_device_info()
        mode = config.get("mode", "single")
        if mode == "balanced":
            channels = config.get("channels", [0, 1, 2])
            energy = await client.get_balanced_power(channels)
            energy_kwh = float(energy["energy_wh"]) / 1000
        else:
            channel = config.get("channel", 0)
            data = await client.get_energy(channel)
            energy = data
            energy_kwh = float(data["energy_wh"]) / 1000

        return {
            "success": True,
            "device": info,
            "mode": mode,
            "current_power_w": energy.get("power", 0),
            "total_energy_kwh": energy_kwh,
            "raw": energy,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}
