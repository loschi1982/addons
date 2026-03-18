"""
test_e2e_allocations.py – E2E-Test: Zähler-Nutzungseinheit-Zuordnungen.

Testet den kompletten Lebenszyklus:
Standort/Gebäude/Einheiten anlegen → Zähler anlegen → Zuordnungen →
Verbrauchsberechnung mit Add/Subtract → Update → Delete.
"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_allocation_full_workflow(client: AsyncClient, auth_headers: dict):
    """Kompletter Workflow: Zuordnungen mit Stichleitungs-Szenario."""

    # ── 1. Standort + Gebäude + 2 Nutzungseinheiten anlegen ──
    site_resp = await client.post(
        "/api/v1/sites",
        json={"name": "Teststandort", "city": "Berlin", "country": "DE"},
        headers=auth_headers,
    )
    assert site_resp.status_code == 201
    site_id = site_resp.json()["id"]

    bldg_resp = await client.post(
        f"/api/v1/sites/{site_id}/buildings",
        json={
            "name": "Gebäude A",
            "site_id": site_id,
            "building_type": "office",
            "floors": 3,
        },
        headers=auth_headers,
    )
    assert bldg_resp.status_code == 201
    building_id = bldg_resp.json()["id"]

    unit_a_resp = await client.post(
        f"/api/v1/sites/{site_id}/buildings/{building_id}/units",
        json={
            "name": "Büro EG",
            "building_id": building_id,
            "usage_type": "office",
            "area_m2": 200.0,
        },
        headers=auth_headers,
    )
    assert unit_a_resp.status_code == 201
    unit_a_id = unit_a_resp.json()["id"]

    unit_b_resp = await client.post(
        f"/api/v1/sites/{site_id}/buildings/{building_id}/units",
        json={
            "name": "Büro OG",
            "building_id": building_id,
            "usage_type": "office",
            "area_m2": 150.0,
        },
        headers=auth_headers,
    )
    assert unit_b_resp.status_code == 201
    unit_b_id = unit_b_resp.json()["id"]

    # ── 2. Zähler anlegen (Stichleitung) ──
    meter_resp = await client.post(
        "/api/v1/meters",
        json={
            "name": "Stichleitung Keller → Büro OG",
            "energy_type": "electricity",
            "unit": "kWh",
            "data_source": "manual",
        },
        headers=auth_headers,
    )
    assert meter_resp.status_code == 201
    meter_id = meter_resp.json()["id"]

    # ── 3. Zuordnung: Zähler → Unit A (subtract) ──
    alloc1_resp = await client.post(
        "/api/v1/allocations",
        json={
            "meter_id": meter_id,
            "usage_unit_id": unit_a_id,
            "allocation_type": "subtract",
            "factor": 1.0,
            "description": "Stichleitung wird von EG abgezogen",
        },
        headers=auth_headers,
    )
    assert alloc1_resp.status_code == 201
    alloc1 = alloc1_resp.json()
    alloc1_id = alloc1["id"]
    assert alloc1["allocation_type"] == "subtract"
    assert float(alloc1["factor"]) == 1.0

    # ── 4. Zuordnung: Zähler → Unit B (add) ──
    alloc2_resp = await client.post(
        "/api/v1/allocations",
        json={
            "meter_id": meter_id,
            "usage_unit_id": unit_b_id,
            "allocation_type": "add",
            "factor": 1.0,
            "description": "Stichleitung wird OG zugeschlagen",
        },
        headers=auth_headers,
    )
    assert alloc2_resp.status_code == 201
    alloc2_id = alloc2_resp.json()["id"]

    # ── 5. Duplikat-Prüfung → 409 ──
    dup_resp = await client.post(
        "/api/v1/allocations",
        json={
            "meter_id": meter_id,
            "usage_unit_id": unit_a_id,
            "allocation_type": "add",
        },
        headers=auth_headers,
    )
    assert dup_resp.status_code == 409

    # ── 6. Zuordnungen auflisten ──
    list_resp = await client.get(
        "/api/v1/allocations", headers=auth_headers,
    )
    assert list_resp.status_code == 200
    assert list_resp.json()["total"] == 2

    # ── 7. Nach Zähler filtern ──
    filter_resp = await client.get(
        f"/api/v1/allocations?meter_id={meter_id}", headers=auth_headers,
    )
    assert filter_resp.status_code == 200
    assert filter_resp.json()["total"] == 2

    # ── 8. Nach Nutzungseinheit filtern ──
    filter_unit_resp = await client.get(
        f"/api/v1/allocations?usage_unit_id={unit_a_id}", headers=auth_headers,
    )
    assert filter_unit_resp.status_code == 200
    assert filter_unit_resp.json()["total"] == 1
    assert filter_unit_resp.json()["items"][0]["allocation_type"] == "subtract"

    # ── 9. Einzelne Zuordnung abrufen ──
    detail_resp = await client.get(
        f"/api/v1/allocations/{alloc1_id}", headers=auth_headers,
    )
    assert detail_resp.status_code == 200
    assert detail_resp.json()["description"] == "Stichleitung wird von EG abgezogen"

    # ── 10. Ablesungen für Verbrauchsberechnung ──
    await client.post(
        "/api/v1/readings",
        json={
            "meter_id": meter_id,
            "timestamp": "2024-01-01T00:00:00",
            "value": 1000.0,
            "source": "manual",
        },
        headers=auth_headers,
    )
    await client.post(
        "/api/v1/readings",
        json={
            "meter_id": meter_id,
            "timestamp": "2024-02-01T00:00:00",
            "value": 1500.0,
            "source": "manual",
        },
        headers=auth_headers,
    )

    # ── 11. Verbrauch Unit A (subtract) → negativ ──
    cons_a = await client.get(
        f"/api/v1/allocations/unit/{unit_a_id}/consumption"
        "?start_date=2024-01-01&end_date=2024-02-28",
        headers=auth_headers,
    )
    assert cons_a.status_code == 200
    data_a = cons_a.json()
    assert float(data_a["total_consumption"]) == -500.0
    assert data_a["usage_unit_name"] == "Büro EG"

    # ── 12. Verbrauch Unit B (add) → positiv ──
    cons_b = await client.get(
        f"/api/v1/allocations/unit/{unit_b_id}/consumption"
        "?start_date=2024-01-01&end_date=2024-02-28",
        headers=auth_headers,
    )
    assert cons_b.status_code == 200
    data_b = cons_b.json()
    assert float(data_b["total_consumption"]) == 500.0
    assert data_b["usage_unit_name"] == "Büro OG"

    # ── 13. Zuordnung aktualisieren (Faktor auf 50%) ──
    update_resp = await client.put(
        f"/api/v1/allocations/{alloc2_id}",
        json={"factor": 0.5},
        headers=auth_headers,
    )
    assert update_resp.status_code == 200
    assert float(update_resp.json()["factor"]) == 0.5

    # ── 14. Verbrauch Unit B nach Faktor-Änderung → 250 ──
    cons_b2 = await client.get(
        f"/api/v1/allocations/unit/{unit_b_id}/consumption"
        "?start_date=2024-01-01&end_date=2024-02-28",
        headers=auth_headers,
    )
    assert cons_b2.status_code == 200
    assert float(cons_b2.json()["total_consumption"]) == 250.0

    # ── 15. Zuordnung löschen ──
    del_resp = await client.delete(
        f"/api/v1/allocations/{alloc1_id}", headers=auth_headers,
    )
    assert del_resp.status_code == 200

    # ── 16. Gelöschte Zuordnung → 404 ──
    gone_resp = await client.get(
        f"/api/v1/allocations/{alloc1_id}", headers=auth_headers,
    )
    assert gone_resp.status_code == 404

    # ── 17. Verbrauch Unit A nach Löschung → 0 (keine Zuordnungen mehr) ──
    cons_a2 = await client.get(
        f"/api/v1/allocations/unit/{unit_a_id}/consumption"
        "?start_date=2024-01-01&end_date=2024-02-28",
        headers=auth_headers,
    )
    assert cons_a2.status_code == 200
    assert float(cons_a2.json()["total_consumption"]) == 0.0


@pytest.mark.asyncio
async def test_allocation_invalid_references(client: AsyncClient, auth_headers: dict):
    """Zuordnung mit ungültigem Zähler oder Nutzungseinheit → 404."""
    fake_id = "00000000-0000-0000-0000-000000000000"

    # Ungültiger Zähler
    resp1 = await client.post(
        "/api/v1/allocations",
        json={
            "meter_id": fake_id,
            "usage_unit_id": fake_id,
            "allocation_type": "add",
        },
        headers=auth_headers,
    )
    assert resp1.status_code == 404
