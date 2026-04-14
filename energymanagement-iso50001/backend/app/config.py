"""
config.py – Zentrale Konfiguration des Energy Management Backends.

Alle Einstellungen werden aus Umgebungsvariablen gelesen. Pydantic-Settings
validiert die Werte automatisch und gibt sinnvolle Fehlermeldungen, wenn
eine Pflicht-Variable fehlt oder einen ungültigen Wert hat.

In der Produktion setzt docker-compose die Umgebungsvariablen.
In der Entwicklung können sie in einer .env-Datei definiert werden.
"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def _read_version() -> str:
    """Liest die Version aus der VERSION-Datei im Projekt-Root."""
    version_file = Path(__file__).resolve().parent.parent.parent / "VERSION"
    try:
        return version_file.read_text().strip()
    except FileNotFoundError:
        return "0.0.0"


class Settings(BaseSettings):
    """
    Anwendungskonfiguration – wird einmal beim Start geladen.

    Jedes Feld entspricht einer Umgebungsvariable (GROSSBUCHSTABEN).
    Beispiel: database_url → Umgebungsvariable DATABASE_URL
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # ── Datenbank ──
    # TimescaleDB (PostgreSQL) – läuft im Container.
    # Daten werden in /data/postgresql/ persistiert.
    database_url: str = "postgresql+asyncpg://energy:energy@localhost:5432/energy_management"

    # ── Redis ──
    # Wird für Celery (Hintergrund-Tasks) und optionales Caching verwendet.
    redis_url: str = "redis://redis:6379/0"

    # ── Sicherheit ──
    # Geheimer Schlüssel für die JWT-Token-Signierung.
    # MUSS in der Produktion auf einen zufälligen Wert gesetzt werden!
    secret_key: str = "CHANGE-ME-in-production-use-a-random-64-char-hex-string"

    # Wie lange ein Access Token gültig ist (in Minuten).
    # Nach Ablauf muss der Client einen neuen Token über /auth/refresh holen.
    access_token_expire_minutes: int = 30

    # Wie lange ein Refresh Token gültig ist (in Tagen).
    refresh_token_expire_days: int = 7

    # ── Home Assistant Integration (optional) ──
    # Wenn ein Home Assistant als Datenquelle genutzt wird:
    # Long-Lived Access Token aus HA Profil → HA_ACCESS_TOKEN
    ha_access_token: str = ""
    ha_supervisor_token: str = ""  # veraltet, für Rückwärtskompatibilität

    # Basis-URL der HA-API, z.B. http://192.168.1.100:8123
    ha_base_url: str = ""

    # Deployment-Modus (informativ)
    deployment_mode: str = "standalone"

    # HA-Authentifizierung als Alternative zum eigenen Login (Standard: deaktiviert)
    ha_auth_enabled: bool = False
    ha_default_role: str = "viewer"

    # ── Externe APIs ──
    # Bright Sky API für Wetterdaten (kostenlos, kein Key nötig)
    bright_sky_enabled: bool = True
    bright_sky_base_url: str = "https://api.brightsky.dev"

    # Electricity Maps API für Echtzeit-CO₂-Intensität des Stromnetzes
    # Free Tier: 1 Zone, 50 Requests/Stunde
    electricity_maps_api_key: str = ""

    # ── Dateien ──
    # Verzeichnis für hochgeladene Dokumente
    upload_dir: str = "/data/uploads"
    # Verzeichnis für generierte PDF-Berichte (überschreibbar via REPORT_PDF_DIR)
    report_pdf_dir: str = ""

    # ── Allgemein ──
    language: str = "de"
    log_level: str = "info"

    # ── Anwendung ──
    app_name: str = "Energy Management ISO 50001"
    app_version: str = _read_version()
    debug: bool = False


# Singleton-Instanz: Wird einmal erstellt und überall wiederverwendet
_settings: Settings | None = None


def get_settings() -> Settings:
    """
    Gibt die globale Settings-Instanz zurück.
    Erstellt sie beim ersten Aufruf (Lazy Loading).
    """
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
