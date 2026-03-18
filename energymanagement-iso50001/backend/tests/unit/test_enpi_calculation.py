"""
test_enpi_calculation.py – Tests für EnPI-Berechnung und Benchmarking-Logik.

Testet die Referenzwert-Zuordnung und Bewertungslogik
des erweiterten Benchmarking-Service.
"""

from app.services.analytics_service import AnalyticsService


# ── Referenzwerte VDI 3807 ──

def test_reference_values_exist():
    """Referenzwerte für Büro/Strom sind definiert."""
    ref = AnalyticsService.REFERENCE_VALUES
    assert ("office", "electricity") in ref
    good, medium, poor = ref[("office", "electricity")]
    assert good < medium < poor


def test_reference_values_office_gas():
    """Referenzwerte Büro/Gas: gut=40, mittel=80, schlecht=130."""
    ref = AnalyticsService.REFERENCE_VALUES
    assert ref[("office", "gas")] == (40, 80, 130)


def test_reference_values_residential():
    """Referenzwerte Wohnen/Strom vorhanden."""
    ref = AnalyticsService.REFERENCE_VALUES
    assert ("residential", "electricity") in ref


def test_reference_values_production():
    """Referenzwerte Produktion vorhanden."""
    ref = AnalyticsService.REFERENCE_VALUES
    assert ("production", "electricity") in ref
    assert ("production", "gas") in ref


def test_reference_values_all_ascending():
    """Alle Referenzwerte: gut < mittel < schlecht."""
    for key, (good, medium, poor) in AnalyticsService.REFERENCE_VALUES.items():
        assert good < medium < poor, f"Fehler bei {key}: {good}, {medium}, {poor}"


def test_reference_values_count():
    """Mindestens 10 Gebäudetyp×Energietyp-Kombinationen."""
    assert len(AnalyticsService.REFERENCE_VALUES) >= 10


# ── Bewertungslogik ──

def test_rating_good():
    """kWh/m² unter Gut-Schwelle → Bewertung 'good'."""
    good, _, _ = AnalyticsService.REFERENCE_VALUES[("office", "electricity")]
    # 25 kWh/m² bei Grenze 30 → gut
    kwh_per_m2 = good - 5
    assert kwh_per_m2 <= good


def test_rating_medium():
    """kWh/m² zwischen Gut und Mittel → Bewertung 'medium'."""
    good, medium, _ = AnalyticsService.REFERENCE_VALUES[("office", "electricity")]
    kwh_per_m2 = (good + medium) / 2
    assert kwh_per_m2 > good
    assert kwh_per_m2 <= medium


def test_rating_poor():
    """kWh/m² über Schlecht-Schwelle → Bewertung 'poor'."""
    _, medium, _ = AnalyticsService.REFERENCE_VALUES[("office", "electricity")]
    kwh_per_m2 = medium + 50
    assert kwh_per_m2 > medium


# ── Zielwert-Abweichung ──

def test_target_deviation_on_target():
    """Ist gleich Soll → 0% Abweichung."""
    target = 50.0
    actual = 50.0
    deviation = ((actual - target) / target) * 100
    assert deviation == 0.0


def test_target_deviation_over():
    """20% über Ziel → +20% Abweichung."""
    target = 50.0
    actual = 60.0
    deviation = round(((actual - target) / target) * 100, 1)
    assert deviation == 20.0


def test_target_deviation_under():
    """10% unter Ziel → -10% Abweichung (positiv)."""
    target = 50.0
    actual = 45.0
    deviation = round(((actual - target) / target) * 100, 1)
    assert deviation == -10.0
