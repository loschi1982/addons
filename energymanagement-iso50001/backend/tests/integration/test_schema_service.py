"""
test_schema_service.py – Tests für den Schema-Service.

Testet CRUD für Energieschemata und Positionen (Knoten im Flussbild),
Default-Markierung und Cascade-Delete.
"""

import uuid

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meter import Meter
from app.models.schema import EnergySchema, SchemaPosition
from app.services.schema_service import SchemaService


@pytest_asyncio.fixture
async def schema_meter(db_session: AsyncSession):
    """Erstellt einen Zähler für Schema-Tests."""
    meter = Meter(
        id=uuid.uuid4(),
        name="Hauptzähler",
        energy_type="electricity",
        unit="kWh",
        data_source="manual",
        is_active=True,
    )
    db_session.add(meter)
    await db_session.commit()
    return meter


@pytest.mark.asyncio
async def test_create_schema(db_session: AsyncSession):
    """Neues Energieschema anlegen."""
    service = SchemaService(db_session)
    schema = await service.create_schema({
        "name": "Stromverteilung Gebäude A",
        "schema_type": "electricity",
        "description": "Übersicht der Stromverteilung",
    })
    assert schema.id is not None
    assert schema.name == "Stromverteilung Gebäude A"
    assert schema.schema_type == "electricity"


@pytest.mark.asyncio
async def test_list_schemas(db_session: AsyncSession):
    """Schemata auflisten (alphabetisch)."""
    service = SchemaService(db_session)
    await service.create_schema({"name": "B-Schema", "schema_type": "gas"})
    await service.create_schema({"name": "A-Schema", "schema_type": "electricity"})

    schemas = await service.list_schemas()
    assert len(schemas) == 2
    assert schemas[0].name == "A-Schema"  # Alphabetisch sortiert


@pytest.mark.asyncio
async def test_get_schema_with_positions(db_session: AsyncSession, schema_meter):
    """Schema mit Positionen und Zähler-Infos laden."""
    service = SchemaService(db_session)
    schema = await service.create_schema({
        "name": "Detail-Test",
        "schema_type": "electricity",
    })
    await service.create_position(schema.id, {
        "meter_id": schema_meter.id,
        "x": 100.0, "y": 200.0,
        "width": 250.0, "height": 120.0,
    })

    loaded = await service.get_schema(schema.id)
    assert loaded is not None
    assert len(loaded.positions) == 1
    assert loaded.positions[0].x == 100.0


@pytest.mark.asyncio
async def test_update_schema(db_session: AsyncSession):
    """Schema aktualisieren."""
    service = SchemaService(db_session)
    schema = await service.create_schema({"name": "Alt", "schema_type": "gas"})
    updated = await service.update_schema(schema.id, {"name": "Neu"})
    assert updated.name == "Neu"


@pytest.mark.asyncio
async def test_update_schema_not_found(db_session: AsyncSession):
    """Nicht existierendes Schema → None."""
    service = SchemaService(db_session)
    result = await service.update_schema(uuid.uuid4(), {"name": "X"})
    assert result is None


@pytest.mark.asyncio
async def test_delete_schema(db_session: AsyncSession):
    """Schema löschen."""
    service = SchemaService(db_session)
    schema = await service.create_schema({"name": "Löschen", "schema_type": "gas"})
    assert await service.delete_schema(schema.id) is True
    assert await service.get_schema(schema.id) is None


@pytest.mark.asyncio
async def test_delete_schema_not_found(db_session: AsyncSession):
    """Nicht existierendes Schema löschen → False."""
    service = SchemaService(db_session)
    assert await service.delete_schema(uuid.uuid4()) is False


@pytest.mark.asyncio
async def test_default_schema(db_session: AsyncSession):
    """Default-Markierung: nur ein Schema gleichzeitig als Default."""
    service = SchemaService(db_session)
    s1 = await service.create_schema({
        "name": "Schema 1", "schema_type": "electricity", "is_default": True,
    })
    assert s1.is_default is True

    # Neues Default → altes wird zurückgesetzt
    s2 = await service.create_schema({
        "name": "Schema 2", "schema_type": "gas", "is_default": True,
    })
    assert s2.is_default is True

    # s1 nachladen
    await db_session.refresh(s1)
    assert s1.is_default is False


@pytest.mark.asyncio
async def test_create_position(db_session: AsyncSession, schema_meter):
    """Position im Schema anlegen."""
    service = SchemaService(db_session)
    schema = await service.create_schema({"name": "Pos-Test", "schema_type": "electricity"})
    pos = await service.create_position(schema.id, {
        "meter_id": schema_meter.id,
        "x": 50.0, "y": 75.0,
    })
    assert pos.id is not None
    assert pos.schema_id == schema.id
    assert pos.x == 50.0
    assert pos.y == 75.0


@pytest.mark.asyncio
async def test_update_position(db_session: AsyncSession, schema_meter):
    """Position aktualisieren (Drag & Drop)."""
    service = SchemaService(db_session)
    schema = await service.create_schema({"name": "Drag-Test", "schema_type": "electricity"})
    pos = await service.create_position(schema.id, {
        "meter_id": schema_meter.id,
        "x": 0.0, "y": 0.0,
    })
    updated = await service.update_position(pos.id, {"x": 300.0, "y": 150.0})
    assert updated.x == 300.0
    assert updated.y == 150.0


@pytest.mark.asyncio
async def test_update_position_not_found(db_session: AsyncSession):
    """Nicht existierende Position → None."""
    service = SchemaService(db_session)
    result = await service.update_position(uuid.uuid4(), {"x": 100.0})
    assert result is None


@pytest.mark.asyncio
async def test_delete_position(db_session: AsyncSession, schema_meter):
    """Position löschen."""
    service = SchemaService(db_session)
    schema = await service.create_schema({"name": "Del-Pos", "schema_type": "electricity"})
    pos = await service.create_position(schema.id, {
        "meter_id": schema_meter.id,
        "x": 0.0, "y": 0.0,
    })
    assert await service.delete_position(pos.id) is True
    assert await service.delete_position(pos.id) is False  # Schon gelöscht


@pytest.mark.asyncio
async def test_delete_schema_cascades_positions(db_session: AsyncSession, schema_meter):
    """Schema-Löschung löscht auch alle Positionen."""
    service = SchemaService(db_session)
    schema = await service.create_schema({"name": "Cascade", "schema_type": "electricity"})
    pos = await service.create_position(schema.id, {
        "meter_id": schema_meter.id,
        "x": 0.0, "y": 0.0,
    })
    pos_id = pos.id

    await service.delete_schema(schema.id)

    # Position sollte auch weg sein
    from sqlalchemy import select
    result = await db_session.execute(
        select(SchemaPosition).where(SchemaPosition.id == pos_id)
    )
    assert result.scalar_one_or_none() is None
