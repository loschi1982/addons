"""
monitoring_point.py – Schemas für Betrachtungspunkte des Energieschemas.
"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


ScopeType = Literal["site", "building", "usage_unit", "meter"]


class MonitoringPointCreate(BaseModel):
    """Eingabe beim Anlegen eines Betrachtungspunktes."""
    label: str = Field(..., min_length=1, max_length=255)
    scope_type: ScopeType
    scope_id: uuid.UUID
    energy_type: str | None = Field(None, max_length=50)

    @model_validator(mode="after")
    def _check_scope(self) -> "MonitoringPointCreate":
        if self.scope_type == "meter" and self.energy_type is not None:
            # Bei Zähler-Scope wird die Energieart vom Zähler übernommen
            # – ein expliziter Filter ist hier sinnlos.
            self.energy_type = None
        return self


class MonitoringPointResponse(BaseModel):
    """Auflistung eines Betrachtungspunktes."""
    id: uuid.UUID
    label: str
    scope_type: ScopeType
    scope_id: uuid.UUID
    scope_name: str | None = None  # Anzeige-Name (Site/Building/Unit/Meter)
    energy_type: str | None = None
    meter_count: int = 0
    is_active: bool = True
    created_at: datetime

    class Config:
        from_attributes = True
