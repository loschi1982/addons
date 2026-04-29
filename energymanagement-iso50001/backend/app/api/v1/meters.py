"""
meters.py – Endpunkte für Zähler-CRUD.

Zähler können hierarchisch organisiert sein (Haupt-/Unterzähler).
Die Baumansicht zeigt die Struktur visuell an.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.site import Site
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


def _meter_to_response(meter, latest=None, site_name: str | None = None) -> MeterResponse:
    """Hilfsfunktion: Meter-Objekt → MeterResponse."""
    latest_value, latest_ts = latest if latest else (None, None)
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
        is_delivery_based=getattr(meter, 'is_delivery_based', False),
        is_weather_corrected=meter.is_weather_corrected,
        co2_factor_override=meter.co2_factor_override,
        tariff_info=meter.tariff_info,
        virtual_config=meter.virtual_config,
        notes=getattr(meter, 'notes', None),
        schema_label=getattr(meter, 'schema_label', None),
        is_active=meter.is_active,
        created_at=meter.created_at,
        latest_reading=latest_value,
        latest_reading_date=latest_ts,
        site_name=site_name or getattr(meter, '_site_name', None),
    )


@router.get("", response_model=PaginatedResponse[MeterResponse])
async def list_meters(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=500),
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
    latest_by_meter = result.get("latest_by_meter", {})
    meters = result["items"]

    # Site-Namen per Batch-Abfrage laden
    site_ids = {m.site_id for m in meters if m.site_id}
    site_names: dict[uuid.UUID, str] = {}
    if site_ids:
        site_rows = await db.execute(select(Site.id, Site.name).where(Site.id.in_(site_ids)))
        for sid, sname in site_rows.all():
            site_names[sid] = sname

    return PaginatedResponse(
        items=[
            _meter_to_response(m, latest_by_meter.get(m.id), site_names.get(m.site_id))
            for m in meters
        ],
        total=total,
        page=result["page"],
        page_size=result["page_size"],
        total_pages=(total + page_size - 1) // page_size if total > 0 else 0,
    )


@router.get("/tree")
async def list_meters_tree(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Alle aktiven Zähler als schlanke Liste für die Baumansicht.

    Kein latest_reading-Query – nur die für den Baum nötigen Felder.
    Wesentlich schneller als der vollständige list_meters-Endpunkt.
    """
    from sqlalchemy import select as _select
    from app.models.meter import Meter as _Meter

    rows = await db.execute(
        _select(
            _Meter.id,
            _Meter.name,
            _Meter.meter_number,
            _Meter.energy_type,
            _Meter.unit,
            _Meter.data_source,
            _Meter.location,
            _Meter.site_id,
            _Meter.building_id,
            _Meter.usage_unit_id,
            _Meter.parent_meter_id,
            _Meter.is_active,
            _Meter.is_virtual,
            _Meter.is_feed_in,
            _Meter.is_delivery_based,
            _Meter.is_weather_corrected,
            _Meter.source_config,
            _Meter.virtual_config,
        )
        .where(_Meter.is_active == True)  # noqa: E712
        .order_by(_Meter.name)
    )
    meters = rows.mappings().all()

    # Site-Namen per Batch-Abfrage laden
    site_ids = {m["site_id"] for m in meters if m["site_id"]}
    site_names: dict = {}
    if site_ids:
        site_rows = await db.execute(select(Site.id, Site.name).where(Site.id.in_(site_ids)))
        for sid, sname in site_rows.all():
            site_names[sid] = sname

    return {
        "items": [
            {
                "id": str(m["id"]),
                "name": m["name"],
                "meter_number": m["meter_number"],
                "energy_type": m["energy_type"],
                "unit": m["unit"],
                "data_source": m["data_source"],
                "location": m["location"],
                "site_id": str(m["site_id"]) if m["site_id"] else None,
                "site_name": site_names.get(m["site_id"]),
                "building_id": str(m["building_id"]) if m["building_id"] else None,
                "usage_unit_id": str(m["usage_unit_id"]) if m["usage_unit_id"] else None,
                "parent_meter_id": str(m["parent_meter_id"]) if m["parent_meter_id"] else None,
                "is_active": m["is_active"],
                "is_virtual": m["is_virtual"],
                "is_feed_in": m["is_feed_in"],
                "is_delivery_based": m["is_delivery_based"],
                "is_weather_corrected": m["is_weather_corrected"],
                "source_config": m["source_config"],
                "virtual_config": m["virtual_config"],
            }
            for m in meters
        ],
        "total": len(meters),
    }


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


