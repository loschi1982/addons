"""
emission_service.py – CO₂-Emissionsberechnung.

Berechnet CO₂-Emissionen auf Basis von Verbrauchsdaten und
Emissionsfaktoren aus verschiedenen Quellen (BAFA, UBA, Electricity Maps).
"""

import uuid
from datetime import date

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger()


class EmissionService:
    """Service für CO₂-Bilanzierung."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_co2_dashboard(self, year: int | None = None) -> dict:
        """CO₂-Dashboard-Daten berechnen."""
        raise NotImplementedError

    async def get_co2_summary(self, start_date: date, end_date: date) -> dict:
        """CO₂-Zusammenfassung für einen Zeitraum."""
        raise NotImplementedError

    async def calculate_emissions(
        self,
        start_date: date,
        end_date: date,
        meter_ids: list[uuid.UUID] | None = None,
    ) -> list[dict]:
        """
        CO₂-Emissionen für Zeitraum berechnen.

        Algorithmus:
        1. Verbrauchsdaten je Zähler und Monat laden
        2. Passenden Emissionsfaktor ermitteln (Priorität: Override > Electricity Maps > BAFA > UBA)
        3. CO₂ = Verbrauch_kWh × Faktor_g/kWh / 1000 → kg
        4. Ergebnis speichern
        """
        raise NotImplementedError

    async def list_factor_sources(self) -> list[dict]:
        """Verfügbare Emissionsfaktor-Quellen auflisten."""
        raise NotImplementedError

    async def list_factors(self, **filters) -> list[dict]:
        """Emissionsfaktoren mit Filtern auflisten."""
        raise NotImplementedError

    async def create_factor(self, data: dict) -> dict:
        """Eigenen Emissionsfaktor anlegen."""
        raise NotImplementedError
