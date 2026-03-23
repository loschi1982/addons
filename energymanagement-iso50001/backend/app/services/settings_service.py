"""
settings_service.py – Anwendungseinstellungen verwalten.

CRUD für Key-Value-Einstellungen mit Kategorie-Filterung
und Standard-Werten für neue Installationen.
"""

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.settings import AppSetting

logger = structlog.get_logger()

# Standard-Einstellungen für neue Installationen
DEFAULT_SETTINGS: dict[str, dict] = {
    "organization": {
        "value": {
            "name": "",
            "logo_url": "",
            "address": "",
            "contact_email": "",
            "contact_phone": "",
        },
        "description": "Organisationsdaten für Berichte und ISO-Dokumente",
        "category": "general",
    },
    "branding": {
        "value": {
            "primary_color": "#1B5E7B",
            "secondary_color": "#2D8EB9",
            "accent_color": "#F59E0B",
        },
        "description": "Farben für UI und Berichte",
        "category": "general",
    },
    "report_defaults": {
        "value": {
            "company_name": "",
            "report_language": "de",
            "include_logo": True,
            "include_weather_correction": True,
            "include_co2": True,
            "default_period_months": 12,
        },
        "description": "Standardeinstellungen für Berichtsgenerierung",
        "category": "reports",
    },
    "enpi_config": {
        "value": {
            "metrics": ["kwh_per_m2", "kwh_per_person"],
            "show_reference_values": True,
            "reference_standard": "vdi_3807",
        },
        "description": "EnPI-Kennzahlen-Konfiguration",
        "category": "energy",
    },
    "notifications": {
        "value": {
            "email_enabled": False,
            "review_reminder_days": 30,
            "audit_reminder_days": 14,
        },
        "description": "Benachrichtigungseinstellungen",
        "category": "notifications",
    },
    "integrations_ha": {
        "value": {
            "base_url": "",
            "access_token": "",
            "auth_enabled": False,
            "default_role": "viewer",
        },
        "description": "Home Assistant Verbindungseinstellungen",
        "category": "integrations",
    },
    "integrations_weather": {
        "value": {
            "enabled": True,
            "provider": "brightsky",
            "base_url": "https://api.brightsky.dev",
            "station_id": "",
            "latitude": None,
            "longitude": None,
        },
        "description": "Wetterdaten-Integration (BrightSky / DWD)",
        "category": "integrations",
    },
    "integrations_co2": {
        "value": {
            "enabled": False,
            "provider": "electricity_maps",
            "api_key": "",
            "zone": "DE",
        },
        "description": "CO₂-Intensität (Electricity Maps)",
        "category": "integrations",
    },
}


class SettingsService:
    """Service für Anwendungseinstellungen."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_all(self, category: str | None = None) -> dict[str, dict]:
        """Alle Einstellungen laden, nach Kategorie filterbar."""
        query = select(AppSetting)
        if category:
            query = query.where(AppSetting.category == category)
        query = query.order_by(AppSetting.category, AppSetting.key)

        result = await self.db.execute(query)
        settings = result.scalars().all()

        # Merge mit Defaults für fehlende Schlüssel
        data: dict[str, dict] = {}
        existing_keys = set()
        for s in settings:
            existing_keys.add(s.key)
            data[s.key] = {
                "value": s.value,
                "description": s.description,
                "category": s.category,
            }

        # Defaults für fehlende Schlüssel ergänzen
        for key, default in DEFAULT_SETTINGS.items():
            if key not in existing_keys:
                if category and default["category"] != category:
                    continue
                data[key] = default

        return data

    async def get(self, key: str) -> dict | None:
        """Einzelne Einstellung laden."""
        result = await self.db.execute(
            select(AppSetting).where(AppSetting.key == key)
        )
        setting = result.scalar_one_or_none()
        if setting:
            return {
                "value": setting.value,
                "description": setting.description,
                "category": setting.category,
            }
        # Fallback auf Default
        return DEFAULT_SETTINGS.get(key)

    async def update(self, key: str, value: dict) -> dict:
        """Einstellung erstellen oder aktualisieren (Upsert)."""
        result = await self.db.execute(
            select(AppSetting).where(AppSetting.key == key)
        )
        setting = result.scalar_one_or_none()

        default = DEFAULT_SETTINGS.get(key, {})
        if setting:
            setting.value = value
        else:
            setting = AppSetting(
                key=key,
                value=value,
                description=default.get("description", ""),
                category=default.get("category", "general"),
            )
            self.db.add(setting)

        await self.db.commit()
        await self.db.refresh(setting)

        return {
            "key": setting.key,
            "value": setting.value,
            "description": setting.description,
            "category": setting.category,
        }

    async def initialize_defaults(self) -> int:
        """Fehlende Standard-Einstellungen anlegen."""
        result = await self.db.execute(select(AppSetting.key))
        existing = {row[0] for row in result.all()}

        created = 0
        for key, default in DEFAULT_SETTINGS.items():
            if key not in existing:
                setting = AppSetting(
                    key=key,
                    value=default["value"],
                    description=default["description"],
                    category=default["category"],
                )
                self.db.add(setting)
                created += 1

        if created:
            await self.db.commit()
        return created
