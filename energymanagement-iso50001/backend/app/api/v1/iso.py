"""
iso.py – Endpunkte für das ISO 50001 Management-Modul.

Enthält alle CRUD-Endpunkte für: Kontext, Energiepolitik, Rollen,
Ziele, Aktionspläne, Risiken, Dokumente, Rechtskataster, Audits,
Managementbewertung und Nichtkonformitäten.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.user import User
from app.schemas.common import DeleteResponse, PaginatedResponse
from app.schemas.iso import (
    ActionPlanCreate,
    ActionPlanResponse,
    ActionPlanUpdate,
    AuditFindingCreate,
    AuditFindingResponse,
    AuditFindingUpdate,
    DocumentCreate,
    DocumentResponse,
    DocumentRevisionResponse,
    DocumentUpdate,
    EnergyObjectiveCreate,
    EnergyObjectiveResponse,
    EnergyObjectiveUpdate,
    EnergyPolicyCreate,
    EnergyPolicyResponse,
    EnergyPolicyUpdate,
    EnMSRoleCreate,
    EnMSRoleResponse,
    EnMSRoleUpdate,
    InternalAuditCreate,
    InternalAuditResponse,
    InternalAuditUpdate,
    LegalRequirementCreate,
    LegalRequirementResponse,
    LegalRequirementUpdate,
    ManagementReviewCreate,
    ManagementReviewResponse,
    ManagementReviewUpdate,
    NonconformityCreate,
    NonconformityResponse,
    NonconformityUpdate,
    OrganizationContextResponse,
    OrganizationContextUpdate,
    RiskOpportunityCreate,
    RiskOpportunityResponse,
    RiskOpportunityUpdate,
)
from app.services.iso_service import ISOService

router = APIRouter()


# ---------------------------------------------------------------------------
# Kontext der Organisation (Kap. 4)
# ---------------------------------------------------------------------------

@router.get("/context", response_model=OrganizationContextResponse | None)
async def get_context(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Aktuellen Organisationskontext abrufen."""
    service = ISOService(db)
    return await service.get_context()


@router.put("/context", response_model=OrganizationContextResponse)
async def update_context(
    request: OrganizationContextUpdate,
    current_user: User = Depends(require_permission("iso", "manage_context")),
    db: AsyncSession = Depends(get_db),
):
    """Organisationskontext aktualisieren."""
    service = ISOService(db)
    return await service.update_context(request.model_dump(exclude_unset=True))


# ---------------------------------------------------------------------------
# Energiepolitik (Kap. 5.2)
# ---------------------------------------------------------------------------

