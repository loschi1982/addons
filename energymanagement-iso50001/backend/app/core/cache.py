"""
cache.py – Redis-basiertes Caching für häufige Abfragen.

Bietet einen einfachen Cache-Decorator und direkte get/set-Methoden.
Fällt auf Nicht-Caching zurück wenn Redis nicht erreichbar ist.
"""

import json
import hashlib
from functools import wraps
from typing import Any

import structlog
from redis.asyncio import Redis

from app.config import get_settings

logger = structlog.get_logger()

_redis_client: Redis | None = None


async def get_redis() -> Redis | None:
    """Gibt den Redis-Client zurück (Lazy-Init)."""
    global _redis_client
    if _redis_client is None:
        settings = get_settings()
        try:
            _redis_client = Redis.from_url(
                settings.redis_url,
                decode_responses=True,
            )
            await _redis_client.ping()
            logger.info("redis_connected", url=settings.redis_url)
        except Exception as e:
            logger.warning("redis_unavailable", error=str(e))
            _redis_client = None
    return _redis_client


async def cache_get(key: str) -> Any | None:
    """Wert aus Cache lesen."""
    client = await get_redis()
    if not client:
        return None
    try:
        data = await client.get(f"em:{key}")
        return json.loads(data) if data else None
    except Exception:
        return None


async def cache_set(key: str, value: Any, ttl: int = 300) -> None:
    """Wert in Cache schreiben (TTL in Sekunden, Standard: 5 Min)."""
    client = await get_redis()
    if not client:
        return
    try:
        await client.set(f"em:{key}", json.dumps(value, default=str), ex=ttl)
    except Exception:
        pass


async def cache_delete(pattern: str) -> int:
    """Cache-Einträge nach Pattern löschen."""
    client = await get_redis()
    if not client:
        return 0
    try:
        keys = []
        async for key in client.scan_iter(f"em:{pattern}"):
            keys.append(key)
        if keys:
            await client.delete(*keys)
        return len(keys)
    except Exception:
        return 0


def cached(prefix: str, ttl: int = 300):
    """
    Decorator für Service-Methoden mit Cache.

    Erzeugt einen Cache-Key aus Prefix + Funktionsargumenten.
    Ignoriert `self` und `db`-Parameter.

    Beispiel:
        @cached("dashboard", ttl=600)
        async def get_dashboard(self, year=None):
            ...
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Cache-Key aus Argumenten bauen (self ignorieren)
            key_parts = [prefix, func.__name__]
            # Positional args nach self ignorieren
            for a in args[1:]:
                if not hasattr(a, 'execute'):  # AsyncSession ausschließen
                    key_parts.append(str(a))
            for k, v in sorted(kwargs.items()):
                if k not in ('self', 'db'):
                    key_parts.append(f"{k}={v}")

            cache_key = hashlib.md5(
                ":".join(key_parts).encode()
            ).hexdigest()
            full_key = f"{prefix}:{cache_key}"

            # Cache prüfen
            result = await cache_get(full_key)
            if result is not None:
                return result

            # Funktion ausführen
            result = await func(*args, **kwargs)

            # Ergebnis cachen
            await cache_set(full_key, result, ttl)

            return result
        return wrapper
    return decorator
