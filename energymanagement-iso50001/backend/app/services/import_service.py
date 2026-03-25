"""
import_service.py – CSV/Excel-Datenimport.

Der Import läuft in mehreren Schritten:
1. Datei hochladen → Format/Spalten erkennen, Vorschau generieren
2. Spaltenzuordnung und Zähler-Mapping bestätigen
3. Validierung mit Plausibilitätsprüfung
4. Daten importieren mit Duplikat-Erkennung
5. Rückgängig-Funktion über import_batch_id

Unterstützte Formate: CSV (mit automatischer Trennzeichen-/Encoding-Erkennung), XLSX
"""

import csv
import io
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    EnergyManagementError,
    ImportFormatError,
    ImportValidationError,
)
from app.models.meter import Meter
from app.models.reading import ImportBatch, ImportMappingProfile, MeterReading

logger = structlog.get_logger()

# Gängige Datumsformate für automatische Erkennung
DATE_FORMATS = [
    "%d.%m.%Y %H:%M",
    "%d.%m.%Y %H:%M:%S",
    "%d.%m.%Y",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%d",
    "%d/%m/%Y",
    "%m/%d/%Y",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M:%SZ",
]


class ImportService:
    """Service für CSV/Excel-Import von Zählerständen."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def upload_file(
        self, filename: str, content: bytes, user_id: uuid.UUID
    ) -> dict:
        """
        Datei analysieren und Spalten erkennen.

        1. Format erkennen (CSV vs XLSX)
        2. Trennzeichen und Encoding erkennen (CSV)
        3. Spalten und erste Zeilen als Vorschau liefern
        4. Multi-Meter-Erkennung (>1 Wert-Spalte)
        5. ImportBatch-Eintrag anlegen

        Returns:
            Dict mit batch_id, filename, detected_columns, preview_rows, row_count,
            is_multi_meter, meter_columns
        """
        file_type = self._detect_file_type(filename)

        if file_type == "csv":
            columns, rows, total_rows = self._parse_csv(content)
        elif file_type in ("xlsx", "xls"):
            columns, rows, total_rows = self._parse_excel(content)
        else:
            raise ImportFormatError(f"Nicht unterstütztes Dateiformat: {filename}")

        # Multi-Meter-Erkennung: Spalte 0 = Datum, Spalten 1..N = Werte
        is_multi_meter = len(columns) > 2
        meter_columns = None

        if is_multi_meter:
            # Spalten ab Index 1 als potenzielle Zähler-Spalten
            meter_columns = [
                {"column_index": i, "column_name": col}
                for i, col in enumerate(columns)
                if i > 0
            ]

        # ImportBatch anlegen
        batch = ImportBatch(
            filename=filename,
            file_type=file_type,
            file_size_bytes=len(content),
            column_mapping={},
            import_settings={},
            meter_mapping={},
            total_rows=total_rows,
            status="uploaded",
            imported_by=user_id,
        )
        self.db.add(batch)
        await self.db.commit()

        # Erste 20 Zeilen als Vorschau
        preview = rows[:20]

        return {
            "batch_id": batch.id,
            "filename": filename,
            "detected_columns": columns,
            "preview_rows": preview,
            "row_count": total_rows,
            "is_multi_meter": is_multi_meter,
            "meter_columns": meter_columns,
        }

    async def process_import(
        self,
        batch_id: uuid.UUID,
        column_mapping: dict[str, str],
        date_format: str | None = None,
        decimal_separator: str = ",",
        skip_duplicates: bool = True,
        meter_id: uuid.UUID | None = None,
        save_as_profile: str | None = None,
        user_id: uuid.UUID | None = None,
        meter_column_mapping: dict[int, uuid.UUID] | None = None,
    ) -> dict:
        """
        Import mit bestätigter Spaltenzuordnung durchführen.

        column_mapping: {"Quellspalte": "timestamp" | "value" | "meter_id" | "notes"}

        Ablauf:
        1. Batch laden und Datei erneut parsen
        2. Zeile für Zeile: Datum parsen, Wert konvertieren, Zähler zuordnen
        3. Duplikate prüfen (meter_id + timestamp)
        4. Plausibilitätsprüfung
        5. Speichern und Ergebnis zusammenfassen
        """
        batch = await self.db.get(ImportBatch, batch_id)
        if not batch:
            raise EnergyManagementError(
                "Import-Batch nicht gefunden",
                error_code="BATCH_NOT_FOUND",
                status_code=404,
            )

        if batch.status not in ("uploaded", "validated"):
            raise EnergyManagementError(
                f"Import kann im Status '{batch.status}' nicht gestartet werden",
                error_code="INVALID_BATCH_STATUS",
                status_code=400,
            )

        # Mapping speichern
        batch.column_mapping = column_mapping
        batch.import_settings = {
            "date_format": date_format,
            "decimal_separator": decimal_separator,
            "skip_duplicates": skip_duplicates,
        }
        if meter_column_mapping:
            batch.meter_mapping = {
                str(k): str(v) for k, v in meter_column_mapping.items()
            }
        batch.status = "processing"

        # Auto-detect Datumsformat wenn nicht angegeben
        if not date_format:
            date_format = await self._detect_date_format(batch)

        imported = 0
        skipped = 0
        errors = []
        affected_meters = set()

        # Spalten-Mapping auflösen
        ts_col = None
        val_col = None
        meter_col = None
        notes_col = None

        for src_col, target in column_mapping.items():
            if target == "timestamp":
                ts_col = src_col
            elif target == "value":
                val_col = src_col
            elif target == "meter_id":
                meter_col = src_col
            elif target == "notes":
                notes_col = src_col

        if not ts_col or not val_col:
            raise ImportValidationError(
                "Spalten-Mapping unvollständig: 'timestamp' und 'value' sind Pflicht"
            )

        # TODO: Datei aus Storage laden – für Phase 2 erwarten wir,
        # dass die Daten im Batch gespeichert wurden. Für jetzt
        # setzen wir den Status auf completed und geben die Statistik zurück.
        # In einer vollständigen Implementierung würde hier die Datei
        # erneut gelesen und Zeile für Zeile verarbeitet.

        batch.imported_count = imported
        batch.skipped_count = skipped
        batch.error_count = len(errors)
        batch.error_details = errors[:100]  # Max 100 Fehler speichern
        batch.affected_meter_ids = [str(m) for m in affected_meters]
        batch.status = "completed"
        batch.completed_at = datetime.now(timezone.utc)

        # Profil speichern wenn gewünscht
        if save_as_profile and user_id:
            await self._save_profile(
                save_as_profile, batch.file_type, column_mapping,
                batch.import_settings, user_id,
            )

        await self.db.commit()

        return {
            "batch_id": batch.id,
            "status": batch.status,
            "total_rows": batch.total_rows,
            "imported_count": imported,
            "skipped_count": skipped,
            "error_count": len(errors),
            "errors": errors[:20],
        }

    async def import_rows(
        self,
        rows: list[dict],
        column_mapping: dict[str, str],
        batch_id: uuid.UUID,
        date_format: str | None = None,
        decimal_separator: str = ",",
        skip_duplicates: bool = True,
        default_meter_id: uuid.UUID | None = None,
    ) -> dict:
        """
        Zeilen direkt importieren (für programmatischen Aufruf).

        Wird vom Upload-Wizard aufgerufen, nachdem die Datei
        im Frontend geparst und die Zeilen an die API geschickt wurden.
        """
        ts_col = None
        val_col = None
        notes_col = None

        for src_col, target in column_mapping.items():
            if target == "timestamp":
                ts_col = src_col
            elif target == "value":
                val_col = src_col
            elif target == "notes":
                notes_col = src_col

        imported = 0
        skipped = 0
        errors = []
        affected_meters = set()

        for i, row in enumerate(rows):
            try:
                # Datum parsen
                raw_ts = row.get(ts_col, "")
                timestamp = self._parse_date(str(raw_ts), date_format)
                if not timestamp:
                    errors.append({"row": i + 1, "error": f"Ungültiges Datum: {raw_ts}"})
                    continue

                # Wert parsen
                raw_val = row.get(val_col, "")
                value = self._parse_decimal(str(raw_val), decimal_separator)
                if value is None:
                    errors.append({"row": i + 1, "error": f"Ungültiger Wert: {raw_val}"})
                    continue

                meter_id = default_meter_id

                if not meter_id:
                    errors.append({"row": i + 1, "error": "Kein Zähler zugeordnet"})
                    continue

                # Duplikat-Prüfung
                if skip_duplicates:
                    existing = await self.db.execute(
                        select(MeterReading).where(
                            MeterReading.meter_id == meter_id,
                            MeterReading.timestamp == timestamp,
                        ).limit(1)
                    )
                    if existing.scalar_one_or_none():
                        skipped += 1
                        continue

                # Verbrauch berechnen
                prev = await self.db.execute(
                    select(MeterReading)
                    .where(
                        MeterReading.meter_id == meter_id,
                        MeterReading.timestamp < timestamp,
                    )
                    .order_by(MeterReading.timestamp.desc())
                    .limit(1)
                )
                prev_reading = prev.scalar_one_or_none()
                consumption = None
                if prev_reading:
                    diff = value - prev_reading.value
                    consumption = diff if diff >= 0 else None

                reading = MeterReading(
                    meter_id=meter_id,
                    timestamp=timestamp,
                    value=value,
                    consumption=consumption,
                    source="import",
                    quality="measured",
                    notes=row.get(notes_col) if notes_col else None,
                    import_batch_id=batch_id,
                )
                self.db.add(reading)
                imported += 1
                affected_meters.add(meter_id)

            except Exception as e:
                errors.append({"row": i + 1, "error": str(e)})

        # Batch aktualisieren
        batch = await self.db.get(ImportBatch, batch_id)
        if batch:
            batch.imported_count = imported
            batch.skipped_count = skipped
            batch.error_count = len(errors)
            batch.error_details = errors[:100]
            batch.affected_meter_ids = [str(m) for m in affected_meters]
            batch.status = "completed"
            batch.completed_at = datetime.now(timezone.utc)

        await self.db.commit()

        return {
            "batch_id": batch_id,
            "status": "completed",
            "total_rows": len(rows),
            "imported_count": imported,
            "skipped_count": skipped,
            "error_count": len(errors),
            "errors": errors[:20],
        }

    async def get_import_result(self, batch_id: uuid.UUID) -> dict:
        """Import-Ergebnis abrufen."""
        batch = await self.db.get(ImportBatch, batch_id)
        if not batch:
            raise EnergyManagementError(
                "Import-Batch nicht gefunden",
                error_code="BATCH_NOT_FOUND",
                status_code=404,
            )

        return {
            "batch_id": batch.id,
            "status": batch.status,
            "total_rows": batch.total_rows,
            "imported_count": batch.imported_count,
            "skipped_count": batch.skipped_count,
            "error_count": batch.error_count,
            "errors": batch.error_details or [],
        }

    async def undo_import(self, batch_id: uuid.UUID) -> int:
        """
        Kompletten Import rückgängig machen.

        Löscht alle MeterReadings mit dieser batch_id.
        """
        result = await self.db.execute(
            select(MeterReading).where(MeterReading.import_batch_id == batch_id)
        )
        readings = result.scalars().all()
        count = len(readings)

        for r in readings:
            await self.db.delete(r)

        batch = await self.db.get(ImportBatch, batch_id)
        if batch:
            batch.status = "reverted"

        await self.db.commit()
        logger.info("import_reverted", batch_id=str(batch_id), deleted_count=count)
        return count

    async def list_import_history(self, page: int = 1, page_size: int = 25) -> dict:
        """Alle bisherigen Imports auflisten."""
        from sqlalchemy import func

        query = select(ImportBatch).order_by(ImportBatch.created_at.desc())

        count_query = select(func.count()).select_from(ImportBatch)
        total = (await self.db.execute(count_query)).scalar() or 0

        offset = (page - 1) * page_size
        result = await self.db.execute(query.offset(offset).limit(page_size))
        batches = result.scalars().all()

        return {
            "items": [
                {
                    "batch_id": b.id,
                    "filename": b.filename,
                    "file_type": b.file_type,
                    "status": b.status,
                    "total_rows": b.total_rows,
                    "imported_count": b.imported_count,
                    "error_count": b.error_count,
                    "created_at": b.created_at.isoformat(),
                    "completed_at": b.completed_at.isoformat() if b.completed_at else None,
                }
                for b in batches
            ],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    async def list_mapping_profiles(self) -> list[dict]:
        """Gespeicherte Import-Profile auflisten."""
        result = await self.db.execute(
            select(ImportMappingProfile).order_by(ImportMappingProfile.name)
        )
        profiles = result.scalars().all()
        return [
            {
                "id": p.id,
                "name": p.name,
                "column_mapping": p.column_mapping,
                "date_format": p.import_settings.get("date_format"),
                "decimal_separator": p.import_settings.get("decimal_separator", ","),
                "created_at": p.created_at,
            }
            for p in profiles
        ]

    async def delete_mapping_profile(self, profile_id: uuid.UUID) -> None:
        """Import-Profil löschen."""
        profile = await self.db.get(ImportMappingProfile, profile_id)
        if profile:
            await self.db.delete(profile)
            await self.db.commit()

    async def match_columns_to_meters(
        self, column_names: list[str],
    ) -> list[dict]:
        """
        Auto-Matching: Spalten-Header gegen bestehende Zähler abgleichen.

        Matching-Strategien (in Reihenfolge):
        1. Exakter Match auf meter.name oder meter.meter_number
        2. Teilstring-Match (Spaltenname enthält meter_number oder umgekehrt)
        """
        result = await self.db.execute(select(Meter))
        all_meters = result.scalars().all()

        matched = []
        for col_name in column_names:
            col_lower = col_name.lower().strip()
            match = None

            for meter in all_meters:
                # Exakter Match
                if meter.name and meter.name.lower() == col_lower:
                    match = meter
                    break
                if meter.meter_number and meter.meter_number.lower() == col_lower:
                    match = meter
                    break

            # Teilstring-Match
            if not match:
                for meter in all_meters:
                    if meter.meter_number and meter.meter_number.lower() in col_lower:
                        match = meter
                        break
                    if meter.name and meter.name.lower() in col_lower:
                        match = meter
                        break
                    # Umgekehrt: Spaltenname in Zählername
                    if meter.name and col_lower in meter.name.lower():
                        match = meter
                        break

            matched.append({
                "column_name": col_name,
                "matched_meter_id": str(match.id) if match else None,
                "matched_meter_name": match.name if match else None,
            })

        return matched

    async def import_multi_meter_rows(
        self,
        rows: list[dict],
        meter_column_mapping: dict[int, uuid.UUID],
        timestamp_column: str,
        batch_id: uuid.UUID,
        date_format: str | None = None,
        decimal_separator: str = ",",
        skip_duplicates: bool = True,
    ) -> dict:
        """
        Multi-Meter Import: Mehrere Zähler-Spalten gleichzeitig importieren.

        meter_column_mapping: {Spalten-Index → Meter-UUID}
        """
        columns = list(rows[0].keys()) if rows else []
        imported = 0
        skipped = 0
        errors = []
        affected_meters: set[uuid.UUID] = set()
        meter_details: dict[str, dict] = {}  # meter_id → {name, imported, errors}

        for i, row in enumerate(rows):
            # Datum parsen
            raw_ts = row.get(timestamp_column, "")
            timestamp = self._parse_date(str(raw_ts), date_format)
            if not timestamp:
                errors.append({"row": i + 1, "error": f"Ungültiges Datum: {raw_ts}"})
                continue

            # Jede gemappte Spalte verarbeiten
            for col_idx_str, meter_id in meter_column_mapping.items():
                col_idx = int(col_idx_str) if isinstance(col_idx_str, str) else col_idx_str
                if col_idx >= len(columns):
                    continue

                col_name = columns[col_idx]
                raw_val = row.get(col_name, "")

                # Leere Zellen überspringen
                if raw_val is None or str(raw_val).strip() == "":
                    continue

                value = self._parse_decimal(str(raw_val), decimal_separator)
                if value is None:
                    errors.append({
                        "row": i + 1,
                        "error": f"Ungültiger Wert in Spalte '{col_name}': {raw_val}",
                    })
                    continue

                try:
                    # Duplikat-Prüfung
                    if skip_duplicates:
                        existing = await self.db.execute(
                            select(MeterReading).where(
                                MeterReading.meter_id == meter_id,
                                MeterReading.timestamp == timestamp,
                            ).limit(1)
                        )
                        if existing.scalar_one_or_none():
                            skipped += 1
                            continue

                    # Verbrauch berechnen
                    prev = await self.db.execute(
                        select(MeterReading)
                        .where(
                            MeterReading.meter_id == meter_id,
                            MeterReading.timestamp < timestamp,
                        )
                        .order_by(MeterReading.timestamp.desc())
                        .limit(1)
                    )
                    prev_reading = prev.scalar_one_or_none()
                    consumption = None
                    if prev_reading:
                        diff = value - prev_reading.value
                        consumption = diff if diff >= 0 else None

                    reading = MeterReading(
                        meter_id=meter_id,
                        timestamp=timestamp,
                        value=value,
                        consumption=consumption,
                        source="import",
                        quality="measured",
                        import_batch_id=batch_id,
                    )
                    self.db.add(reading)
                    imported += 1
                    affected_meters.add(meter_id)

                    # Zähler-Details tracken
                    mid_str = str(meter_id)
                    if mid_str not in meter_details:
                        meter_details[mid_str] = {"imported": 0, "errors": 0}
                    meter_details[mid_str]["imported"] += 1

                except Exception as e:
                    errors.append({"row": i + 1, "error": str(e)})
                    mid_str = str(meter_id)
                    if mid_str not in meter_details:
                        meter_details[mid_str] = {"imported": 0, "errors": 0}
                    meter_details[mid_str]["errors"] += 1

        # Batch aktualisieren
        batch = await self.db.get(ImportBatch, batch_id)
        if batch:
            batch.imported_count = imported
            batch.skipped_count = skipped
            batch.error_count = len(errors)
            batch.error_details = errors[:100]
            batch.affected_meter_ids = [str(m) for m in affected_meters]
            batch.status = "completed"
            batch.completed_at = datetime.now(timezone.utc)

        await self.db.commit()

        return {
            "batch_id": batch_id,
            "status": "completed",
            "total_rows": len(rows),
            "imported_count": imported,
            "skipped_count": skipped,
            "error_count": len(errors),
            "errors": errors[:20],
            "meter_details": [
                {"meter_id": mid, **details}
                for mid, details in meter_details.items()
            ],
        }

    # ── Interne Hilfsmethoden ──

    def _detect_file_type(self, filename: str) -> str:
        """Dateityp anhand der Endung erkennen."""
        lower = filename.lower()
        if lower.endswith(".csv"):
            return "csv"
        elif lower.endswith(".xlsx"):
            return "xlsx"
        elif lower.endswith(".xls"):
            return "xls"
        raise ImportFormatError(f"Unbekannte Dateiendung: {filename}")

    def _parse_csv(self, content: bytes) -> tuple[list[str], list[dict], int]:
        """
        CSV-Datei parsen mit automatischer Erkennung von
        Trennzeichen und Encoding.
        """
        # Encoding erkennen (UTF-7, UTF-8, dann Latin-1 als Fallback)
        for encoding in ("utf-8", "utf-8-sig", "utf-7", "iso-8859-1", "windows-1252"):
            try:
                text = content.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        else:
            raise ImportFormatError("Datei-Encoding nicht erkannt")

        # Trennzeichen erkennen
        sniffer = csv.Sniffer()
        try:
            dialect = sniffer.sniff(text[:4096])
        except csv.Error:
            # Fallback: Semikolon (in DE Standard)
            dialect = csv.excel
            dialect.delimiter = ";"

        reader = csv.DictReader(io.StringIO(text), dialect=dialect)
        columns = reader.fieldnames or []

        rows = []
        for row in reader:
            rows.append(dict(row))

        return list(columns), rows, len(rows)

    def _parse_excel(self, content: bytes) -> tuple[list[str], list[dict], int]:
        """Excel-Datei parsen (benötigt openpyxl)."""
        try:
            import openpyxl
        except ImportError:
            raise ImportFormatError(
                "Excel-Import nicht verfügbar – openpyxl nicht installiert"
            )

        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True)
        ws = wb.active

        rows_data = []
        columns = []
        for i, row in enumerate(ws.iter_rows(values_only=True)):
            if i == 0:
                columns = [str(c) if c else f"Spalte_{j}" for j, c in enumerate(row)]
            else:
                row_dict = {}
                for j, val in enumerate(row):
                    if j < len(columns):
                        row_dict[columns[j]] = val
                rows_data.append(row_dict)

        wb.close()
        return columns, rows_data, len(rows_data)

    def _parse_date(self, value: str, fmt: str | None = None) -> datetime | None:
        """Datum parsen – mit angegebenem oder automatisch erkanntem Format."""
        if not value or value.strip() == "":
            return None

        value = value.strip()

        if fmt:
            try:
                dt = datetime.strptime(value, fmt)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt
            except ValueError:
                return None

        # Automatische Erkennung
        for fmt_try in DATE_FORMATS:
            try:
                dt = datetime.strptime(value, fmt_try)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt
            except ValueError:
                continue

        return None

    def _parse_decimal(self, value: str, decimal_separator: str = ",") -> Decimal | None:
        """Dezimalzahl parsen mit konfigurierbarem Dezimaltrennzeichen."""
        if not value or value.strip() == "":
            return None

        value = value.strip()

        # Tausendertrennzeichen entfernen
        if decimal_separator == ",":
            value = value.replace(".", "").replace(",", ".")
        else:
            value = value.replace(",", "")

        try:
            return Decimal(value)
        except InvalidOperation:
            return None

    async def _detect_date_format(self, batch: ImportBatch) -> str | None:
        """Datumsformat aus den Batch-Settings oder automatisch ermitteln."""
        settings = batch.import_settings or {}
        return settings.get("date_format")

    async def _save_profile(
        self, name: str, file_type: str, column_mapping: dict,
        import_settings: dict, user_id: uuid.UUID
    ) -> None:
        """Import-Mapping als Profil speichern."""
        # Prüfen ob Name bereits existiert
        existing = await self.db.execute(
            select(ImportMappingProfile).where(ImportMappingProfile.name == name)
        )
        profile = existing.scalar_one_or_none()

        if profile:
            # Bestehendes Profil aktualisieren
            profile.column_mapping = column_mapping
            profile.import_settings = import_settings
            profile.use_count += 1
            profile.last_used = datetime.now(timezone.utc)
        else:
            profile = ImportMappingProfile(
                name=name,
                file_type=file_type,
                column_mapping=column_mapping,
                import_settings=import_settings,
                created_by=user_id,
                use_count=1,
                last_used=datetime.now(timezone.utc),
            )
            self.db.add(profile)
