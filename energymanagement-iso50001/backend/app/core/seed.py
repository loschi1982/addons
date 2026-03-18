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
from sqlalchemy import select

from app.core.database import _async_session_factory

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
    from app.models.role import Permission, Role, RolePermission

    seed_file = SEED_DATA_DIR / "roles_permissions.json"
    if not seed_file.exists():
        logger.warning("seed_file_missing", file="roles_permissions.json")
        return

    data = json.loads(seed_file.read_text(encoding="utf-8"))

    async with _async_session_factory() as session:
        # 1. Berechtigungen anlegen (falls nicht vorhanden)
        existing_perms = (await session.execute(select(Permission))).scalars().all()
        existing_perm_keys = {f"{p.module}.{p.action}" for p in existing_perms}

        perm_map = {}  # "module.action" → Permission-Objekt
        for p in existing_perms:
            perm_map[f"{p.module}.{p.action}"] = p

        new_perm_count = 0
        for perm_data in data.get("permissions", []):
            key = f"{perm_data['module']}.{perm_data['action']}"
            if key not in existing_perm_keys:
                perm = Permission(
                    module=perm_data["module"],
                    action=perm_data["action"],
                    resource_scope=perm_data.get("resource_scope", "all"),
                    description=perm_data.get("description", f"{perm_data['module']}.{perm_data['action']}"),
                    category=perm_data.get("category", "Allgemein"),
                )
                session.add(perm)
                perm_map[key] = perm
                new_perm_count += 1

        if new_perm_count > 0:
            await session.flush()  # IDs generieren

        # 2. Rollen anlegen und Berechtigungen zuordnen
        existing_roles = (await session.execute(select(Role))).scalars().all()
        existing_role_names = {r.name for r in existing_roles}

        new_role_count = 0
        for role_data in data.get("roles", []):
            if role_data["name"] in existing_role_names:
                continue

            role = Role(
                name=role_data["name"],
                display_name=role_data["display_name"],
                description=role_data.get("description"),
                is_system_role=role_data.get("is_system_role", False),
            )
            session.add(role)
            await session.flush()  # Role-ID generieren

            # Berechtigungen zuordnen
            role_perms = role_data.get("permissions", [])
            for perm_key in role_perms:
                if perm_key == "*":
                    # Alle Berechtigungen zuordnen (Administrator)
                    for p in perm_map.values():
                        rp = RolePermission(role_id=role.id, permission_id=p.id)
                        session.add(rp)
                elif perm_key.endswith(".*"):
                    # Alle Aktionen eines Moduls (z.B. "meters.*")
                    module = perm_key[:-2]
                    for key, p in perm_map.items():
                        if key.startswith(f"{module}."):
                            rp = RolePermission(role_id=role.id, permission_id=p.id)
                            session.add(rp)
                elif perm_key in perm_map:
                    rp = RolePermission(role_id=role.id, permission_id=perm_map[perm_key].id)
                    session.add(rp)

            new_role_count += 1

        await session.commit()
        logger.info(
            "seed_roles_loaded",
            new_roles=new_role_count,
            new_permissions=new_perm_count,
            total_roles=len(existing_role_names) + new_role_count,
        )


async def load_emission_factors():
    """
    Lädt die BAFA- und UBA-Emissionsfaktoren.
    """
    from app.models.emission import EmissionFactor, EmissionFactorSource

    seed_file = SEED_DATA_DIR / "emission_factors.json"
    if not seed_file.exists():
        logger.warning("seed_file_missing", file="emission_factors.json")
        return

    data = json.loads(seed_file.read_text(encoding="utf-8"))

    async with _async_session_factory() as session:
        # Quellen anlegen
        existing_sources = (await session.execute(select(EmissionFactorSource))).scalars().all()
        existing_source_names = {s.name for s in existing_sources}
        source_map = {s.name: s for s in existing_sources}

        for src_data in data.get("sources", []):
            if src_data["name"] not in existing_source_names:
                source = EmissionFactorSource(
                    name=src_data["name"],
                    source_type=src_data["source_type"],
                    description=src_data.get("description"),
                    url=src_data.get("url"),
                    is_default=src_data.get("is_default", False),
                )
                session.add(source)
                source_map[src_data["name"]] = source

        await session.flush()

        # Faktoren anlegen
        existing_factors = (await session.execute(select(EmissionFactor))).scalars().all()
        existing_keys = {
            f"{f.source_id}:{f.energy_type}:{f.year}:{f.month}" for f in existing_factors
        }

        new_count = 0
        for f_data in data.get("factors", []):
            source = source_map.get(f_data["source"])
            if not source:
                continue

            key = f"{source.id}:{f_data['energy_type']}:{f_data['year']}:{f_data.get('month')}"
            if key not in existing_keys:
                factor = EmissionFactor(
                    source_id=source.id,
                    energy_type=f_data["energy_type"],
                    year=f_data["year"],
                    month=f_data.get("month"),
                    region=f_data.get("region"),
                    co2_g_per_kwh=f_data["co2_g_per_kwh"],
                    scope=f_data.get("scope"),
                )
                session.add(factor)
                new_count += 1

        await session.commit()
        logger.info("seed_emission_factors_loaded", new_factors=new_count)


async def load_dwd_stations():
    """
    Lädt die DWD-Wetterstationen mit Koordinaten.
    """
    from app.models.weather import WeatherStation

    seed_file = SEED_DATA_DIR / "dwd_stations.json"
    if not seed_file.exists():
        logger.warning("seed_file_missing", file="dwd_stations.json")
        return

    data = json.loads(seed_file.read_text(encoding="utf-8"))

    async with _async_session_factory() as session:
        existing = (await session.execute(select(WeatherStation))).scalars().all()
        existing_ids = {s.dwd_station_id for s in existing}

        new_count = 0
        for st_data in data.get("stations", []):
            if st_data["dwd_station_id"] not in existing_ids:
                station = WeatherStation(
                    name=st_data["name"],
                    dwd_station_id=st_data["dwd_station_id"],
                    latitude=st_data["latitude"],
                    longitude=st_data["longitude"],
                    altitude=st_data.get("altitude"),
                    data_source=st_data.get("data_source", "bright_sky"),
                )
                session.add(station)
                new_count += 1

        await session.commit()
        logger.info("seed_dwd_stations_loaded", new_stations=new_count)
