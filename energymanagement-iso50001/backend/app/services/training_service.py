"""
training_service.py – Schulungsdokumentation nach ISO 50001 Kap. 7.2/7.3.
"""

import uuid
from datetime import date, timedelta

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import TrainingRecord

logger = structlog.get_logger()


class TrainingService:
    """Service für Schulungsdokumentation."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_trainings(
        self,
        page: int = 1,
        page_size: int = 25,
        status: str | None = None,
        year: int | None = None,
    ) -> dict:
        query = select(TrainingRecord).order_by(TrainingRecord.training_date.desc())
        if status:
            query = query.where(TrainingRecord.status == status)
        if year:
            query = query.where(
                TrainingRecord.training_date >= date(year, 1, 1),
                TrainingRecord.training_date <= date(year, 12, 31),
            )
        count_q = select(func.count()).select_from(query.subquery())
        total = (await self.db.execute(count_q)).scalar() or 0
        query = query.offset((page - 1) * page_size).limit(page_size)
        result = await self.db.execute(query)
        return {"items": list(result.scalars().all()), "total": total, "page": page, "page_size": page_size, "total_pages": max(1, (total + page_size - 1) // page_size)}

    async def get_training(self, training_id: uuid.UUID) -> TrainingRecord:
        t = await self.db.get(TrainingRecord, training_id)
        if not t:
            raise ValueError("Schulung nicht gefunden")
        return t

    async def create_training(self, data: dict) -> TrainingRecord:
        training = TrainingRecord(**data)
        self.db.add(training)
        await self.db.commit()
        await self.db.refresh(training)
        return training

    async def update_training(self, training_id: uuid.UUID, data: dict) -> TrainingRecord:
        training = await self.get_training(training_id)
        for k, v in data.items():
            if hasattr(training, k):
                setattr(training, k, v)
        await self.db.commit()
        await self.db.refresh(training)
        return training

    async def delete_training(self, training_id: uuid.UUID) -> None:
        training = await self.get_training(training_id)
        await self.db.delete(training)
        await self.db.commit()

    async def get_stats(self) -> dict:
        """Statistiken: Schulungen gesamt, Teilnehmer, fällige Wiederholungen."""
        today = date.today()
        threshold = today + timedelta(days=90)

        total = (await self.db.execute(select(func.count(TrainingRecord.id)))).scalar() or 0
        planned = (await self.db.execute(
            select(func.count(TrainingRecord.id)).where(TrainingRecord.status == "planned")
        )).scalar() or 0
        completed = (await self.db.execute(
            select(func.count(TrainingRecord.id)).where(TrainingRecord.status == "completed")
        )).scalar() or 0

        # Fällige Wiederholungen
        due_result = await self.db.execute(
            select(TrainingRecord).where(
                TrainingRecord.next_training_date.isnot(None),
                TrainingRecord.next_training_date <= threshold,
                TrainingRecord.status != "cancelled",
            ).order_by(TrainingRecord.next_training_date)
        )
        due_soon = [
            {
                "id": str(t.id),
                "title": t.title,
                "next_training_date": t.next_training_date.isoformat() if t.next_training_date else None,
                "overdue": t.next_training_date < today if t.next_training_date else False,
            }
            for t in due_result.scalars().all()
        ]

        return {
            "total": total,
            "planned": planned,
            "completed": completed,
            "due_soon": due_soon,
            "due_count": len(due_soon),
        }
