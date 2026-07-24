"""
spie_service.py – SPIE-Import-Service mit Fortschrittsverfolgung.

Holt Zählerstände vom SPIE Energy-as-a-Service-Portal und speichert
sie als MeterReading-Objekte. Pro Zähler wird der neueste vorhandene
Messwert-Timestamp ermittelt und ab dort importiert.

Fortschritt wird in /tmp/spie_sync_{job_id}.json geschrieben –
analog zum Backup-System, Browser-Reload-sicher.
"""

import json
import os
import tempfile
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy import delete, func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.spie import SpieAuthError, SpieClient
from app.models.meter import Meter
from app.models.reading import MeterReading
from app.models.settings import AppSetting

logger = structlog.get_logger()

_TMP = tempfile.gettempdir()
SETTINGS_KEY = "integrations_spie"
LAST_SYNC_KEY = "integrations_spie_last_sync"
# Standard-Rückblick wenn noch kein Messwert vorhanden
DEFAULT_LOOKBACK_DAYS = 30
# Ab dieser Inaktivität (Sekunden) gilt ein "running"-Fortschritt als abgebrochen.
# Der Import aktualisiert den Fortschritt je Zähler bzw. je Recompute-Schritt,
# also deutlich häufiger als dieser Wert.
PROGRESS_STALE_SECONDS = 180


def _progress_path(job_id: str) -> str:
    return os.path.join(_TMP, f"spie_sync_{job_id}.json")


def _write_progress(job_id: str, data: dict) -> None:
    """Fortschritt auf Disk schreiben (Reload-sicher)."""
    try:
        with open(_progress_path(job_id), "w") as f:
            json.dump(data, f)
    except OSError as e:
        logger.warning("spie_progress_write_failed", job_id=job_id, error=str(e))


def read_progress(job_id: str) -> dict | None:
    """Fortschritt aus Disk lesen (für API-Endpoint).

    Stale-Erkennung: Ein laufender Import schreibt regelmäßig Fortschritt. Wird
    die Datei länger als PROGRESS_STALE_SECONDS nicht mehr aktualisiert, obwohl
    der Status noch "running" ist, gilt der Task als abgebrochen (typisch nach
    einem Container-Neustart, der die In-Process-asyncio-Task killt). Dann wird
    "error" gemeldet, damit das Frontend nicht ewig "läuft" anzeigt.
    """
    path = _progress_path(job_id)
    if not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None

    if isinstance(data, dict) and data.get("status") == "running":
        try:
            age = time.time() - os.path.getmtime(path)
        except OSError:
            age = 0
        if age > PROGRESS_STALE_SECONDS:
            data["status"] = "error"
            data["error"] = (
                "Import abgebrochen – keine Aktualisierung seit "
                f"{int(age)} s (vermutlich Neustart)."
            )
    return data


def cleanup_progress(job_id: str) -> None:
    """Fortschritts-Datei löschen."""
    try:
        os.unlink(_progress_path(job_id))
    except OSError:
        pass


