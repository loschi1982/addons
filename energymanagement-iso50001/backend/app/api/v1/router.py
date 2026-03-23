"""
router.py – Zentraler API-Router, der alle Sub-Router einbindet.

Jedes Modul hat seinen eigenen Router, der hier unter dem
entsprechenden Prefix registriert wird.
"""

from fastapi import APIRouter

from app.api.v1 import (
    allocations,
    analytics,
    audit,
    auth,
    climate,
    consumers,
    dashboard,
    emissions,
    energy_review,
    imports,
    integrations,
    iso,
    meters,
    readings,
    reports,
    schemas,
    settings,
    sites,
    system,
    users,
    weather,
)

api_router = APIRouter()

# Authentifizierung und Benutzer
api_router.include_router(auth.router, prefix="/auth", tags=["Authentifizierung"])
api_router.include_router(users.router, prefix="/users", tags=["Benutzer"])

# Standort-Hierarchie
api_router.include_router(sites.router, prefix="/sites", tags=["Standorte"])

# Zähler und Verbrauch
api_router.include_router(meters.router, prefix="/meters", tags=["Zähler"])
api_router.include_router(readings.router, prefix="/readings", tags=["Zählerstände"])
api_router.include_router(consumers.router, prefix="/consumers", tags=["Verbraucher"])
api_router.include_router(allocations.router, prefix="/allocations", tags=["Zähler-Zuordnungen"])
api_router.include_router(imports.router, prefix="/imports", tags=["Datenimport"])

# Analysen und Berichte
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["Dashboard"])
api_router.include_router(analytics.router, prefix="/analytics", tags=["Analysen"])
api_router.include_router(schemas.router, prefix="/schemas", tags=["Energieschema"])
api_router.include_router(emissions.router, prefix="/emissions", tags=["CO₂-Emissionen"])
api_router.include_router(weather.router, prefix="/weather", tags=["Wetterdaten"])
api_router.include_router(climate.router, prefix="/climate", tags=["Klimasensoren"])
api_router.include_router(reports.router, prefix="/reports", tags=["Berichte"])

# ISO 50001 Management
api_router.include_router(iso.router, prefix="/iso", tags=["ISO 50001"])

# Energiebewertung (EnPI, Baseline, SEU, Variablen)
api_router.include_router(
    energy_review.router, prefix="/energy-review", tags=["Energiebewertung"]
)

# Integrationen (HA, Shelly, Modbus, KNX, Polling)
api_router.include_router(integrations.router, prefix="/integrations", tags=["Integrationen"])

# Einstellungen
api_router.include_router(settings.router, prefix="/settings", tags=["Einstellungen"])

# Audit-Log
api_router.include_router(audit.router, prefix="/audit", tags=["Audit-Log"])

# System (Version, Updates)
api_router.include_router(system.router, prefix="/system", tags=["System"])
