"""
test_iso_service.py – Integration-Tests für den ISO 50001 Service.

Testet CRUD-Operationen für alle ISO-Entitäten mit echter DB.
"""

from datetime import date

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.iso_service import ISOService


# ── Kontext ──

@pytest.mark.asyncio
async def test_create_context(db_session: AsyncSession):
    """Organisationskontext erstellen."""
    service = ISOService(db_session)
    ctx = await service.create_context({
        "scope_description": "Alle Standorte der Muster GmbH",
        "interested_parties": [
            {"name": "Geschäftsführung", "needs": "Kostenreduktion"}
        ],
    })
    assert ctx.id is not None
    assert ctx.scope_description == "Alle Standorte der Muster GmbH"


@pytest.mark.asyncio
async def test_get_context(db_session: AsyncSession):
    """Kontext erstellen und wieder abrufen."""
    service = ISOService(db_session)
    created = await service.create_context({
        "scope_description": "Test",
    })
    fetched = await service.get_context()
    assert fetched is not None
    assert fetched.scope_description == "Test"


@pytest.mark.asyncio
async def test_update_context(db_session: AsyncSession):
    """Kontext aktualisieren."""
    service = ISOService(db_session)
    ctx = await service.create_context({
        "scope_description": "Alt",
    })
    updated = await service.update_context({
        "scope_description": "Neu",
    })
    assert updated.scope_description == "Neu"


# ── Energiepolitik ──

@pytest.mark.asyncio
async def test_create_policy(db_session: AsyncSession):
    """Energiepolitik erstellen mit is_current."""
    service = ISOService(db_session)
    policy = await service.create_policy({
        "title": "Energiepolitik 2024",
        "content": "Wir verpflichten uns...",
        "approved_by": "Geschäftsführer",
        "approved_date": date(2024, 1, 1),
        "valid_from": date(2024, 1, 1),
        "version": 1,
        "is_current": True,
    })
    assert policy.is_current is True
    assert policy.version == 1


@pytest.mark.asyncio
async def test_only_one_current_policy(db_session: AsyncSession):
    """Nur eine Politik kann is_current=True sein."""
    service = ISOService(db_session)

    p1 = await service.create_policy({
        "title": "V1", "content": "...",
        "approved_by": "GF", "approved_date": date(2024, 1, 1),
        "valid_from": date(2024, 1, 1), "version": 1, "is_current": True,
    })
    p2 = await service.create_policy({
        "title": "V2", "content": "...",
        "approved_by": "GF", "approved_date": date(2024, 6, 1),
        "valid_from": date(2024, 6, 1), "version": 2, "is_current": True,
    })

    # P1 sollte jetzt is_current=False sein
    await db_session.refresh(p1)
    assert p1.is_current is False
    assert p2.is_current is True


# ── Rollen ──

@pytest.mark.asyncio
async def test_create_role(db_session: AsyncSession):
    """EnMS-Rolle erstellen."""
    service = ISOService(db_session)
    role = await service.create_enms_role({
        "role_name": "Energiemanager",
        "person_name": "Max Mustermann",
        "responsibilities": ["Energiepolitik umsetzen", "Berichte erstellen"],
        "authorities": ["Budget-Freigabe bis 5.000€"],
        "appointed_date": date(2024, 1, 1),
        "appointed_by": "Geschäftsführer",
    })
    assert role.role_name == "Energiemanager"
    assert len(role.responsibilities) == 2


# ── Energieziele & Aktionspläne ──

@pytest.mark.asyncio
async def test_create_objective(db_session: AsyncSession):
    """Energieziel erstellen."""
    service = ISOService(db_session)
    obj = await service.create_objective({
        "title": "Stromverbrauch senken",
        "description": "10% Reduktion bis 2025",
        "target_value": 90.0,
        "baseline_value": 100.0,
        "target_unit": "MWh",
        "target_type": "reduction",
        "baseline_period": "2023",
        "target_date": date(2025, 12, 31),
        "responsible_person": "Max Mustermann",
    })
    assert obj.title == "Stromverbrauch senken"
    assert obj.target_value == 90.0


@pytest.mark.asyncio
async def test_create_action_plan(db_session: AsyncSession):
    """Aktionsplan für ein Ziel erstellen."""
    service = ISOService(db_session)
    obj = await service.create_objective({
        "title": "Ziel", "target_value": 90.0,
        "baseline_value": 100.0, "target_unit": "MWh",
        "target_type": "reduction", "baseline_period": "2023",
        "target_date": date(2025, 12, 31),
        "responsible_person": "Max Mustermann",
    })
    plan = await service.create_action_plan({
        "objective_id": obj.id,
        "title": "LED-Umrüstung",
        "responsible_person": "Max Mustermann",
        "start_date": date(2025, 1, 1),
        "target_date": date(2025, 6, 30),
        "status": "planned",
    })
    assert plan.objective_id == obj.id
    assert plan.title == "LED-Umrüstung"


