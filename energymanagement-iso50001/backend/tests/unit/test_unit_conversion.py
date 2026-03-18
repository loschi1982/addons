"""
test_unit_conversion.py – Tests für Einheitenumrechnung.

Testet die Brennwert-Umrechnungsfaktoren die in mehreren
Services verwendet werden (analytics, co2, dashboard).
"""

from decimal import Decimal

from app.core.utils import convert_gas_m3_to_kwh, convert_mwh_to_kwh


# ── Gas m³ → kWh ──

def test_gas_m3_to_kwh_standard():
    """100 m³ Gas × 10,3 kWh/m³ = 1030 kWh."""
    assert convert_gas_m3_to_kwh(Decimal("100")) == Decimal("1030.0")


def test_gas_m3_to_kwh_custom_factor():
    """Benutzerdefinierter Brennwert (11,5 kWh/m³)."""
    result = convert_gas_m3_to_kwh(Decimal("100"), Decimal("11.5"))
    assert result == Decimal("1150.0")


def test_gas_m3_to_kwh_zero():
    """0 m³ → 0 kWh."""
    assert convert_gas_m3_to_kwh(Decimal("0")) == Decimal("0")


def test_gas_m3_to_kwh_fractional():
    """Nachkommastellen korrekt berechnet."""
    result = convert_gas_m3_to_kwh(Decimal("0.5"))
    assert result == Decimal("5.15")


# ── MWh → kWh ──

def test_mwh_to_kwh():
    """2,5 MWh = 2500 kWh."""
    assert convert_mwh_to_kwh(Decimal("2.5")) == Decimal("2500")


def test_mwh_to_kwh_zero():
    """0 MWh = 0 kWh."""
    assert convert_mwh_to_kwh(Decimal("0")) == Decimal("0")


def test_mwh_to_kwh_small():
    """0,001 MWh = 1 kWh."""
    assert convert_mwh_to_kwh(Decimal("0.001")) == Decimal("1.000")


# ── CONVERSION_FACTORS dict ──

def test_conversion_factors_keys():
    """Alle erwarteten Einheiten sind im Umrechnungstabelle."""
    from app.services.co2_service import CONVERSION_FACTORS

    expected = {"m³", "l", "kg", "MWh", "kWh"}
    assert set(CONVERSION_FACTORS.keys()) == expected


def test_conversion_factor_kwh_is_one():
    """kWh → kWh ist Faktor 1."""
    from app.services.co2_service import CONVERSION_FACTORS

    assert CONVERSION_FACTORS["kWh"] == Decimal("1")


def test_conversion_factor_mwh():
    """MWh → kWh ist Faktor 1000."""
    from app.services.co2_service import CONVERSION_FACTORS

    assert CONVERSION_FACTORS["MWh"] == Decimal("1000")
