"""
test_health.py – Integration-Test für den Health-Check-Endpunkt.
"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_check(client: AsyncClient):
    """Health-Check-Endpunkt muss 200 OK zurückgeben."""
    response = await client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
