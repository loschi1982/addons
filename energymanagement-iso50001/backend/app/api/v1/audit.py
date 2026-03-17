"""
audit.py – Audit-Log Endpunkte.

Zeigt die Protokollierung aller sicherheitsrelevanten Aktionen.
Nur für Administratoren einsehbar.
"""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_permission
from app.models.user import AuditLog, User
from app.schemas.common import PaginatedResponse, BaseSchema

router = APIRouter()


class AuditLogResponse(BaseSchema):
    """Audit-Log Eintrag in API-Responses."""
    id: uuid.UUID
    user_id: uuid.UUID | None
    username: str | None = None
    action: str
    resource_type: str | None
    resource_id: uuid.UUID | None
    details: dict | None
    ip_address: str | None
    timestamp: str


@router.get("", response_model=PaginatedResponse[AuditLogResponse])
async def list_audit_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    user_id: uuid.UUID | None = None,
    action: str | None = None,
    resource_type: str | None = None,
    current_user: User = require_permission("audit", "view"),
    db: AsyncSession = Depends(get_db),
):
    """
    Audit-Log durchsuchen (nur Admin).

    Zeigt alle sicherheitsrelevanten Aktionen chronologisch an.
    """
    query = select(AuditLog)

    if user_id:
        query = query.where(AuditLog.user_id == user_id)
    if action:
        query = query.where(AuditLog.action == action)
    if resource_type:
        query = query.where(AuditLog.resource_type == resource_type)

    # Gesamtanzahl
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    # Pagination (neueste zuerst)
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size).order_by(AuditLog.timestamp.desc())

    result = await db.execute(query)
    logs = result.scalars().all()

    # Benutzernamen laden
    user_ids = {log.user_id for log in logs if log.user_id}
    usernames = {}
    if user_ids:
        users_result = await db.execute(
            select(User.id, User.username).where(User.id.in_(user_ids))
        )
        usernames = {row.id: row.username for row in users_result}

    items = [
        AuditLogResponse(
            id=log.id,
            user_id=log.user_id,
            username=usernames.get(log.user_id) if log.user_id else None,
            action=log.action,
            resource_type=log.resource_type,
            resource_id=log.resource_id,
            details=log.details,
            ip_address=log.ip_address,
            timestamp=log.timestamp.isoformat(),
        )
        for log in logs
    ]

    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size if total > 0 else 0,
    )
