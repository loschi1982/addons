"""
iso.py – Schemas für das ISO 50001 Management-Modul.

Enthält Schemas für alle organisatorischen Anforderungen der
ISO 50001:2018: Kontext, Energiepolitik, Ziele, Aktionspläne,
Risiken, Audits, Managementbewertung und Nichtkonformitäten.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.common import BaseSchema


# ---------------------------------------------------------------------------
# Kontext der Organisation (Kap. 4)
# ---------------------------------------------------------------------------

class OrganizationContextCreate(BaseModel):
    scope_description: str
    scope_boundaries: dict | None = None
    internal_issues: list = []
    external_issues: list = []
    interested_parties: list = []
    energy_types_excluded: list | None = None
    last_reviewed: date


class OrganizationContextUpdate(BaseModel):
    scope_description: str | None = None
    scope_boundaries: dict | None = None
    internal_issues: list | None = None
    external_issues: list | None = None
    interested_parties: list | None = None
    energy_types_excluded: list | None = None
    last_reviewed: date | None = None


class OrganizationContextResponse(BaseSchema):
    id: uuid.UUID
    scope_description: str
    scope_boundaries: dict | None
    internal_issues: list
    external_issues: list
    interested_parties: list
    energy_types_excluded: list | None
    last_reviewed: date
    version: int


# ---------------------------------------------------------------------------
# Energiepolitik (Kap. 5.2)
# ---------------------------------------------------------------------------

class EnergyPolicyCreate(BaseModel):
    title: str = Field(..., max_length=255)
    content: str
    approved_by: str = Field(..., max_length=255)
    approved_date: date
    valid_from: date
    valid_to: date | None = None
    is_current: bool = True


class EnergyPolicyUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    approved_by: str | None = None
    valid_to: date | None = None
    is_current: bool | None = None


class EnergyPolicyResponse(BaseSchema):
    id: uuid.UUID
    title: str
    content: str
    approved_by: str
    approved_date: date
    valid_from: date
    valid_to: date | None
    is_current: bool
    pdf_path: str | None
    version: int


# ---------------------------------------------------------------------------
# EnMS-Rollen (Kap. 5.3)
# ---------------------------------------------------------------------------

class EnMSRoleCreate(BaseModel):
    role_name: str = Field(..., max_length=255)
    person_name: str = Field(..., max_length=255)
    department: str | None = None
    responsibilities: list = []
    authorities: list = []
    appointed_date: date
    appointed_by: str = Field(..., max_length=255)


class EnMSRoleUpdate(BaseModel):
    role_name: str | None = None
    person_name: str | None = None
    department: str | None = None
    responsibilities: list | None = None
    authorities: list | None = None
    is_active: bool | None = None


class EnMSRoleResponse(BaseSchema):
    id: uuid.UUID
    role_name: str
    person_name: str
    department: str | None
    responsibilities: list
    authorities: list
    appointed_date: date
    appointed_by: str
    is_active: bool


# ---------------------------------------------------------------------------
# Energieziele (Kap. 6.2)
# ---------------------------------------------------------------------------

class EnergyObjectiveCreate(BaseModel):
    title: str = Field(..., max_length=500)
    description: str | None = None
    target_type: str = Field(..., max_length=50)
    target_value: Decimal
    target_unit: str = Field(..., max_length=50)
    baseline_value: Decimal
    baseline_period: str = Field(..., max_length=50)
    target_date: date
    responsible_person: str = Field(..., max_length=255)
    related_meter_ids: list[uuid.UUID] | None = None


class EnergyObjectiveUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    target_value: Decimal | None = None
    target_date: date | None = None
    responsible_person: str | None = None
    status: str | None = None
    current_value: Decimal | None = None
    progress_percent: Decimal | None = None
    related_meter_ids: list[uuid.UUID] | None = None


class EnergyObjectiveResponse(BaseSchema):
    id: uuid.UUID
    title: str
    description: str | None
    target_type: str
    target_value: Decimal
    target_unit: str
    baseline_value: Decimal
    baseline_period: str
    target_date: date
    responsible_person: str
    status: str
    current_value: Decimal | None
    progress_percent: Decimal | None
    related_meter_ids: list[uuid.UUID] | None
    created_at: datetime
    updated_at: datetime | None


# ---------------------------------------------------------------------------
# Aktionspläne (Kap. 6.2)
# ---------------------------------------------------------------------------

class ActionPlanCreate(BaseModel):
    objective_id: uuid.UUID
    title: str = Field(..., max_length=500)
    description: str | None = None
    responsible_person: str = Field(..., max_length=255)
    resources_required: str | None = None
    investment_cost: Decimal | None = None
    expected_savings_kwh: Decimal | None = None
    expected_savings_eur: Decimal | None = None
    expected_savings_co2_kg: Decimal | None = None
    start_date: date
    target_date: date
    verification_method: str | None = None


class ActionPlanUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    responsible_person: str | None = None
    resources_required: str | None = None
    investment_cost: Decimal | None = None
    expected_savings_kwh: Decimal | None = None
    expected_savings_eur: Decimal | None = None
    expected_savings_co2_kg: Decimal | None = None
    target_date: date | None = None
    completion_date: date | None = None
    status: str | None = None
    actual_savings_kwh: Decimal | None = None
    notes: str | None = None


class ActionPlanResponse(BaseSchema):
    id: uuid.UUID
    objective_id: uuid.UUID
    title: str
    description: str | None
    responsible_person: str
    resources_required: str | None
    investment_cost: Decimal | None
    expected_savings_kwh: Decimal | None
    expected_savings_eur: Decimal | None
    expected_savings_co2_kg: Decimal | None
    start_date: date
    target_date: date
    completion_date: date | None
    status: str
    verification_method: str | None
    actual_savings_kwh: Decimal | None
    notes: str | None
    created_at: datetime


# ---------------------------------------------------------------------------
# Risiken und Chancen (Kap. 6.1)
# ---------------------------------------------------------------------------

class RiskOpportunityCreate(BaseModel):
    type: str = Field(..., pattern="^(risk|opportunity)$")
    title: str = Field(..., max_length=500)
    description: str
    category: str = Field(..., max_length=100)
    likelihood: int = Field(..., ge=1, le=5)
    impact: int = Field(..., ge=1, le=5)
    mitigation_action: str | None = None
    responsible_person: str | None = None
    review_date: date | None = None


class RiskOpportunityUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    category: str | None = None
    likelihood: int | None = None
    impact: int | None = None
    mitigation_action: str | None = None
    responsible_person: str | None = None
    status: str | None = None
    review_date: date | None = None


class RiskOpportunityResponse(BaseSchema):
    id: uuid.UUID
    type: str
    title: str
    description: str
    category: str
    likelihood: int
    impact: int
    risk_score: int
    mitigation_action: str | None
    responsible_person: str | None
    status: str
    review_date: date | None
    created_at: datetime


# ---------------------------------------------------------------------------
# Dokumentenlenkung (Kap. 7.5)
# ---------------------------------------------------------------------------

class DocumentCreate(BaseModel):
    title: str = Field(..., max_length=500)
    document_type: str = Field(..., max_length=50)
    category: str = Field(..., max_length=100)
    description: str | None = None
    author: str = Field(..., max_length=255)
    iso_clause_reference: str | None = None
    tags: list[str] | None = None
    review_due_date: date | None = None
    retention_period_months: int | None = None


class DocumentUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    approved_by: str | None = None
    approved_date: date | None = None
    review_due_date: date | None = None
    tags: list[str] | None = None


class DocumentResponse(BaseSchema):
    id: uuid.UUID
    title: str
    document_type: str
    category: str
    description: str | None
    file_path: str | None
    file_type: str | None
    version: str
    status: str
    author: str
    approved_by: str | None
    approved_date: date | None
    review_due_date: date | None
    iso_clause_reference: str | None
    tags: list[str] | None
    created_at: datetime


class DocumentRevisionResponse(BaseSchema):
    id: uuid.UUID
    document_id: uuid.UUID
    version: str
    change_description: str
    changed_by: str
    changed_at: datetime
    file_path: str | None


# ---------------------------------------------------------------------------
# Rechtskataster (Kap. 9.1.2)
# ---------------------------------------------------------------------------

class LegalRequirementCreate(BaseModel):
    title: str = Field(..., max_length=500)
    category: str = Field(..., max_length=50)
    jurisdiction: str = Field("DE", max_length=50)
    description: str
    relevance: str
    responsible_person: str | None = None
    next_review_date: date | None = None
    source_url: str | None = None


class LegalRequirementUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    relevance: str | None = None
    compliance_status: str | None = None
    responsible_person: str | None = None
    last_assessment_date: date | None = None
    next_review_date: date | None = None
    notes: str | None = None
    is_active: bool | None = None


class LegalRequirementResponse(BaseSchema):
    id: uuid.UUID
    title: str
    category: str
    jurisdiction: str
    description: str
    relevance: str
    compliance_status: str
    responsible_person: str | None
    last_assessment_date: date | None
    next_review_date: date | None
    source_url: str | None
    notes: str | None
    is_active: bool
    created_at: datetime


# ---------------------------------------------------------------------------
# Internes Audit (Kap. 9.2)
# ---------------------------------------------------------------------------

class InternalAuditCreate(BaseModel):
    title: str = Field(..., max_length=500)
    audit_type: str = Field(..., max_length=50)
    scope: str
    planned_date: date
    lead_auditor: str = Field(..., max_length=255)
    audit_team: list[str] | None = None


class InternalAuditUpdate(BaseModel):
    title: str | None = None
    scope: str | None = None
    planned_date: date | None = None
    actual_date: date | None = None
    lead_auditor: str | None = None
    audit_team: list[str] | None = None
    status: str | None = None
    overall_result: str | None = None


class InternalAuditResponse(BaseSchema):
    id: uuid.UUID
    title: str
    audit_type: str
    scope: str
    planned_date: date
    actual_date: date | None
    lead_auditor: str
    audit_team: list[str] | None
    status: str
    overall_result: str | None
    created_at: datetime


class AuditFindingCreate(BaseModel):
    audit_id: uuid.UUID
    finding_type: str = Field(..., max_length=50)
    iso_clause: str = Field(..., max_length=20)
    description: str
    evidence: str | None = None
    corrective_action: str | None = None
    responsible_person: str | None = None
    due_date: date | None = None


class AuditFindingUpdate(BaseModel):
    corrective_action: str | None = None
    responsible_person: str | None = None
    due_date: date | None = None
    completion_date: date | None = None
    verification_result: str | None = None
    status: str | None = None


class AuditFindingResponse(BaseSchema):
    id: uuid.UUID
    audit_id: uuid.UUID
    finding_type: str
    iso_clause: str
    description: str
    evidence: str | None
    corrective_action: str | None
    responsible_person: str | None
    due_date: date | None
    completion_date: date | None
    verification_result: str | None
    status: str


# ---------------------------------------------------------------------------
# Managementbewertung (Kap. 9.3)
# ---------------------------------------------------------------------------

class ManagementReviewCreate(BaseModel):
    title: str = Field(..., max_length=500)
    review_date: date
    participants: list[str] = []
    period_start: date
    period_end: date


class ManagementReviewUpdate(BaseModel):
    title: str | None = None
    review_date: date | None = None
    participants: list[str] | None = None
    previous_review_actions: str | None = None
    energy_policy_adequacy: str | None = None
    enpi_performance: str | None = None
    compliance_status: str | None = None
    audit_results_summary: str | None = None
    nonconformities_summary: str | None = None
    external_changes: str | None = None
    resource_adequacy: str | None = None
    improvement_opportunities: str | None = None
    decisions: list[dict] | None = None
    action_items: list[dict] | None = None
    policy_changes_needed: bool | None = None
    resource_changes_needed: str | None = None
    next_review_date: date | None = None
    status: str | None = None
    protocol_document_id: uuid.UUID | None = None


class ManagementReviewResponse(BaseSchema):
    id: uuid.UUID
    title: str
    review_date: date
    participants: list[str]
    period_start: date
    period_end: date
    status: str
    decisions: list[dict] | None
    action_items: list[dict] | None
    policy_changes_needed: bool
    next_review_date: date | None
    protocol_document_id: uuid.UUID | None
    created_at: datetime


# ---------------------------------------------------------------------------
# Nichtkonformitäten (Kap. 10.1)
# ---------------------------------------------------------------------------

class NonconformityCreate(BaseModel):
    title: str = Field(..., max_length=500)
    source: str = Field(..., max_length=50)
    source_reference_id: uuid.UUID | None = None
    description: str
    responsible_person: str = Field(..., max_length=255)
    due_date: date
    immediate_action: str | None = None


class NonconformityUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    root_cause: str | None = None
    immediate_action: str | None = None
    corrective_action: str | None = None
    responsible_person: str | None = None
    due_date: date | None = None
    completion_date: date | None = None
    effectiveness_verified: bool | None = None
    verification_date: date | None = None
    verification_notes: str | None = None
    status: str | None = None


class NonconformityResponse(BaseSchema):
    id: uuid.UUID
    title: str
    source: str
    source_reference_id: uuid.UUID | None
    description: str
    root_cause: str | None
    immediate_action: str | None
    corrective_action: str | None
    responsible_person: str
    due_date: date
    completion_date: date | None
    effectiveness_verified: bool
    verification_date: date | None
    verification_notes: str | None
    status: str
    created_at: datetime
