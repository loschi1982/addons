"""
iso.py – ISO 50001 Management-Modelle.

Alle Modelle, die für die organisatorischen Anforderungen der
ISO 50001:2018 benötigt werden: Kontext, Energiepolitik, Ziele,
Risiken, Audits, Managementbewertung, Nichtkonformitäten und Dokumente.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class OrganizationContext(Base, UUIDMixin):
    """Kontext der Organisation (ISO 50001 Kap. 4)."""
    __tablename__ = "organization_context"

    scope_description: Mapped[str] = mapped_column(Text)
    scope_boundaries: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    internal_issues: Mapped[list] = mapped_column(JSON, default=list)
    external_issues: Mapped[list] = mapped_column(JSON, default=list)
    interested_parties: Mapped[list] = mapped_column(JSON, default=list)
    energy_types_excluded: Mapped[list | None] = mapped_column(JSON, nullable=True)
    last_reviewed: Mapped[date] = mapped_column(Date)
    version: Mapped[int] = mapped_column(Integer, default=1)


class EnergyPolicy(Base, UUIDMixin):
    """Energiepolitik (ISO 50001 Kap. 5.2)."""
    __tablename__ = "energy_policies"

    title: Mapped[str] = mapped_column(String(255))
    content: Mapped[str] = mapped_column(Text)
    approved_by: Mapped[str] = mapped_column(String(255))
    approved_date: Mapped[date] = mapped_column(Date)
    valid_from: Mapped[date] = mapped_column(Date)
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)
    pdf_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)


class EnMSRole(Base, UUIDMixin):
    """Rollen im Energiemanagementsystem (ISO 50001 Kap. 5.3)."""
    __tablename__ = "enms_roles"

    role_name: Mapped[str] = mapped_column(String(255))
    person_name: Mapped[str] = mapped_column(String(255))
    department: Mapped[str | None] = mapped_column(String(255), nullable=True)
    responsibilities: Mapped[list] = mapped_column(JSON, default=list)
    authorities: Mapped[list] = mapped_column(JSON, default=list)
    appointed_date: Mapped[date] = mapped_column(Date)
    appointed_by: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class EnergyObjective(Base, UUIDMixin, TimestampMixin):
    """Energieziele (ISO 50001 Kap. 6.2)."""
    __tablename__ = "energy_objectives"

    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_type: Mapped[str] = mapped_column(String(50))
    target_value: Mapped[Decimal] = mapped_column(Numeric(16, 4))
    target_unit: Mapped[str] = mapped_column(String(50))
    baseline_value: Mapped[Decimal] = mapped_column(Numeric(16, 4))
    baseline_period: Mapped[str] = mapped_column(String(50))
    target_date: Mapped[date] = mapped_column(Date)
    responsible_person: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(50), default="planned")
    related_meter_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    current_value: Mapped[Decimal | None] = mapped_column(Numeric(16, 4), nullable=True)
    progress_percent: Mapped[Decimal | None] = mapped_column(Numeric(5, 1), nullable=True)

    action_plans = relationship("ActionPlan", back_populates="objective")


class ActionPlan(Base, UUIDMixin, TimestampMixin):
    """Aktionspläne zur Zielerreichung (ISO 50001 Kap. 6.2)."""
    __tablename__ = "action_plans"

    objective_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("energy_objectives.id")
    )
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    responsible_person: Mapped[str] = mapped_column(String(255))
    resources_required: Mapped[str | None] = mapped_column(Text, nullable=True)
    investment_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    expected_savings_kwh: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    expected_savings_eur: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    expected_savings_co2_kg: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    start_date: Mapped[date] = mapped_column(Date)
    target_date: Mapped[date] = mapped_column(Date)
    completion_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="planned")
    verification_method: Mapped[str | None] = mapped_column(Text, nullable=True)
    actual_savings_kwh: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    objective = relationship("EnergyObjective", back_populates="action_plans")


class RiskOpportunity(Base, UUIDMixin, TimestampMixin):
    """Risiken und Chancen (ISO 50001 Kap. 6.1)."""
    __tablename__ = "risks_opportunities"

    type: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(100))
    likelihood: Mapped[int] = mapped_column(Integer)
    impact: Mapped[int] = mapped_column(Integer)
    risk_score: Mapped[int] = mapped_column(Integer)
    mitigation_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    responsible_person: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="open")
    review_date: Mapped[date | None] = mapped_column(Date, nullable=True)


class Document(Base, UUIDMixin, TimestampMixin):
    """Dokumentenlenkung (ISO 50001 Kap. 7.5)."""
    __tablename__ = "documents"

    title: Mapped[str] = mapped_column(String(500))
    document_type: Mapped[str] = mapped_column(String(50))
    category: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    version: Mapped[str] = mapped_column(String(20), default="1.0")
    status: Mapped[str] = mapped_column(String(50), default="draft")
    author: Mapped[str] = mapped_column(String(255))
    approved_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    approved_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    review_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    retention_period_months: Mapped[int | None] = mapped_column(Integer, nullable=True)
    iso_clause_reference: Mapped[str | None] = mapped_column(String(20), nullable=True)
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)

    revisions = relationship("DocumentRevision", back_populates="document")


class DocumentRevision(Base, UUIDMixin):
    """Revisionshistorie eines Dokuments."""
    __tablename__ = "document_revisions"

    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id")
    )
    version: Mapped[str] = mapped_column(String(20))
    change_description: Mapped[str] = mapped_column(Text)
    changed_by: Mapped[str] = mapped_column(String(255))
    changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)

    document = relationship("Document", back_populates="revisions")


class LegalRequirement(Base, UUIDMixin, TimestampMixin):
    """Rechtskataster (ISO 50001 Kap. 9.1.2)."""
    __tablename__ = "legal_requirements"

    title: Mapped[str] = mapped_column(String(500))
    category: Mapped[str] = mapped_column(String(50))
    jurisdiction: Mapped[str] = mapped_column(String(50))
    description: Mapped[str] = mapped_column(Text)
    relevance: Mapped[str] = mapped_column(Text)
    compliance_status: Mapped[str] = mapped_column(String(50), default="not_assessed")
    responsible_person: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_assessment_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    next_review_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    source_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class InternalAudit(Base, UUIDMixin, TimestampMixin):
    """Internes Audit (ISO 50001 Kap. 9.2)."""
    __tablename__ = "internal_audits"

    title: Mapped[str] = mapped_column(String(500))
    audit_type: Mapped[str] = mapped_column(String(50))
    scope: Mapped[str] = mapped_column(Text)
    planned_date: Mapped[date] = mapped_column(Date)
    actual_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    lead_auditor: Mapped[str] = mapped_column(String(255))
    audit_team: Mapped[list | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="planned")
    overall_result: Mapped[str | None] = mapped_column(Text, nullable=True)

    findings = relationship("AuditFinding", back_populates="audit")


class AuditFinding(Base, UUIDMixin):
    """Einzelbefund aus einem internen Audit."""
    __tablename__ = "audit_findings"

    audit_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("internal_audits.id")
    )
    finding_type: Mapped[str] = mapped_column(String(50))
    iso_clause: Mapped[str] = mapped_column(String(20))
    description: Mapped[str] = mapped_column(Text)
    evidence: Mapped[str | None] = mapped_column(Text, nullable=True)
    corrective_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    responsible_person: Mapped[str | None] = mapped_column(String(255), nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    completion_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    verification_result: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="open")

    audit = relationship("InternalAudit", back_populates="findings")


class ManagementReview(Base, UUIDMixin, TimestampMixin):
    """Managementbewertung (ISO 50001 Kap. 9.3)."""
    __tablename__ = "management_reviews"

    title: Mapped[str] = mapped_column(String(500))
    review_date: Mapped[date] = mapped_column(Date)
    participants: Mapped[list] = mapped_column(JSON, default=list)
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    previous_review_actions: Mapped[str | None] = mapped_column(Text, nullable=True)
    energy_policy_adequacy: Mapped[str | None] = mapped_column(Text, nullable=True)
    enpi_performance: Mapped[str | None] = mapped_column(Text, nullable=True)
    compliance_status: Mapped[str | None] = mapped_column(Text, nullable=True)
    audit_results_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    nonconformities_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    external_changes: Mapped[str | None] = mapped_column(Text, nullable=True)
    resource_adequacy: Mapped[str | None] = mapped_column(Text, nullable=True)
    improvement_opportunities: Mapped[str | None] = mapped_column(Text, nullable=True)
    decisions: Mapped[list | None] = mapped_column(JSON, nullable=True)
    action_items: Mapped[list | None] = mapped_column(JSON, nullable=True)
    policy_changes_needed: Mapped[bool] = mapped_column(Boolean, default=False)
    resource_changes_needed: Mapped[str | None] = mapped_column(Text, nullable=True)
    next_review_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="planned")
    protocol_document_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)


class Nonconformity(Base, UUIDMixin, TimestampMixin):
    """Nichtkonformitäten und Korrekturmaßnahmen (ISO 50001 Kap. 10.1)."""
    __tablename__ = "nonconformities"

    title: Mapped[str] = mapped_column(String(500))
    source: Mapped[str] = mapped_column(String(50))
    source_reference_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    description: Mapped[str] = mapped_column(Text)
    root_cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    immediate_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    corrective_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    responsible_person: Mapped[str] = mapped_column(String(255))
    due_date: Mapped[date] = mapped_column(Date)
    completion_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    effectiveness_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    verification_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    verification_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="open")