@router.get("/policies", response_model=list[EnergyPolicyResponse])
async def list_policies(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle Energiepolitiken auflisten."""
    service = ISOService(db)
    return await service.list_policies()


@router.post("/policies", response_model=EnergyPolicyResponse, status_code=201)
async def create_policy(
    request: EnergyPolicyCreate,
    current_user: User = Depends(require_permission("iso", "manage_policy")),
    db: AsyncSession = Depends(get_db),
):
    """Neue Energiepolitik anlegen."""
    service = ISOService(db)
    return await service.create_policy(request.model_dump())


@router.put("/policies/{policy_id}", response_model=EnergyPolicyResponse)
async def update_policy(
    policy_id: uuid.UUID,
    request: EnergyPolicyUpdate,
    current_user: User = Depends(require_permission("iso", "manage_policy")),
    db: AsyncSession = Depends(get_db),
):
    """Energiepolitik aktualisieren."""
    service = ISOService(db)
    policy = await service.update_policy(policy_id, request.model_dump(exclude_unset=True))
    if not policy:
        raise HTTPException(status_code=404, detail="Energiepolitik nicht gefunden")
    return policy


# ---------------------------------------------------------------------------
# EnMS-Rollen (Kap. 5.3)
# ---------------------------------------------------------------------------

@router.get("/roles", response_model=list[EnMSRoleResponse])
async def list_enms_roles(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle EnMS-Rollen auflisten."""
    service = ISOService(db)
    return await service.list_enms_roles()


@router.post("/roles", response_model=EnMSRoleResponse, status_code=201)
async def create_enms_role(
    request: EnMSRoleCreate,
    current_user: User = Depends(require_permission("iso", "manage_roles")),
    db: AsyncSession = Depends(get_db),
):
    """Neue EnMS-Rolle anlegen."""
    service = ISOService(db)
    return await service.create_enms_role(request.model_dump())


@router.put("/roles/{role_id}", response_model=EnMSRoleResponse)
async def update_enms_role(
    role_id: uuid.UUID,
    request: EnMSRoleUpdate,
    current_user: User = Depends(require_permission("iso", "manage_roles")),
    db: AsyncSession = Depends(get_db),
):
    """EnMS-Rolle aktualisieren."""
    service = ISOService(db)
    role = await service.update_enms_role(role_id, request.model_dump(exclude_unset=True))
    if not role:
        raise HTTPException(status_code=404, detail="Rolle nicht gefunden")
    return role


@router.delete("/roles/{role_id}", response_model=DeleteResponse)
async def delete_enms_role(
    role_id: uuid.UUID,
    current_user: User = Depends(require_permission("iso", "manage_roles")),
    db: AsyncSession = Depends(get_db),
):
    """EnMS-Rolle löschen."""
    service = ISOService(db)
    deleted = await service.delete_enms_role(role_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Rolle nicht gefunden")
    return DeleteResponse(message="Rolle gelöscht")


# ---------------------------------------------------------------------------
# Energieziele (Kap. 6.2)
# ---------------------------------------------------------------------------

@router.get("/objectives", response_model=PaginatedResponse[EnergyObjectiveResponse])
async def list_objectives(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    status: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Energieziele auflisten."""
    service = ISOService(db)
    return await service.list_objectives(page=page, page_size=page_size, status=status)


@router.post("/objectives", response_model=EnergyObjectiveResponse, status_code=201)
async def create_objective(
    request: EnergyObjectiveCreate,
    current_user: User = Depends(require_permission("iso", "manage_objectives")),
    db: AsyncSession = Depends(get_db),
):
    """Neues Energieziel anlegen."""
    service = ISOService(db)
    return await service.create_objective(request.model_dump())


@router.put("/objectives/{objective_id}", response_model=EnergyObjectiveResponse)
async def update_objective(
    objective_id: uuid.UUID,
    request: EnergyObjectiveUpdate,
    current_user: User = Depends(require_permission("iso", "manage_objectives")),
    db: AsyncSession = Depends(get_db),
):
    """Energieziel aktualisieren."""
    service = ISOService(db)
    obj = await service.update_objective(objective_id, request.model_dump(exclude_unset=True))
    if not obj:
        raise HTTPException(status_code=404, detail="Energieziel nicht gefunden")
    return obj


# ---------------------------------------------------------------------------
# Aktionspläne (Kap. 6.2)
# ---------------------------------------------------------------------------

@router.get("/objectives/{objective_id}/actions", response_model=list[ActionPlanResponse])
async def list_action_plans(
    objective_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Aktionspläne eines Ziels auflisten."""
    service = ISOService(db)
    return await service.list_action_plans(objective_id)


@router.post(
    "/objectives/{objective_id}/actions",
    response_model=ActionPlanResponse,
    status_code=201,
)
async def create_action_plan(
    objective_id: uuid.UUID,
    request: ActionPlanCreate,
    current_user: User = Depends(require_permission("iso", "manage_objectives")),
    db: AsyncSession = Depends(get_db),
):
    """Neuen Aktionsplan anlegen."""
    service = ISOService(db)
    data = request.model_dump()
    data["objective_id"] = objective_id
    return await service.create_action_plan(data)


@router.put("/actions/{action_id}", response_model=ActionPlanResponse)
async def update_action_plan(
    action_id: uuid.UUID,
    request: ActionPlanUpdate,
    current_user: User = Depends(require_permission("iso", "manage_objectives")),
    db: AsyncSession = Depends(get_db),
):
    """Aktionsplan aktualisieren."""
    service = ISOService(db)
    plan = await service.update_action_plan(action_id, request.model_dump(exclude_unset=True))
    if not plan:
        raise HTTPException(status_code=404, detail="Aktionsplan nicht gefunden")
    return plan


# ---------------------------------------------------------------------------
# Risiken und Chancen (Kap. 6.1)
# ---------------------------------------------------------------------------

@router.get("/risks", response_model=PaginatedResponse[RiskOpportunityResponse])
async def list_risks(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    type: str | None = None,
    status: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Risiken und Chancen auflisten."""
    service = ISOService(db)
    return await service.list_risks(page=page, page_size=page_size, type=type, status=status)


@router.post("/risks", response_model=RiskOpportunityResponse, status_code=201)
async def create_risk(
    request: RiskOpportunityCreate,
    current_user: User = Depends(require_permission("iso", "manage_risks")),
    db: AsyncSession = Depends(get_db),
):
    """Neues Risiko/Chance anlegen."""
    service = ISOService(db)
    return await service.create_risk(request.model_dump())


@router.put("/risks/{risk_id}", response_model=RiskOpportunityResponse)
async def update_risk(
    risk_id: uuid.UUID,
    request: RiskOpportunityUpdate,
    current_user: User = Depends(require_permission("iso", "manage_risks")),
    db: AsyncSession = Depends(get_db),
):
    """Risiko/Chance aktualisieren."""
    service = ISOService(db)
    risk = await service.update_risk(risk_id, request.model_dump(exclude_unset=True))
    if not risk:
        raise HTTPException(status_code=404, detail="Risiko/Chance nicht gefunden")
    return risk


# ---------------------------------------------------------------------------
# Dokumentenlenkung (Kap. 7.5)
# ---------------------------------------------------------------------------

@router.get("/documents", response_model=PaginatedResponse[DocumentResponse])
async def list_documents(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    category: str | None = None,
    status: str | None = None,
    search: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Dokumente auflisten."""
    service = ISOService(db)
    return await service.list_documents(
        page=page, page_size=page_size, category=category, status=status, search=search
    )


@router.post("/documents", response_model=DocumentResponse, status_code=201)
async def create_document(
    request: DocumentCreate,
    current_user: User = Depends(require_permission("iso", "manage_documents")),
    db: AsyncSession = Depends(get_db),
):
    """Neues Dokument anlegen."""
    service = ISOService(db)
    return await service.create_document(request.model_dump())


@router.put("/documents/{doc_id}", response_model=DocumentResponse)
async def update_document(
    doc_id: uuid.UUID,
    request: DocumentUpdate,
    current_user: User = Depends(require_permission("iso", "manage_documents")),
    db: AsyncSession = Depends(get_db),
):
    """Dokument aktualisieren."""
    service = ISOService(db)
    doc = await service.update_document(doc_id, request.model_dump(exclude_unset=True))
    if not doc:
        raise HTTPException(status_code=404, detail="Dokument nicht gefunden")
    return doc


@router.post("/documents/{doc_id}/upload")
async def upload_document_file(
    doc_id: uuid.UUID,
    file: UploadFile = File(...),
    current_user: User = Depends(require_permission("iso", "manage_documents")),
    db: AsyncSession = Depends(get_db),
):
    """Datei zu einem Dokument hochladen."""
    service = ISOService(db)
    content = await file.read()
    path = await service.upload_document_file(doc_id, file.filename or "upload", content)
    if not path:
        raise HTTPException(status_code=404, detail="Dokument nicht gefunden")
    return {"message": "Datei hochgeladen", "file_path": path}


@router.get("/documents/{doc_id}/revisions", response_model=list[DocumentRevisionResponse])
async def list_revisions(
    doc_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Revisionshistorie eines Dokuments abrufen."""
    service = ISOService(db)
    return await service.list_revisions(doc_id)


@router.get("/documents/review-due", response_model=list[DocumentResponse])
async def get_documents_review_due(
    days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Dokumente mit fälliger oder bald fälliger Überprüfung."""
    service = ISOService(db)
    return await service.get_documents_review_due(days=days)


# ---------------------------------------------------------------------------
# Rechtskataster (Kap. 9.1.2)
# ---------------------------------------------------------------------------

@router.get("/legal", response_model=PaginatedResponse[LegalRequirementResponse])
async def list_legal_requirements(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    category: str | None = None,
    compliance_status: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Rechtsanforderungen auflisten."""
    service = ISOService(db)
    return await service.list_legal_requirements(
        page=page, page_size=page_size, category=category, compliance_status=compliance_status
    )


@router.post("/legal", response_model=LegalRequirementResponse, status_code=201)
async def create_legal_requirement(
    request: LegalRequirementCreate,
    current_user: User = Depends(require_permission("iso", "manage_legal")),
    db: AsyncSession = Depends(get_db),
):
    """Neue Rechtsanforderung anlegen."""
    service = ISOService(db)
    return await service.create_legal_requirement(request.model_dump())


@router.put("/legal/{req_id}", response_model=LegalRequirementResponse)
async def update_legal_requirement(
    req_id: uuid.UUID,
    request: LegalRequirementUpdate,
    current_user: User = Depends(require_permission("iso", "manage_legal")),
    db: AsyncSession = Depends(get_db),
):
    """Rechtsanforderung aktualisieren."""
    service = ISOService(db)
    req = await service.update_legal_requirement(req_id, request.model_dump(exclude_unset=True))
    if not req:
        raise HTTPException(status_code=404, detail="Rechtsanforderung nicht gefunden")
    return req


# ---------------------------------------------------------------------------
# Interne Audits (Kap. 9.2)
# ---------------------------------------------------------------------------

@router.get("/audits", response_model=PaginatedResponse[InternalAuditResponse])
async def list_audits(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    status: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Interne Audits auflisten."""
    service = ISOService(db)
    return await service.list_audits(page=page, page_size=page_size, status=status)


@router.post("/audits", response_model=InternalAuditResponse, status_code=201)
async def create_audit(
    request: InternalAuditCreate,
    current_user: User = Depends(require_permission("iso", "manage_audits")),
    db: AsyncSession = Depends(get_db),
):
    """Neues internes Audit anlegen."""
    service = ISOService(db)
    return await service.create_audit(request.model_dump())


@router.put("/audits/{audit_id}", response_model=InternalAuditResponse)
async def update_audit(
    audit_id: uuid.UUID,
    request: InternalAuditUpdate,
    current_user: User = Depends(require_permission("iso", "manage_audits")),
    db: AsyncSession = Depends(get_db),
):
    """Audit aktualisieren."""
    service = ISOService(db)
    audit = await service.update_audit(audit_id, request.model_dump(exclude_unset=True))
    if not audit:
        raise HTTPException(status_code=404, detail="Audit nicht gefunden")
    return audit


@router.get("/audits/{audit_id}/findings", response_model=list[AuditFindingResponse])
async def list_findings(
    audit_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Audit-Befunde auflisten."""
    service = ISOService(db)
    return await service.list_findings(audit_id)


@router.post("/audits/{audit_id}/findings", response_model=AuditFindingResponse, status_code=201)
async def create_finding(
    audit_id: uuid.UUID,
    request: AuditFindingCreate,
    current_user: User = Depends(require_permission("iso", "manage_audits")),
    db: AsyncSession = Depends(get_db),
):
    """Neuen Audit-Befund anlegen."""
    service = ISOService(db)
    data = request.model_dump()
    data["audit_id"] = audit_id
    return await service.create_finding(data)


@router.put("/findings/{finding_id}", response_model=AuditFindingResponse)
async def update_finding(
    finding_id: uuid.UUID,
    request: AuditFindingUpdate,
    current_user: User = Depends(require_permission("iso", "manage_audits")),
    db: AsyncSession = Depends(get_db),
):
    """Audit-Befund aktualisieren."""
    service = ISOService(db)
    finding = await service.update_finding(finding_id, request.model_dump(exclude_unset=True))
    if not finding:
        raise HTTPException(status_code=404, detail="Befund nicht gefunden")
    return finding


@router.get("/audits/checklist")
async def get_audit_checklist(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """ISO 50001 Audit-Checkliste pro Normkapitel."""
    service = ISOService(db)
    return await service.get_audit_checklist()


@router.post(
    "/findings/{finding_id}/create-nc",
    response_model=NonconformityResponse,
    status_code=201,
)
async def create_nc_from_finding(
    finding_id: uuid.UUID,
    current_user: User = Depends(require_permission("iso", "manage_audits")),
    db: AsyncSession = Depends(get_db),
):
    """Nichtkonformität aus Audit-Befund erstellen (Workflow: Befund → NK)."""
    service = ISOService(db)
    nc = await service.create_nc_from_finding(finding_id)
    if not nc:
        raise HTTPException(status_code=404, detail="Befund nicht gefunden")
    return nc


@router.get("/findings/{finding_id}/suggest-objective")
async def suggest_objective_from_finding(
    finding_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Energieziel + Aktionsplan aus Audit-Befund vorschlagen.

    Gibt vorausgefüllte Entwürfe zurück (kein automatisches Erstellen).
    Der Nutzer prüft die Daten und sendet sie über die regulären
    Endpunkte /objectives und /action-plans ab.
    """
    service = ISOService(db)
    suggestion = await service.suggest_objective_from_finding(finding_id)
    if not suggestion:
        raise HTTPException(status_code=404, detail="Befund nicht gefunden")
    return suggestion


@router.post(
    "/nonconformities/{nc_id}/create-action-plan",
    response_model=ActionPlanResponse,
    status_code=201,
)
async def create_action_plan_from_nc(
    nc_id: uuid.UUID,
    objective_id: uuid.UUID = Query(...),
    current_user: User = Depends(
        require_permission("iso", "manage_nonconformities")
    ),
    db: AsyncSession = Depends(get_db),
):
    """Aktionsplan aus NK erstellen (Workflow: NK → Aktionsplan → Ziel)."""
    service = ISOService(db)
    plan = await service.create_action_plan_from_nc(nc_id, objective_id)
    if not plan:
        raise HTTPException(
            status_code=404, detail="Nichtkonformität nicht gefunden"
        )
    return plan


# ---------------------------------------------------------------------------
# Managementbewertung (Kap. 9.3)
# ---------------------------------------------------------------------------

@router.get("/reviews", response_model=PaginatedResponse[ManagementReviewResponse])
async def list_reviews(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Managementbewertungen auflisten."""
    service = ISOService(db)
    return await service.list_reviews(page=page, page_size=page_size)


@router.post("/reviews", response_model=ManagementReviewResponse, status_code=201)
async def create_review(
    request: ManagementReviewCreate,
    current_user: User = Depends(require_permission("iso", "manage_reviews")),
    db: AsyncSession = Depends(get_db),
):
    """Neue Managementbewertung anlegen."""
    service = ISOService(db)
    return await service.create_review(request.model_dump())


@router.put("/reviews/{review_id}", response_model=ManagementReviewResponse)
async def update_review(
    review_id: uuid.UUID,
    request: ManagementReviewUpdate,
    current_user: User = Depends(require_permission("iso", "manage_reviews")),
    db: AsyncSession = Depends(get_db),
):
    """Managementbewertung aktualisieren."""
    service = ISOService(db)
    review = await service.update_review(review_id, request.model_dump(exclude_unset=True))
    if not review:
        raise HTTPException(status_code=404, detail="Managementbewertung nicht gefunden")
    return review


@router.get("/reviews/prefill")
async def prefill_review(
    period_start: date = Query(...),
    period_end: date = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Auto-vorausgefüllten Management-Review-Entwurf generieren.

    Sammelt Daten aus dem angegebenen Zeitraum: Zielstatus, Audit-Ergebnisse,
    offene Nichtkonformitäten, Compliance-Status, Energiepolitik-Bewertung.
    """
    service = ISOService(db)
    return await service.prefill_review(period_start, period_end)


# ---------------------------------------------------------------------------
# Nichtkonformitäten (Kap. 10.1)
# ---------------------------------------------------------------------------

@router.get("/nonconformities", response_model=PaginatedResponse[NonconformityResponse])
async def list_nonconformities(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    status: str | None = None,
    source: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Nichtkonformitäten auflisten."""
    service = ISOService(db)
    return await service.list_nonconformities(
        page=page, page_size=page_size, status=status, source=source
    )


@router.post("/nonconformities", response_model=NonconformityResponse, status_code=201)
async def create_nonconformity(
    request: NonconformityCreate,
    current_user: User = Depends(require_permission("iso", "manage_nonconformities")),
    db: AsyncSession = Depends(get_db),
):
    """Neue Nichtkonformität anlegen."""
    service = ISOService(db)
    return await service.create_nonconformity(request.model_dump())


@router.put("/nonconformities/{nc_id}", response_model=NonconformityResponse)
async def update_nonconformity(
    nc_id: uuid.UUID,
    request: NonconformityUpdate,
    current_user: User = Depends(require_permission("iso", "manage_nonconformities")),
    db: AsyncSession = Depends(get_db),
):
    """Nichtkonformität aktualisieren."""
    service = ISOService(db)
    nc = await service.update_nonconformity(nc_id, request.model_dump(exclude_unset=True))
    if not nc:
        raise HTTPException(status_code=404, detail="Nichtkonformität nicht gefunden")
    return nc
