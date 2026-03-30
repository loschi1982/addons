"""
log_buffer.py – In-Memory-Ringpuffer für Anwendungs-Logs.

Hält die letzten 200 Log-Einträge im Speicher, damit sie über die API
abgerufen werden können. Überlebt keinen Server-Neustart, reicht aber
zur Diagnose von Laufzeitfehlern.
"""

from collections import deque
from datetime import datetime, timezone
from typing import Any

_buffer: deque[dict[str, Any]] = deque(maxlen=200)


def write(level: str, source: str, message: str, details: dict | None = None) -> None:
    """Eintrag in den Puffer schreiben."""
    _buffer.appendleft(
        {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": level,
            "source": source,
            "message": message,
            "details": details or {},
        }
    )


def get_entries(limit: int = 100) -> list[dict[str, Any]]:
    """Neueste Einträge zurückgeben (neueste zuerst)."""
    entries = list(_buffer)
    return entries[:limit]


def clear() -> None:
    _buffer.clear()
