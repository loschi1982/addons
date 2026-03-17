"""
seed.py – Laden der Stammdaten beim ersten Start.

Seed-Daten sind vordefinierte Datensätze, die das System für den
Betrieb braucht – z.B. Benutzerrollen, CO₂-Emissionsfaktoren und
Wetterstationen. Sie werden beim ersten Start automatisch geladen.

Alle Seed-Funktionen sind idempotent: Werden sie erneut aufgerufen,
überspringen sie bereits vorhandene Einträge, ohne sie zu überschreiben.
"""

import json
from pathlib import Path

import structlog

logger = structlog.get_logger()

# Pfad zu den Seed-Daten-Dateien
SEED_DATA_DIR = Path(__file__).parent.parent.parent / "seed_data"


async def run_all_seeds():
    """
    Lädt alle Seed-Daten in die Datenbank.
    Wird beim Start der App aufgerufen (siehe main.py).
    """
    logger.info("seed_data_start", message="Lade Seed-Daten...")

    try:
        await load_roles_permissions()
    except Exception as e:
        logger.warning("seed_roles_failed", error=str(e))

    try:
        await load_emission_factors()
    except Exception as e:
        logger.warning("seed_emission_factors_failed", error=str(e))

    try:
        await load_dwd_stations()
    except Exception as e:
        logger.warning("seed_dwd_stations_failed", error=str(e))

    logger.info("seed_data_complete", message="Seed-Daten geladen")


async def load_roles_permissions():
    """
    Lädt die vordefinierten Rollen und Berechtigungen.

    5 Standardrollen: Administrator, Energiemanager, Auditor, Techniker, Viewer
    Jede Rolle hat einen definierten Satz an Berechtigungen (siehe Spec).
    """
    seed_file = SEED_DATA_DIR / "roles_permissions.json"
    if not seed_file.exists():
        logger.warning("seed_file_missing", file="roles_permissions.json")
        return

    data = json.loads(seed_file.read_text(encoding="utf-8"))
    logger.info("seed_roles_loaded", roles=len(data.get("roles", [])))
    # TODO: Rollen und Berechtigungen in DB schreiben (Phase 1)


async def load_emission_factors():
    """
    Lädt die BAFA- und UBA-Emissionsfaktoren.

    BAFA: CO₂-Faktoren für verschiedene Energieträger (Strom, Gas, etc.)
    UBA: Historische Strommix-Emissionsfaktoren (Zeitreihe ab 2010)
    """
    for filename in ["emission_factors_bafa.json", "emission_factors_uba.json"]:
        seed_file = SEED_DATA_DIR / filename
        if not seed_file.exists():
            logger.warning("seed_file_missing", file=filename)
            continue

        data = json.loads(seed_file.read_text(encoding="utf-8"))
        logger.info("seed_emission_factors_loaded", file=filename, count=len(data.get("factors", [])))
        # TODO: Emissionsfaktoren in DB schreiben (Phase 3)


async def load_dwd_stations():
    """
    Lädt die DWD-Wetterstationen mit Koordinaten.

    Diese Stationen werden für die automatische Zuordnung verwendet:
    Beim Anlegen eines Standorts wird die nächstgelegene Station
    anhand der Geo-Koordinaten bestimmt (Haversine-Distanz).
    """
    seed_file = SEED_DATA_DIR / "dwd_stations.json"
    if not seed_file.exists():
        logger.warning("seed_file_missing", file="dwd_stations.json")
        return

    data = json.loads(seed_file.read_text(encoding="utf-8"))
    logger.info("seed_dwd_stations_loaded", count=len(data.get("stations", [])))
    # TODO: Wetterstationen in DB schreiben (Phase 3)
