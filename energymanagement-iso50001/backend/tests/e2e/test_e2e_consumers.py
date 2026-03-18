"""
test_e2e_consumers.py – E2E-Test: Verbraucher CRUD Workflow.

Testet den kompletten Lebenszyklus für Verbraucher (SEU):
Anlegen → Auflisten → Filtern → Aktualisieren → Löschen.
"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_consumer_crud_workflow(client: AsyncClient, auth_headers: dict):
    """Kompletter Verbraucher-Workflow: Anlegen → Filtern → Update → Delete."""

    # ── 1. Verbraucher anlegen: Heizkessel ──
    create_resp = await client.post(
        "/api/v1/consumers",
        json={
            "name": "Heizkessel Erdgas",
            "category": "hvac",
            "rated_power_kw": 150.0,
            "operating_hours_per_year": 4000,
            "priority": "3",
            "description": "Hauptheizkessel für das Verwaltungsgebäude",
        },
        headers=auth_headers,
    )
    assert create_resp.status_code == 201
    consumer1 = create_resp.json()
    consumer1_id = consumer1["id"]
    assert consumer1["name"] == "Heizkessel Erdgas"
    assert consumer1["category"] == "hvac"
    assert consumer1["priority"] == "3"

    # ── 2. Zweiter Verbraucher: Lüftungsanlage ──
    create2_resp = await client.post(
        "/api/v1/consumers",
        json={
            "name": "RLT-Anlage OG",
            "category": "hvac",
            "rated_power_kw": 45.0,
            "operating_hours_per_year": 3000,
            "priority": "2",
        },
        headers=auth_headers,
    )
    assert create2_resp.status_code == 201
    consumer2_id = create2_resp.json()["id"]

    # ── 3. Dritter Verbraucher: Druckluft ──
    create3_resp = await client.post(
        "/api/v1/consumers",
        json={
            "name": "Kompressor Druckluft",
            "category": "compressed_air",
            "rated_power_kw": 75.0,
            "priority": "2",
        },
        headers=auth_headers,
    )
    assert create3_resp.status_code == 201

    # ── 4. Alle Verbraucher auflisten ──
    list_resp = await client.get("/api/v1/consumers", headers=auth_headers)
    assert list_resp.status_code == 200
    data = list_resp.json()
    assert data["total"] == 3

    # ── 5. Nach Kategorie filtern ──
    filter_resp = await client.get(
        "/api/v1/consumers?category=hvac", headers=auth_headers
    )
    assert filter_resp.status_code == 200
    filtered = filter_resp.json()
    assert filtered["total"] == 2
    for item in filtered["items"]:
        assert item["category"] == "hvac"

    # ── 6. Suche nach Name ──
    search_resp = await client.get(
        "/api/v1/consumers?search=Kompressor", headers=auth_headers
    )
    assert search_resp.status_code == 200
    assert search_resp.json()["total"] == 1
    assert search_resp.json()["items"][0]["name"] == "Kompressor Druckluft"

    # ── 7. Einzelnen Verbraucher abrufen ──
    detail_resp = await client.get(
        f"/api/v1/consumers/{consumer1_id}", headers=auth_headers
    )
    assert detail_resp.status_code == 200
    assert detail_resp.json()["name"] == "Heizkessel Erdgas"

    # ── 8. Verbraucher aktualisieren ──
    update_resp = await client.put(
        f"/api/v1/consumers/{consumer1_id}",
        json={
            "rated_power_kw": 160.0,
            "description": "Neuer Brenner installiert",
        },
        headers=auth_headers,
    )
    assert update_resp.status_code == 200
    updated = update_resp.json()
    assert float(updated["rated_power_kw"] or 0) == 160.0

    # ── 9. Verbraucher löschen (Soft-Delete) ──
    del_resp = await client.delete(
        f"/api/v1/consumers/{consumer2_id}", headers=auth_headers
    )
    assert del_resp.status_code == 200

    # ── 10. Gelöschter Verbraucher nicht mehr in Liste ──
    list2_resp = await client.get("/api/v1/consumers", headers=auth_headers)
    assert list2_resp.status_code == 200
    remaining_ids = [c["id"] for c in list2_resp.json()["items"]]
    assert consumer2_id not in remaining_ids

    # ── 11. Nicht existierender Verbraucher → 404 ──
    fake_id = "00000000-0000-0000-0000-000000000000"
    not_found = await client.get(
        f"/api/v1/consumers/{fake_id}", headers=auth_headers
    )
    assert not_found.status_code == 404
