"""
test_permission_service.py – Tests für den Berechtigungs-Service.

Testet die dreistufige Prüflogik:
1. User-Override DENY → sofort abgelehnt
2. User-Override GRANT → sofort erlaubt
3. Rollen-Berechtigung → erlaubt wenn vorhanden
4. Sonst → abgelehnt
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.role import Permission, Role, RolePermission, UserPermissionOverride
from app.models.user import User
from app.services.permission_service import PermissionService


@pytest_asyncio.fixture
async def permission_data(db_session: AsyncSession):
    """Erstellt Rollen, Berechtigungen und Benutzer für Tests."""
    # Berechtigungen
    perm_view = Permission(
        id=uuid.uuid4(),
        module="meters", action="view",
        description="Zähler ansehen", category="meters",
        resource_scope="all",
    )
    perm_create = Permission(
        id=uuid.uuid4(),
        module="meters", action="create",
        description="Zähler anlegen", category="meters",
        resource_scope="all",
    )
    perm_delete = Permission(
        id=uuid.uuid4(),
        module="meters", action="delete",
        description="Zähler löschen", category="meters",
        resource_scope="all",
    )
    db_session.add_all([perm_view, perm_create, perm_delete])

    # Rolle "Techniker" mit view + create
    role = Role(
        id=uuid.uuid4(),
        name="techniker_test",
        display_name="Techniker",
        is_system_role=False,
    )
    db_session.add(role)
    await db_session.flush()

    rp1 = RolePermission(id=uuid.uuid4(), role_id=role.id, permission_id=perm_view.id)
    rp2 = RolePermission(id=uuid.uuid4(), role_id=role.id, permission_id=perm_create.id)
    db_session.add_all([rp1, rp2])

    # Benutzer
    from passlib.context import CryptContext
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    user = User(
        id=uuid.uuid4(),
        username="testtech",
        email="tech@test.de",
        password_hash=pwd_context.hash("test123"),
        display_name="Test Techniker",
        role_id=role.id,
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()

    return {
        "user": user,
        "role": role,
        "perm_view": perm_view,
        "perm_create": perm_create,
        "perm_delete": perm_delete,
    }


@pytest.mark.asyncio
async def test_role_permission_granted(db_session: AsyncSession, permission_data):
    """Berechtigung über Rolle: view + create erlaubt."""
    service = PermissionService(db_session)
    user = permission_data["user"]
    assert await service.check(user, "meters", "view") is True
    assert await service.check(user, "meters", "create") is True


@pytest.mark.asyncio
async def test_role_permission_denied(db_session: AsyncSession, permission_data):
    """Berechtigung nicht in Rolle: delete verweigert."""
    service = PermissionService(db_session)
    user = permission_data["user"]
    assert await service.check(user, "meters", "delete") is False


@pytest.mark.asyncio
async def test_unknown_permission(db_session: AsyncSession, permission_data):
    """Unbekannte Berechtigung → verweigert."""
    service = PermissionService(db_session)
    user = permission_data["user"]
    assert await service.check(user, "nonexistent", "action") is False


@pytest.mark.asyncio
async def test_grant_override(db_session: AsyncSession, permission_data):
    """GRANT-Override gibt zusätzliche Berechtigung."""
    service = PermissionService(db_session)
    user = permission_data["user"]
    perm_delete = permission_data["perm_delete"]

    # Vor Override: kein Löschen
    assert await service.check(user, "meters", "delete") is False

    # GRANT-Override setzen
    override = UserPermissionOverride(
        id=uuid.uuid4(),
        user_id=user.id,
        permission_id=perm_delete.id,
        override_type="GRANT",
        granted_by=user.id,
        reason="Projektarbeit",
    )
    db_session.add(override)
    await db_session.commit()

    # Nach Override: Löschen erlaubt
    assert await service.check(user, "meters", "delete") is True


@pytest.mark.asyncio
async def test_deny_override(db_session: AsyncSession, permission_data):
    """DENY-Override entzieht Berechtigung."""
    service = PermissionService(db_session)
    user = permission_data["user"]
    perm_view = permission_data["perm_view"]

    # Vor Override: view erlaubt
    assert await service.check(user, "meters", "view") is True

    # DENY-Override setzen
    override = UserPermissionOverride(
        id=uuid.uuid4(),
        user_id=user.id,
        permission_id=perm_view.id,
        override_type="DENY",
        granted_by=user.id,
        reason="Temporäre Sperre",
    )
    db_session.add(override)
    await db_session.commit()

    # Nach Override: view verweigert
    assert await service.check(user, "meters", "view") is False


@pytest.mark.asyncio
async def test_deny_overrides_grant(db_session: AsyncSession, permission_data):
    """DENY hat Vorrang vor GRANT (gleiche Berechtigung)."""
    service = PermissionService(db_session)
    user = permission_data["user"]
    perm_create = permission_data["perm_create"]

    # Sowohl GRANT als auch DENY für die gleiche Berechtigung
    db_session.add(UserPermissionOverride(
        id=uuid.uuid4(),
        user_id=user.id,
        permission_id=perm_create.id,
        override_type="GRANT",
        granted_by=user.id,
    ))
    db_session.add(UserPermissionOverride(
        id=uuid.uuid4(),
        user_id=user.id,
        permission_id=perm_create.id,
        override_type="DENY",
        granted_by=user.id,
    ))
    await db_session.commit()

    # DENY gewinnt
    assert await service.check(user, "meters", "create") is False


@pytest.mark.asyncio
async def test_override_time_limited(db_session: AsyncSession, permission_data):
    """Override nur innerhalb gültigem Zeitraum aktiv."""
    service = PermissionService(db_session)
    user = permission_data["user"]
    perm_delete = permission_data["perm_delete"]

    # GRANT-Override, aber in der Zukunft
    override = UserPermissionOverride(
        id=uuid.uuid4(),
        user_id=user.id,
        permission_id=perm_delete.id,
        override_type="GRANT",
        granted_by=user.id,
        valid_from=date(2099, 1, 1),
        valid_to=date(2099, 12, 31),
    )
    db_session.add(override)
    await db_session.commit()

    # Nicht aktiv → Rolle greift (kein delete)
    assert await service.check(user, "meters", "delete") is False


@pytest.mark.asyncio
async def test_override_expired(db_session: AsyncSession, permission_data):
    """Abgelaufener Override wird ignoriert."""
    service = PermissionService(db_session)
    user = permission_data["user"]
    perm_view = permission_data["perm_view"]

    # DENY-Override, aber abgelaufen
    override = UserPermissionOverride(
        id=uuid.uuid4(),
        user_id=user.id,
        permission_id=perm_view.id,
        override_type="DENY",
        granted_by=user.id,
        valid_from=date(2020, 1, 1),
        valid_to=date(2020, 12, 31),
    )
    db_session.add(override)
    await db_session.commit()

    # Abgelaufen → Rolle greift (view erlaubt)
    assert await service.check(user, "meters", "view") is True


@pytest.mark.asyncio
async def test_get_user_permissions(db_session: AsyncSession, permission_data):
    """Alle effektiven Berechtigungen eines Benutzers abrufen."""
    service = PermissionService(db_session)
    user = permission_data["user"]

    perms = await service.get_user_permissions(user.id)
    assert "meters.view" in perms
    assert "meters.create" in perms
    assert "meters.delete" not in perms


@pytest.mark.asyncio
async def test_get_user_permissions_with_overrides(db_session: AsyncSession, permission_data):
    """Effektive Berechtigungen berücksichtigen Overrides."""
    service = PermissionService(db_session)
    user = permission_data["user"]
    perm_delete = permission_data["perm_delete"]
    perm_view = permission_data["perm_view"]

    # GRANT delete + DENY view
    db_session.add(UserPermissionOverride(
        id=uuid.uuid4(), user_id=user.id, permission_id=perm_delete.id,
        override_type="GRANT", granted_by=user.id,
    ))
    db_session.add(UserPermissionOverride(
        id=uuid.uuid4(), user_id=user.id, permission_id=perm_view.id,
        override_type="DENY", granted_by=user.id,
    ))
    await db_session.commit()

    perms = await service.get_user_permissions(user.id)
    assert "meters.delete" in perms
    assert "meters.view" not in perms
    assert "meters.create" in perms


@pytest.mark.asyncio
async def test_has_permission_alias(db_session: AsyncSession, permission_data):
    """has_permission() ist Alias für check()."""
    service = PermissionService(db_session)
    user = permission_data["user"]
    assert await service.has_permission(user, "meters", "view") is True


def test_is_override_active_static():
    """Statische Methode _is_override_active prüfen."""
    from unittest.mock import MagicMock
    ovr = MagicMock()

    # Ohne Zeitgrenzen → aktiv
    ovr.valid_from = None
    ovr.valid_to = None
    assert PermissionService._is_override_active(ovr, date(2024, 6, 1)) is True

    # In der Zukunft → nicht aktiv
    ovr.valid_from = date(2025, 1, 1)
    ovr.valid_to = None
    assert PermissionService._is_override_active(ovr, date(2024, 6, 1)) is False

    # Abgelaufen → nicht aktiv
    ovr.valid_from = None
    ovr.valid_to = date(2023, 12, 31)
    assert PermissionService._is_override_active(ovr, date(2024, 6, 1)) is False

    # Im gültigen Bereich → aktiv
    ovr.valid_from = date(2024, 1, 1)
    ovr.valid_to = date(2024, 12, 31)
    assert PermissionService._is_override_active(ovr, date(2024, 6, 1)) is True
