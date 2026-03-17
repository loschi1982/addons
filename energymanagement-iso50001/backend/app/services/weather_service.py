"""
weather_service.py – Wetterdaten und Witterungskorrektur.

Bezieht Wetterdaten vom DWD (Bright Sky API), berechnet Gradtagszahlen
und führt die Witterungskorrektur des Heizenergieverbrauchs durch.
"""

import uuid
from datetime import date
from decimal import Decimal

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger()


class WeatherService:
    """Service für Wetterdaten und Gradtagszahlen."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_stations(self, search: str | None = None) -> list[dict]:
        """Wetterstationen auflisten."""
        raise NotImplementedError

    async def find_nearest_station(self, lat: Decimal, lon: Decimal, max_km: int = 50) -> dict:
        """Nächste Wetterstation zu gegebenen Koordinaten finden."""
        raise NotImplementedError

    async def get_weather_data(
        self, station_id: uuid.UUID, start_date: date, end_date: date
    ) -> list[dict]:
        """Wetterdaten für Station und Zeitraum abrufen."""
        raise NotImplementedError

    async def get_degree_days(
        self, station_id: uuid.UUID, start_date: date, end_date: date
    ) -> dict:
        """Gradtagszahlen für Zeitraum berechnen/abrufen."""
        raise NotImplementedError

    async def fetch_from_dwd(
        self, station_id: uuid.UUID, start_date: date, end_date: date
    ) -> int:
        """Wetterdaten vom DWD via Bright Sky API abrufen und speichern."""
        raise NotImplementedError


class WeatherCorrectionService:
    """Service für Witterungskorrektur des Heizenergieverbrauchs."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_configs(self) -> list[dict]:
        """Witterungskorrektur-Konfigurationen auflisten."""
        raise NotImplementedError

    async def create_config(self, data: dict) -> dict:
        """Witterungskorrektur für einen Zähler konfigurieren."""
        raise NotImplementedError

    async def calculate_correction(
        self, meter_id: uuid.UUID, start_date: date, end_date: date
    ) -> list[dict]:
        """
        Witterungskorrektur berechnen.

        Formel (Gradtagszahl-Methode):
        korrigierter_Verbrauch = Rohverbrauch × (Referenz-GTZ / Ist-GTZ)

        Bei Grundlast-Anteil:
        korrigierter_Verbrauch = Grundlast + (Rohverbrauch - Grundlast) × (Ref-GTZ / Ist-GTZ)
        """
        raise NotImplementedError

    async def get_corrected_consumption(
        self, meter_id: uuid.UUID, start_date: date, end_date: date
    ) -> list[dict]:
        """Gespeicherte witterungskorrigierte Verbrauchsdaten abrufen."""
        raise NotImplementedError
