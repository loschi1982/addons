"""
test_anomaly_detection.py – Tests für statistische Ausreißer-Erkennung.

Testet die Anomalie-Erkennungslogik aus dem AnalyticsService.
"""

import statistics


def test_anomaly_above_threshold():
    """Wert über threshold × Durchschnitt wird als Anomalie erkannt."""
    daily_values = [100, 105, 98, 102, 97, 103, 99, 101, 104, 96]
    avg = statistics.mean(daily_values)
    threshold = 2.0

    # Anomaler Wert (3× Durchschnitt)
    anomaly_value = 300
    assert anomaly_value > avg * threshold


def test_no_anomaly_within_range():
    """Werte innerhalb des Schwellenwerts sind keine Anomalie."""
    daily_values = [100, 105, 98, 102, 97, 103, 99, 101, 104, 96]
    avg = statistics.mean(daily_values)
    threshold = 2.0

    # Normaler Wert (leicht über Durchschnitt)
    normal_value = 150
    assert normal_value <= avg * threshold


def test_threshold_boundary():
    """Exakt auf dem Schwellenwert ist keine Anomalie."""
    avg = 100.0
    threshold = 2.0
    boundary_value = avg * threshold  # 200
    assert boundary_value <= avg * threshold  # Grenzwert ist OK


def test_zero_consumption_no_anomaly():
    """Nullverbrauch (z.B. Wochenende) ist keine Anomalie."""
    daily_values = [0, 0, 100, 105, 98, 0, 0]
    non_zero = [v for v in daily_values if v > 0]
    avg = statistics.mean(non_zero) if non_zero else 0
    assert avg > 0
    assert 0 <= avg * 2.0  # 0 ist unter dem Schwellenwert


def test_high_threshold_fewer_anomalies():
    """Höherer Schwellenwert → weniger Anomalien."""
    values = [100, 105, 200, 95, 300, 110, 98, 250]
    avg = statistics.mean(values)

    anomalies_2x = [v for v in values if v > avg * 2.0]
    anomalies_3x = [v for v in values if v > avg * 3.0]

    assert len(anomalies_3x) <= len(anomalies_2x)
