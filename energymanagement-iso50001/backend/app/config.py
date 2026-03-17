"""
config.py – Zentrale Konfiguration des Energy Management Backends.

Alle Einstellungen werden aus Umgebungsvariablen gelesen. Pydantic-Settings
validiert die Werte automatisch und gibt sinnvolle Fehlermeldungen, wenn
eine Pflicht-Variable fehlt oder einen ungültigen Wert hat.

In der Produktion (als HA Add-on) setzt das run.sh-Skript die Variablen.
In der Entwicklung können sie in einer .env-Datei definiert werden.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


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
    # Verbindungs-URL zur TimescaleDB/PostgreSQL-Datenbank.
    # Format: postgresql+asyncpg://benutzer:passwort@host:port/datenbankname
    database_url: str = "postgresql+asyncpg://energy:energy@timescaledb:5432/energy_management"

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

    # ── Home Assistant ──
    # Supervisor-Token für den Zugriff auf die HA-API.
    # Wird automatisch von HA gesetzt, wenn das Add-on läuft.
    ha_supervisor_token: str = ""

    # Basis-URL der HA-API (innerhalb des Add-on-Containers)
    ha_base_url: str = "http://supervisor/core"

    # Soll HA-Authentifizierung als Alternative zum eigenen Login erlaubt sein?
    ha_auth_enabled: bool = False

    # Standard-Rolle für automatisch angelegte HA-Benutzer
    ha_default_role: str = "viewer"

    # ── Externe APIs ──
    # Bright Sky API für Wetterdaten (kostenlos, kein Key nötig)
    bright_sky_enabled: bool = True
    bright_sky_base_url: str = "https://api.brightsky.dev"

    # Electricity Maps API für Echtzeit-CO₂-Intensität des Stromnetzes
    # Free Tier: 1 Zone, 50 Requests/Stunde
    electricity_maps_api_key: str = ""

    # ── Allgemein ──
    language: str = "de"
    log_level: str = "info"

    # ── Anwendung ──
    app_name: str = "Energy Management ISO 50001"
    app_version: str = "0.1.0"
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
