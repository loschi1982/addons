"""
backup_service.py – Vollständiger Datenbank-Export und -Import.

Exportiert alle Tabellen als komprimierte JSON-Datei (.json.gz).
Importiert diese Datei in eine frische oder bestehende Datenbank.
Reihenfolge der Tabellen berücksichtigt Foreign-Key-Abhängigkeiten.
"""

import gzip
import json
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger()

# Aktuelle Format-Version – wird beim Import geprüft
BACKUP_FORMAT_VERSION = "1.0"

# Tabellen in Importreihenfolge (abhängige Tabellen nach ihren Eltern)
EXPORT_TABLES: list[str] = [
    # ── Auth / Benutzer ──
    "roles",
    "permissions",
    "role_permissions",
    "users",
    "user_permission_overrides",
    "user_sessions",
    "audit_logs",
    # ── App-Einstellungen ──
    "app_settings",
    # ── Emissionsfaktoren ──
    "emission_factor_sources",
    "emission_factors",
    # ── Standort-Hierarchie ──
    "sites",
    "buildings",
    "usage_units",
    # ── Zähler ──
    "meters",
    "meter_unit_allocations",
    "meter_changes",
    # ── Verbraucher ──
    "consumers",
    "meter_consumer",
    # ── Wetterdaten ──
    "weather_stations",
    "weather_records",
    "monthly_degree_days",
    # ── Klimasensoren ──
    "climate_sensors",
    "climate_readings",
    "climate_zone_summaries",
    # ── Import / Zählerstände ──
    "import_mapping_profiles",
    "import_batches",
    "meter_readings",
    # ── Rechnungen ──
    "energy_invoices",
    # ── CO₂-Berechnungen ──
    "co2_calculations",
    # ── ISO 50001 Management ──
    "organization_context",
    "energy_policies",
    "enms_roles",
    "documents",
    "document_revisions",
    "legal_requirements",
    "energy_objectives",
    "action_plans",
    "risks_opportunities",
    "internal_audits",
    "audit_findings",
    "management_reviews",
    "nonconformities",
    # ── Energieschema ──
    "energy_schemas",
    "schema_positions",
    # ── Energiebewertung ──
    "relevant_variables",
    "relevant_variable_values",
    "significant_energy_uses",
    "energy_baselines",
    "energy_performance_indices",
    # ── Witterungskorrektur ──
    "corrections",
    # ── Berichte ──
    "audit_reports",
]


# Tabellen die beim Factory-Reset NICHT gelöscht werden (Seed-Daten)
FACTORY_RESET_KEEP: set[str] = {
    "roles",
    "permissions",
    "role_permissions",
    "emission_factor_sources",
    "emission_factors",
    "weather_stations",
}


async def factory_reset(db: AsyncSession, new_password_hash: str) -> dict:
    """
    Setzt das System auf Werkseinstellungen zurück.

    Behält: Rollen, Berechtigungen, Emissionsfaktoren, Wetterstationen.
    Löscht: Alle Benutzer- und Messdaten, ISO-Daten, Einstellungen, Berichte usw.
    Legt danach einen frischen Admin-Benutzer mit dem neuen Passwort-Hash an.

    Args:
        db: Datenbankverbindung.
        admin_user_password_hash: Aktueller Hash des Admin-Passworts (bereits verifiziert).
        new_password_hash: Hash des neuen Admin-Passworts (identisch wenn nicht geändert).

    Returns:
        Dict mit gelöschten Tabellen.
    """
    deleted: list[str] = []

    try:
        # FK-Checks deaktivieren
        await db.execute(text("SET session_replication_role = 'replica'"))
        await db.commit()

        # Jede Tabelle in eigenem Savepoint – Fehler einer Tabelle bricht
        # nicht die gesamte Transaktion ab
        for table in reversed(EXPORT_TABLES):
            if table in FACTORY_RESET_KEEP:
                continue
            try:
                async with db.begin_nested():
                    await db.execute(text(f'TRUNCATE TABLE "{table}" CASCADE'))  # noqa: S608
                deleted.append(table)
            except Exception as e:
                logger.warning("factory_reset_table_skip", table=table, error=str(e))

        # Frischen Admin-Benutzer anlegen
        admin_id = str(uuid.uuid4())
        await db.execute(text("""
            INSERT INTO users (id, username, email, display_name, password_hash, is_active, role_id, created_at, updated_at)
            SELECT :id, 'admin', 'admin@local.host', 'Administrator', :pw, true,
                   (SELECT id FROM roles WHERE name = 'admin' LIMIT 1),
                   NOW(), NOW()
            WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin')
        """), {"id": admin_id, "pw": new_password_hash})

        await db.commit()

        # FK-Checks wieder aktivieren
        await db.execute(text("SET session_replication_role = 'origin'"))
        await db.commit()

    except Exception:
        await db.rollback()
        try:
            await db.execute(text("SET session_replication_role = 'origin'"))
            await db.commit()
        except Exception:
            pass
        raise

    logger.info("factory_reset_complete", deleted_tables=len(deleted))
    return {"deleted_tables": deleted, "kept_tables": list(FACTORY_RESET_KEEP)}


