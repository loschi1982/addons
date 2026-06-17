"""Pydantic-Schemas fuer die interne API (App <-> Frontend)."""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


# --- Themen ---------------------------------------------------------------

class ThemaCreate(BaseModel):
    name: str = Field(..., min_length=1)


class Thema(BaseModel):
    id: int
    name: str
    erstellt_am: str


# --- Dokumente ------------------------------------------------------------

class Dokument(BaseModel):
    """Eintrag im Vertragsbaum."""

    id: int
    titel: str
    eltern_id: Optional[int] = None
    anzahl_markierungen: int = 0


class ParentUpdate(BaseModel):
    eltern_id: Optional[int] = None


# --- Markierungen ---------------------------------------------------------

class MarkierungCreate(BaseModel):
    dokument_id: int
    thema_id: Optional[int] = None
    textauszug: str = Field(..., min_length=1)
    notiz: Optional[str] = None
    # Seite optional: wird serverseitig bestimmt, falls nicht (sicher) bekannt.
    seite: Optional[int] = None
    # Startindex der Markierung im OCR-content (zur Seiten-Disambiguierung).
    offset: Optional[int] = None


class MarkierungUpdate(BaseModel):
    # Notiz an einer bestehenden Markierung setzen/ändern (Post-It). None löscht sie.
    notiz: Optional[str] = None


class Markierung(BaseModel):
    id: int
    dokument_id: int
    thema_id: Optional[int] = None
    seite: int
    textauszug: str
    notiz: Optional[str] = None
    erstellt_am: str


# --- Verknuepfungen -------------------------------------------------------

class VerknuepfungCreate(BaseModel):
    markierung_a_id: int
    markierung_b_id: int


class Verknuepfung(BaseModel):
    id: int
    markierung_a_id: int
    markierung_b_id: int


# --- Themenuebersicht -----------------------------------------------------

class UebersichtMarkierung(BaseModel):
    id: int
    dokument_id: int
    dokument_titel: str
    seite: int
    textauszug: str
    notiz: Optional[str] = None
    verknuepft_mit: List[int] = []


class UebersichtThema(BaseModel):
    thema_id: Optional[int] = None
    name: str
    markierungen: List[UebersichtMarkierung] = []
