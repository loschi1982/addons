"""
common.py – Gemeinsame Schema-Bausteine.

Basis-Klassen und Hilfstypen, die in vielen Schemas wiederverwendet
werden: Pagination, Sortierung, Standard-Responses.
"""

import uuid
from datetime import date, datetime
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


# ---------------------------------------------------------------------------
# Basis-Konfiguration
# ---------------------------------------------------------------------------

class BaseSchema(BaseModel):
    """Basis für alle Schemas – aktiviert orm_mode / from_attributes."""
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------

class PaginationParams(BaseModel):
    """Query-Parameter für paginierte Listen."""
    page: int = Field(1, ge=1, description="Seitennummer (ab 1)")
    page_size: int = Field(25, ge=1, le=100, description="Einträge pro Seite")
    sort_by: str | None = Field(None, description="Feld zum Sortieren")
    sort_order: str = Field("asc", pattern="^(asc|desc)$")


class PaginatedResponse(BaseSchema, Generic[T]):
    """Standardisierte paginierte Antwort."""
    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int


# ---------------------------------------------------------------------------
# Standard-Responses
# ---------------------------------------------------------------------------

class MessageResponse(BaseModel):
    """Einfache Textnachricht, z.B. nach erfolgreicher Aktion."""
    message: str
    detail: str | None = None


class DeleteResponse(BaseModel):
    """Bestätigung einer Löschaktion."""
    message: str = "Erfolgreich gelöscht"
    id: uuid.UUID


class BulkDeleteResponse(BaseModel):
    """Bestätigung einer Massen-Löschaktion."""
    message: str
    deleted_count: int
    failed_ids: list[uuid.UUID] = []


class HealthResponse(BaseModel):
    """Health-Check Antwort."""
    status: str = "ok"
    version: str
    database: str = "connected"
    redis: str = "connected"


# ---------------------------------------------------------------------------
# Filter-Hilfstypen
# ---------------------------------------------------------------------------

class DateRangeFilter(BaseModel):
    """Zeitraumfilter für diverse Abfragen."""
    start_date: date
    end_date: date


class UUIDList(BaseModel):
    """Liste von UUIDs, z.B. für Bulk-Operationen."""
    ids: list[uuid.UUID]