class _JsonEncoder(json.JSONEncoder):
    """JSON-Encoder mit Unterstützung für UUID, datetime, date, Decimal."""

    def default(self, obj: Any) -> Any:
        if isinstance(obj, uuid.UUID):
            return str(obj)
        if isinstance(obj, datetime):
            return obj.isoformat()
        if isinstance(obj, date):
            return obj.isoformat()
        if isinstance(obj, Decimal):
            return float(obj)
        if isinstance(obj, bytes):
            # Binärdaten (z.B. import_batches.file_content) als Base64
            import base64
            return base64.b64encode(obj).decode("ascii")
        return super().default(obj)


def _serialize_row(row: Any) -> dict:
    """Konvertiert eine SQLAlchemy-Row in ein JSON-serialisierbares Dict."""
    return {k: v for k, v in row._mapping.items()}


async def export_database(db: AsyncSession) -> bytes:
    """
    Exportiert alle Tabellen als komprimiertes JSON.

    Returns:
        Gzip-komprimierte JSON-Bytes.
    """
    export_data: dict[str, Any] = {
        "version": BACKUP_FORMAT_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "tables": {},
    }

    skipped: list[str] = []

    for table in EXPORT_TABLES:
        try:
            result = await db.execute(text(f"SELECT * FROM {table}"))  # noqa: S608
            rows = result.fetchall()
            export_data["tables"][table] = [_serialize_row(r) for r in rows]
            logger.info("backup_export_table", table=table, rows=len(rows))
        except Exception as e:
            # Tabelle existiert noch nicht (z.B. nach Migration) – überspringen
            skipped.append(table)
            logger.warning("backup_export_table_skipped", table=table, error=str(e))

    if skipped:
        export_data["skipped_tables"] = skipped

    json_bytes = json.dumps(export_data, cls=_JsonEncoder, ensure_ascii=False).encode("utf-8")
    compressed = gzip.compress(json_bytes, compresslevel=6)
    logger.info(
        "backup_export_complete",
        tables=len(export_data["tables"]),
        size_kb=round(len(compressed) / 1024, 1),
    )
    return compressed


async def import_database(db: AsyncSession, backup_bytes: bytes, replace: bool = True) -> dict:
    """
    Importiert einen Datenbank-Backup.

    Args:
        db:           Datenbankverbindung.
        backup_bytes: Gzip-komprimierte JSON-Bytes (vom Export).
        replace:      True = bestehende Daten löschen vor Import (empfohlen).

    Returns:
        Dict mit Statistiken: {imported, skipped, errors}.
    """
    # Dekomprimieren + Parsen
    try:
        json_bytes = gzip.decompress(backup_bytes)
        data = json.loads(json_bytes.decode("utf-8"))
    except Exception as e:
        raise ValueError(f"Ungültiges Backup-Format: {e}") from e

    version = data.get("version")
    if version != BACKUP_FORMAT_VERSION:
        raise ValueError(f"Inkompatible Backup-Version: {version!r} (erwartet: {BACKUP_FORMAT_VERSION!r})")

    tables_data: dict[str, list[dict]] = data.get("tables", {})
    stats = {"imported": 0, "skipped": 0, "errors": []}

    # Foreign-Key-Checks deaktivieren während des Imports
    await db.execute(text("SET session_replication_role = 'replica'"))

    try:
        if replace:
            # Tabellen in umgekehrter Reihenfolge leeren (Abhängigkeiten)
            for table in reversed(EXPORT_TABLES):
                if table in tables_data:
                    try:
                        await db.execute(text(f"TRUNCATE TABLE {table} CASCADE"))  # noqa: S608
                    except Exception:
                        pass  # Tabelle existiert vielleicht nicht

        # Daten einfügen
        for table in EXPORT_TABLES:
            rows = tables_data.get(table)
            if not rows:
                continue

            try:
                await _insert_rows(db, table, rows)
                stats["imported"] += len(rows)
                logger.info("backup_import_table", table=table, rows=len(rows))
            except Exception as e:
                stats["errors"].append(f"{table}: {e}")
                stats["skipped"] += 1
                logger.warning("backup_import_table_failed", table=table, error=str(e))

        await db.commit()

    except Exception as e:
        await db.rollback()
        raise
    finally:
        # Foreign-Key-Checks wieder aktivieren
        await db.execute(text("SET session_replication_role = 'origin'"))
        await db.commit()

    logger.info("backup_import_complete", **stats)
    return stats


async def _insert_rows(db: AsyncSession, table: str, rows: list[dict]) -> None:
    """Fügt Rows in eine Tabelle ein (batched, via parameterized INSERT)."""
    if not rows:
        return

    # Spalten aus erstem Row ermitteln
    columns = list(rows[0].keys())
    col_names = ", ".join(f'"{c}"' for c in columns)
    placeholders = ", ".join(f":{c}" for c in columns)
    sql = text(
        f'INSERT INTO "{table}" ({col_names}) VALUES ({placeholders}) '  # noqa: S608
        f"ON CONFLICT DO NOTHING"
    )

    # Werte konvertieren (Base64 zurück zu Bytes für Binärspalten)
    import base64
    converted_rows = []
    for row in rows:
        converted = {}
        for k, v in row.items():
            # Binärspalten (file_content) als Base64-String → Bytes
            if k == "file_content" and isinstance(v, str):
                try:
                    v = base64.b64decode(v)
                except Exception:
                    pass
            converted[k] = v
        converted_rows.append(converted)

    # In Batches à 500 einfügen
    batch_size = 500
    for i in range(0, len(converted_rows), batch_size):
        batch = converted_rows[i : i + batch_size]
        await db.execute(sql, batch)
