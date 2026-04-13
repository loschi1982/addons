"""
control_strategy_service.py – BMS-Regelstrategien und Sollwert-Tracking.

Verwaltet Regelstrategien und vergleicht Sollwerte mit tatsächlichen
Klimasensor-Messwerten aus der Datenbank.
"""

import uuid
from datetime import date, timedelta
from decimal import Decimal

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.control_strategy import ControlStrategy

logger = structlog.get_logger()


class ControlStrategyService:
    """Service für BMS-Regelstrategien."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_strategies(
        self,
        page: int = 1,
        page_size: int = 25,
        strategy_type: str | None = None,
        is_active: bool | None = True,
    ) -> dict:
        query = (
            select(ControlStrategy)
            .options(
                selectinload(ControlStrategy.building),
                selectinload(ControlStrategy.usage_unit),
            )
        )
        if strategy_type:
            query = query.where(ControlStrategy.strategy_type == strategy_type)
        if is_active is not None:
            query = query.where(ControlStrategy.is_active == is_active)
        query = query.order_by(ControlStrategy.name)

        count_q = select(func.count()).select_from(query.subquery())
        total = (await self.db.execute(count_q)).scalar() or 0
        query = query.offset((page - 1) * page_size).limit(page_size)
        result = await self.db.execute(query)
        return {"items": list(result.scalars().all()), "total": total, "page": page, "page_size": page_size}

    async def get_strategy(self, strategy_id: uuid.UUID) -> ControlStrategy:
        result = await self.db.execute(
            select(ControlStrategy)
            .options(
                selectinload(ControlStrategy.building),
                selectinload(ControlStrategy.usage_unit),
            )
            .where(ControlStrategy.id == strategy_id)
        )
        strategy = result.scalar_one_or_none()
        if not strategy:
            raise ValueError("Regelstrategie nicht gefunden")
        return strategy

    async def create_strategy(self, data: dict) -> ControlStrategy:
        strategy = ControlStrategy(**data)
        self.db.add(strategy)
        await self.db.commit()
        await self.db.refresh(strategy)
        return strategy

    async def update_strategy(self, strategy_id: uuid.UUID, data: dict) -> ControlStrategy:
        strategy = await self.db.get(ControlStrategy, strategy_id)
        if not strategy:
            raise ValueError("Regelstrategie nicht gefunden")
        for k, v in data.items():
            if hasattr(strategy, k):
                setattr(strategy, k, v)
        await self.db.commit()
        await self.db.refresh(strategy)
        return strategy

    async def delete_strategy(self, strategy_id: uuid.UUID) -> None:
        strategy = await self.db.get(ControlStrategy, strategy_id)
        if not strategy:
            raise ValueError("Regelstrategie nicht gefunden")
        strategy.is_active = False
        await self.db.commit()

    async def get_compliance_report(
        self,
        strategy_id: uuid.UUID,
        period_start: date,
        period_end: date,
    ) -> dict:
        """
        Soll-/Ist-Vergleich: Regelstrategie vs. Klimasensormesswerte.

        Liest durchschnittliche Temperatur/CO₂-Werte aus climate_readings
        für die Nutzungseinheit der Strategie und vergleicht mit Sollwerten.
        """
        from app.models.climate import ClimateReading, ClimateSensor

        strategy = await self.get_strategy(strategy_id)

        result = {
            "strategy_id": str(strategy_id),
            "strategy_name": strategy.name,
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "setpoint_heating": float(strategy.setpoint_heating) if strategy.setpoint_heating else None,
            "setpoint_cooling": float(strategy.setpoint_cooling) if strategy.setpoint_cooling else None,
            "max_co2_ppm": float(strategy.max_co2_ppm) if strategy.max_co2_ppm else None,
            "avg_temperature": None,
            "avg_co2_ppm": None,
            "temp_compliant": None,
            "co2_compliant": None,
            "sensor_count": 0,
        }

        if not strategy.usage_unit_id:
            result["note"] = "Keine Nutzungseinheit zugeordnet – kein Vergleich möglich."
            return result

        # Klimasensoren der Nutzungseinheit
        sensors_result = await self.db.execute(
            select(ClimateSensor.id).where(
                ClimateSensor.usage_unit_id == strategy.usage_unit_id,
                ClimateSensor.is_active == True,  # noqa: E712
            )
        )
        sensor_ids = [row[0] for row in sensors_result.all()]
        result["sensor_count"] = len(sensor_ids)

        if not sensor_ids:
            result["note"] = "Keine aktiven Klimasensoren in der Nutzungseinheit."
            return result

        # Durchschnittswerte im Zeitraum
        from datetime import datetime, timezone
        ts_start = datetime.combine(period_start, datetime.min.time(), tzinfo=timezone.utc)
        ts_end = datetime.combine(period_end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)

        agg_q = select(
            func.avg(ClimateReading.temperature_c).label("avg_temp"),
            func.avg(ClimateReading.co2_ppm).label("avg_co2"),
        ).where(
            ClimateReading.sensor_id.in_(sensor_ids),
            ClimateReading.timestamp >= ts_start,
            ClimateReading.timestamp < ts_end,
        )
        row = (await self.db.execute(agg_q)).one()

        avg_temp = round(float(row.avg_temp), 1) if row.avg_temp is not None else None
        avg_co2 = round(float(row.avg_co2), 0) if row.avg_co2 is not None else None
        result["avg_temperature"] = avg_temp
        result["avg_co2_ppm"] = avg_co2

        # Compliance prüfen
        if avg_temp is not None and strategy.setpoint_heating:
            # Toleranz ±1 K
            sp = float(strategy.setpoint_heating)
            result["temp_compliant"] = (sp - 1.0) <= avg_temp <= (sp + 1.0)
        if avg_co2 is not None and strategy.max_co2_ppm:
            result["co2_compliant"] = avg_co2 <= float(strategy.max_co2_ppm)

        return result
