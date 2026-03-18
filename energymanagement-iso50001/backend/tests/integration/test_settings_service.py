"""
test_settings_service.py – Integration-Tests für den Settings-Service.

Testet CRUD-Operationen und Default-Initialisierung mit echter DB.
"""

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.settings_service import SettingsService


@pytest.mark.asyncio
async def test_get_all_returns_defaults(db_session: AsyncSession):
    """Leere DB gibt Standard-Einstellungen zurück."""
    service = SettingsService(db_session)
    result = await service.get_all()

    assert "organization" in result
    assert "branding" in result
    assert "report_defaults" in result


@pytest.mark.asyncio
async def test_get_single_default(db_session: AsyncSession):
    """Einzelne Default-Einstellung abrufen."""
    service = SettingsService(db_session)
    result = await service.get("branding")

    assert result is not None
    assert result["value"]["primary_color"] == "#1B5E7B"


@pytest.mark.asyncio
async def test_get_nonexistent_key(db_session: AsyncSession):
    """Nicht existierender Key gibt None zurück."""
    service = SettingsService(db_session)
    result = await service.get("nonexistent_key_xyz")
    assert result is None


@pytest.mark.asyncio
async def test_update_creates_setting(db_session: AsyncSession):
    """Update erstellt neue Einstellung wenn nicht vorhanden."""
    service = SettingsService(db_session)
    result = await service.update("organization", {
        "name": "Test GmbH",
        "logo_url": "",
        "address": "Teststraße 1",
        "contact_email": "test@test.de",
        "contact_phone": "+49 123",
    })

    assert result["key"] == "organization"
    assert result["value"]["name"] == "Test GmbH"


@pytest.mark.asyncio
async def test_update_modifies_existing(db_session: AsyncSession):
    """Update ändert bestehende Einstellung."""
    service = SettingsService(db_session)

    # Erstellen
    await service.update("branding", {"primary_color": "#FF0000"})

    # Ändern
    result = await service.update("branding", {"primary_color": "#00FF00"})
    assert result["value"]["primary_color"] == "#00FF00"

    # Verifizieren
    fetched = await service.get("branding")
    assert fetched["value"]["primary_color"] == "#00FF00"


@pytest.mark.asyncio
async def test_get_all_with_category(db_session: AsyncSession):
    """Filter nach Kategorie funktioniert."""
    service = SettingsService(db_session)

    # Defaults haben verschiedene Kategorien
    general = await service.get_all(category="general")
    assert "organization" in general
    assert "branding" in general


@pytest.mark.asyncio
async def test_initialize_defaults(db_session: AsyncSession):
    """Standard-Einstellungen werden initialisiert."""
    service = SettingsService(db_session)
    created = await service.initialize_defaults()

    assert created >= 5  # Mindestens 5 Defaults

    # Zweiter Aufruf erstellt nichts neues
    created_again = await service.initialize_defaults()
    assert created_again == 0
