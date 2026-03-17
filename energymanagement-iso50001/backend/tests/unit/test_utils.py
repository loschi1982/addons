"""
test_utils.py – Tests für Hilfsfunktionen.
"""

from decimal import Decimal

from app.core.utils import convert_gas_m3_to_kwh, convert_mwh_to_kwh


def test_convert_gas_m3_to_kwh_default():
    """Gas m³ → kWh mit Standard-Brennwert (10.3)."""
    result = convert_gas_m3_to_kwh(Decimal("100"))
    assert result == Decimal("1030.0")


def test_convert_gas_m3_to_kwh_custom():
    """Gas m³ → kWh mit benutzerdefiniertem Brennwert."""
    result = convert_gas_m3_to_kwh(Decimal("100"), factor=Decimal("11.5"))
    assert result == Decimal("1150.0")


def test_convert_mwh_to_kwh():
    """MWh → kWh Umrechnung."""
    result = convert_mwh_to_kwh(Decimal("2.5"))
    assert result == Decimal("2500")
