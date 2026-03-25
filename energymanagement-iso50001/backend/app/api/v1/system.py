"""
system.py – API-Endpunkte für System-Verwaltung und Updates.

Endpunkte:
- GET  /system/version        – Aktuelle Version + Deployment-Modus
- GET  /system/status         – Dienste-Status (DB, Redis, Celery, HA)
- POST /system/services/{name}/restart – Einzelnen Dienst neustarten
- GET  /system/updates/check  – GitHub auf neue Version prüfen
- POST /system/updates/install – Update durchführen (nur Admin, nur Standalone)
- GET  /system/updates/log    – Letztes Update-Log
"""

import asyncio
import os
import platform
import shutil
import time
from datetime import datetime, timezone

import httpx
import structlog
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.services.update_service import UpdateService

logger = structlog.get_logger()
router = APIRouter()


async def _check_database(db: AsyncSession) -> dict:
    """Datenbank-Status prüfen: Verbindung, Version, Größe, Tabellen."""
    try:
        start = time.monotonic()
        row = await db.execute(text("SELECT version()"))
        latency_ms = round((time.monotonic() - start) * 1000, 1)
        pg_version = row.scalar()

        # DB-Größe
        size_row = await db.execute(
            text("SELECT pg_size_pretty(pg_database_size(current_database()))")
        )
        db_size = size_row.scalar()

        # Anzahl Tabellen
        table_count_row = await db.execute(
            text("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'")
        )
        table_count = table_count_row.scalar()

        # TimescaleDB-Extension prüfen
        ts_row = await db.execute(
            text("SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'")
        )
        ts_version = ts_row.scalar()

        # Aktive Verbindungen
        conn_row = await db.execute(
            text("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()")
        )
        active_connections = conn_row.scalar()

        return {
            "name": "PostgreSQL / TimescaleDB",
            "status": "running",
            "latency_ms": latency_ms,
            "details": {
                "version": pg_version,
                "timescaledb": ts_version or "nicht installiert",
                "database_size": db_size,
                "tables": table_count,
                "active_connections": active_connections,
            },
        }
    except Exception as e:
        return {
            "name": "PostgreSQL / TimescaleDB",
            "status": "error",
            "error": str(e),
        }


async def _check_redis() -> dict:
    """Redis-Status prüfen: Verbindung, Speicher, wartende Tasks."""
    try:
        import redis.asyncio as aioredis

        settings = get_settings()
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        start = time.monotonic()
        await r.ping()
        latency_ms = round((time.monotonic() - start) * 1000, 1)

        info = await r.info("memory")
        memory_used = info.get("used_memory_human", "?")

        # Warteschlangenlänge (Celery default queue)
        queue_length = await r.llen("celery")

        await r.aclose()

        return {
            "name": "Redis",
            "status": "running",
            "latency_ms": latency_ms,
            "details": {
                "memory_used": memory_used,
                "pending_tasks": queue_length,
            },
        }
    except Exception as e:
        return {
            "name": "Redis",
            "status": "error",
            "error": str(e),
        }


async def _check_celery_worker() -> dict:
    """Celery Worker-Status prüfen via Ping."""
    try:
        from app.tasks import celery_app

        loop = asyncio.get_event_loop()
        # Celery inspect ist synchron – in Thread auslagern
        result = await loop.run_in_executor(
            None, lambda: celery_app.control.ping(timeout=3.0)
        )
        if result:
            workers = []
            for worker_response in result:
                for name, resp in worker_response.items():
                    workers.append(name)
            return {
                "name": "Celery Worker",
                "status": "running",
                "details": {
                    "workers": workers,
                    "worker_count": len(workers),
                },
            }
        return {
            "name": "Celery Worker",
            "status": "stopped",
            "error": "Kein Worker antwortet – Tasks werden nicht verarbeitet.",
        }
    except Exception as e:
        return {
            "name": "Celery Worker",
            "status": "error",
            "error": str(e),
        }


async def _check_celery_beat(db: AsyncSession) -> dict:
    """Celery Beat-Status anhand der letzten Task-Ausführung schätzen."""
    try:
        # Prüfe ob in den letzten 10 Minuten Readings oder Polling stattfand
        from app.models.climate import ClimateReading

        row = await db.execute(
            text("""
                SELECT MAX(timestamp) FROM climate_readings
                WHERE source = 'homeassistant'
            """)
        )
        last_poll = row.scalar()

        # Auch meter_readings prüfen
        row2 = await db.execute(
            text("""
                SELECT MAX(timestamp) FROM meter_readings
                WHERE source = 'auto'
            """)
        )
        last_meter_poll = row2.scalar()

        latest = max(
            (t for t in [last_poll, last_meter_poll] if t is not None),
            default=None,
        )

        if latest:
            age_minutes = (datetime.now(timezone.utc) - latest.replace(tzinfo=timezone.utc)).total_seconds() / 60
            if age_minutes < 10:
                status = "running"
            elif age_minutes < 30:
                status = "warning"
            else:
                status = "stopped"
            return {
                "name": "Celery Beat (Scheduler)",
                "status": status,
                "details": {
                    "last_task_execution": latest.isoformat(),
                    "minutes_ago": round(age_minutes, 1),
                },
            }

        return {
            "name": "Celery Beat (Scheduler)",
            "status": "unknown",
            "error": "Noch keine automatischen Messwerte vorhanden – Status unbekannt.",
        }
    except Exception as e:
        return {
            "name": "Celery Beat (Scheduler)",
            "status": "unknown",
            "error": str(e),
        }


