# Pydantic-Schema für die Anwendungseinstellungen.
# Datei: backend/schemas/settings.py

from typing import Optional

from pydantic import BaseModel


class Settings(BaseModel):
    """Alle konfigurierbaren Einstellungen der Anwendung."""
    ha_url: str = ""
    ha_token: str = ""
    planradar_token: str = ""
    # NEU in v2.1.0: Customer-ID für die PlanRadar-API (Pflicht für alle PlanRadar-Aufrufe)
    planradar_customer_id: str = ""
    jwt_secret: str = ""
    jwt_expire_hours: int = 12
    visitor_token: Optional[str] = None
    visitor_token_enabled: bool = False