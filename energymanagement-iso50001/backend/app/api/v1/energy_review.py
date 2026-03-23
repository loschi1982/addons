"""
energy_review.py – Endpunkte für die Energiebewertung (ISO 50001 Kap. 6.3–6.5).

SEU, EnPI, Baseline und relevante Variablen.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.models.user import User
from app.schemas.common import DeleteResponse, PaginatedResponse
from app.schemas.energy_review import (
    BaselineComparison,
    BaselineCreate,
    BaselineResponse,
    BaselineUpdate,
    EnPICreate,
    EnPIResponse,
    EnPITrendPoint,
    EnPIUpdate,
    EnPIValueResponse,
    RelevantVariableCreate,
    RelevantVariableResponse,
    RelevantVariableUpdate,
    SEUCreate,
    SEUResponse,
    SEUSuggestion,
    SEUUpdate,
    VariableValueCreate,
    VariableValueResponse,
)
from app.services.energy_review_service import EnergyReviewService

router = APIRouter()


# ---------------------------------------------------------------------------
# Relevante Variablen
# ---------------------------------------------------------------------------


@router.get("/variables", response_model=PaginatedResponse[RelevantVariableResponse])
async def list_variables(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Relevante Variablen auflisten."""
    service = EnergyReviewService(db)
    result = await service.list_variables(page=page, page_size=page_size)
    total = result["total"]

    # Letzten Wert pro Variable laden
    items = []
    for v in result["items"]:
        latest = await service.get_latest_variable_value(v.id)
        resp = RelevantVariableResponse.model_validate(v)
        resp.latest_value = latest
        items.append(resp)

    return PaginatedResponse(
        items=items,
        total=total,
        page=result["page"],
        page_size=result["page_size"],
        total_pages=(total + page_size - 1) // page_size if total > 0 else 0,
    )