class SpieService:
    """Service für SPIE-Konfiguration und automatischen Messwert-Import."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ── Konfiguration ─────────────────────────────────────────────────────────

    async def get_config(self) -> dict | None:
        """
        Liest SPIE-Konfiguration aus app_settings.
        Passwort wird nicht zurückgegeben (maskiert mit '***').
        """
        row = await self.db.execute(
            select(AppSetting).where(AppSetting.key == SETTINGS_KEY)
        )
        setting = row.scalar_one_or_none()
        if not setting or not setting.value:
            return None
        val = dict(setting.value)
        if "password" in val:
            val["password_set"] = True
            del val["password"]
        return val

    async def save_config(
        self,
        username: str,
        password: str | None,
        enabled: bool,
    ) -> None:
        """
        Speichert SPIE-Konfiguration in app_settings.
        password=None → bestehendes Passwort unverändert lassen.
        """
        row = await self.db.execute(
            select(AppSetting).where(AppSetting.key == SETTINGS_KEY)
        )
        setting = row.scalar_one_or_none()
        current = dict(setting.value) if (setting and setting.value) else {}

        new_val = {
            "username": username,
            "password": password if password else current.get("password", ""),
            "enabled": enabled,
        }

        if setting:
            setting.value = new_val
        else:
            setting = AppSetting(
                key=SETTINGS_KEY,
                value=new_val,
                description="SPIE Energy-as-a-Service Zugangsdaten und Automatik-Import",
                category="integrations",
            )
            self.db.add(setting)

        await self.db.commit()
        logger.info("spie_config_saved", username=username, enabled=enabled)

    async def get_last_sync(self) -> dict | None:
        """Letzten Sync-Status aus app_settings lesen."""
        row = await self.db.execute(
            select(AppSetting).where(AppSetting.key == LAST_SYNC_KEY)
        )
        setting = row.scalar_one_or_none()
        if not setting or not setting.value:
            return None
        return dict(setting.value)

    async def _save_last_sync(self, result: dict) -> None:
        """Sync-Ergebnis in app_settings speichern."""
        row = await self.db.execute(
            select(AppSetting).where(AppSetting.key == LAST_SYNC_KEY)
        )
        setting = row.scalar_one_or_none()
        val = {
            "synced_at": datetime.now(timezone.utc).isoformat(),
            "imported": result.get("imported", 0),
            "skipped": result.get("skipped", 0),
            "errors": result.get("errors", 0),
            "meters_processed": result.get("meters_processed", 0),
        }
        if setting:
            setting.value = val
        else:
            setting = AppSetting(
                key=LAST_SYNC_KEY,
                value=val,
                description="Letzter SPIE-Sync",
                category="integrations",
            )
            self.db.add(setting)
        await self.db.commit()

    # ── Zähler laden ──────────────────────────────────────────────────────────

    async def _load_spie_meters(self) -> list[Meter]:
        """
        Alle aktiven Zähler mit SPIE-Verknüpfung laden.
        Identisches Query wie in enrich_spie_meters.py.
        """
        result = await self.db.execute(
            select(Meter).where(
                Meter.is_active == True,  # noqa: E712
                Meter.spie_import_excluded == False,  # noqa: E712
                (Meter.data_source == "spie")
                | (Meter.source_config["spie_nav_id"].as_string() != None),  # noqa: E711
            )
        )
        return list(result.scalars().all())

    async def _get_latest_reading_timestamp(self, meter_id: uuid.UUID) -> datetime | None:
        """MAX(timestamp) aus meter_readings für diesen Zähler."""
        result = await self.db.execute(
            select(func.max(MeterReading.timestamp)).where(
                MeterReading.meter_id == meter_id
            )
        )
        return result.scalar_one_or_none()

    # ── Import ────────────────────────────────────────────────────────────────

    async def run_import(
        self,
        job_id: str | None = None,
        override_from: date | None = None,
        replace: bool = False,
    ) -> dict:
        """
        Importiert Messwerte für alle SPIE-Zähler.

        Standard (inkrementell):
          - date_from = MAX(timestamp) + 1s (oder heute - DEFAULT_LOOKBACK_DAYS)
          - date_to   = jetzt (UTC)
          - Werte speichern (ON CONFLICT DO NOTHING)

        Fallback (override_from gesetzt):
          - date_from = override_from für ALLE Zähler
          - replace=True: vorhandene Readings ab date_from werden je Zähler
            gelöscht und durch die SPIE-Werte ersetzt (nur wenn SPIE Werte
            liefert – sonst bleibt der Bestand unangetastet, kein Datenverlust).

        Fortschritt wird in /tmp/spie_sync_{job_id}.json geschrieben.
        """
        if job_id is None:
            job_id = str(uuid.uuid4())

        # Konfiguration laden
        cfg = await self.get_config_raw()
        if not cfg:
            err = "SPIE nicht konfiguriert."
            _write_progress(job_id, {"status": "error", "error": err})
            return {"status": "error", "error": err}

        username = cfg.get("username", "")
        password = cfg.get("password", "")
        if not username or not password:
            err = "SPIE-Zugangsdaten unvollständig."
            _write_progress(job_id, {"status": "error", "error": err})
            return {"status": "error", "error": err}

        # Zähler laden
        meters = await self._load_spie_meters()
        total = len(meters)
        if total == 0:
            result = {"status": "done", "imported": 0, "skipped": 0, "errors": 0, "meters_processed": 0}
            _write_progress(job_id, {**result, "percent": 100})
            return result

        _write_progress(job_id, {
            "status": "running", "phase": "login",
            "current_meter": 0, "total_meters": total,
            "meter_name": "", "imported": 0, "errors": 0, "percent": 0,
        })

        imported_total = 0
        error_count = 0
        now = datetime.now(timezone.utc)
        # Zähler, die SPIE-Werte geliefert haben → nach dem Import muss ihr
        # Verbrauch berechnet werden (SPIE liefert nur value, consumption=NULL).
        affected_meter_ids: set[uuid.UUID] = set()

        async with SpieClient() as client:
            # Login
            try:
                await client.login(username, password)
            except SpieAuthError as e:
                err = f"SPIE-Login fehlgeschlagen: {e}"
                logger.error("spie_import_login_failed", error=str(e))
                _write_progress(job_id, {"status": "error", "error": err})
                return {"status": "error", "error": err}

            for idx, meter in enumerate(meters, 1):
                nav_id = (meter.source_config or {}).get("spie_nav_id") or \
                         (meter.source_config or {}).get("nav_id")
                meter_name = meter.display_name or meter.name or str(meter.id)
                percent = round((idx - 1) / total * 100)

                _write_progress(job_id, {
                    "status": "running", "phase": "import",
                    "current_meter": idx, "total_meters": total,
                    "meter_name": meter_name,
                    "imported": imported_total,
                    "errors": error_count,
                    "percent": percent,
                })

                if not nav_id:
                    logger.debug("spie_import_no_nav_id", meter_id=str(meter.id), name=meter_name)
                    continue

                # Startdatum: Fallback-Wunschdatum hat Vorrang, sonst ab letztem Messwert
                if override_from is not None:
                    date_from = override_from
                else:
                    latest_ts = await self._get_latest_reading_timestamp(meter.id)
                    if latest_ts:
                        date_from = (latest_ts + timedelta(seconds=1)).date()
                    else:
                        date_from = (now - timedelta(days=DEFAULT_LOOKBACK_DAYS)).date()

                date_to = now.date()

                if date_from > date_to:
                    logger.debug("spie_import_up_to_date", meter=meter_name)
                    continue

                # Session alle 25 Zähler erneuern
                if idx > 1 and (idx - 1) % 25 == 0:
                    try:
                        await client.login(username, password)
                    except SpieAuthError as e:
                        logger.warning("spie_session_refresh_failed", error=str(e))

                # Messwerte abrufen
                try:
                    readings = await client.get_readings(nav_id, date_from, date_to)
                except Exception as e:
                    logger.warning("spie_import_meter_error", meter=meter_name, error=str(e))
                    error_count += 1
                    continue

                if not readings:
                    logger.debug("spie_import_no_readings", meter=meter_name,
                                 date_from=str(date_from), date_to=str(date_to))
                    continue

                # Replace-Modus: vorhandene Readings ab date_from ersetzen.
                # Nur löschen wenn SPIE auch Werte liefert (oben bereits geprüft),
                # damit kein Bestand ohne Ersatz verloren geht.
                if replace and override_from is not None:
                    deleted = await self._delete_readings_from(meter.id, date_from)
                    logger.info("spie_replace_deleted", meter=meter_name,
                                deleted=deleted, date_from=str(date_from))

                # Werte in DB schreiben (ON CONFLICT DO NOTHING)
                meter_imported = await self._insert_readings(meter.id, readings)
                imported_total += meter_imported
                # Auch bei 0 neu eingefügten Zeilen (reine Duplikate) vormerken:
                # bereits vorhandene SPIE-Werte können noch consumption=NULL haben
                # und müssen nachberechnet werden.
                affected_meter_ids.add(meter.id)
                logger.info("spie_import_meter_done",
                            meter=meter_name, imported=meter_imported,
                            date_from=str(date_from), date_to=str(date_to))

        # Verbrauch nachberechnen: SPIE liefert nur Rohwerte (value), consumption
        # bleibt beim Insert NULL. Ohne diesen Schritt summiert die Monats-
        # Vorberechnung (SUM(consumption)) nichts → die Werte erscheinen in keiner
        # Auswertung. Läuft nach dem Schließen des Browsers.
        await self._recompute_and_invalidate(
            affected_meter_ids, job_id=job_id,
            imported_total=imported_total, error_count=error_count,
        )

        # Abschluss
        result = {
            "status": "done",
            "imported": imported_total,
            "skipped": 0,
            "errors": error_count,
            "meters_processed": total,
        }
        _write_progress(job_id, {
            **result, "percent": 100,
            "current_meter": total, "total_meters": total, "meter_name": "",
        })
        await self._save_last_sync(result)
        logger.info("spie_import_done", **{k: v for k, v in result.items() if k != "status"})
        return result

    async def _recompute_and_invalidate(
        self,
        meter_ids: set[uuid.UUID],
        job_id: str | None = None,
        imported_total: int = 0,
        error_count: int = 0,
    ) -> int:
        """Verbrauch je Zähler neu berechnen und Analyse-Caches/Snapshots verwerfen.

        recompute_meter_consumption respektiert is_delivery_based (Wert IST
        Verbrauch) vs. Differenzbildung und aktualisiert je Zähler die Monats-
        Vorberechnung. Anschließend werden Analyse-Cache und Dashboard-/Analytics-
        Snapshots verworfen, damit die neu berechneten Verbräuche sofort (statt
        erst beim nächsten 6-h-Beat) in Dashboard und Auswertung erscheinen.
        Gibt die Anzahl verarbeiteter Zähler zurück.
        """
        if not meter_ids:
            return 0

        from app.services.reading_service import ReadingService

        rsvc = ReadingService(self.db)
        n = len(meter_ids)
        for i, mid in enumerate(sorted(meter_ids, key=str), 1):
            if job_id:
                _write_progress(job_id, {
                    "status": "running", "phase": "recompute",
                    "current_meter": i, "total_meters": n,
                    "meter_name": "Verbrauchsberechnung",
                    "imported": imported_total, "errors": error_count,
                    "percent": round((i - 1) / n * 100) if n else 100,
                })
            try:
                await rsvc.recompute_meter_consumption(mid)
            except Exception as e:
                logger.warning("spie_recompute_failed", meter_id=str(mid), error=str(e))

        try:
            from sqlalchemy import delete as _delete

            from app.core.cache import cache_delete
            from app.models.snapshot import AnalyticsSnapshot, DashboardSnapshot

            await cache_delete("analytics_*")
            await self.db.execute(_delete(DashboardSnapshot))
            await self.db.execute(_delete(AnalyticsSnapshot))
            await self.db.commit()
        except Exception as e:  # pragma: no cover - Invalidierung ist best effort
            logger.warning("spie_snapshot_invalidation_failed", error=str(e))
        return n

    async def recompute_all_spie_meters(self, job_id: str | None = None) -> int:
        """Verbrauch ALLER SPIE-Zähler mengenbasiert nachberechnen – ohne
        erneutes Scraping und ohne 222 Einzelläufe.

        Statt je Zähler ein Fenster-UPDATE + eine Monats-Vorberechnung (langsam:
        ~40 s/Zähler) laufen nur noch wenige Set-Statements:
          1. EIN Fenster-UPDATE (LAG PARTITION BY meter_id) für ALLE
             differenzbasierten SPIE-Zähler.
          2. EIN UPDATE (consumption = value) für ALLE lieferungsbasierten.
          3. EINE globale Monats-Vorberechnung (ein GROUP BY).
          4. Analyse-Cache + Dashboard-/Analytics-Snapshots verwerfen.
        Nur tatsächlich geänderte Zeilen werden geschrieben (IS DISTINCT FROM).
        Mit ``job_id`` wird ein grober Fortschritt in die Progress-Datei geschrieben.
        Gibt die Anzahl SPIE-Zähler zurück.
        """
        meters = await self._load_spie_meters()
        n = len(meters)
        if n == 0:
            return 0

        def _prog(percent: int, note: str) -> None:
            if job_id:
                _write_progress(job_id, {
                    "status": "running", "phase": "recompute",
                    "current_meter": 0, "total_meters": n,
                    "meter_name": note, "imported": 0, "errors": 0,
                    "percent": percent,
                })

        # SPIE-Zähler-Filter identisch zu _load_spie_meters, aber als SQL – so ist
        # kein Array-Parameter nötig. Enthält ausschließlich statische Bedingungen
        # (keine Nutzereingabe), daher unbedenklich per f-string eingesetzt.
        spie_filter = (
            "m.is_active = true "
            "AND m.spie_import_excluded = false "
            "AND (m.data_source = 'spie' "
            "     OR (m.source_config->>'spie_nav_id') IS NOT NULL)"
        )

        _prog(10, "Verbrauch berechnen (differenzbasiert)")
        # Differenzbasiert: consumption = value − vorheriger (nicht-NULL) Stand.
        # is_delivery_based NULL zählt als false → differenzbasiert.
        await self.db.execute(text(f"""
            WITH ordered AS (
                SELECT r.id,
                       r.value - LAG(r.value) OVER (
                           PARTITION BY r.meter_id ORDER BY r.timestamp
                       ) AS diff
                FROM meter_readings r
                JOIN meters m ON m.id = r.meter_id
                WHERE r.value IS NOT NULL
                  AND {spie_filter}
                  AND m.is_delivery_based IS NOT TRUE
            ),
            newvals AS (
                SELECT id, CASE WHEN diff IS NOT NULL AND diff >= 0 THEN diff
                                ELSE NULL END AS new_cons
                FROM ordered
            )
            UPDATE meter_readings mr
            SET consumption = n.new_cons
            FROM newvals n
            WHERE mr.id = n.id
              AND mr.consumption IS DISTINCT FROM n.new_cons
        """))

        _prog(40, "Verbrauch berechnen (lieferungsbasiert)")
        await self.db.execute(text(f"""
            UPDATE meter_readings mr
            SET consumption = mr.value
            FROM meters m
            WHERE mr.meter_id = m.id
              AND {spie_filter}
              AND m.is_delivery_based IS TRUE
              AND mr.value IS NOT NULL
              AND mr.consumption IS DISTINCT FROM mr.value
        """))
        await self.db.commit()

        _prog(55, "Monatswerte aktualisieren")
        # Monats-Vorberechnung global in EINEM GROUP BY erneuern (statt je Zähler).
        from app.services.reading_service import ReadingService
        await ReadingService(self.db).recompute_monthly_consumption()

        _prog(90, "Auswertung aktualisieren")
        try:
            from sqlalchemy import delete as _delete

            from app.core.cache import cache_delete
            from app.models.snapshot import AnalyticsSnapshot, DashboardSnapshot

            await cache_delete("analytics_*")
            await self.db.execute(_delete(DashboardSnapshot))
            await self.db.execute(_delete(AnalyticsSnapshot))
            await self.db.commit()
        except Exception as e:  # pragma: no cover - Invalidierung ist best effort
            logger.warning("spie_snapshot_invalidation_failed", error=str(e))

        logger.info("spie_recompute_all_done", meters=n)
        return n

    async def _delete_readings_from(self, meter_id: uuid.UUID, from_date: date) -> int:
        """Alle Readings eines Zählers ab `from_date` (Berlin-Mitternacht) löschen.

        Verwendet exakt dieselbe Zeitgrenze wie der SPIE-Abruf (Berlin-Mitternacht
        in UTC), damit kein Versatz entsteht und der gelöschte Bereich deckungs-
        gleich mit dem neu importierten Zeitraum ist.
        """
        from_ts = datetime.combine(
            from_date, datetime.min.time(), tzinfo=ZoneInfo("Europe/Berlin")
        ).astimezone(timezone.utc)
        result = await self.db.execute(
            delete(MeterReading).where(
                MeterReading.meter_id == meter_id,
                MeterReading.timestamp >= from_ts,
            )
        )
        await self.db.commit()
        return result.rowcount or 0

    async def _insert_readings(
        self, meter_id: uuid.UUID, readings: list[dict]
    ) -> int:
        """
        Messwerte in meter_readings einfügen.
        ON CONFLICT (meter_id, timestamp) DO NOTHING → keine Duplikate.
        Gibt Anzahl tatsächlich eingefügter Zeilen zurück.
        """
        inserted = 0
        for r in readings:
            try:
                stmt = pg_insert(MeterReading).values(
                    id=uuid.uuid4(),
                    meter_id=meter_id,
                    timestamp=r["timestamp"],
                    value=Decimal(str(r["value"])),
                    source="spie",
                    quality="measured",
                ).on_conflict_do_nothing(
                    index_elements=["meter_id", "timestamp"]
                )
                result = await self.db.execute(stmt)
                if result.rowcount:
                    inserted += 1
            except Exception as e:
                logger.warning("spie_insert_reading_failed", meter_id=str(meter_id), error=str(e))
        if inserted:
            await self.db.commit()
        return inserted

    async def get_config_raw(self) -> dict | None:
        """Konfiguration inkl. Passwort (nur intern verwenden)."""
        row = await self.db.execute(
            select(AppSetting).where(AppSetting.key == SETTINGS_KEY)
        )
        setting = row.scalar_one_or_none()
        if not setting or not setting.value:
            return None
        return dict(setting.value)
