"""
conftest.py – Pytest-Fixtures für alle Tests.

Stellt eine Test-Datenbank, einen FastAPI-TestClient und
vorbereitete Testdaten (Benutzer, Zähler, etc.) bereit.
"""

import asyncio
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from app.core.database import Base, get_db
from app.core.security import hash_password
from app.main import create_app

# Alle Modelle importieren, damit Base.metadata alle Tabellen kennt
import app.models.user  # noqa: F401
import app.models.role  # noqa: F401
import app.models.site  # noqa: F401
import app.models.meter  # noqa: F401
import app.models.reading  # noqa: F401
import app.models.consumer  # noqa: F401
import app.models.iso  # noqa: F401
import app.models.emission  # noqa: F401
import app.models.report  # noqa: F401
import app.models.schema  # noqa: F401
import app.models.settings  # noqa: F401
import app.models.weather  # noqa: F401
import app.models.climate  # noqa: F401
import app.models.correction  # noqa: F401
import app.models.allocation  # noqa: F401


# ---------------------------------------------------------------------------
# Test-Datenbank (SQLite async für schnelle Tests)
# ---------------------------------------------------------------------------

TEST_DATABASE_URL = "sqlite+aiosqlite:///./test.db"

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)


@pytest.fixture(scope="session")
def event_loop():
    """Erstellt einen Event-Loop für die gesamte Test-Session."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(autouse=True)
async def setup_database():
    """Erstellt die Tabellen vor jedem Test und räumt danach auf."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def db_session() -> AsyncSession:
    """Liefert eine Test-Datenbank-Session."""
    async with TestSessionLocal() as session:
        yield session


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncClient:
    """HTTP-TestClient mit überschriebener DB-Dependency."""
    app = create_app()

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Testdaten-Factories
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def test_role(db_session: AsyncSession):
    """Erstellt eine Test-Rolle mit allen ISO-Berechtigungen."""
    from app.models.role import Permission, Role, RolePermission

    role = Role(
        id=uuid.uuid4(),
        name="admin",
        display_name="Administrator",
        is_system_role=True,
    )
    db_session.add(role)
    await db_session.flush()

    # Alle benötigten Berechtigungen anlegen
    all_permissions = [
        # ISO 50001
        ("iso", "manage_context"),
        ("iso", "manage_policy"),
        ("iso", "manage_roles"),
        ("iso", "manage_objectives"),
        ("iso", "manage_risks"),
        ("iso", "manage_documents"),
        ("iso", "manage_legal"),
        ("iso", "manage_audits"),
        ("iso", "manage_nonconformities"),
        ("iso", "manage_reviews"),
        # Standorte, Zähler, Verbraucher, Ablesungen
        ("sites", "create"), ("sites", "update"), ("sites", "delete"),
        ("meters", "create"), ("meters", "update"), ("meters", "delete"),
        ("consumers", "create"), ("consumers", "update"), ("consumers", "delete"),
        ("readings", "create"), ("readings", "update"), ("readings", "delete"),
        # Settings, Reports, Users
        ("settings", "update"),
        ("reports", "create"), ("reports", "delete"),
        ("users", "create"), ("users", "edit"), ("users", "delete"),
        # Zuordnungen
        ("allocations", "create"), ("allocations", "update"), ("allocations", "delete"),
    ]
    for module, action in all_permissions:
        perm = Permission(
            id=uuid.uuid4(),
            module=module,
            action=action,
            description=f"{module}.{action}",
            category=module,
        )
        db_session.add(perm)
        await db_session.flush()
        role_perm = RolePermission(
            id=uuid.uuid4(),
            role_id=role.id,
            permission_id=perm.id,
        )
        db_session.add(role_perm)

    await db_session.commit()
    await db_session.refresh(role)
    return role


@pytest_asyncio.fixture
async def test_user(db_session: AsyncSession, test_role):
    """Erstellt einen Test-Benutzer."""
    from app.models.user import User

    user = User(
        id=uuid.uuid4(),
        username="testuser",
        email="test@example.com",
        display_name="Test User",
        password_hash=hash_password("TestPass123!"),
        role_id=test_role.id,
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def auth_headers(test_user) -> dict:
    """JWT-Auth-Headers für authentifizierte Requests."""
    from app.core.security import create_access_token

    token = create_access_token(test_user.id, "admin")
    return {"Authorization": f"Bearer {token}"}
