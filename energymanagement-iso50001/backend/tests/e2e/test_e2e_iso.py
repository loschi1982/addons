"""
test_e2e_iso.py – E2E-Test: Kompletter ISO 50001 Workflow.

Testet den vollständigen ISO 50001 Managementsystem-Lebenszyklus:
Kontext → Energiepolitik → Rollen → Ziele → Risiken → Rechtskataster
→ Dokumente → Audit → Nichtkonformitäten → Management Review.
"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_iso50001_full_workflow(client: AsyncClient, auth_headers: dict):
    """Kompletter ISO 50001 Workflow: Aufbau eines EnMS."""

    # ── 1. Kontext der Organisation definieren ──
    ctx_resp = await client.put(
        "/api/v1/iso/context",
        json={
            "scope_description": "Alle Bürostandorte in Deutschland",
            "boundaries": "Energieverbrauch Strom, Gas, Fernwärme",
        },
        headers=auth_headers,
    )
    assert ctx_resp.status_code == 200
    context = ctx_resp.json()
    assert context["scope_description"] == "Alle Bürostandorte in Deutschland"

    # ── 2. Kontext abrufen ──
    ctx_get = await client.get("/api/v1/iso/context", headers=auth_headers)
    assert ctx_get.status_code == 200

    # ── 3. Energiepolitik erstellen ──
    policy_resp = await client.post(
        "/api/v1/iso/policies",
        json={
            "title": "Energiepolitik 2024",
            "content": "Wir verpflichten uns zur kontinuierlichen Verbesserung "
                       "der energiebezogenen Leistung und zur Einhaltung aller "
                       "rechtlichen Anforderungen.",
            "approved_by": "Geschäftsführer Dr. Müller",
            "approved_date": "2024-01-15",
            "valid_from": "2024-01-15",
            "is_current": True,
        },
        headers=auth_headers,
    )
    assert policy_resp.status_code == 201
    policy = policy_resp.json()
    assert policy["title"] == "Energiepolitik 2024"
    assert policy["is_current"] is True

    # ── 4. Energiepolitiken auflisten ──
    policies_list = await client.get(
        "/api/v1/iso/policies", headers=auth_headers
    )
    assert policies_list.status_code == 200

    # ── 5. EnMS-Rolle zuweisen ──
    role_resp = await client.post(
        "/api/v1/iso/roles",
        json={
            "role_name": "Energiebeauftragter",
            "person_name": "Max Mustermann",
            "email": "max.mustermann@example.com",
            "appointed_date": "2024-01-15",
            "appointed_by": "Geschäftsführer",
            "responsibilities": [
                "Überwachung des Energieverbrauchs",
                "Erstellung von Berichten",
                "Schulung der Mitarbeiter",
            ],
            "authorities": [
                "Budget für Energieeffizienzmaßnahmen",
                "Zugang zu allen Verbrauchsdaten",
            ],
        },
        headers=auth_headers,
    )
    assert role_resp.status_code == 201
    role = role_resp.json()
    role_id = role["id"]
    assert role["role_name"] == "Energiebeauftragter"

    # ── 6. Zweite Rolle: Energieteam-Mitglied ──
    role2_resp = await client.post(
        "/api/v1/iso/roles",
        json={
            "role_name": "Energieteam-Mitglied",
            "person_name": "Anna Schmidt",
            "appointed_date": "2024-02-01",
            "appointed_by": "Energiebeauftragter",
            "responsibilities": ["Datenerfassung", "Vor-Ort-Kontrollen"],
            "authorities": ["Lesezugriff auf Verbrauchsdaten"],
        },
        headers=auth_headers,
    )
    assert role2_resp.status_code == 201

    # ── 7. Rollen auflisten ──
    roles_list = await client.get("/api/v1/iso/roles", headers=auth_headers)
    assert roles_list.status_code == 200

    # ── 8. Energieziel erstellen ──
    obj_resp = await client.post(
        "/api/v1/iso/objectives",
        json={
            "title": "10% Stromverbrauchsreduktion bis 2025",
            "description": "Reduktion des Gesamtstromverbrauchs um 10% "
                          "gegenüber dem Basisjahr 2023",
            "target_type": "reduction",
            "target_value": 90.0,
            "target_unit": "MWh",
            "baseline_value": 100.0,
            "baseline_period": "2023",
            "target_date": "2025-12-31",
            "responsible_person": "Max Mustermann",
            "status": "in_progress",
        },
        headers=auth_headers,
    )
    assert obj_resp.status_code == 201
    objective = obj_resp.json()
    objective_id = objective["id"]
    assert objective["title"] == "10% Stromverbrauchsreduktion bis 2025"

    # ── 9. Zweites Ziel ──
    obj2_resp = await client.post(
        "/api/v1/iso/objectives",
        json={
            "title": "LED-Umrüstung aller Standorte",
            "target_type": "implementation",
            "target_value": 100.0,
            "target_unit": "%",
            "baseline_value": 30.0,
            "baseline_period": "2023",
            "target_date": "2025-06-30",
            "responsible_person": "Anna Schmidt",
        },
        headers=auth_headers,
    )
    assert obj2_resp.status_code == 201

    # ── 10. Ziele auflisten ──
    objs_list = await client.get(
        "/api/v1/iso/objectives", headers=auth_headers
    )
    assert objs_list.status_code == 200

    # ── 11. Risiko erstellen ──
    risk_resp = await client.post(
        "/api/v1/iso/risks",
        json={
            "title": "Strompreisanstieg über 40 ct/kWh",
            "type": "risk",
            "description": "Steigende Energiekosten belasten das Budget "
                          "und gefährden die Wirtschaftlichkeit",
            "category": "financial",
            "likelihood": 4,
            "impact": 3,
            "mitigation": "Langfristige Lieferverträge, Eigenstromerzeugung",
        },
        headers=auth_headers,
    )
    assert risk_resp.status_code == 201
    risk = risk_resp.json()
    assert risk["risk_score"] == 12  # 4 × 3

    # ── 12. Chance erstellen ──
    opp_resp = await client.post(
        "/api/v1/iso/risks",
        json={
            "title": "PV-Anlage auf Produktionshalle",
            "type": "opportunity",
            "description": "500 kWp Dachanlage ermöglicht signifikante "
                          "Eigenstromerzeugung",
            "category": "technical",
            "likelihood": 5,
            "impact": 4,
        },
        headers=auth_headers,
    )
    assert opp_resp.status_code == 201
    assert opp_resp.json()["risk_score"] == 20

    # ── 13. Risiken auflisten ──
    risks_list = await client.get("/api/v1/iso/risks", headers=auth_headers)
    assert risks_list.status_code == 200

    # ── 14. Rechtliche Anforderung erstellen ──
    legal_resp = await client.post(
        "/api/v1/iso/legal",
        json={
            "title": "Energieeffizienzgesetz (EnEfG)",
            "category": "law",
            "description": "Verpflichtung zur Einführung eines EnMS "
                          "für Unternehmen > 7,5 GWh/a",
            "relevance": "Direkt anwendbar – Unternehmen liegt über "
                        "der Schwelle von 7,5 GWh/a",
        },
        headers=auth_headers,
    )
    assert legal_resp.status_code == 201

    # ── 15. Zweite rechtliche Anforderung ──
    legal2_resp = await client.post(
        "/api/v1/iso/legal",
        json={
            "title": "EU Energy Efficiency Directive (EED)",
            "category": "regulation",
            "description": "EU-Richtlinie zur Energieeffizienz",
            "relevance": "Über nationales EnEfG umgesetzt",
        },
        headers=auth_headers,
    )
    assert legal2_resp.status_code == 201

    # ── 16. Rechtskataster auflisten ──
    legal_list = await client.get("/api/v1/iso/legal", headers=auth_headers)
    assert legal_list.status_code == 200

    # ── 17. Dokument erstellen ──
    doc_resp = await client.post(
        "/api/v1/iso/documents",
        json={
            "title": "Verfahrensanweisung Energiedatenerfassung",
            "document_type": "procedure",
            "category": "operations",
            "version": "1.0",
            "author": "Max Mustermann",
        },
        headers=auth_headers,
    )
    assert doc_resp.status_code == 201
    doc = doc_resp.json()
    doc_id = doc["id"]

    # ── 18. Zweites Dokument ──
    doc2_resp = await client.post(
        "/api/v1/iso/documents",
        json={
            "title": "Arbeitsanweisung Zählerablesung",
            "document_type": "work_instruction",
            "category": "operations",
            "author": "Anna Schmidt",
        },
        headers=auth_headers,
    )
    assert doc2_resp.status_code == 201

    # ── 19. Dokumente auflisten ──
    docs_list = await client.get(
        "/api/v1/iso/documents", headers=auth_headers
    )
    assert docs_list.status_code == 200

    # ── 20. Fällige Dokument-Reviews abrufen ──
    review_due = await client.get(
        "/api/v1/iso/documents/review-due?days=365",
        headers=auth_headers,
    )
    assert review_due.status_code == 200

    # ── 21. Audit erstellen ──
    audit_resp = await client.post(
        "/api/v1/iso/audits",
        json={
            "title": "Internes Audit Q1/2024",
            "audit_type": "internal",
            "scope": "Energiedatenerfassung und -auswertung",
            "planned_date": "2024-03-15",
            "lead_auditor": "Externe Auditfirma GmbH",
        },
        headers=auth_headers,
    )
    assert audit_resp.status_code == 201
    audit = audit_resp.json()
    audit_id = audit["id"]

    # ── 22. Audit-Checkliste abrufen ──
    checklist_resp = await client.get(
        "/api/v1/iso/audits/checklist", headers=auth_headers
    )
    assert checklist_resp.status_code == 200
    checklist = checklist_resp.json()
    assert len(checklist) == 20  # ISO 50001 hat 20 Klauseln

    # ── 23. Audits auflisten ──
    audits_list = await client.get("/api/v1/iso/audits", headers=auth_headers)
    assert audits_list.status_code == 200

    # ── 24. Nichtkonformität erstellen ──
    nc_resp = await client.post(
        "/api/v1/iso/nonconformities",
        json={
            "title": "Fehlende Kalibrierung Stromzähler Halle B",
            "source": "internal_audit",
            "description": "Bei der internen Begehung wurde festgestellt, "
                          "dass der Stromzähler in Halle B seit 18 Monaten "
                          "nicht kalibriert wurde.",
            "responsible_person": "Max Mustermann",
            "due_date": "2024-06-30",
        },
        headers=auth_headers,
    )
    assert nc_resp.status_code == 201
    nc = nc_resp.json()
    nc_id = nc["id"]

    # ── 25. Nichtkonformitäten auflisten ──
    nc_list = await client.get(
        "/api/v1/iso/nonconformities", headers=auth_headers
    )
    assert nc_list.status_code == 200

    # ── 26. Management Review Prefill abrufen ──
    prefill_resp = await client.get(
        "/api/v1/iso/reviews/prefill"
        "?period_start=2024-01-01&period_end=2024-12-31",
        headers=auth_headers,
    )
    assert prefill_resp.status_code == 200
    prefill = prefill_resp.json()
    # Prefill sollte aggregierte Daten enthalten
    assert isinstance(prefill, dict)


@pytest.mark.asyncio
async def test_iso_objective_update_workflow(client: AsyncClient, auth_headers: dict):
    """Energieziel: Erstellen → Fortschritt aktualisieren → Abschließen."""

    # Ziel erstellen
    create_resp = await client.post(
        "/api/v1/iso/objectives",
        json={
            "title": "Druckluft-Leckage reduzieren",
            "target_type": "reduction",
            "target_value": 20.0,
            "target_unit": "%",
            "baseline_value": 100.0,
            "baseline_period": "2024-Q1",
            "target_date": "2024-12-31",
            "responsible_person": "Techniker Müller",
        },
        headers=auth_headers,
    )
    assert create_resp.status_code == 201
    obj_id = create_resp.json()["id"]

    # Ziel aktualisieren (Fortschritt)
    update_resp = await client.put(
        f"/api/v1/iso/objectives/{obj_id}",
        json={
            "current_value": 85.0,
            "status": "in_progress",
        },
        headers=auth_headers,
    )
    assert update_resp.status_code == 200

    # Ziel abschließen
    close_resp = await client.put(
        f"/api/v1/iso/objectives/{obj_id}",
        json={
            "current_value": 78.0,
            "status": "achieved",
        },
        headers=auth_headers,
    )
    assert close_resp.status_code == 200
    assert close_resp.json()["status"] == "achieved"


@pytest.mark.asyncio
async def test_iso_risk_matrix(client: AsyncClient, auth_headers: dict):
    """Risikomatrix: Verschiedene Likelihood/Impact-Kombinationen."""
    risks = [
        {"title": "Niedrig-Niedrig", "likelihood": 1, "impact": 1, "expected_score": 1},
        {"title": "Hoch-Hoch", "likelihood": 5, "impact": 5, "expected_score": 25},
        {"title": "Mittel", "likelihood": 3, "impact": 3, "expected_score": 9},
    ]
    for r in risks:
        resp = await client.post(
            "/api/v1/iso/risks",
            json={
                "title": r["title"],
                "type": "risk",
                "description": f"Testrisiko {r['title']}",
                "category": "operational",
                "likelihood": r["likelihood"],
                "impact": r["impact"],
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        assert resp.json()["risk_score"] == r["expected_score"]