async def _check_homeassistant(db: AsyncSession) -> dict:
    """Home Assistant Verbindung prüfen."""
    try:
        from app.integrations.homeassistant import HomeAssistantClient

        client = await HomeAssistantClient.from_settings(db)
        if not client.base_url or not client.token:
            return {
                "name": "Home Assistant",
                "status": "not_configured",
                "error": "Keine HA-Verbindung konfiguriert.",
            }

        start = time.monotonic()
        connected = await client.check_connection()
        latency_ms = round((time.monotonic() - start) * 1000, 1)

        if connected:
            return {
                "name": "Home Assistant",
                "status": "running",
                "latency_ms": latency_ms,
                "details": {
                    "base_url": client.base_url,
                },
            }
        return {
            "name": "Home Assistant",
            "status": "error",
            "error": f"Verbindung zu {client.base_url} fehlgeschlagen.",
        }
    except Exception as e:
        return {
            "name": "Home Assistant",
            "status": "error",
            "error": str(e),
        }


@router.get("/status")
async def get_system_status(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Systemstatus aller Dienste abrufen (Ampelsystem)."""
    settings = get_settings()

    # Alle Checks parallel ausführen
    db_check, redis_check, worker_check, beat_check, ha_check = await asyncio.gather(
        _check_database(db),
        _check_redis(),
        _check_celery_worker(),
        _check_celery_beat(db),
        _check_homeassistant(db),
    )

    services = [db_check, redis_check, worker_check, beat_check, ha_check]

    # System-Ressourcen
    disk = shutil.disk_usage("/")
    uptime_seconds = None
    try:
        with open("/proc/uptime") as f:
            uptime_seconds = int(float(f.read().split()[0]))
    except Exception:
        pass

    # Gesamtstatus
    statuses = [s["status"] for s in services if s["status"] != "not_configured"]
    if any(s == "error" for s in statuses):
        overall = "error"
    elif any(s in ("stopped", "warning") for s in statuses):
        overall = "warning"
    else:
        overall = "healthy"

    return {
        "overall": overall,
        "services": services,
        "system": {
            "hostname": platform.node(),
            "platform": f"{platform.system()} {platform.release()}",
            "python": platform.python_version(),
            "deployment_mode": settings.deployment_mode,
            "version": settings.app_version,
            "uptime_seconds": uptime_seconds,
            "disk_total_gb": round(disk.total / (1024**3), 1),
            "disk_used_gb": round(disk.used / (1024**3), 1),
            "disk_free_gb": round(disk.free / (1024**3), 1),
            "disk_usage_percent": round(disk.used / disk.total * 100, 1),
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/services/{service_name}/restart")
async def restart_service(
    service_name: str,
    current_user=Depends(require_permission("system", "update")),
):
    """Einen Dienst neustarten (nur im Docker-Container möglich)."""
    allowed = {"celery_worker", "celery_beat"}
    if service_name not in allowed:
        return {"success": False, "error": f"Dienst '{service_name}' kann nicht neugestartet werden."}

    try:
        import subprocess

        if service_name == "celery_worker":
            # Celery Worker graceful restart
            result = subprocess.run(
                ["pkill", "-HUP", "-f", "celery.*worker"],
                capture_output=True, text=True, timeout=10,
            )
            if result.returncode == 0:
                return {"success": True, "message": "Celery Worker wird neugestartet (warm restart)..."}
            # Falls kein Prozess läuft, starten
            subprocess.Popen(
                ["celery", "-A", "app.tasks", "worker",
                 "--loglevel=info", "--concurrency=2", "--pool=prefork"],
                cwd="/app/backend",
            )
            return {"success": True, "message": "Celery Worker wurde gestartet."}

        elif service_name == "celery_beat":
            subprocess.run(
                ["pkill", "-f", "celery.*beat"],
                capture_output=True, text=True, timeout=10,
            )
            await asyncio.sleep(1)
            subprocess.Popen(
                ["celery", "-A", "app.tasks", "beat",
                 "--loglevel=info", "--schedule=/tmp/celerybeat-schedule"],
                cwd="/app/backend",
            )
            return {"success": True, "message": "Celery Beat wurde neugestartet."}

    except Exception as e:
        logger.error("service_restart_failed", service=service_name, error=str(e))
        return {"success": False, "error": str(e)}

    return {"success": False, "error": "Unbekannter Fehler"}


@router.get("/version")
async def get_version(
    current_user=Depends(get_current_user),
):
    """Aktuelle Version und Deployment-Modus abfragen."""
    service = UpdateService()
    return await service.get_version_info()


@router.get("/updates/check")
async def check_updates(
    current_user=Depends(get_current_user),
):
    """Prüft auf GitHub ob eine neue Version verfügbar ist."""
    service = UpdateService()
    return await service.check_for_updates()


@router.post("/updates/install")
async def install_update(
    current_user=Depends(require_permission("system", "update")),
):
    """
    Führt ein Update durch (nur im Standalone-Modus).
    Erfordert Admin-Berechtigung.
    """
    service = UpdateService()
    return await service.install_update()


@router.get("/updates/log")
async def get_update_log(
    current_user=Depends(get_current_user),
):
    """Gibt den Log des letzten Updates zurück."""
    service = UpdateService()
    return await service.get_update_log()
