"""
test_bright_sky.py – Tests für Gradtagszahl-Berechnung.
"""

from decimal import Decimal

from app.integrations.bright_sky import BrightSkyClient


def test_calculate_hdd_cold_day():
    """Heizgradtage an einem kalten Tag (unter Heizgrenze)."""
    hdd = BrightSkyClient.calculate_hdd(Decimal("5.0"))
    assert hdd == Decimal("15.0")  # 20 - 5 = 15


def test_calculate_hdd_warm_day():
    """Keine Heizgradtage an einem warmen Tag (über Heizgrenze)."""
    hdd = BrightSkyClient.calculate_hdd(Decimal("18.0"))
    assert hdd == Decimal("0")  # 18 >= 15 → 0


def test_calculate_cdd_hot_day():
    """Kühlgradtage an einem heißen Tag."""
    cdd = BrightSkyClient.calculate_cdd(Decimal("30.0"))
    assert cdd == Decimal("6.0")  # 30 - 24 = 6


def test_calculate_cdd_cool_day():
    """Keine Kühlgradtage an einem kühlen Tag."""
    cdd = BrightSkyClient.calculate_cdd(Decimal("20.0"))
    assert cdd == Decimal("0")
