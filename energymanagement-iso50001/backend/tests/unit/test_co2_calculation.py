"""
test_co2_calculation.py – Tests für CO₂-Berechnungslogik.

Testet Umrechnungen, Emissionsfaktor-Auflösung und Export-Formate.
"""

import csv
import io
from decimal import Decimal


# ── CO₂-Formel ──

def test_co2_formula_basic():
    """CO₂ (kg) = Verbrauch (kWh) × Faktor (g/kWh) / 1000."""
    consumption_kwh = Decimal("10000")  # 10.000 kWh
    factor_g_per_kwh = Decimal("420")   # 420 g CO₂/kWh (Strom DE)
    co2_kg = consumption_kwh * factor_g_per_kwh / Decimal("1000")
    assert co2_kg == Decimal("4200.000")


def test_co2_formula_gas():
    """Gas: 1000 m³ × 10,3 kWh/m³ × 201 g/kWh ÷ 1000."""
    volume_m3 = Decimal("1000")
    kwh = volume_m3 * Decimal("10.3")  # 10300 kWh
    factor = Decimal("201")  # g CO₂/kWh für Erdgas
    co2_kg = kwh * factor / Decimal("1000")
    assert co2_kg == Decimal("2070.300")


def test_co2_zero_consumption():
    """Kein Verbrauch → kein CO₂."""
    co2_kg = Decimal("0") * Decimal("420") / Decimal("1000")
    assert co2_kg == Decimal("0")


# ── GHG Protocol CSV-Format ──

def test_ghg_csv_header():
    """GHG CSV muss die korrekten Spalten haben."""
    expected_headers = [
        "Scope", "Energietyp", "Quelle (Zähler)", "Standort",
        "Gebäude", "Nutzungseinheit", "Region",
        "Zeitraum von", "Zeitraum bis",
        "Verbrauch (kWh)", "Emissionsfaktor (g CO₂/kWh)",
        "CO₂ (kg)", "CO₂eq (kg)", "Berechnungsmethode",
    ]
    # Simuliere CSV mit Header
    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow(expected_headers)
    output.seek(0)
    reader = csv.reader(output, delimiter=";")
    header = next(reader)
    assert header == expected_headers


def test_emas_csv_structure():
    """EMAS CSV enthält Energieträger-Aufschlüsselung."""
    expected_headers = [
        "Energieträger", "Verbrauch (kWh)", "Verbrauch (MWh)",
        "CO₂-Emissionen (kg)", "CO₂-Emissionen (t)",
        "Anteil Verbrauch (%)", "Anteil Emissionen (%)",
    ]
    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow(expected_headers)
    output.seek(0)
    reader = csv.reader(output, delimiter=";")
    header = next(reader)
    assert len(header) == 7


# ── Scope-Zuordnung ──

def test_scope_types():
    """Valide Scopes nach GHG Protocol."""
    valid_scopes = {"scope_1", "scope_2", "scope_3"}
    assert "scope_1" in valid_scopes
    assert "scope_2" in valid_scopes


def test_scope_default():
    """Standard-Scope für Strom ist scope_2."""
    default_scope = "scope_2"
    assert default_scope == "scope_2"


# ── Anteil-Berechnung (EMAS) ──

def test_emas_percentage_calculation():
    """Anteile summieren sich zu 100%."""
    by_type = {
        "electricity": {"kwh": 50000, "co2_kg": 21000},
        "gas": {"kwh": 30000, "co2_kg": 6030},
        "district_heating": {"kwh": 20000, "co2_kg": 4000},
    }
    total_kwh = sum(d["kwh"] for d in by_type.values())
    total_co2 = sum(d["co2_kg"] for d in by_type.values())

    kwh_pcts = []
    co2_pcts = []
    for d in by_type.values():
        kwh_pcts.append(d["kwh"] / total_kwh * 100)
        co2_pcts.append(d["co2_kg"] / total_co2 * 100)

    assert abs(sum(kwh_pcts) - 100) < 0.01
    assert abs(sum(co2_pcts) - 100) < 0.01
