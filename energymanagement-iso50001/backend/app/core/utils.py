"""
utils.py – Hilfsfunktionen, die überall im Backend verwendet werden.

Sammlung von kleinen, wiederverwendbaren Funktionen für häufige
Aufgaben wie UUID-Generierung, Datumsformatierung und Einheitenumrechnung.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal


def generate_uuid() -> uuid.UUID:
    """Erzeugt eine neue zufällige UUID (Version 4)."""
    return uuid.uuid4()


def utc_now() -> datetime:
    """Gibt die aktuelle Zeit in UTC zurück."""
    return datetime.now(timezone.utc)


def today() -> date:
    """Gibt das heutige Datum zurück."""
    return date.today()


def convert_gas_m3_to_kwh(
    volume_m3: Decimal,
    conversion_factor: Decimal = Decimal("10.3"),
) -> Decimal:
    """
    Rechnet Gasverbrauch von Kubikmetern in Kilowattstunden um.

    Der Brennwert von Erdgas liegt typischerweise bei 10,0–11,4 kWh/m³.
    Der Standardwert 10,3 kWh/m³ ist ein in Deutschland üblicher Durchschnitt.

    Args:
        volume_m3: Gasverbrauch in Kubikmetern
        conversion_factor: Brennwert in kWh/m³ (Standard: 10,3)

    Returns:
        Verbrauch in kWh
    """
    return volume_m3 * conversion_factor


def convert_mwh_to_kwh(value_mwh: Decimal) -> Decimal:
    """Rechnet Megawattstunden in Kilowattstunden um (× 1000)."""
    return value_mwh * Decimal("1000")