@router.post("/variables", response_model=RelevantVariableResponse, status_code=201)
async def create_variable(
    request: RelevantVariableCreate,
    current_user: User = Depends(require_permission("iso", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Neue relevante Variable anlegen."""
    service = EnergyReviewService(db)
    variable = await service.create_variable(request.model_dump())
    return RelevantVariableResponse.model_validate(variable)


@router.get("/variables/{variable_id}", response_model=RelevantVariableResponse)
async def get_variable(
    variable_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Einzelne Variable abrufen."""
    service = EnergyReviewService(db)
    variable = await service.get_variable(variable_id)
    latest = await service.get_latest_variable_value(variable_id)
    resp = RelevantVariableResponse.model_validate(variable)
    resp.latest_value = latest
    return resp


@router.put("/variables/{variable_id}", response_model=RelevantVariableResponse)
async def update_variable(
    variable_id: uuid.UUID,
    request: RelevantVariableUpdate,
    current_user: User = Depends(require_permission("iso", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Variable aktualisieren."""
    service = EnergyReviewService(db)
    variable = await service.update_variable(
        variable_id, request.model_dump(exclude_unset=True)
    )
    return RelevantVariableResponse.model_validate(variable)


@router.delete("/variables/{variable_id}", response_model=DeleteResponse)
async def delete_variable(
    variable_id: uuid.UUID,
    current_user: User = Depends(require_permission("iso", "delete")),
    db: AsyncSession = Depends(get_db),
):
    """Variable deaktivieren."""
    service = EnergyReviewService(db)
    await service.delete_variable(variable_id)
    return DeleteResponse(id=variable_id)


@router.post(
    "/variables/{variable_id}/values",
    response_model=VariableValueResponse,
    status_code=201,
)
async def add_variable_value(
    variable_id: uuid.UUID,
    request: VariableValueCreate,
    current_user: User = Depends(require_permission("iso", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Messwert für eine Variable hinzufügen."""
    service = EnergyReviewService(db)
    value = await service.add_variable_value(variable_id, request.model_dump())
    return VariableValueResponse.model_validate(value)


@router.get(
    "/variables/{variable_id}/values",
    response_model=list[VariableValueResponse],
)
async def list_variable_values(
    variable_id: uuid.UUID,
    period_start: date | None = None,
    period_end: date | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Messwerte einer Variable auflisten."""
    service = EnergyReviewService(db)
    values = await service.list_variable_values(
        variable_id, period_start, period_end
    )
    return [VariableValueResponse.model_validate(v) for v in values]


@router.post("/variables/{variable_id}/import-hdd")
async def import_hdd_values(
    variable_id: uuid.UUID,
    station_id: uuid.UUID = Query(...),
    period_start: date = Query(...),
    period_end: date = Query(...),
    current_user: User = Depends(require_permission("iso", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Heizgradtage aus Wetterdaten importieren."""
    service = EnergyReviewService(db)
    count = await service.import_hdd(
        variable_id, station_id, period_start, period_end
    )
    return {"imported": count, "variable_id": str(variable_id)}


# ---------------------------------------------------------------------------
# Wesentliche Energieeinsätze (SEU)
# ---------------------------------------------------------------------------


@router.get("/seu", response_model=PaginatedResponse[SEUResponse])
async def list_seus(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Wesentliche Energieeinsätze auflisten."""
    service = EnergyReviewService(db)
    result = await service.list_seus(page=page, page_size=page_size)
    total = result["total"]

    items = []
    for seu in result["items"]:
        resp = SEUResponse.model_validate(seu)
        resp.consumer_name = seu.consumer.name if seu.consumer else None
        items.append(resp)

    return PaginatedResponse(
        items=items,
        total=total,
        page=result["page"],
        page_size=result["page_size"],
        total_pages=(total + page_size - 1) // page_size if total > 0 else 0,
    )


@router.post("/seu", response_model=SEUResponse, status_code=201)
async def create_seu(
    request: SEUCreate,
    current_user: User = Depends(require_permission("iso", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Neuen SEU anlegen."""
    service = EnergyReviewService(db)
    seu = await service.create_seu(request.model_dump())
    return SEUResponse.model_validate(seu)


@router.get("/seu/suggestions", response_model=list[SEUSuggestion])
async def suggest_seus(
    threshold: float = Query(5.0, ge=0, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """SEU-Vorschläge basierend auf Verbrauchsanteil generieren."""
    service = EnergyReviewService(db)
    suggestions = await service.suggest_seus(threshold)
    return [SEUSuggestion(**s) for s in suggestions]


@router.get("/seu/{seu_id}", response_model=SEUResponse)
async def get_seu(
    seu_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Einzelnen SEU abrufen."""
    service = EnergyReviewService(db)
    seu = await service.get_seu(seu_id)
    resp = SEUResponse.model_validate(seu)
    resp.consumer_name = seu.consumer.name if seu.consumer else None
    return resp


@router.put("/seu/{seu_id}", response_model=SEUResponse)
async def update_seu(
    seu_id: uuid.UUID,
    request: SEUUpdate,
    current_user: User = Depends(require_permission("iso", "update")),
    db: AsyncSession = Depends(get_db),
):
    """SEU aktualisieren."""
    service = EnergyReviewService(db)
    seu = await service.update_seu(seu_id, request.model_dump(exclude_unset=True))
    return SEUResponse.model_validate(seu)


@router.delete("/seu/{seu_id}", response_model=DeleteResponse)
async def delete_seu(
    seu_id: uuid.UUID,
    current_user: User = Depends(require_permission("iso", "delete")),
    db: AsyncSession = Depends(get_db),
):
    """SEU deaktivieren."""
    service = EnergyReviewService(db)
    await service.delete_seu(seu_id)
    return DeleteResponse(id=seu_id)


@router.post("/seu/recalculate")
async def recalculate_shares(
    current_user: User = Depends(require_permission("iso", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Verbrauchsanteile aller SEUs neu berechnen."""
    service = EnergyReviewService(db)
    updated = await service.recalculate_shares()
    return {"updated": updated}


# ---------------------------------------------------------------------------
# Energieleistungskennzahlen (EnPI)
# ---------------------------------------------------------------------------


@router.get("/enpi", response_model=PaginatedResponse[EnPIResponse])
async def list_enpis(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Energieleistungskennzahlen auflisten."""
    service = EnergyReviewService(db)
    result = await service.list_enpis(page=page, page_size=page_size)
    total = result["total"]

    items = []
    for enpi in result["items"]:
        resp = EnPIResponse.model_validate(enpi)
        resp.latest_value = await service.get_latest_enpi_value(enpi.id)
        items.append(resp)

    return PaginatedResponse(
        items=items,
        total=total,
        page=result["page"],
        page_size=result["page_size"],
        total_pages=(total + page_size - 1) // page_size if total > 0 else 0,
    )


@router.post("/enpi", response_model=EnPIResponse, status_code=201)
async def create_enpi(
    request: EnPICreate,
    current_user: User = Depends(require_permission("iso", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Neuen EnPI anlegen."""
    service = EnergyReviewService(db)
    enpi = await service.create_enpi(request.model_dump())
    return EnPIResponse.model_validate(enpi)


@router.get("/enpi/{enpi_id}", response_model=EnPIResponse)
async def get_enpi(
    enpi_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Einzelnen EnPI abrufen."""
    service = EnergyReviewService(db)
    enpi = await service.get_enpi(enpi_id)
    resp = EnPIResponse.model_validate(enpi)
    resp.latest_value = await service.get_latest_enpi_value(enpi_id)
    return resp


@router.put("/enpi/{enpi_id}", response_model=EnPIResponse)
async def update_enpi(
    enpi_id: uuid.UUID,
    request: EnPIUpdate,
    current_user: User = Depends(require_permission("iso", "update")),
    db: AsyncSession = Depends(get_db),
):
    """EnPI aktualisieren."""
    service = EnergyReviewService(db)
    enpi = await service.update_enpi(enpi_id, request.model_dump(exclude_unset=True))
    return EnPIResponse.model_validate(enpi)


@router.delete("/enpi/{enpi_id}", response_model=DeleteResponse)
async def delete_enpi(
    enpi_id: uuid.UUID,
    current_user: User = Depends(require_permission("iso", "delete")),
    db: AsyncSession = Depends(get_db),
):
    """EnPI deaktivieren."""
    service = EnergyReviewService(db)
    await service.delete_enpi(enpi_id)
    return DeleteResponse(id=enpi_id)


@router.post("/enpi/{enpi_id}/calculate", response_model=EnPIValueResponse)
async def calculate_enpi(
    enpi_id: uuid.UUID,
    period_start: date = Query(...),
    period_end: date = Query(...),
    current_user: User = Depends(require_permission("iso", "update")),
    db: AsyncSession = Depends(get_db),
):
    """EnPI für einen Zeitraum berechnen."""
    service = EnergyReviewService(db)
    value = await service.calculate_enpi(enpi_id, period_start, period_end)
    return EnPIValueResponse.model_validate(value)


@router.get("/enpi/{enpi_id}/trend", response_model=list[EnPITrendPoint])
async def get_enpi_trend(
    enpi_id: uuid.UUID,
    period_start: date | None = None,
    period_end: date | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """EnPI-Trend-Daten für Chart abrufen."""
    service = EnergyReviewService(db)
    trend = await service.get_enpi_trend(enpi_id, period_start, period_end)
    return [EnPITrendPoint(**t) for t in trend]


@router.post("/enpi/calculate-all")
async def calculate_all_enpis(
    period_start: date = Query(...),
    period_end: date = Query(...),
    current_user: User = Depends(require_permission("iso", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Alle aktiven EnPIs für einen Zeitraum berechnen."""
    service = EnergyReviewService(db)
    return await service.calculate_all_enpis(period_start, period_end)


# ---------------------------------------------------------------------------
# Energetische Ausgangsbasis (EnB / Baseline)
# ---------------------------------------------------------------------------


@router.get("/baselines", response_model=list[BaselineResponse])
async def list_baselines(
    enpi_id: uuid.UUID | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Baselines auflisten."""
    service = EnergyReviewService(db)
    baselines = await service.list_baselines(enpi_id)
    return [BaselineResponse.model_validate(b) for b in baselines]


@router.post("/baselines", response_model=BaselineResponse, status_code=201)
async def create_baseline(
    request: BaselineCreate,
    current_user: User = Depends(require_permission("iso", "create")),
    db: AsyncSession = Depends(get_db),
):
    """Neue Baseline anlegen (Wert wird automatisch berechnet)."""
    service = EnergyReviewService(db)
    baseline = await service.create_baseline(request.model_dump())
    return BaselineResponse.model_validate(baseline)


@router.get("/baselines/{baseline_id}", response_model=BaselineResponse)
async def get_baseline(
    baseline_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Einzelne Baseline abrufen."""
    service = EnergyReviewService(db)
    baseline = await service.get_baseline(baseline_id)
    return BaselineResponse.model_validate(baseline)


@router.put("/baselines/{baseline_id}", response_model=BaselineResponse)
async def update_baseline(
    baseline_id: uuid.UUID,
    request: BaselineUpdate,
    current_user: User = Depends(require_permission("iso", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Baseline aktualisieren."""
    service = EnergyReviewService(db)
    baseline = await service.update_baseline(
        baseline_id, request.model_dump(exclude_unset=True)
    )
    return BaselineResponse.model_validate(baseline)


@router.post("/baselines/{baseline_id}/revise", response_model=BaselineResponse)
async def revise_baseline(
    baseline_id: uuid.UUID,
    request: BaselineCreate,
    current_user: User = Depends(require_permission("iso", "update")),
    db: AsyncSession = Depends(get_db),
):
    """Baseline revidieren (neue Baseline erstellen, alte ersetzen)."""
    service = EnergyReviewService(db)
    baseline = await service.revise_baseline(baseline_id, request.model_dump())
    return BaselineResponse.model_validate(baseline)


@router.get(
    "/baselines/{baseline_id}/comparison",
    response_model=BaselineComparison,
)
async def get_baseline_comparison(
    baseline_id: uuid.UUID,
    period_start: date = Query(...),
    period_end: date = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Baseline vs. aktuellen Wert vergleichen."""
    service = EnergyReviewService(db)
    baseline = await service.get_baseline(baseline_id)
    comparison = await service.get_comparison(
        baseline.enpi_id, period_start, period_end
    )
    return BaselineComparison(**comparison)
