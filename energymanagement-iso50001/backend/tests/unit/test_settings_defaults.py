"""
test_settings_defaults.py – Tests für Settings-Standardwerte.

Prüft die Default-Konfiguration für neue Installationen.
"""

from app.services.settings_service import DEFAULT_SETTINGS


def test_default_settings_count():
    """Es gibt mindestens 5 Standard-Einstellungskategorien."""
    assert len(DEFAULT_SETTINGS) >= 5


def test_default_settings_keys():
    """Alle erwarteten Einstellungsschlüssel sind vorhanden."""
    expected = {"organization", "branding", "report_defaults", "enpi_config", "notifications"}
    assert set(DEFAULT_SETTINGS.keys()) == expected


def test_organization_has_name():
    """Organisation hat ein name-Feld."""
    org = DEFAULT_SETTINGS["organization"]["value"]
    assert "name" in org


def test_organization_has_contact_fields():
    """Organisation hat Kontaktfelder."""
    org = DEFAULT_SETTINGS["organization"]["value"]
    assert "contact_email" in org
    assert "contact_phone" in org


def test_branding_has_primary_color():
    """Branding hat Primärfarbe #1B5E7B."""
    branding = DEFAULT_SETTINGS["branding"]["value"]
    assert branding["primary_color"] == "#1B5E7B"


def test_branding_colors_are_hex():
    """Alle Branding-Farben sind valide Hex-Codes."""
    branding = DEFAULT_SETTINGS["branding"]["value"]
    for key in ["primary_color", "secondary_color", "accent_color"]:
        color = branding[key]
        assert color.startswith("#"), f"{key} ist kein Hex-Code"
        assert len(color) == 7, f"{key} hat falsche Länge"


def test_report_defaults_language():
    """Standard-Berichtssprache ist Deutsch."""
    report = DEFAULT_SETTINGS["report_defaults"]["value"]
    assert report["report_language"] == "de"


def test_report_defaults_period():
    """Standard-Berichtszeitraum ist 12 Monate."""
    report = DEFAULT_SETTINGS["report_defaults"]["value"]
    assert report["default_period_months"] == 12


def test_enpi_config_metrics():
    """Standard-EnPI-Kennzahlen enthalten kWh/m²."""
    enpi = DEFAULT_SETTINGS["enpi_config"]["value"]
    assert "kwh_per_m2" in enpi["metrics"]


def test_enpi_config_reference_standard():
    """Standard-Referenz ist VDI 3807."""
    enpi = DEFAULT_SETTINGS["enpi_config"]["value"]
    assert enpi["reference_standard"] == "vdi_3807"


def test_notifications_defaults():
    """Benachrichtigungen sind standardmäßig deaktiviert."""
    notif = DEFAULT_SETTINGS["notifications"]["value"]
    assert notif["email_enabled"] is False
    assert notif["review_reminder_days"] == 30


def test_all_defaults_have_category():
    """Alle Defaults haben eine Kategorie."""
    for key, setting in DEFAULT_SETTINGS.items():
        assert "category" in setting, f"{key} hat keine Kategorie"
        assert setting["category"], f"{key} hat leere Kategorie"


def test_all_defaults_have_description():
    """Alle Defaults haben eine Beschreibung."""
    for key, setting in DEFAULT_SETTINGS.items():
        assert "description" in setting, f"{key} hat keine Beschreibung"
        assert setting["description"], f"{key} hat leere Beschreibung"
