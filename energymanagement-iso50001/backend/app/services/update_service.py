"""
update_service.py – Service für das Web-basierte Update-System.

Prüft GitHub auf neue Versionen und führt Updates im Standalone-Modus durch.
Im HA-Addon-Modus wird nur auf Updates hingewiesen.
"""

import asyncio
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import httpx
import structlog

from app.config import get_settings

logger = structlog.get_logger()

# Projekt-Root (3 Ebenen hoch von services/)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent

GITHUB_REPO = "loschi1982/addons"
GITHUB_SUBPATH = "energymanagement-iso50001"


def _read_current_version() -> str:
    """Liest die aktuelle Version aus der VERSION-Datei."""
    version_file = PROJECT_ROOT / "VERSION"
    try:
        return version_file.read_text().strip()
    except FileNotFoundError:
        return "0.0.0"


def _parse_version(v: str) -> tuple[int, ...]:
    """Parst eine Versionszeichenkette in ein Tupel für Vergleiche."""
    v = v.lstrip("v")
    parts = []
    for p in v.split("."):
        try:
            parts.append(int(p))
        except ValueError:
            parts.append(0)
    return tuple(parts)


class UpdateService:
    """Service für Versions- und Update-Verwaltung."""

    async def get_version_info(self) -> dict:
        """Gibt aktuelle Version und Deployment-Modus zurück."""
        settings = get_settings()
        return {
            "current_version": _read_current_version(),
            "deployment_mode": settings.deployment_mode,
            "app_name": settings.app_name,
        }

    async def check_for_updates(self) -> dict:
        """
        Prüft GitHub auf neue Versionen.

        Liest die VERSION-Datei im main-Branch des Repos und vergleicht
        mit der lokalen Version.
        """
        current = _read_current_version()
        settings = get_settings()

        result = {
            "current_version": current,
            "latest_version": current,
            "update_available": False,
            "deployment_mode": settings.deployment_mode,
            "release_notes": "",
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }

        try:
            # VERSION-Datei aus dem main-Branch lesen
            async with httpx.AsyncClient(timeout=15) as client:
                # Rohe VERSION-Datei aus GitHub
                version_url = (
                    f"https://raw.githubusercontent.com/{GITHUB_REPO}"
                    f"/main/{GITHUB_SUBPATH}/VERSION"
                )
                resp = await client.get(version_url)
                resp.raise_for_status()
                latest = resp.text.strip()

                result["latest_version"] = latest
                result["update_available"] = _parse_version(latest) > _parse_version(current)

                # Release-Notes: letzte Commits abrufen
                if result["update_available"]:
                    commits_url = (
                        f"https://api.github.com/repos/{GITHUB_REPO}"
                        f"/commits?path={GITHUB_SUBPATH}&per_page=10"
                    )
                    resp = await client.get(commits_url)
                    if resp.status_code == 200:
                        commits = resp.json()
                        notes = []
                        for c in commits[:10]:
                            msg = c.get("commit", {}).get("message", "").split("\n")[0]
                            date = c.get("commit", {}).get("author", {}).get("date", "")[:10]
                            notes.append(f"- {date}: {msg}")
                        result["release_notes"] = "\n".join(notes)

        except Exception as e:
            logger.warning("update_check_failed", error=str(e))
            result["error"] = f"Update-Prüfung fehlgeschlagen: {str(e)}"

        return result

    async def install_update(self) -> dict:
        """
        Führt ein Update im Standalone-Modus durch.

        Schritte:
        1. git pull origin main
        2. pip install -r requirements.txt
        3. alembic upgrade head
        4. Frontend muss nicht neu gebaut werden (ist im Container)

        Returns:
            Dict mit Ergebnis des Updates
        """
        settings = get_settings()

        if settings.deployment_mode == "ha-addon":
            return {
                "success": False,
                "message": "Updates im HA-Addon-Modus werden über den HA Supervisor verwaltet.",
            }

        old_version = _read_current_version()
        log_lines: list[str] = []

        try:
            # 1. Git Pull
            log_lines.append("=== Git Pull ===")
            result = subprocess.run(
                ["git", "pull", "origin", "main"],
                cwd=str(PROJECT_ROOT),
                capture_output=True,
                text=True,
                timeout=60,
            )
            log_lines.append(result.stdout)
            if result.returncode != 0:
                log_lines.append(f"FEHLER: {result.stderr}")
                return {
                    "success": False,
                    "message": "Git Pull fehlgeschlagen",
                    "log": "\n".join(log_lines),
                    "old_version": old_version,
                }

            # 2. pip install
            log_lines.append("\n=== Pip Install ===")
            result = subprocess.run(
                ["pip", "install", "--no-cache-dir", "-r", "requirements.txt"],
                cwd=str(PROJECT_ROOT / "backend"),
                capture_output=True,
                text=True,
                timeout=120,
            )
            log_lines.append(result.stdout[:500])  # Ausgabe begrenzen
            if result.returncode != 0:
                log_lines.append(f"WARNUNG: {result.stderr[:500]}")

            # 3. Alembic Migrationen
            log_lines.append("\n=== Datenbank-Migrationen ===")
            result = subprocess.run(
                ["python3", "-m", "alembic", "upgrade", "head"],
                cwd=str(PROJECT_ROOT / "backend"),
                capture_output=True,
                text=True,
                timeout=60,
            )
            log_lines.append(result.stdout)
            if result.returncode != 0:
                log_lines.append(f"WARNUNG: {result.stderr[:500]}")

            new_version = _read_current_version()
            log_lines.append(f"\n=== Update abgeschlossen: {old_version} → {new_version} ===")

            return {
                "success": True,
                "message": f"Update von {old_version} auf {new_version} erfolgreich.",
                "old_version": old_version,
                "new_version": new_version,
                "log": "\n".join(log_lines),
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "restart_required": True,
            }

        except subprocess.TimeoutExpired:
            log_lines.append("FEHLER: Timeout bei Update-Schritt")
            return {
                "success": False,
                "message": "Update-Timeout",
                "log": "\n".join(log_lines),
                "old_version": old_version,
            }
        except Exception as e:
            log_lines.append(f"FEHLER: {str(e)}")
            logger.error("update_install_failed", error=str(e))
            return {
                "success": False,
                "message": f"Update fehlgeschlagen: {str(e)}",
                "log": "\n".join(log_lines),
                "old_version": old_version,
            }

    async def get_update_log(self) -> dict:
        """Gibt den letzten Update-Log zurück (aus AppSetting)."""
        from sqlalchemy import select
        from app.core.database import get_db
        from app.models.setting import AppSetting

        # Vereinfachte Version: Log wird erst beim nächsten Update gespeichert
        return {
            "message": "Kein Update-Log vorhanden.",
            "last_update": None,
        }
