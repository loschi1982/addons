"""
iso_service.py – ISO 50001 Management-Logik.

Zentrale Geschäftslogik für alle ISO 50001 Kapitel:
Kontext, Energiepolitik, Rollen, Ziele, Aktionspläne, Risiken,
Dokumente, Rechtskataster, Audits, Managementbewertung, Nichtkonformitäten.
"""

import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.models.iso import (
    ActionPlan,
    AuditFinding,
    Document,
    DocumentRevision,
    EnergyObjective,
    EnergyPolicy,
    EnMSRole,
    InternalAudit,
    LegalRequirement,
    ManagementReview,
    Nonconformity,
    OrganizationContext,
    RiskOpportunity,
)

logger = structlog.get_logger()
settings = get_settings()


class ISOService:
    """Service für ISO 50001 Management-Funktionen."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # --- Kontext (Kap. 4) ---

    async def get_context(self) -> OrganizationContext | None:
        """Aktuellen Organisationskontext abrufen (es gibt nur einen)."""
        result = await self.db.execute(select(OrganizationContext).limit(1))
        return result.scalar_one_or_none()

    async def create_context(self, data: dict) -> OrganizationContext:
        """Organisationskontext erstmalig anlegen."""
        if "last_reviewed" not in data:
            data["last_reviewed"] = date.today()
        ctx = OrganizationContext(**data)
        self.db.add(ctx)
        await self.db.commit()
        await self.db.refresh(ctx)
        return ctx

    async def update_context(self, data: dict) -> OrganizationContext | None:
        """Organisationskontext aktualisieren (Version wird hochgezählt)."""
        ctx = await self.get_context()
        if not ctx:
            # Noch kein Kontext vorhanden → anlegen
            return await self.create_context(data)
        for key, value in data.items():
            if value is not None:
                setattr(ctx, key, value)
        ctx.version += 1
        await self.db.commit()
        await self.db.refresh(ctx)
        return ctx

    # --- Energiepolitik (Kap. 5.2) ---

    async def list_policies(self) -> list[EnergyPolicy]:
        """Alle Energiepolitiken auflisten (neueste zuerst)."""
        result = await self.db.execute(
            select(EnergyPolicy).order_by(EnergyPolicy.valid_from.desc())
        )
        return list(result.scalars().all())

    async def create_policy(self, data: dict) -> EnergyPolicy:
        """Neue Energiepolitik anlegen. Setzt alte auf is_current=False."""
        if data.get("is_current", True):
            await self._clear_current_policy()
        policy = EnergyPolicy(**data)
        self.db.add(policy)
        await self.db.commit()
        await self.db.refresh(policy)
        return policy

    async def update_policy(self, policy_id: uuid.UUID, data: dict) -> EnergyPolicy | None:
        """Energiepolitik aktualisieren."""
        result = await self.db.execute(
            select(EnergyPolicy).where(EnergyPolicy.id == policy_id)
        )
        policy = result.scalar_one_or_none()
        if not policy:
            return None
        if data.get("is_current"):
            await self._clear_current_policy()
        for key, value in data.items():
            if value is not None:
                setattr(policy, key, value)
        await self.db.commit()
        await self.db.refresh(policy)
        return policy

    async def _clear_current_policy(self):
        """Alle bestehenden Politiken auf is_current=False setzen."""
        result = await self.db.execute(
            select(EnergyPolicy).where(EnergyPolicy.is_current.is_(True))
        )
        for p in result.scalars().all():
            p.is_current = False

    # --- EnMS-Rollen (Kap. 5.3) ---

    async def list_enms_roles(self) -> list[EnMSRole]:
        """Alle EnMS-Rollen auflisten."""
        result = await self.db.execute(
            select(EnMSRole).order_by(EnMSRole.role_name)
        )
        return list(result.scalars().all())

    async def create_enms_role(self, data: dict) -> EnMSRole:
        """Neue EnMS-Rolle anlegen."""
        role = EnMSRole(**data)
        self.db.add(role)
        await self.db.commit()
        await self.db.refresh(role)
        return role

    async def update_enms_role(self, role_id: uuid.UUID, data: dict) -> EnMSRole | None:
        """EnMS-Rolle aktualisieren."""
        result = await self.db.execute(
            select(EnMSRole).where(EnMSRole.id == role_id)
        )
        role = result.scalar_one_or_none()
        if not role:
            return None
        for key, value in data.items():
            if value is not None:
                setattr(role, key, value)
        await self.db.commit()
        await self.db.refresh(role)
        return role

    async def delete_enms_role(self, role_id: uuid.UUID) -> bool:
        """EnMS-Rolle löschen."""
        result = await self.db.execute(
            select(EnMSRole).where(EnMSRole.id == role_id)
        )
        role = result.scalar_one_or_none()
        if not role:
            return False
        await self.db.delete(role)
        await self.db.commit()
        return True

    # --- Energieziele (Kap. 6.2) ---

    async def list_objectives(
        self, page: int = 1, page_size: int = 25, status: str | None = None
    ) -> dict:
        """Energieziele paginiert auflisten."""
        query = select(EnergyObjective)
        count_query = select(func.count(EnergyObjective.id))

        if status:
            query = query.where(EnergyObjective.status == status)
            count_query = count_query.where(EnergyObjective.status == status)

        total = (await self.db.execute(count_query)).scalar() or 0
        query = query.order_by(EnergyObjective.target_date).offset(
            (page - 1) * page_size
        ).limit(page_size)

        result = await self.db.execute(query)
        items = list(result.scalars().all())

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": max(1, (total + page_size - 1) // page_size),
        }

    async def create_objective(self, data: dict) -> EnergyObjective:
        """Neues Energieziel anlegen mit automatischer Fortschrittsberechnung."""
        obj = EnergyObjective(**data)
        obj.progress_percent = 0
        self.db.add(obj)
        await self.db.commit()
        await self.db.refresh(obj)
        return obj

    async def update_objective(
        self, objective_id: uuid.UUID, data: dict
    ) -> EnergyObjective | None:
        """Energieziel aktualisieren. Fortschritt wird automatisch berechnet."""
        result = await self.db.execute(
            select(EnergyObjective).where(EnergyObjective.id == objective_id)
        )
        obj = result.scalar_one_or_none()
        if not obj:
            return None
        for key, value in data.items():
            if value is not None:
                setattr(obj, key, value)
        # Fortschritt automatisch berechnen
        if obj.current_value is not None and obj.baseline_value and obj.target_value:
            diff_target = float(obj.target_value) - float(obj.baseline_value)
            if diff_target != 0:
                diff_actual = float(obj.current_value) - float(obj.baseline_value)
                obj.progress_percent = round(
                    min(max((diff_actual / diff_target) * 100, 0), 100), 1
                )
        await self.db.commit()
        await self.db.refresh(obj)
        return obj

    async def recalculate_objective_progress(self) -> dict:
        """
        Automatische Fortschrittsberechnung für alle aktiven Ziele
        mit zugeordneten Zählern. Berechnet current_value aus
        Readings für das laufende Jahr vs. baseline_period.
        """
        from app.models.reading import MeterReading

        result = await self.db.execute(
            select(EnergyObjective).where(
                EnergyObjective.status.in_(["planned", "in_progress", "overdue"]),
                EnergyObjective.related_meter_ids.isnot(None),
            )
        )
        objectives = list(result.scalars().all())
        updated = 0

        today = date.today()
        year_start = date(today.year, 1, 1)

        for obj in objectives:
            meter_ids = obj.related_meter_ids or []
            if not meter_ids:
                continue

            try:
                meter_uuids = [uuid.UUID(m) for m in meter_ids]
            except (ValueError, TypeError):
                continue

            # Aktueller Verbrauch im laufenden Jahr
            consumption_q = select(func.sum(MeterReading.consumption)).where(
                MeterReading.meter_id.in_(meter_uuids),
                MeterReading.timestamp >= year_start,
                MeterReading.timestamp < today,
                MeterReading.consumption.isnot(None),
            )
            current = (await self.db.execute(consumption_q)).scalar()
            if current is None:
                continue

            from decimal import Decimal
            obj.current_value = round(Decimal(str(current)), 4)

            # Fortschritt berechnen
            if obj.baseline_value and obj.target_value:
                diff_target = float(obj.target_value) - float(obj.baseline_value)
                if diff_target != 0:
                    diff_actual = float(obj.current_value) - float(obj.baseline_value)
                    obj.progress_percent = round(
                        min(max((diff_actual / diff_target) * 100, 0), 100), 1
                    )

            # Status aktualisieren
            if obj.progress_percent and float(obj.progress_percent) >= 100:
                obj.status = "completed"
            elif obj.target_date < today and obj.status != "completed":
                obj.status = "overdue"
            elif obj.status == "planned" and obj.current_value:
                obj.status = "in_progress"

            updated += 1

        await self.db.commit()
        logger.info("objectives_recalculated", updated=updated, total=len(objectives))
        return {"updated": updated, "total": len(objectives)}

    # --- Aktionspläne ---

    async def list_action_plans(self, objective_id: uuid.UUID) -> list[ActionPlan]:
        """Aktionspläne eines Ziels auflisten."""
        result = await self.db.execute(
            select(ActionPlan)
            .where(ActionPlan.objective_id == objective_id)
            .order_by(ActionPlan.start_date)
        )
        return list(result.scalars().all())

    async def create_action_plan(self, data: dict) -> ActionPlan:
        """Neuen Aktionsplan anlegen."""
        plan = ActionPlan(**data)
        self.db.add(plan)
        await self.db.commit()
        await self.db.refresh(plan)
        return plan

    async def update_action_plan(
        self, action_id: uuid.UUID, data: dict
    ) -> ActionPlan | None:
        """Aktionsplan aktualisieren."""
        result = await self.db.execute(
            select(ActionPlan).where(ActionPlan.id == action_id)
        )
        plan = result.scalar_one_or_none()
        if not plan:
            return None
        for key, value in data.items():
            if value is not None:
                setattr(plan, key, value)
        # Status automatisch auf 'completed' setzen wenn completion_date gesetzt
        if plan.completion_date and plan.status != "completed":
            plan.status = "completed"
        await self.db.commit()
        await self.db.refresh(plan)
        return plan

    async def update_overdue_statuses(self) -> dict:
        """
        Überziehungs-Status für Energieziele und Aktionspläne aktualisieren.

        Setzt Status auf "overdue" wenn target_date überschritten und
        nicht bereits abgeschlossen oder abgebrochen. Wird täglich per
        Celery-Task ausgeführt.
        """
        today = date.today()
        terminal_statuses = {"completed", "cancelled"}

        # Energieziele prüfen
        obj_result = await self.db.execute(
            select(EnergyObjective).where(
                EnergyObjective.target_date < today,
                EnergyObjective.status.not_in(terminal_statuses | {"overdue"}),
            )
        )
        objectives = obj_result.scalars().all()
        objectives_updated = 0
        for obj in objectives:
            obj.status = "overdue"
            objectives_updated += 1

        # Aktionspläne prüfen
        plan_result = await self.db.execute(
            select(ActionPlan).where(
                ActionPlan.target_date < today,
                ActionPlan.status.not_in(terminal_statuses | {"overdue"}),
                ActionPlan.completion_date.is_(None),
            )
        )
        plans = plan_result.scalars().all()
        plans_updated = 0
        for plan in plans:
            plan.status = "overdue"
            plans_updated += 1

        if objectives_updated or plans_updated:
            await self.db.commit()

        logger.info(
            "overdue_statuses_updated",
            objectives=objectives_updated,
            action_plans=plans_updated,
        )
        return {"objectives_updated": objectives_updated, "plans_updated": plans_updated}

    # --- Risiken und Chancen (Kap. 6.1) ---

    async def list_risks(
        self,
        page: int = 1,
        page_size: int = 25,
        type: str | None = None,
        status: str | None = None,
    ) -> dict:
        """Risiken und Chancen paginiert auflisten."""
        query = select(RiskOpportunity)
        count_query = select(func.count(RiskOpportunity.id))

        if type:
            query = query.where(RiskOpportunity.type == type)
            count_query = count_query.where(RiskOpportunity.type == type)
        if status:
            query = query.where(RiskOpportunity.status == status)
            count_query = count_query.where(RiskOpportunity.status == status)

        total = (await self.db.execute(count_query)).scalar() or 0
        query = query.order_by(RiskOpportunity.risk_score.desc()).offset(
            (page - 1) * page_size
        ).limit(page_size)

        result = await self.db.execute(query)
        items = list(result.scalars().all())

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": max(1, (total + page_size - 1) // page_size),
        }

    async def create_risk(self, data: dict) -> RiskOpportunity:
        """Neues Risiko/Chance anlegen. risk_score = likelihood × impact."""
        risk = RiskOpportunity(**data)
        risk.risk_score = risk.likelihood * risk.impact
        self.db.add(risk)
        await self.db.commit()
        await self.db.refresh(risk)
        return risk

    async def update_risk(
        self, risk_id: uuid.UUID, data: dict
    ) -> RiskOpportunity | None:
        """Risiko/Chance aktualisieren. risk_score wird neu berechnet."""
        result = await self.db.execute(
            select(RiskOpportunity).where(RiskOpportunity.id == risk_id)
        )
        risk = result.scalar_one_or_none()
        if not risk:
            return None
        for key, value in data.items():
            if value is not None:
                setattr(risk, key, value)
        risk.risk_score = risk.likelihood * risk.impact
        await self.db.commit()
        await self.db.refresh(risk)
        return risk

    # --- Dokumente (Kap. 7.5) ---

    async def list_documents(
        self,
        page: int = 1,
        page_size: int = 25,
        category: str | None = None,
        status: str | None = None,
        search: str | None = None,
    ) -> dict:
        """Dokumente paginiert auflisten mit optionaler Suche."""
        query = select(Document)
        count_query = select(func.count(Document.id))

        if category:
            query = query.where(Document.category == category)
            count_query = count_query.where(Document.category == category)
        if status:
            query = query.where(Document.status == status)
            count_query = count_query.where(Document.status == status)
        if search:
            search_filter = Document.title.ilike(f"%{search}%")
            query = query.where(search_filter)
            count_query = count_query.where(search_filter)

        total = (await self.db.execute(count_query)).scalar() or 0
        query = query.order_by(Document.created_at.desc()).offset(
            (page - 1) * page_size
        ).limit(page_size)

        result = await self.db.execute(query)
        items = list(result.scalars().all())

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": max(1, (total + page_size - 1) // page_size),
        }

    async def create_document(self, data: dict) -> Document:
        """Neues Dokument anlegen."""
        doc = Document(**data)
        self.db.add(doc)
        await self.db.commit()
        await self.db.refresh(doc)
        return doc

    async def update_document(
        self, doc_id: uuid.UUID, data: dict
    ) -> Document | None:
        """Dokument aktualisieren und Revisionshistorie erstellen."""
        result = await self.db.execute(
            select(Document).where(Document.id == doc_id)
        )
        doc = result.scalar_one_or_none()
        if not doc:
            return None

        # Revision erstellen bei Statusänderung oder inhaltlichen Änderungen
        changes = []
        for key, value in data.items():
            if value is not None and getattr(doc, key, None) != value:
                changes.append(f"{key}: {getattr(doc, key, '')} → {value}")
                setattr(doc, key, value)

        if changes:
            revision = DocumentRevision(
                document_id=doc_id,
                version=doc.version,
                change_description="; ".join(changes),
                changed_by=data.get("approved_by", "System"),
            )
            self.db.add(revision)

        await self.db.commit()
        await self.db.refresh(doc)
        return doc

    async def upload_document_file(
        self, doc_id: uuid.UUID, filename: str, content: bytes
    ) -> str:
        """Datei zu einem Dokument hochladen."""
        result = await self.db.execute(
            select(Document).where(Document.id == doc_id)
        )
        doc = result.scalar_one_or_none()
        if not doc:
            return ""

        # Verzeichnis erstellen
        upload_dir = Path(settings.upload_dir) / "documents" / str(doc_id)
        upload_dir.mkdir(parents=True, exist_ok=True)

        # Datei speichern
        file_path = upload_dir / filename
        file_path.write_bytes(content)

        # Dokument aktualisieren
        doc.file_path = str(file_path)
        doc.file_type = filename.rsplit(".", 1)[-1] if "." in filename else None

        # Neue Version
        old_version = doc.version
        parts = old_version.split(".")
        parts[-1] = str(int(parts[-1]) + 1)
        doc.version = ".".join(parts)

        # Revision
        revision = DocumentRevision(
            document_id=doc_id,
            version=doc.version,
            change_description=f"Datei hochgeladen: {filename}",
            changed_by="Upload",
            file_path=str(file_path),
        )
        self.db.add(revision)

        await self.db.commit()
        await self.db.refresh(doc)
        return str(file_path)

    async def list_revisions(self, doc_id: uuid.UUID) -> list[DocumentRevision]:
        """Revisionshistorie eines Dokuments abrufen."""
        result = await self.db.execute(
            select(DocumentRevision)
            .where(DocumentRevision.document_id == doc_id)
            .order_by(DocumentRevision.changed_at.desc())
        )
        return list(result.scalars().all())

    async def get_documents_review_due(self, days: int = 30) -> list[Document]:
        """Dokumente mit fälliger oder bald fälliger Überprüfung.

        Gibt alle Dokumente zurück, deren review_due_date innerhalb der
        nächsten 'days' Tage liegt oder bereits überschritten ist.
        """
        cutoff = date.today() + __import__("datetime").timedelta(days=days)
        result = await self.db.execute(
            select(Document)
            .where(
                Document.review_due_date.isnot(None),
                Document.review_due_date <= cutoff,
                Document.status != "archived",
            )
            .order_by(Document.review_due_date.asc())
        )
        return list(result.scalars().all())

    # --- Rechtskataster (Kap. 9.1.2) ---

    async def list_legal_requirements(
        self,
        page: int = 1,
        page_size: int = 25,
        category: str | None = None,
        compliance_status: str | None = None,
    ) -> dict:
        """Rechtsanforderungen paginiert auflisten."""
        query = select(LegalRequirement).where(LegalRequirement.is_active.is_(True))
        count_query = select(func.count(LegalRequirement.id)).where(
            LegalRequirement.is_active.is_(True)
        )

        if category:
            query = query.where(LegalRequirement.category == category)
            count_query = count_query.where(LegalRequirement.category == category)
        if compliance_status:
            query = query.where(LegalRequirement.compliance_status == compliance_status)
            count_query = count_query.where(
                LegalRequirement.compliance_status == compliance_status
            )

        total = (await self.db.execute(count_query)).scalar() or 0
        query = query.order_by(LegalRequirement.next_review_date.asc().nullslast()).offset(
            (page - 1) * page_size
        ).limit(page_size)

        result = await self.db.execute(query)
        items = list(result.scalars().all())

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": max(1, (total + page_size - 1) // page_size),
        }

    async def create_legal_requirement(self, data: dict) -> LegalRequirement:
        """Neue Rechtsanforderung anlegen."""
        req = LegalRequirement(**data)
        self.db.add(req)
        await self.db.commit()
        await self.db.refresh(req)
        return req

    async def update_legal_requirement(
        self, req_id: uuid.UUID, data: dict
    ) -> LegalRequirement | None:
        """Rechtsanforderung aktualisieren."""
        result = await self.db.execute(
            select(LegalRequirement).where(LegalRequirement.id == req_id)
        )
        req = result.scalar_one_or_none()
        if not req:
            return None
        for key, value in data.items():
            if value is not None:
                setattr(req, key, value)
        await self.db.commit()
        await self.db.refresh(req)
        return req

    # --- Interne Audits (Kap. 9.2) ---

    async def list_audits(
        self, page: int = 1, page_size: int = 25, status: str | None = None
    ) -> dict:
        """Interne Audits paginiert auflisten."""
        query = select(InternalAudit)
        count_query = select(func.count(InternalAudit.id))

        if status:
            query = query.where(InternalAudit.status == status)
            count_query = count_query.where(InternalAudit.status == status)

        total = (await self.db.execute(count_query)).scalar() or 0
        query = query.order_by(InternalAudit.planned_date.desc()).offset(
            (page - 1) * page_size
        ).limit(page_size)

        result = await self.db.execute(query)
        items = list(result.scalars().all())

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": max(1, (total + page_size - 1) // page_size),
        }

    async def create_audit(self, data: dict) -> InternalAudit:
        """Neues internes Audit anlegen."""
        audit = InternalAudit(**data)
        self.db.add(audit)
        await self.db.commit()
        await self.db.refresh(audit)
        return audit

    async def update_audit(
        self, audit_id: uuid.UUID, data: dict
    ) -> InternalAudit | None:
        """Audit aktualisieren."""
        result = await self.db.execute(
            select(InternalAudit).where(InternalAudit.id == audit_id)
        )
        audit = result.scalar_one_or_none()
        if not audit:
            return None
        for key, value in data.items():
            if value is not None:
                setattr(audit, key, value)
        await self.db.commit()
        await self.db.refresh(audit)
        return audit

    async def list_findings(self, audit_id: uuid.UUID) -> list[AuditFinding]:
        """Audit-Befunde eines Audits auflisten."""
        result = await self.db.execute(
            select(AuditFinding)
            .where(AuditFinding.audit_id == audit_id)
            .order_by(AuditFinding.iso_clause)
        )
        return list(result.scalars().all())

    async def create_finding(self, data: dict) -> AuditFinding:
        """Neuen Audit-Befund anlegen."""
        finding = AuditFinding(**data)
        self.db.add(finding)
        await self.db.commit()
        await self.db.refresh(finding)
        return finding

    async def update_finding(
        self, finding_id: uuid.UUID, data: dict
    ) -> AuditFinding | None:
        """Audit-Befund aktualisieren."""
        result = await self.db.execute(
            select(AuditFinding).where(AuditFinding.id == finding_id)
        )
        finding = result.scalar_one_or_none()
        if not finding:
            return None
        for key, value in data.items():
            if value is not None:
                setattr(finding, key, value)
        await self.db.commit()
        await self.db.refresh(finding)
        return finding

    async def get_audit_checklist(self) -> list[dict]:
        """ISO 50001 Audit-Checkliste pro Normkapitel.

        Gibt eine strukturierte Checkliste für die Audit-Durchführung zurück.
        Jeder Eintrag enthält Normkapitel, Thema und Prüfpunkte.
        """
        return [
            {"clause": "4.1", "topic": "Kontext der Organisation", "checks": [
                "Interne und externe Themen identifiziert?",
                "Relevanz für energiebezogene Leistung bewertet?",
            ]},
            {"clause": "4.2", "topic": "Interessierte Parteien", "checks": [
                "Anforderungen interessierter Parteien ermittelt?",
                "Energierelevante Anforderungen berücksichtigt?",
            ]},
            {"clause": "4.3", "topic": "Anwendungsbereich", "checks": [
                "Grenzen und Anwendungsbereich dokumentiert?",
                "Ausschlüsse begründet?",
            ]},
            {"clause": "5.1", "topic": "Führung und Verpflichtung", "checks": [
                "Engagement der obersten Leitung nachweisbar?",
                "Ressourcen bereitgestellt?",
            ]},
            {"clause": "5.2", "topic": "Energiepolitik", "checks": [
                "Energiepolitik dokumentiert und kommuniziert?",
                "Verpflichtung zur Verbesserung enthalten?",
                "Regelmäßig überprüft?",
            ]},
            {"clause": "5.3", "topic": "Rollen & Verantwortlichkeiten", "checks": [
                "Energiemanagementbeauftragter benannt?",
                "Verantwortlichkeiten und Befugnisse zugewiesen?",
            ]},
            {"clause": "6.1", "topic": "Risiken und Chancen", "checks": [
                "Risiken und Chancen identifiziert?",
                "Maßnahmen geplant?",
            ]},
            {"clause": "6.2", "topic": "Energieziele & Aktionspläne", "checks": [
                "Messbare Ziele festgelegt?",
                "Aktionspläne mit Verantwortlichen und Fristen?",
                "Fortschritt überwacht?",
            ]},
            {"clause": "6.3", "topic": "Energetische Bewertung", "checks": [
                "SEUs identifiziert?",
                "Energierelevante Variablen ermittelt?",
            ]},
            {"clause": "6.4", "topic": "EnPIs", "checks": [
                "EnPIs definiert und dokumentiert?",
                "Methodik zur Bestimmung festgelegt?",
            ]},
            {"clause": "6.5", "topic": "Energetische Ausgangsbasis", "checks": [
                "Baseline definiert und dokumentiert?",
                "Kriterien für Anpassung festgelegt?",
            ]},
            {"clause": "6.6", "topic": "Energiedatensammlung", "checks": [
                "Datensammlungsplan vorhanden?",
                "Messgeräte kalibriert?",
            ]},
            {"clause": "7.5", "topic": "Dokumentierte Information", "checks": [
                "Dokumente gelenkt und aktuell?",
                "Aufbewahrungsfristen eingehalten?",
                "Versionierung nachvollziehbar?",
            ]},
            {"clause": "8.1", "topic": "Betriebliche Steuerung", "checks": [
                "Betriebskriterien für SEUs festgelegt?",
                "Abweichungen erkannt und behandelt?",
            ]},
            {"clause": "9.1", "topic": "Überwachung & Messung", "checks": [
                "Schlüsselmerkmale überwacht?",
                "Messgeräte geeignet und genau?",
            ]},
            {"clause": "9.1.2", "topic": "Rechtliche Anforderungen", "checks": [
                "Compliance-Bewertung durchgeführt?",
                "Alle relevanten Anforderungen erfasst?",
            ]},
            {"clause": "9.2", "topic": "Internes Audit", "checks": [
                "Auditprogramm geplant?",
                "Auditor-Unabhängigkeit gewährleistet?",
                "Befunde dokumentiert?",
            ]},
            {"clause": "9.3", "topic": "Managementbewertung", "checks": [
                "Alle Inputs berücksichtigt?",
                "Entscheidungen und Maßnahmen dokumentiert?",
            ]},
            {"clause": "10.1", "topic": "Nichtkonformitäten & Korrekturmaßnahmen", "checks": [
                "Ursachenanalyse durchgeführt?",
                "Wirksamkeit der Maßnahmen überprüft?",
            ]},
            {"clause": "10.2", "topic": "Fortlaufende Verbesserung", "checks": [
                "Verbesserung der energiebezogenen Leistung nachweisbar?",
                "EnMS-Eignung regelmäßig bewertet?",
            ]},
        ]

    async def create_nc_from_finding(
        self, finding_id: uuid.UUID
    ) -> Nonconformity | None:
        """Nichtkonformität aus einem Audit-Befund erstellen (Workflow-Verknüpfung).

        Erstellt eine neue Nichtkonformität und verknüpft sie mit dem
        Quell-Befund über source_reference_id.
        """
        result = await self.db.execute(
            select(AuditFinding).where(AuditFinding.id == finding_id)
        )
        finding = result.scalar_one_or_none()
        if not finding:
            return None

        nc = Nonconformity(
            title=f"NK aus Audit-Befund: {finding.description[:100]}",
            source="audit",
            source_reference_id=finding_id,
            description=finding.description,
            immediate_action=finding.corrective_action,
            responsible_person=finding.responsible_person or "Nicht zugewiesen",
            due_date=finding.due_date or (date.today() + __import__("datetime").timedelta(days=30)),
        )
        self.db.add(nc)

        # Befund-Status auf "in_progress" setzen
        finding.status = "in_progress"

        await self.db.commit()
        await self.db.refresh(nc)
        return nc

    async def create_action_plan_from_nc(
        self, nc_id: uuid.UUID, objective_id: uuid.UUID
    ) -> ActionPlan | None:
        """Aktionsplan aus einer Nichtkonformität erstellen (Workflow-Verknüpfung).

        Verknüpft NK → Aktionsplan → Energieziel für durchgängiges Tracking.
        """
        result = await self.db.execute(
            select(Nonconformity).where(Nonconformity.id == nc_id)
        )
        nc = result.scalar_one_or_none()
        if not nc:
            return None

        plan = ActionPlan(
            objective_id=objective_id,
            title=f"Korrekturmaßnahme: {nc.title[:100]}",
            description=f"Aus NK: {nc.description}\n\nKorrekturmaßnahme: {nc.corrective_action or 'Noch zu definieren'}",
            responsible_person=nc.responsible_person,
            start_date=date.today(),
            target_date=nc.due_date,
        )
        self.db.add(plan)
        await self.db.commit()
        await self.db.refresh(plan)
        return plan

    async def suggest_objective_from_finding(
        self, finding_id: uuid.UUID
    ) -> dict | None:
        """
        Energieziel + Aktionsplan aus Audit-Befund vorschlagen.

        Gibt vorausgefüllte Entwürfe zurück, die der Nutzer prüfen und
        absenden kann. Keine automatische Erstellung, da Zielwerte
        (target_value, baseline_value) fachlich gesetzt werden müssen.
        """
        result = await self.db.execute(
            select(AuditFinding).where(AuditFinding.id == finding_id)
        )
        finding = result.scalar_one_or_none()
        if not finding:
            return None

        today = date.today()
        # Zieldatum: due_date des Befundes oder 12 Monate ab heute
        target_date = finding.due_date or date(today.year + 1, today.month, today.day)

        objective_draft = {
            "title": f"Verbesserung aus Audit-Befund (ISO {finding.iso_clause}): "
                     f"{finding.description[:120]}",
            "description": (
                f"Abgeleitet aus Audit-Befund vom {today.isoformat()}.\n"
                f"Befundtyp: {finding.finding_type}\n"
                f"ISO-Klausel: {finding.iso_clause}\n\n"
                f"Beschreibung: {finding.description}\n\n"
                f"Korrekturmaßnahme: {finding.corrective_action or 'Noch zu definieren'}"
            ),
            "target_type": "reduction",          # Standardannahme: Reduzierung
            "target_unit": "kWh",                # Nutzer kann anpassen
            "target_value": 0,                   # Muss vom Nutzer gesetzt werden
            "baseline_value": 0,                 # Muss vom Nutzer gesetzt werden
            "baseline_period": str(today.year - 1),
            "target_date": target_date.isoformat(),
            "responsible_person": finding.responsible_person or "",
            "status": "planned",
        }

        action_plan_draft = {
            "title": (
                f"Korrekturmaßnahme: {finding.description[:100]}"
            ),
            "description": finding.corrective_action or finding.description,
            "responsible_person": finding.responsible_person or "",
            "start_date": today.isoformat(),
            "target_date": target_date.isoformat(),
            "status": "planned",
            "verification_method": (
                f"Überprüfung Audit-Befund {str(finding_id)[:8]} – "
                f"ISO {finding.iso_clause}"
            ),
        }

        return {
            "finding_id": str(finding_id),
            "finding_description": finding.description,
            "objective_draft": objective_draft,
            "action_plan_draft": action_plan_draft,
        }

    # --- Managementbewertung (Kap. 9.3) ---

    async def list_reviews(
        self, page: int = 1, page_size: int = 25
    ) -> dict:
        """Managementbewertungen paginiert auflisten."""
        count_query = select(func.count(ManagementReview.id))
        total = (await self.db.execute(count_query)).scalar() or 0

        query = (
            select(ManagementReview)
            .order_by(ManagementReview.review_date.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        result = await self.db.execute(query)
        items = list(result.scalars().all())

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": max(1, (total + page_size - 1) // page_size),
        }

    async def create_review(self, data: dict) -> ManagementReview:
        """Neue Managementbewertung anlegen."""
        review = ManagementReview(**data)
        self.db.add(review)
        await self.db.commit()
        await self.db.refresh(review)
        return review

    async def update_review(
        self, review_id: uuid.UUID, data: dict
    ) -> ManagementReview | None:
        """Managementbewertung aktualisieren."""
        result = await self.db.execute(
            select(ManagementReview).where(ManagementReview.id == review_id)
        )
        review = result.scalar_one_or_none()
        if not review:
            return None
        for key, value in data.items():
            if value is not None:
                setattr(review, key, value)
        await self.db.commit()
        await self.db.refresh(review)
        return review

    async def prefill_review(self, period_start: date, period_end: date) -> dict:
        """Automatisch vorausgefüllten Management-Review-Entwurf erstellen.

        Sammelt alle relevanten Daten aus dem Bewertungszeitraum:
        - Energieziel-Status und Fortschritt
        - Audit-Ergebnisse und offene Befunde
        - Offene Nichtkonformitäten
        - Compliance-Status Rechtskataster
        - Aktuelle Energiepolitik-Prüfung
        """
        # Energieziele: Status-Übersicht
        obj_result = await self.db.execute(select(EnergyObjective))
        objectives = list(obj_result.scalars().all())
        obj_summary = []
        for o in objectives:
            obj_summary.append({
                "title": o.title,
                "status": o.status,
                "progress": float(o.progress_percent) if o.progress_percent else 0,
                "target_date": str(o.target_date),
            })

        enpi_text = f"{len(objectives)} Energieziele definiert. "
        on_track = sum(1 for o in objectives if o.status in ("on_track", "completed"))
        behind = sum(1 for o in objectives if o.status in ("behind", "at_risk"))
        enpi_text += f"{on_track} im Plan, {behind} gefährdet."

        # Audits im Zeitraum
        audit_result = await self.db.execute(
            select(InternalAudit).where(
                InternalAudit.planned_date >= period_start,
                InternalAudit.planned_date <= period_end,
            )
        )
        audits = list(audit_result.scalars().all())
        completed_audits = [a for a in audits if a.status == "completed"]

        # Offene Befunde
        finding_result = await self.db.execute(
            select(AuditFinding).where(
                AuditFinding.status.in_(["open", "in_progress"])
            )
        )
        open_findings = list(finding_result.scalars().all())
        audit_text = (
            f"{len(audits)} Audits geplant, {len(completed_audits)} durchgeführt. "
            f"{len(open_findings)} offene Befunde."
        )

        # Nichtkonformitäten
        nc_result = await self.db.execute(
            select(Nonconformity).where(
                Nonconformity.status.in_(["open", "in_progress"])
            )
        )
        open_ncs = list(nc_result.scalars().all())
        nc_text = f"{len(open_ncs)} offene Nichtkonformitäten."

        # Compliance-Status
        legal_result = await self.db.execute(
            select(LegalRequirement).where(LegalRequirement.is_active.is_(True))
        )
        legal_reqs = list(legal_result.scalars().all())
        compliant = sum(1 for r in legal_reqs if r.compliance_status == "compliant")
        non_compliant = sum(1 for r in legal_reqs if r.compliance_status == "non_compliant")
        compliance_text = (
            f"{len(legal_reqs)} Anforderungen, {compliant} konform, "
            f"{non_compliant} nicht konform."
        )

        # Energiepolitik
        policy_result = await self.db.execute(
            select(EnergyPolicy).where(EnergyPolicy.is_current.is_(True))
        )
        current_policy = policy_result.scalar_one_or_none()
        policy_text = (
            f"Aktuelle Politik: '{current_policy.title}' (v{current_policy.version}, "
            f"gültig ab {current_policy.valid_from})"
            if current_policy else "Keine aktuelle Energiepolitik definiert."
        )

        # Letzte Managementbewertung
        prev_result = await self.db.execute(
            select(ManagementReview)
            .where(ManagementReview.status == "completed")
            .order_by(ManagementReview.review_date.desc())
            .limit(1)
        )
        prev_review = prev_result.scalar_one_or_none()
        prev_actions_text = ""
        if prev_review and prev_review.action_items:
            total_items = len(prev_review.action_items)
            prev_actions_text = (
                f"Letzte Bewertung vom {prev_review.review_date}: "
                f"{total_items} Maßnahmen definiert."
            )

        return {
            "enpi_performance": enpi_text,
            "audit_results_summary": audit_text,
            "nonconformities_summary": nc_text,
            "compliance_status": compliance_text,
            "energy_policy_adequacy": policy_text,
            "previous_review_actions": prev_actions_text,
            "objectives_detail": obj_summary,
            "open_findings_count": len(open_findings),
            "open_ncs_count": len(open_ncs),
        }

    # --- Nichtkonformitäten (Kap. 10.1) ---

    async def list_nonconformities(
        self,
        page: int = 1,
        page_size: int = 25,
        status: str | None = None,
        source: str | None = None,
    ) -> dict:
        """Nichtkonformitäten paginiert auflisten."""
        query = select(Nonconformity)
        count_query = select(func.count(Nonconformity.id))

        if status:
            query = query.where(Nonconformity.status == status)
            count_query = count_query.where(Nonconformity.status == status)
        if source:
            query = query.where(Nonconformity.source == source)
            count_query = count_query.where(Nonconformity.source == source)

        total = (await self.db.execute(count_query)).scalar() or 0
        query = query.order_by(Nonconformity.due_date.asc()).offset(
            (page - 1) * page_size
        ).limit(page_size)

        result = await self.db.execute(query)
        items = list(result.scalars().all())

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": max(1, (total + page_size - 1) // page_size),
        }

    async def create_nonconformity(self, data: dict) -> Nonconformity:
        """Neue Nichtkonformität anlegen."""
        nc = Nonconformity(**data)
        self.db.add(nc)
        await self.db.commit()
        await self.db.refresh(nc)
        return nc

    async def update_nonconformity(
        self, nc_id: uuid.UUID, data: dict
    ) -> Nonconformity | None:
        """Nichtkonformität aktualisieren."""
        result = await self.db.execute(
            select(Nonconformity).where(Nonconformity.id == nc_id)
        )
        nc = result.scalar_one_or_none()
        if not nc:
            return None
        for key, value in data.items():
            if value is not None:
                setattr(nc, key, value)
        await self.db.commit()
        await self.db.refresh(nc)
        return nc
