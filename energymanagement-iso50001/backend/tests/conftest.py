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
from app.main import app


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
async def test_user(db_session: AsyncSession):
    """Erstellt einen Test-Benutzer."""
    from app.models.user import User

    user = User(
        id=uuid.uuid4(),
        username="testuser",
        email="test@example.com",
        password_hash=hash_password("TestPass123!"),
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

    token = create_access_token({"sub": str(test_user.id), "username": test_user.username})
    return {"Authorization": f"Bearer {token}"}
