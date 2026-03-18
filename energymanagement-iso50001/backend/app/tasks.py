"""
tasks.py – Celery-Tasks für Hintergrundverarbeitung.

Celery wird für zeitgesteuerte und rechenintensive Aufgaben verwendet:
- Automatisches Polling von Zählerständen
- Wetterdaten-Abruf vom DWD
- CO₂-Neuberechnung
- PDF-Berichtserstellung
- Witterungskorrektur-Berechnung
"""

import asyncio
from datetime import date, timedelta

from celery import Celery

from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "energymanagement",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Europe/Berlin",
    enable_utc=True,
    # Beat-Schedule: periodische Tasks
    beat_schedule={
        "poll-meters-every-5-min": {
            "task": "app.tasks.poll_all_meters",
            "schedule": 300.0,  # alle 5 Minuten
        },
        "fetch-weather-daily": {
            "task": "app.tasks.fetch_weather_data",
            "schedule": 86400.0,  # einmal täglich
        },
        "recalculate-co2-daily": {
            "task": "app.tasks.recalculate_co2",
            "schedule": 86400.0,
        },
    },
)


def _run_async(coro):
    """Hilfsfunktion: Async-Code in synchronem Celery-Task ausführen."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


async def _get_db_session():
    """Neue DB-Session für Celery-Tasks erstellen."""
    from app.core.database import async_session_factory
    async with async_session_factory() as session:
        yield session


@celery_app.task(name="app.tasks.poll_all_meters")
def poll_all_meters():
    """Alle konfigurierten Zähler automatisch abfragen."""
    async def _run():
        from app.core.database import async_session_factory
        from app.integrations.polling_manager import PollingManager

        async with async_session_factory() as db:
            manager = PollingManager(db)
            return await manager.poll_all_meters()

    return _run_async(_run())


@celery_app.task(name="app.tasks.fetch_weather_data")
def fetch_weather_data():
    """Wetterdaten vom DWD abrufen und Gradtagszahlen berechnen."""
    async def _run():
        from app.core.database import async_session_factory
        from app.services.weather_service import WeatherService

        async with async_session_factory() as db:
            service = WeatherService(db)
            return await service.fetch_all_active_stations()

    return _run_async(_run())


@celery_app.task(name="app.tasks.recalculate_co2")
def recalculate_co2():
    """CO₂-Emissionen für den aktuellen Monat neu berechnen."""
    async def _run():
        from app.core.database import async_session_factory
        from app.services.co2_service import CO2Service

        today = date.today()
        start = date(today.year, today.month, 1)

        async with async_session_factory() as db:
            service = CO2Service(db)
            return await service.calculate_all_meters(start, today)

    return _run_async(_run())


@celery_app.task(name="app.tasks.generate_report_pdf", bind=True)
def generate_report_pdf(self, report_id: str):
    """PDF-Bericht im Hintergrund generieren."""
    import uuid

    async def _run():
        from app.core.database import async_session_factory
        from app.services.report_service import ReportService

        async with async_session_factory() as db:
            service = ReportService(db)
            return await service.generate_pdf(uuid.UUID(report_id))

    return _run_async(_run())


@celery_app.task(name="app.tasks.calculate_weather_correction")
def calculate_weather_correction(meter_id: str, start_date: str, end_date: str):
    """Witterungskorrektur im Hintergrund berechnen."""
    import uuid

    async def _run():
        from app.core.database import async_session_factory
        from app.services.weather_service import WeatherCorrectionService

        async with async_session_factory() as db:
            service = WeatherCorrectionService(db)
            return await service.calculate_correction(
                uuid.UUID(meter_id),
                date.fromisoformat(start_date),
                date.fromisoformat(end_date),
            )

    return _run_async(_run())
