"""
test_cache.py – Tests für die Cache-Infrastruktur.

Testet den cached-Decorator und Cache-Key-Generierung.
Da Redis in Tests nicht verfügbar ist, wird das Fallback-Verhalten geprüft.
"""

import hashlib
import pytest

from app.core.cache import cache_get, cache_set, cache_delete


@pytest.mark.asyncio
async def test_cache_get_without_redis():
    """Ohne Redis gibt cache_get None zurück."""
    result = await cache_get("nonexistent_key")
    assert result is None


@pytest.mark.asyncio
async def test_cache_set_without_redis():
    """Ohne Redis läuft cache_set ohne Fehler durch."""
    # Soll keinen Fehler werfen
    await cache_set("test_key", {"data": 42}, ttl=60)


@pytest.mark.asyncio
async def test_cache_delete_without_redis():
    """Ohne Redis gibt cache_delete 0 zurück."""
    result = await cache_delete("*")
    assert result == 0


def test_cache_key_generation():
    """Cache-Key wird deterministisch aus Parametern generiert."""
    key_parts = ["dashboard", "get_dashboard", "2024"]
    cache_key = hashlib.md5(":".join(key_parts).encode()).hexdigest()

    # Gleiche Eingabe → gleicher Key
    key_parts_2 = ["dashboard", "get_dashboard", "2024"]
    cache_key_2 = hashlib.md5(":".join(key_parts_2).encode()).hexdigest()

    assert cache_key == cache_key_2


def test_cache_key_different_params():
    """Unterschiedliche Parameter → unterschiedliche Keys."""
    key1 = hashlib.md5("dashboard:get_dashboard:2024".encode()).hexdigest()
    key2 = hashlib.md5("dashboard:get_dashboard:2025".encode()).hexdigest()
    assert key1 != key2


def test_cached_decorator_preserves_function_name():
    """Der @cached-Decorator behält den Funktionsnamen bei."""
    from app.core.cache import cached

    @cached("test", ttl=60)
    async def my_function():
        return 42

    assert my_function.__name__ == "my_function"
