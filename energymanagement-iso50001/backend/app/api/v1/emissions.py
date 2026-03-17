"""
emissions.py – Endpunkte für CO₂-Emissionen.

CO₂-Berechnung auf Basis von Emissionsfaktoren (BAFA, UBA,
Electricity Maps) und Verbrauchsdaten der Zähler.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.user import User
from app.schemas.emission import (
    CO2DashboardData,
    CO2Summary,
    EmissionFactorCreate,
    EmissionFactorResponse,
    EmissionFactorSourceResponse,
)

router = APIRouter()


@router.get("/dashboard", response_model=CO2DashboardData)
async def get_co2_dashboard(
    year: int | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """CO₂-Dashboard-Daten abrufen."""
    raise NotImplementedError("EmissionService noch nicht implementiert")


@router.get("/summary", response_model=CO2Summary)
async def get_co2_summary(
    start_date: date = Query(...),
    end_date: date = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """CO₂-Zusammenfassung für einen Zeitraum."""
    raise NotImplementedError("EmissionService noch nicht implementiert")


@router.get("/factors/sources", response_model=list[EmissionFactorSourceResponse])
async def list_factor_sources(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Verfügbare Emissionsfaktor-Quellen auflisten."""
    raise NotImplementedError("EmissionService noch nicht implementiert")


@router.get("/factors", response_model=list[EmissionFactorResponse])
async def list_factors(
    energy_type: str | None = None,
    year: int | None = None,
    source_id: uuid.UUID | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Emissionsfaktoren auflisten."""
    raise NotImplementedError("EmissionService noch nicht implementiert")


@router.post("/factors", response_model=EmissionFactorResponse, status_code=201)
async def create_factor(
    request: EmissionFactorCreate,
    current_user: User = Depends(require_permission("emissions", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Eigenen Emissionsfaktor anlegen."""
    raise NotImplementedError("EmissionService noch nicht implementiert")


@router.post("/calculate")
async def trigger_calculation(
    start_date: date = Query(...),
    end_date: date = Query(...),
    meter_ids: str | None = Query(None),
    current_user: User = Depends(require_permission("emissions", "calculate")),
    db: AsyncSession = Depends(get_db),
):
    """CO₂-Neuberechnung für einen Zeitraum anstoßen."""
    raise NotImplementedError("EmissionService noch nicht implementiert")
