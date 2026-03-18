"""
test_e2e_sites.py – E2E-Test: Standort-Hierarchie Workflow.

Testet den kompletten CRUD-Lebenszyklus der 3-stufigen Hierarchie:
Standort → Gebäude → Nutzungseinheit.
"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_site_hierarchy_full_workflow(client: AsyncClient, auth_headers: dict):
    """Kompletter Workflow: Standort → Gebäude → Nutzungseinheit → Update → Delete."""

    # ── 1. Standort anlegen ──
    site_resp = await client.post(
        "/api/v1/sites",
        json={
            "name": "Hauptstandort München",
            "street": "Industriestraße 42",
            "zip_code": "80331",
            "city": "München",
            "country": "DE",
            "latitude": 48.1351,
            "longitude": 11.5820,
        },
        headers=auth_headers,
    )
    assert site_resp.status_code == 201
    site = site_resp.json()
    site_id = site["id"]
    assert site["name"] == "Hauptstandort München"
    assert site["city"] == "München"
    assert site["building_count"] == 0

    # ── 2. Standort in Liste auffindbar ──
    list_resp = await client.get("/api/v1/sites", headers=auth_headers)
    assert list_resp.status_code == 200
    sites_data = list_resp.json()
    assert sites_data["total"] >= 1
    site_names = [s["name"] for s in sites_data["items"]]
    assert "Hauptstandort München" in site_names

    # ── 3. Standort-Suche ──
    search_resp = await client.get(
        "/api/v1/sites?search=München", headers=auth_headers
    )
    assert search_resp.status_code == 200
    assert search_resp.json()["total"] >= 1

    # ── 4. Gebäude anlegen ──
    bldg_resp = await client.post(
        f"/api/v1/sites/{site_id}/buildings",
        json={
            "name": "Verwaltungsgebäude A",
            "site_id": site_id,
            "building_type": "office",
            "building_year": 2015,
            "total_area_m2": 2500.0,
            "heated_area_m2": 2200.0,
            "floors": 4,
        },
        headers=auth_headers,
    )
    assert bldg_resp.status_code == 201
    building = bldg_resp.json()
    building_id = building["id"]
    assert building["name"] == "Verwaltungsgebäude A"
    assert float(building["total_area_m2"]) == 2500.0
    assert building["floors"] == 4

    # ── 5. Zweites Gebäude anlegen ──
    bldg2_resp = await client.post(
        f"/api/v1/sites/{site_id}/buildings",
        json={
            "name": "Produktionshalle B",
            "site_id": site_id,
            "building_type": "industrial",
            "building_year": 2010,
            "total_area_m2": 5000.0,
            "floors": 2,
        },
        headers=auth_headers,
    )
    assert bldg2_resp.status_code == 201

    # ── 6. Gebäude auflisten ──
    bldgs_resp = await client.get(
        f"/api/v1/sites/{site_id}/buildings", headers=auth_headers
    )
    assert bldgs_resp.status_code == 200
    buildings = bldgs_resp.json()
    assert len(buildings) == 2

    # ── 7. Nutzungseinheit anlegen ──
    unit_resp = await client.post(
        f"/api/v1/sites/{site_id}/buildings/{building_id}/units",
        json={
            "name": "Büro EG",
            "building_id": building_id,
            "usage_type": "office",
            "unit_number": "EG-001",
            "floor": "EG",
            "area_m2": 120.0,
            "occupants": 8,
            "tenant_name": "Musterfirma GmbH",
        },
        headers=auth_headers,
    )
    assert unit_resp.status_code == 201
    unit = unit_resp.json()
    unit_id = unit["id"]
    assert unit["name"] == "Büro EG"
    assert float(unit["area_m2"]) == 120.0

    # ── 8. Standort-Detail mit Gebäuden ──
    detail_resp = await client.get(
        f"/api/v1/sites/{site_id}", headers=auth_headers
    )
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["building_count"] == 2
    assert len(detail["buildings"]) == 2

    # ── 9. Gebäude-Detail mit Nutzungseinheiten ──
    bldg_detail = await client.get(
        f"/api/v1/sites/{site_id}/buildings/{building_id}",
        headers=auth_headers,
    )
    assert bldg_detail.status_code == 200
    bldg_data = bldg_detail.json()
    assert len(bldg_data["usage_units"]) == 1
    assert bldg_data["usage_units"][0]["name"] == "Büro EG"

    # ── 10. Standort aktualisieren ──
    update_resp = await client.put(
        f"/api/v1/sites/{site_id}",
        json={"name": "Hauptstandort München (Zentrale)"},
        headers=auth_headers,
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["name"] == "Hauptstandort München (Zentrale)"

    # ── 11. Gebäude aktualisieren ──
    bldg_update = await client.put(
        f"/api/v1/sites/{site_id}/buildings/{building_id}",
        json={"heated_area_m2": 2300.0},
        headers=auth_headers,
    )
    assert bldg_update.status_code == 200
    assert float(bldg_update.json()["heated_area_m2"]) == 2300.0

    # ── 12. Nutzungseinheit aktualisieren ──
    unit_update = await client.put(
        f"/api/v1/sites/{site_id}/buildings/{building_id}/units/{unit_id}",
        json={"occupants": 10},
        headers=auth_headers,
    )
    assert unit_update.status_code == 200
    assert unit_update.json()["occupants"] == 10

    # ── 13. Nutzungseinheit löschen (Soft-Delete) ──
    unit_del = await client.delete(
        f"/api/v1/sites/{site_id}/buildings/{building_id}/units/{unit_id}",
        headers=auth_headers,
    )
    assert unit_del.status_code == 200

    # ── 14. Gebäude löschen ──
    bldg_del = await client.delete(
        f"/api/v1/sites/{site_id}/buildings/{building_id}",
        headers=auth_headers,
    )
    assert bldg_del.status_code == 200

    # ── 15. Standort löschen ──
    site_del = await client.delete(
        f"/api/v1/sites/{site_id}", headers=auth_headers
    )
    assert site_del.status_code == 200


@pytest.mark.asyncio
async def test_site_pagination(client: AsyncClient, auth_headers: dict):
    """Standort-Pagination mit mehreren Einträgen."""
    # 3 Standorte anlegen
    for i in range(3):
        resp = await client.post(
            "/api/v1/sites",
            json={"name": f"Standort {i+1}", "city": "Berlin", "country": "DE"},
            headers=auth_headers,
        )
        assert resp.status_code == 201

    # Seite 1, page_size=2
    page_resp = await client.get(
        "/api/v1/sites?page=1&page_size=2", headers=auth_headers
    )
    assert page_resp.status_code == 200
    data = page_resp.json()
    assert len(data["items"]) == 2
    assert data["total"] == 3
    assert data["total_pages"] == 2

    # Seite 2
    page2_resp = await client.get(
        "/api/v1/sites?page=2&page_size=2", headers=auth_headers
    )
    assert page2_resp.status_code == 200
    assert len(page2_resp.json()["items"]) == 1