@router.post("/from-discovery", response_model=MeterResponse, status_code=201)
async def create_meter_from_discovery(
    request: dict,
    current_user: User = Depends(require_permission("meters", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Zähler aus Discovery-Daten anlegen (vereinfachte Anlage)."""
    integration = request.get("integration", "homeassistant")
    entity_id = request.get("entity_id", "")

    # source_config basierend auf Integration aufbauen
    source_config_map = {
        "homeassistant": {"entity_id": entity_id},
        "mqtt": {
            "broker_host": request.get("broker_host", ""),
            "topic": entity_id,
            "port": request.get("port", 1883),
        },
        "bacnet": {
            "device_address": request.get("device_address", ""),
            "object_type": request.get("object_type", "analogInput"),
            "object_instance": request.get("object_instance", 0),
        },
        "shelly": {
            "shelly_host": entity_id,
            "channel": request.get("channel", 0),
        },
    }

    meter_data = {
        "name": request.get("name", entity_id),
        "energy_type": request.get("energy_type", "electricity"),
        "unit": request.get("unit", "kWh"),
        "data_source": integration,
        "source_config": source_config_map.get(integration, {"entity_id": entity_id}),
        "site_id": request.get("site_id"),
        "building_id": request.get("building_id"),
        "parent_meter_id": request.get("parent_meter_id"),
    }

    service = MeterService(db)
    meter = await service.create_meter(meter_data)
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


@router.get("/schema-roots")
async def get_schema_roots(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle Zähler mit schema_label (Betrachtungspunkte) laden."""
    service = MeterService(db)
    return await service.get_schema_roots()


@router.get("/{meter_id}/subtree")
async def get_meter_subtree(
    meter_id: uuid.UUID,
    period_start: date | None = None,
    period_end: date | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Zählerbaum ab einem bestimmten Zähler mit Verbrauchsdaten aufbauen."""
    service = MeterService(db)
    return await service.get_subtree(meter_id, period_start, period_end)


@router.get("/{meter_id}/subtree-pdf")
async def export_subtree_pdf(
    meter_id: uuid.UUID,
    period_start: date = Query(...),
    period_end: date = Query(...),
    schema_label: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Energieschema-Auswertung als PDF exportieren."""
    from app.services.reporting.schema_report import generate_schema_pdf

    service = MeterService(db)
    tree = await service.get_subtree(meter_id, period_start, period_end)

    pdf_bytes = await generate_schema_pdf(
        tree=tree,
        period_start=period_start,
        period_end=period_end,
        schema_label=schema_label,
    )

    name = (schema_label or tree.get("name", "schema")).replace(" ", "_")
    filename = f"schema_{name}_{period_start}_{period_end}.pdf"

    # Wenn WeasyPrint nicht verfügbar, HTML zurückgeben
    content_type = "application/pdf"
    if not pdf_bytes[:4] == b"%PDF":
        content_type = "text/html; charset=utf-8"
        filename = filename.replace(".pdf", ".html")

    return Response(
        content=pdf_bytes,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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


@router.patch("/{meter_id}/parent")
async def set_meter_parent(
    meter_id: uuid.UUID,
    body: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Übergeordneten Zähler setzen oder entfernen (Drag & Drop).

    Body: {"parent_meter_id": "<uuid>"} oder {"parent_meter_id": null}
    Expliziter Endpunkt, weil PUT mit exclude_unset null-Werte ignoriert.
    """
    from app.models.meter import Meter as _Meter
    from fastapi import HTTPException
    meter = await db.get(_Meter, meter_id)
    if not meter:
        raise HTTPException(status_code=404, detail="Zähler nicht gefunden")
    raw = body.get("parent_meter_id")
    meter.parent_meter_id = uuid.UUID(str(raw)) if raw else None
    await db.commit()
    return {"id": str(meter_id), "parent_meter_id": str(meter.parent_meter_id) if meter.parent_meter_id else None}


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
