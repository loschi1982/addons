"""
energy_review.py – Pydantic Schemas für die Energiebewertung.

SEU, EnPI, Baseline und relevante Variablen.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel


# ── Relevante Variablen ──


class RelevantVariableCreate(BaseModel):
    name: str
    variable_type: str
    unit: str
    description: str | None = None
    data_source: str | None = None
    source_config: dict | None = None


class RelevantVariableUpdate(BaseModel):
    name: str | None = None
    variable_type: str | None = None
    unit: str | None = None
    description: str | None = None
    data_source: str | None = None
    source_config: dict | None = None
    is_active: bool | None = None


class RelevantVariableResponse(BaseModel):
    id: uuid.UUID
    name: str
    variable_type: str
    unit: str
    description: str | None
    data_source: str | None
    source_config: dict | None
    is_active: bool
    latest_value: Decimal | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class VariableValueCreate(BaseModel):
    period_start: date
    period_end: date
    value: Decimal
    source: str = "manual"


class VariableValueResponse(BaseModel):
    id: uuid.UUID
    variable_id: uuid.UUID
    period_start: date
    period_end: date
    value: Decimal
    source: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ── SEU ──


class SEUCreate(BaseModel):
    consumer_id: uuid.UUID | None = None
    name: str
    energy_type: str
    determination_method: str = "manual"
    determination_criteria: str | None = None
    monitoring_requirements: list | None = None
    responsible_person: str | None = None
    review_date: date | None = None
    notes: str | None = None


class SEUUpdate(BaseModel):
    name: str | None = None
    energy_type: str | None = None
    determination_method: str | None = None
    determination_criteria: str | None = None
    consumption_share_percent: Decimal | None = None
    annual_consumption_kwh: Decimal | None = None
    monitoring_requirements: list | None = None
    responsible_person: str | None = None
    review_date: date | None = None
    notes: str | None = None
    is_active: bool | None = None


class SEUResponse(BaseModel):
    id: uuid.UUID
    consumer_id: uuid.UUID | None
    name: str
    energy_type: str
    determination_method: str
    determination_criteria: str | None
    consumption_share_percent: Decimal | None
    annual_consumption_kwh: Decimal | None
    monitoring_requirements: list | None
    responsible_person: str | None
    review_date: date | None
    notes: str | None
    is_active: bool
    consumer_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class SEUSuggestion(BaseModel):
    """Vorschlag für einen wesentlichen Energieeinsatz."""
    consumer_id: uuid.UUID
    consumer_name: str
    energy_type: str
    consumption_kwh: Decimal
    share_percent: Decimal
    suggested_reason: str


# ── EnPI ──


class EnPICreate(BaseModel):
    name: str
    description: str | None = None
    formula_type: str = "specific"
    unit: str
    numerator_meter_ids: list[str] = []
    denominator_variable_id: uuid.UUID | None = None
    denominator_fixed_value: Decimal | None = None
    seu_id: uuid.UUID | None = None
    target_value: Decimal | None = None
    target_direction: str = "lower"


class EnPIUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    formula_type: str | None = None
    unit: str | None = None
    numerator_meter_ids: list[str] | None = None
    denominator_variable_id: uuid.UUID | None = None
    denominator_fixed_value: Decimal | None = None
    seu_id: uuid.UUID | None = None
    target_value: Decimal | None = None
    target_direction: str | None = None
    is_active: bool | None = None


class EnPIResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    formula_type: str
    unit: str
    numerator_meter_ids: list
    denominator_variable_id: uuid.UUID | None
    denominator_fixed_value: Decimal | None
    seu_id: uuid.UUID | None
    target_value: Decimal | None
    target_direction: str
    is_active: bool
    latest_value: Decimal | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class EnPIValueResponse(BaseModel):
    id: uuid.UUID
    enpi_id: uuid.UUID
    period_start: date
    period_end: date
    numerator_value: Decimal
    denominator_value: Decimal | None
    enpi_value: Decimal
    created_at: datetime

    model_config = {"from_attributes": True}


class EnPITrendPoint(BaseModel):
    """Einzelner Datenpunkt für den EnPI-Trend-Chart."""
    period_start: date
    period_end: date
    enpi_value: Decimal
    baseline_value: Decimal | None = None


# ── Baseline ──


class BaselineCreate(BaseModel):
    enpi_id: uuid.UUID
    name: str
    period_start: date
    period_end: date
    adjustment_factors: list | None = None
    revision_reason: str | None = None


class BaselineUpdate(BaseModel):
    name: str | None = None
    adjustment_factors: list | None = None
    adjusted_baseline_value: Decimal | None = None
    is_current: bool | None = None
    revision_reason: str | None = None


class BaselineResponse(BaseModel):
    id: uuid.UUID
    enpi_id: uuid.UUID
    name: str
    period_start: date
    period_end: date
    baseline_value: Decimal
    total_consumption_kwh: Decimal | None
    adjustment_factors: list | None
    adjusted_baseline_value: Decimal | None
    is_current: bool
    revision_reason: str | None
    superseded_by_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class BaselineComparison(BaseModel):
    """Vergleich: Baseline vs. aktueller Wert."""
    enpi_id: uuid.UUID
    enpi_name: str
    baseline_value: Decimal
    adjusted_baseline_value: Decimal | None
    current_value: Decimal | None
    improvement_percent: Decimal | None
    target_value: Decimal | None