# ── Risiken ──

@pytest.mark.asyncio
async def test_create_risk_with_score(db_session: AsyncSession):
    """Risiko erstellen – Score wird automatisch berechnet."""
    service = ISOService(db_session)
    risk = await service.create_risk({
        "title": "Strompreisanstieg",
        "type": "risk",
        "description": "Steigende Strompreise belasten das Budget",
        "category": "financial",
        "likelihood": 4,
        "impact": 3,
    })
    assert risk.risk_score == 12  # 4 × 3


# ── Dokumente ──

@pytest.mark.asyncio
async def test_create_document(db_session: AsyncSession):
    """Dokument erstellen."""
    service = ISOService(db_session)
    doc = await service.create_document({
        "title": "Energiepolitik",
        "document_type": "policy",
        "category": "management",
        "author": "Max Mustermann",
        "status": "active",
    })
    assert doc.title == "Energiepolitik"


# ── Rechtskataster ──

@pytest.mark.asyncio
async def test_create_legal_requirement(db_session: AsyncSession):
    """Rechtliche Anforderung erstellen."""
    service = ISOService(db_session)
    req = await service.create_legal_requirement({
        "title": "EnEG",
        "category": "law",
        "jurisdiction": "federal",
        "description": "Energieeinsparungsgesetz",
        "relevance": "Direkt anwendbar",
        "compliance_status": "compliant",
    })
    assert req.title == "EnEG"
    assert req.compliance_status == "compliant"


# ── Audits & Befunde ──

@pytest.mark.asyncio
async def test_create_audit(db_session: AsyncSession):
    """Internes Audit erstellen."""
    service = ISOService(db_session)
    audit = await service.create_audit({
        "title": "Internes Audit Q1/2024",
        "audit_type": "internal",
        "scope": "Gesamte Organisation",
        "planned_date": date(2024, 3, 15),
        "lead_auditor": "Max Mustermann",
        "status": "planned",
    })
    assert audit.title == "Internes Audit Q1/2024"


@pytest.mark.asyncio
async def test_create_finding(db_session: AsyncSession):
    """Audit-Befund erstellen."""
    service = ISOService(db_session)
    audit = await service.create_audit({
        "title": "Audit", "audit_type": "internal",
        "scope": "Gesamte Organisation",
        "planned_date": date(2024, 3, 15),
        "lead_auditor": "Max Mustermann",
        "status": "in_progress",
    })
    finding = await service.create_finding({
        "audit_id": audit.id,
        "iso_clause": "6.2",
        "finding_type": "minor_nc",
        "description": "Energieziele nicht vollständig dokumentiert",
        "status": "open",
    })
    assert finding.audit_id == audit.id
    assert finding.finding_type == "minor_nc"


# ── Nichtkonformitäten ──

@pytest.mark.asyncio
async def test_create_nonconformity(db_session: AsyncSession):
    """Nichtkonformität erstellen."""
    service = ISOService(db_session)
    nc = await service.create_nonconformity({
        "title": "Fehlende Dokumentation",
        "source": "internal",
        "description": "Energiepolitik nicht aktuell",
        "responsible_person": "Max Mustermann",
        "due_date": date(2024, 12, 31),
        "status": "open",
    })
    assert nc.title == "Fehlende Dokumentation"
    assert nc.status == "open"


# ── Management Review ──

@pytest.mark.asyncio
async def test_create_review(db_session: AsyncSession):
    """Managementbewertung erstellen."""
    service = ISOService(db_session)
    review = await service.create_review({
        "title": "Managementbewertung 2024",
        "review_date": date(2024, 12, 15),
        "period_start": date(2024, 1, 1),
        "period_end": date(2024, 12, 31),
        "status": "draft",
    })
    assert review.title == "Managementbewertung 2024"


# ── Audit-Checkliste ──

@pytest.mark.asyncio
async def test_get_audit_checklist(db_session: AsyncSession):
    """Audit-Checkliste hat 20 Klauseln."""
    service = ISOService(db_session)
    checklist = await service.get_audit_checklist()
    assert len(checklist) == 20


# ── Dokument-Überprüfung ──

@pytest.mark.asyncio
async def test_get_documents_review_due(db_session: AsyncSession):
    """Dokumente mit fälliger Überprüfung abfragen."""
    service = ISOService(db_session)
    # Ohne Daten → leere Liste
    docs = await service.get_documents_review_due(30)
    assert isinstance(docs, list)
