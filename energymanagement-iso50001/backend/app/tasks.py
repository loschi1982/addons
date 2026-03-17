"""
tasks.py – Celery-Tasks für Hintergrundverarbeitung.

Celery wird für zeitgesteuerte und rechenintensive Aufgaben verwendet:
- Automatisches Polling von Zählerständen
- Wetterdaten-Abruf vom DWD
- CO₂-Neuberechnung
- PDF-Berichtserstellung
- Witterungskorrektur-Berechnung
"""

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


@celery_app.task(name="app.tasks.poll_all_meters")
def poll_all_meters():
    """Alle konfigurierten Zähler automatisch abfragen."""
    # TODO: PollingManager aufrufen
    pass


@celery_app.task(name="app.tasks.fetch_weather_data")
def fetch_weather_data():
    """Wetterdaten vom DWD abrufen und Gradtagszahlen berechnen."""
    # TODO: WeatherService.fetch_from_dwd() aufrufen
    pass


@celery_app.task(name="app.tasks.recalculate_co2")
def recalculate_co2():
    """CO₂-Emissionen für den aktuellen Monat neu berechnen."""
    # TODO: EmissionService.calculate_emissions() aufrufen
    pass


@celery_app.task(name="app.tasks.generate_report_pdf")
def generate_report_pdf(report_id: str):
    """PDF-Bericht im Hintergrund generieren."""
    # TODO: ReportService.generate_pdf() aufrufen
    pass


@celery_app.task(name="app.tasks.calculate_weather_correction")
def calculate_weather_correction(meter_id: str, start_date: str, end_date: str):
    """Witterungskorrektur im Hintergrund berechnen."""
    # TODO: WeatherCorrectionService.calculate_correction() aufrufen
    pass
