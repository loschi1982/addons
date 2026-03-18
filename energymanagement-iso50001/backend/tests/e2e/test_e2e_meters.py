"""
test_e2e_meters.py – E2E-Test: Zähler + Ablesungen Workflow.

Testet den kompletten Lebenszyklus:
Zähler anlegen → Ablesungen erfassen → Dashboard abrufen → Zähler löschen.
"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_meter_and_readings_workflow(client: AsyncClient, auth_headers: dict):
    """Kompletter Workflow: Zähler → Ablesungen → Verbrauchsberechnung."""

    # ── 1. Stromzähler anlegen ──
    meter_resp = await client.post(
        "/api/v1/meters",
        json={
            "name": "Hauptzähler Strom",
            "meter_number": "DE-STR-001",
            "energy_type": "electricity",
            "unit": "kWh",
            "data_source": "manual",
            "location": "Keller Technikraum",
        },
        headers=auth_headers,
    )
    assert meter_resp.status_code == 201
    meter = meter_resp.json()
    meter_id = meter["id"]
    assert meter["name"] == "Hauptzähler Strom"
    assert meter["energy_type"] == "electricity"

    # ── 2. Gaszähler anlegen ──
    gas_resp = await client.post(
        "/api/v1/meters",
        json={
            "name": "Gaszähler Heizung",
            "meter_number": "DE-GAS-001",
            "energy_type": "gas",
            "unit": "m³",
            "data_source": "manual",
            "is_weather_corrected": True,
        },
        headers=auth_headers,
    )
    assert gas_resp.status_code == 201
    gas_meter_id = gas_resp.json()["id"]

    # ── 3. Zähler auflisten ──
    list_resp = await client.get("/api/v1/meters", headers=auth_headers)
    assert list_resp.status_code == 200
    meters_data = list_resp.json()
    assert meters_data["total"] == 2

    # ── 4. Zähler nach Energieart filtern ──
    filter_resp = await client.get(
        "/api/v1/meters?energy_type=electricity", headers=auth_headers
    )
    assert filter_resp.status_code == 200
    assert filter_resp.json()["total"] == 1
    assert filter_resp.json()["items"][0]["energy_type"] == "electricity"

    # ── 5. Zähler-Suche ──
    search_resp = await client.get(
        "/api/v1/meters?search=Hauptzähler", headers=auth_headers
    )
    assert search_resp.status_code == 200
    assert search_resp.json()["total"] >= 1

    # ── 6. Ablesung erfassen (Stromzähler) ──
    reading1_resp = await client.post(
        "/api/v1/readings",
        json={
            "meter_id": meter_id,
            "timestamp": "2024-01-01T00:00:00",
            "value": 10000.0,
            "source": "manual",
        },
        headers=auth_headers,
    )
    assert reading1_resp.status_code == 201
    reading1 = reading1_resp.json()
    assert reading1["meter_id"] == meter_id
    assert float(reading1["value"]) == 10000.0

    # ── 7. Zweite Ablesung ──
    reading2_resp = await client.post(
        "/api/v1/readings",
        json={
            "meter_id": meter_id,
            "timestamp": "2024-02-01T00:00:00",
            "value": 12500.0,
            "source": "manual",
        },
        headers=auth_headers,
    )
    assert reading2_resp.status_code == 201

    # ── 8. Ablesungen auflisten ──
    readings_resp = await client.get(
        f"/api/v1/readings?meter_id={meter_id}", headers=auth_headers
    )
    assert readings_resp.status_code == 200
    readings_data = readings_resp.json()
    assert readings_data["total"] == 2

    # ── 9. Zähler-Detail abrufen ──
    detail_resp = await client.get(
        f"/api/v1/meters/{meter_id}", headers=auth_headers
    )
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["name"] == "Hauptzähler Strom"

    # ── 10. Zähler aktualisieren ──
    update_resp = await client.put(
        f"/api/v1/meters/{meter_id}",
        json={"location": "Technikraum EG"},
        headers=auth_headers,
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["location"] == "Technikraum EG"

    # ── 11. Zähler löschen (Soft-Delete) ──
    del_resp = await client.delete(
        f"/api/v1/meters/{meter_id}", headers=auth_headers
    )
    assert del_resp.status_code == 200

    # ── 12. Gelöschter Zähler nicht mehr in aktiver Liste ──
    active_resp = await client.get(
        "/api/v1/meters?is_active=true", headers=auth_headers
    )
    assert active_resp.status_code == 200
    active_ids = [m["id"] for m in active_resp.json()["items"]]
    assert meter_id not in active_ids

    # ── 13. Gaszähler aufräumen ──
    await client.delete(f"/api/v1/meters/{gas_meter_id}", headers=auth_headers)


@pytest.mark.asyncio
async def test_meter_tree(client: AsyncClient, auth_headers: dict):
    """Zählerbaum: Hauptzähler mit Unterzähler."""
    # Hauptzähler
    main_resp = await client.post(
        "/api/v1/meters",
        json={
            "name": "Hauptzähler Gesamt",
            "energy_type": "electricity",
            "unit": "kWh",
            "data_source": "manual",
        },
        headers=auth_headers,
    )
    assert main_resp.status_code == 201
    main_id = main_resp.json()["id"]

    # Unterzähler
    sub_resp = await client.post(
        "/api/v1/meters",
        json={
            "name": "Unterzähler Beleuchtung",
            "energy_type": "electricity",
            "unit": "kWh",
            "data_source": "shelly",
            "parent_meter_id": main_id,
            "is_submeter": True,
        },
        headers=auth_headers,
    )
    assert sub_resp.status_code == 201

    # Baumstruktur abrufen
    tree_resp = await client.get("/api/v1/meters/tree", headers=auth_headers)
    assert tree_resp.status_code == 200
