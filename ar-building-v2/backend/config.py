# Lädt die Anwendungseinstellungen aus /data/settings.json.
# Diese Datei wird von run.sh beim ersten Start erstellt.

import json
import os
from typing import Optional

# Pfad zur Einstellungsdatei im persistenten HA-Speicher.
SETTINGS_PATH = "/data/settings.json"

# Standardwerte falls eine Einstellung fehlt.
# planradar_customer_id ist neu in v2.1.0 — alte Installationen ohne dieses Feld crashen nicht.
DEFAULT_SETTINGS = {
    "ha_url": "",
    "ha_token": "",
    "planradar_token": "",
    "planradar_customer_id": "",   # NEU: Pflicht für alle PlanRadar-API-Aufrufe
    "jwt_secret": "changeme-please",
    "jwt_expire_hours": 12,
    "visitor_token": None,          # Dauerhafter Besucher-Token (wird beim ersten Abruf generiert)
    "visitor_token_enabled": False, # Token aktiv oder deaktiviert
}


def load_settings() -> dict:
    """Liest die Einstellungen aus der JSON-Datei.
    Falls die Datei fehlt oder beschädigt ist, werden Standardwerte zurückgegeben.
    Fehlende Felder (z.B. planradar_customer_id bei alten Installationen) werden
    automatisch mit Standardwerten aufgefüllt — kein KeyError möglich."""
    if not os.path.exists(SETTINGS_PATH):
        return DEFAULT_SETTINGS.copy()
    try:
        with open(SETTINGS_PATH, "r") as f:
            data = json.load(f)
        # Fehlende Felder mit Standardwerten auffüllen.
        for k, v in DEFAULT_SETTINGS.items():
            if k not in data:
                data[k] = v
        return data
    except Exception:
        return DEFAULT_SETTINGS.copy()


def save_settings(settings: dict) -> dict:
    """Speichert die Einstellungen in die JSON-Datei und gibt sie zurück."""
    # Verzeichnis anlegen falls es noch nicht existiert.
    os.makedirs(os.path.dirname(SETTINGS_PATH), exist_ok=True)
    with open(SETTINGS_PATH, "w") as f:
        json.dump(settings, f, indent=2)
    return settings


def get_jwt_secret() -> str:
    """Gibt das JWT-Secret aus den Einstellungen zurück."""
    return load_settings().get("jwt_secret", "changeme-please")


def get_jwt_expire_hours() -> int:
    """Gibt die JWT-Gültigkeitsdauer in Stunden zurück."""
    return int(load_settings().get("jwt_expire_hours", 12))