"""
tasks.py – Celery-Tasks für Hintergrundverarbeitung.

Celery wird für zeitgesteuerte und rechenintensive Aufgaben verwendet:
- Automatisches Polling von Zählerständen
- Wetterdaten-Abruf vom DWD
- CO₂-Neuberechnung
- PDF-Berichtserstellung
- Witterungskorrektur-Berechnung

Wichtig: Jeder Task erstellt eine eigene DB-Engine + Session,
weil Celery prefork-Worker die globale Engine nicht sicher teilen können
(asyncpg erlaubt keine parallelen Operationen auf einer Verbindung).
"""

import asyncio
from contextlib import asynccontextmanager
from datetime import date, timedelta

from celery import Celery
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

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
    # Worker: max 1 Task gleichzeitig pro Prozess (keine Race Conditions)
    worker_concurrency=1,
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
        "daily-maintenance": {
            "task": "app.tasks.daily_maintenance",
            "schedule": 86400.0,  # einmal täglich
        },
        "poll-climate-every-5-min": {
            "task": "app.tasks.poll_climate_sensors",
            "schedule": 300.0,  # alle 5 Minuten
        },
        "recalculate-enpis-daily": {
            "task": "app.tasks.recalculate_enpis",
            "schedule": 86400.0,  # einmal täglich (Vormonat + laufender Monat)
        },
        "recalculate-objectives-daily": {
            "task": "app.tasks.recalculate_objectives",
            "schedule": 86400.0,  # einmal täglich
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


@asynccontextmanager
async def _task_db_session():
    """Eigene Engine + Session pro Task (sicher für prefork-Worker)."""
    engine = create_async_engine(
        settings.database_url,
        echo=False,
        pool_size=2,
        max_overflow=3,
        pool_recycle=1800,
    )
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await engine.dispose()


@celery_app.task(name="app.tasks.poll_all_meters")
def poll_all_meters():
    """Alle konfigurierten Zähler automatisch abfragen."""
    async def _run():
        from app.integrations.polling_manager import PollingManager

        async with _task_db_session() as db:
            manager = PollingManager(db)
            return await manager.poll_all_meters()

    return _run_async(_run())


@celery_app.task(name="app.tasks.fetch_weather_data")
def fetch_weather_data():
    """Wetterdaten vom DWD abrufen und Gradtagszahlen berechnen."""
    async def _run():
        from app.services.weather_service import WeatherService

        async with _task_db_session() as db:
            service = WeatherService(db)
            return await service.fetch_all_active_stations()

    return _run_async(_run())


@celery_app.task(name="app.tasks.recalculate_co2")
def recalculate_co2():
    """CO₂-Emissionen für den aktuellen Monat neu berechnen."""
    async def _run():
        from app.services.co2_service import CO2Service

        today = date.today()
        start = date(today.year, today.month, 1)

        async with _task_db_session() as db:
            service = CO2Service(db)
            return await service.calculate_all_meters(start, today)

    return _run_async(_run())


@celery_app.task(name="app.tasks.poll_climate_sensors")
def poll_climate_sensors():
    """HA-Klimasensoren (Temperatur, Feuchte) automatisch abfragen."""
    async def _run():
        from app.services.climate_service import ClimateService

        async with _task_db_session() as db:
            service = ClimateService(db)
            return await service.poll_ha_sensors()

    return _run_async(_run())


@celery_app.task(name="app.tasks.generate_report_pdf", bind=True)
def generate_report_pdf(self, report_id: str):
    """PDF-Bericht im Hintergrund generieren."""
    import uuid

    async def _run():
        from app.services.report_service import ReportService

        async with _task_db_session() as db:
            service = ReportService(db)
            return await service.generate_pdf(uuid.UUID(report_id))

    return _run_async(_run())


@celery_app.task(name="app.tasks.daily_maintenance")
def daily_maintenance():
    """Tägliche Wartungsaufgaben: Überziehungs-Status, SEU-Anteile."""
    async def _run():
        from app.services.iso_service import ISOService
        from app.services.energy_review_service import EnergyReviewService

        async with _task_db_session() as db:
            iso = ISOService(db)
            overdue = await iso.update_overdue_statuses()

            review = EnergyReviewService(db)
            seu_updated = await review.recalculate_shares()

            return {
                "overdue_objectives": overdue["objectives_updated"],
                "overdue_plans": overdue["plans_updated"],
                "seu_shares_updated": seu_updated,
            }

    return _run_async(_run())


@celery_app.task(name="app.tasks.recalculate_enpis")
def recalculate_enpis():
    """
    Alle aktiven EnPIs für den laufenden und den Vormonat berechnen.

    Wird täglich ausgeführt, damit EnPI-Werte stets aktuell bleiben.
    Der Vormonat wird mitberechnet, da Zählerstände oft verzögert eingehen.
    """
    async def _run():
        from app.services.energy_review_service import EnergyReviewService

        today = date.today()

        # Laufender Monat
        current_start = date(today.year, today.month, 1)
        if today.month == 12:
            current_end = date(today.year + 1, 1, 1)
        else:
            current_end = date(today.year, today.month + 1, 1)

        # Vormonat
        if today.month == 1:
            prev_start = date(today.year - 1, 12, 1)
            prev_end = date(today.year, 1, 1)
        else:
            prev_start = date(today.year, today.month - 1, 1)
            prev_end = current_start

        async with _task_db_session() as db:
            service = EnergyReviewService(db)
            result_prev = await service.calculate_all_enpis(prev_start, prev_end)
            result_curr = await service.calculate_all_enpis(current_start, current_end)
            return {
                "prev_month": result_prev,
                "current_month": result_curr,
            }

    return _run_async(_run())


@celery_app.task(name="app.tasks.recalculate_objectives")
def recalculate_objectives():
    """
    Fortschritt aller aktiven Energieziele aus Zählerdaten berechnen.

    Wird täglich ausgeführt. Ziele mit zugeordneten Zählern (related_meter_ids)
    erhalten automatisch current_value und progress_percent.
    """
    async def _run():
        from app.services.iso_service import ISOService

        async with _task_db_session() as db:
            service = ISOService(db)
            return await service.recalculate_objective_progress()

    return _run_async(_run())


@celery_app.task(name="app.tasks.calculate_weather_correction")
def calculate_weather_correction(meter_id: str, start_date: str, end_date: str):
    """Witterungskorrektur im Hintergrund berechnen."""
    import uuid

    async def _run():
        from app.services.weather_service import WeatherCorrectionService

        async with _task_db_session() as db:
            service = WeatherCorrectionService(db)
            return await service.calculate_correction(
                uuid.UUID(meter_id),
                date.fromisoformat(start_date),
                date.fromisoformat(end_date),
            )

    return _run_async(_run())
