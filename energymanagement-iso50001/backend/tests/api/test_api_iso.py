"""
test_api_iso.py – API-Tests für ISO 50001 Endpunkte.
"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_iso_context_unauthorized(client: AsyncClient):
    """ISO Kontext ohne Auth → 401."""
    response = await client.get("/api/v1/iso/context")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_create_context(client: AsyncClient, auth_headers: dict):
    """Kontext erstellen/aktualisieren via PUT → 200."""
    response = await client.put(
        "/api/v1/iso/context",
        json={
            "scope_description": "Alle Standorte",
        },
        headers=auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["scope_description"] == "Alle Standorte"


@pytest.mark.asyncio
async def test_list_contexts(client: AsyncClient, auth_headers: dict):
    """Kontexte auflisten → 200."""
    response = await client.get("/api/v1/iso/context", headers=auth_headers)
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_create_policy(client: AsyncClient, auth_headers: dict):
    """Energiepolitik erstellen → 201."""
    response = await client.post(
        "/api/v1/iso/policies",
        json={
            "title": "Energiepolitik 2024",
            "content": "Wir verpflichten uns zur kontinuierlichen Verbesserung.",
            "approved_by": "Geschäftsführer",
            "approved_date": "2024-01-01",
            "valid_from": "2024-01-01",
            "is_current": True,
        },
        headers=auth_headers,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Energiepolitik 2024"


@pytest.mark.asyncio
async def test_list_policies(client: AsyncClient, auth_headers: dict):
    """Policies auflisten → 200."""
    response = await client.get("/api/v1/iso/policies", headers=auth_headers)
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_create_role(client: AsyncClient, auth_headers: dict):
    """EnMS-Rolle erstellen → 201."""
    response = await client.post(
        "/api/v1/iso/roles",
        json={
            "role_name": "Energiebeauftragter",
            "person_name": "Max Mustermann",
            "appointed_date": "2024-01-01",
            "appointed_by": "Geschäftsführer",
            "responsibilities": ["Monitoring", "Reporting"],
            "authorities": ["Budget"],
        },
        headers=auth_headers,
    )
    assert response.status_code == 201


@pytest.mark.asyncio
async def test_create_objective(client: AsyncClient, auth_headers: dict):
    """Energieziel erstellen → 201."""
    response = await client.post(
        "/api/v1/iso/objectives",
        json={
            "title": "10% Stromreduktion",
            "target_type": "reduction",
            "target_value": 90.0,
            "target_unit": "MWh",
            "baseline_value": 100.0,
            "baseline_period": "2023",
            "target_date": "2025-12-31",
            "responsible_person": "Max Mustermann",
        },
        headers=auth_headers,
    )
    assert response.status_code == 201


@pytest.mark.asyncio
async def test_create_risk(client: AsyncClient, auth_headers: dict):
    """Risiko erstellen → 201 mit berechnetem Score."""
    response = await client.post(
        "/api/v1/iso/risks",
        json={
            "title": "Strompreisanstieg",
            "type": "risk",
            "description": "Steigende Strompreise belasten das Budget",
            "category": "financial",
            "likelihood": 4,
            "impact": 3,
        },
        headers=auth_headers,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["risk_score"] == 12


@pytest.mark.asyncio
async def test_list_risks(client: AsyncClient, auth_headers: dict):
    """Risiken auflisten → 200."""
    response = await client.get("/api/v1/iso/risks", headers=auth_headers)
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_create_document(client: AsyncClient, auth_headers: dict):
    """Dokument erstellen → 201."""
    response = await client.post(
        "/api/v1/iso/documents",
        json={
            "title": "Verfahrensanweisung Energiemessung",
            "document_type": "procedure",
            "category": "operations",
            "author": "Max Mustermann",
        },
        headers=auth_headers,
    )
    assert response.status_code == 201


@pytest.mark.asyncio
async def test_create_legal_requirement(client: AsyncClient, auth_headers: dict):
    """Rechtliche Anforderung erstellen → 201."""
    response = await client.post(
        "/api/v1/iso/legal",
        json={
            "title": "EnEfG",
            "category": "law",
            "description": "Energieeffizienzgesetz",
            "relevance": "Direkt anwendbar auf Unternehmen dieser Größe",
        },
        headers=auth_headers,
    )
    assert response.status_code == 201


@pytest.mark.asyncio
async def test_create_audit(client: AsyncClient, auth_headers: dict):
    """Audit erstellen → 201."""
    response = await client.post(
        "/api/v1/iso/audits",
        json={
            "title": "Internes Audit Q1",
            "audit_type": "internal",
            "scope": "Gesamte Organisation",
            "planned_date": "2024-03-15",
            "lead_auditor": "Max Mustermann",
        },
        headers=auth_headers,
    )
    assert response.status_code == 201


@pytest.mark.asyncio
async def test_get_checklist(client: AsyncClient, auth_headers: dict):
    """Audit-Checkliste → 200 mit 20 Klauseln."""
    response = await client.get(
        "/api/v1/iso/audits/checklist", headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 20


@pytest.mark.asyncio
async def test_create_nonconformity(client: AsyncClient, auth_headers: dict):
    """Nichtkonformität erstellen → 201."""
    response = await client.post(
        "/api/v1/iso/nonconformities",
        json={
            "title": "Fehlende Kalibrierung",
            "source": "internal",
            "description": "Zähler nicht kalibriert",
            "responsible_person": "Max Mustermann",
            "due_date": "2024-12-31",
        },
        headers=auth_headers,
    )
    assert response.status_code == 201


@pytest.mark.asyncio
async def test_documents_review_due(client: AsyncClient, auth_headers: dict):
    """Fällige Dokumenten-Reviews → 200."""
    response = await client.get(
        "/api/v1/iso/documents/review-due?days=30",
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.asyncio
async def test_prefill_review(client: AsyncClient, auth_headers: dict):
    """Management Review Prefill → 200."""
    response = await client.get(
        "/api/v1/iso/reviews/prefill?period_start=2024-01-01&period_end=2024-12-31",
        headers=auth_headers,
    )
    assert response.status_code == 200
