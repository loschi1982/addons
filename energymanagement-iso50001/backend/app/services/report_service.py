"""
report_service.py – Berichterstellung und PDF-Generierung.

Erstellt Energieberichte mit eingefrorenem Daten-Snapshot und
generiert PDF-Dokumente via Jinja2 + WeasyPrint.
"""

import os
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import structlog
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.emission import CO2Calculation, EmissionFactor
from app.models.meter import Meter
from app.models.reading import MeterReading
from app.models.report import AuditReport

logger = structlog.get_logger()

# Brennwert-Umrechnungsfaktoren
CONVERSION_FACTORS: dict[str, Decimal] = {
    "m³": Decimal("10.3"),
    "l": Decimal("9.8"),
    "kg": Decimal("4.8"),
    "MWh": Decimal("1000"),
    "kWh": Decimal("1"),
}

import os as _os
# Suche das Verzeichnis über das Repo-Root (parent von app/, services/)
# __file__ kann in Flatpak/Docker-Umgebungen als /app/... aufgelöst werden – daher Fallback auf bekannte Pfade
def _resolve_pdf_dir() -> Path:
    env_val = _os.environ.get("REPORT_PDF_DIR")
    if env_val:
        return Path(env_val)
    # Kandidaten: relatives Verzeichnis, bekannte Home-Pfade
    candidates = [
        Path(_os.getcwd()) / "data" / "reports",
        Path(_os.path.expanduser("~")) / "addons" / "energymanagement-iso50001" / "backend" / "data" / "reports",
        Path("/tmp") / "energymanagement_reports",
    ]
    for c in candidates:
        try:
            c.mkdir(parents=True, exist_ok=True)
            return c
        except OSError:
            continue
    return candidates[-1]

PDF_DIR = _resolve_pdf_dir()


class ReportService:
    """Service für Energieberichte."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_reports(
        self,
        page: int = 1,
        page_size: int = 25,
        report_type: str | None = None,
        status: str | None = None,
    ) -> dict:
        """Berichte auflisten mit Pagination."""
        query = select(AuditReport)
        count_query = select(func.count(AuditReport.id))

        if report_type:
            query = query.where(AuditReport.report_type == report_type)
            count_query = count_query.where(AuditReport.report_type == report_type)
        if status:
            query = query.where(AuditReport.status == status)
            count_query = count_query.where(AuditReport.status == status)

        total = (await self.db.execute(count_query)).scalar() or 0
        query = (
            query
            .order_by(AuditReport.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        result = await self.db.execute(query)
        items = list(result.scalars().all())

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": max(1, (total + page_size - 1) // page_size),
        }

    @staticmethod
    def _compute_period(data: dict) -> tuple[date, date]:
        """Berichtszeitraum aus year/quarter/month oder period_start/period_end berechnen."""
        import calendar
        report_type = data.get("report_type", "custom")
        year = data.get("year")
        quarter = data.get("quarter")
        month = data.get("month")

        if report_type == "annual" and year:
            return date(year, 1, 1), date(year, 12, 31)
        elif report_type == "quarterly" and year and quarter:
            q_start_month = (quarter - 1) * 3 + 1
            q_end_month = q_start_month + 2
            last_day = calendar.monthrange(year, q_end_month)[1]
            return date(year, q_start_month, 1), date(year, q_end_month, last_day)
        elif report_type == "monthly" and year and month:
            last_day = calendar.monthrange(year, month)[1]
            return date(year, month, 1), date(year, month, last_day)
        else:
            # custom oder Fallback auf explizite Datumsangaben
            ps = data.get("period_start")
            pe = data.get("period_end")
            if not ps or not pe:
                raise ValueError("Für benutzerdefinierte Berichte sind period_start und period_end Pflicht.")
            return ps, pe

    async def _resolve_meter_ids(
        self,
        site_id: uuid.UUID | None,
        root_meter_id: uuid.UUID | None,
        meter_ids: list[uuid.UUID] | None,
    ) -> list[uuid.UUID] | None:
        """Zähler-IDs basierend auf Scope-Filtern auflösen."""
        if meter_ids:
            return meter_ids

        if root_meter_id:
            # Root-Zähler + alle Unterzähler rekursiv laden
            all_meters = []
            queue = [root_meter_id]
            while queue:
                current_id = queue.pop(0)
                all_meters.append(current_id)
                children = await self.db.execute(
                    select(Meter.id).where(Meter.parent_meter_id == current_id)
                )
                queue.extend(row[0] for row in children.all())
            return all_meters

        if site_id:
            result = await self.db.execute(
                select(Meter.id).where(
                    Meter.site_id == site_id,
                    Meter.is_active == True,  # noqa: E712
                )
            )
            ids = [row[0] for row in result.all()]
            return ids if ids else None

        return None  # Alle Zähler

    async def _collect_chart_data(
        self,
        period_start: date,
        period_end: date,
        meter_ids: list[uuid.UUID] | None,
        scope_config: dict,
    ) -> dict:
        """Diagramm-Daten für aktivierte Charts sammeln."""
        from app.services.analytics_service import AnalyticsService
        analytics = AnalyticsService(self.db)
        charts = {}

        if scope_config.get("include_sankey"):
            try:
                charts["sankey"] = await analytics.get_sankey(period_start, period_end)
            except Exception as e:
                logger.warning("chart_sankey_failed", error=str(e))

        if scope_config.get("include_heatmap"):
            try:
                heatmap_meter_id = meter_ids[0] if meter_ids else None
                if not heatmap_meter_id:
                    first_result = await self.db.execute(
                        select(Meter.id).where(
                            Meter.is_active == True,  # noqa: E712
                            Meter.parent_meter_id.is_(None),
                        ).limit(1)
                    )
                    row = first_result.first()
                    heatmap_meter_id = row[0] if row else None
                if heatmap_meter_id:
                    charts["heatmap"] = await analytics.get_heatmap(
                        heatmap_meter_id, period_start, period_end
                    )
            except Exception as e:
                logger.warning("chart_heatmap_failed", error=str(e))

        if scope_config.get("include_yoy_comparison"):
            try:
                prev_start = date(period_start.year - 1, period_start.month, period_start.day)
                prev_end = date(period_end.year - 1, period_end.month, period_end.day)
                # get_comparison bricht bei meter_ids=None früh ab → alle Root-Zähler laden
                yoy_meter_ids = meter_ids
                if not yoy_meter_ids:
                    root_result = await self.db.execute(
                        select(Meter.id).where(
                            Meter.is_active == True,  # noqa: E712
                            Meter.is_feed_in != True,
                            Meter.parent_meter_id.is_(None),
                        )
                    )
                    yoy_meter_ids = [row[0] for row in root_result.all()]
                charts["yoy_comparison"] = await analytics.get_comparison(
                    meter_ids=yoy_meter_ids,
                    period1_start=prev_start,
                    period1_end=prev_end,
                    period2_start=period_start,
                    period2_end=period_end,
                    granularity="monthly",
                )
            except Exception as e:
                logger.warning("chart_yoy_failed", error=str(e))

        if scope_config.get("include_meter_tree"):
            try:
                # Zählerbaum-Struktur aufbauen
                query = select(Meter).where(Meter.is_active == True)  # noqa: E712
                if meter_ids:
                    query = query.where(Meter.id.in_(meter_ids))
                result = await self.db.execute(query)
                meters = list(result.scalars().all())
                tree_nodes = []
                for m in meters:
                    tree_nodes.append({
                        "id": str(m.id),
                        "name": m.name,
                        "energy_type": m.energy_type,
                        "parent_id": str(m.parent_meter_id) if m.parent_meter_id else None,
                        "unit": m.unit,
                    })
                charts["meter_tree"] = tree_nodes
            except Exception as e:
                logger.warning("chart_meter_tree_failed", error=str(e))

        return charts

    async def create_report(
        self,
        data: dict,
        user_id: uuid.UUID | None = None,
    ) -> AuditReport:
        """Neuen Bericht anlegen und Daten-Snapshot erstellen."""
        # Felder aus data extrahieren
        meter_ids_raw = data.pop("meter_ids", None)
        site_id = data.pop("site_id", None)
        root_meter_id = data.pop("root_meter_id", None)
        include_co2 = data.pop("include_co2", True)
        include_weather_correction = data.pop("include_weather_correction", False)
        include_benchmarks = data.pop("include_benchmarks", False)
        include_seu = data.pop("include_seu", True)
        include_enpi = data.pop("include_enpi", True)
        include_anomalies = data.pop("include_anomalies", True)
        # Diagramm-Toggles
        include_sankey = data.pop("include_sankey", True)
        include_heatmap = data.pop("include_heatmap", False)
        include_yoy_comparison = data.pop("include_yoy_comparison", True)
        include_meter_tree = data.pop("include_meter_tree", False)
        include_cost_flow = data.pop("include_cost_flow", False)
        include_cost_overview = data.pop("include_cost_overview", False)
        sections = data.pop("sections", None)
        data.pop("template", None)
        data.pop("language", None)
        # Bezugsgröße für Energieintensität
        reference_value = data.pop("reference_value", None)
        reference_unit = data.pop("reference_unit", "m²") or "m²"
        # Analyse-Kommentar (optionaler Nutzer-Hinweis)
        analysis_comment = data.pop("analysis_comment", None)
        # Perioden-Felder entfernen (werden berechnet)
        year = data.pop("year", None)
        quarter = data.pop("quarter", None)
        month = data.pop("month", None)

        # Zeitraum berechnen
        period_start, period_end = self._compute_period({
            "report_type": data.get("report_type", "custom"),
            "year": year, "quarter": quarter, "month": month,
            "period_start": data.get("period_start"),
            "period_end": data.get("period_end"),
        })
        data["period_start"] = period_start
        data["period_end"] = period_end

        # Scope-Filter: Zähler-IDs auflösen
        meter_ids = await self._resolve_meter_ids(site_id, root_meter_id, meter_ids_raw)

        # Daten-Snapshot erstellen
        snapshot = await self._create_data_snapshot(
            period_start, period_end, meter_ids,
            reference_value=reference_value,
            reference_unit=reference_unit,
        )

        # Scope-Konfiguration für Charts und Audit-Trail
        scope_config = {
            "meter_ids": [str(m) for m in meter_ids] if meter_ids else None,
            "site_id": str(site_id) if site_id else None,
            "root_meter_id": str(root_meter_id) if root_meter_id else None,
            "include_co2": include_co2,
            "include_weather_correction": include_weather_correction,
            "include_benchmarks": include_benchmarks,
            "include_seu": include_seu,
            "include_enpi": include_enpi,
            "include_anomalies": include_anomalies,
            "include_sankey": include_sankey,
            "include_heatmap": include_heatmap,
            "include_yoy_comparison": include_yoy_comparison,
            "include_meter_tree": include_meter_tree,
            "include_cost_flow": include_cost_flow,
            "include_cost_overview": include_cost_overview,
            "sections": sections,
            "reference_value": reference_value,
            "reference_unit": reference_unit,
        }

        # Diagramm-Daten sammeln
        charts = await self._collect_chart_data(
            period_start, period_end, meter_ids, scope_config
        )

        # Sankey je Energieart sammeln (immer, unabhängig vom include_sankey-Toggle)
        energy_by_type_keys = list((snapshot.get("energy_by_type") or {}).keys())
        if energy_by_type_keys:
            from app.services.analytics_service import AnalyticsService as _AS
            _analytics = _AS(self.db)
            sankey_by_type: dict = {}
            for _et_key in energy_by_type_keys:
                try:
                    _sankey_et = await _analytics.get_sankey(period_start, period_end, energy_type=_et_key)
                    if _sankey_et.get("nodes"):
                        sankey_by_type[_et_key] = _sankey_et
                except Exception as _e:
                    logger.warning(f"sankey_by_type_{_et_key}_failed", error=str(_e))
            if sankey_by_type:
                charts["sankey_by_type"] = sankey_by_type

        if charts:
            snapshot["charts"] = charts

        # CO₂-Zusammenfassung
        co2_summary = None
        if include_co2:
            co2_summary = await self._create_co2_summary(period_start, period_end)

        # Kosten-Zusammenfassung
        cost_summary = await self._create_cost_summary(period_start, period_end, meter_ids)
        if cost_summary.get("available"):
            snapshot["cost_summary"] = cost_summary

        # Nachhaltigkeits-Snapshot (ISO 50001: Ziele, EnPI, Gebäude, KVP)
        try:
            sustainability = await self._create_sustainability_snapshot()
            if sustainability:
                snapshot["sustainability"] = sustainability
        except Exception as e:
            logger.warning("sustainability_snapshot_failed", error=str(e))

        # Amortisations-Übersicht für Wirtschaftlichkeitssektion
        try:
            amortization = await self._create_amortization_summary()
            if amortization:
                snapshot["amortization"] = amortization
        except Exception as e:
            logger.warning("amortization_snapshot_failed", error=str(e))

        # Witterungsanalyse + Verbrauchs-Narrativ
        weather_analysis = await self._create_weather_analysis(period_start, period_end)
        analysis = await self._create_analysis_narrative(
            snapshot, weather_analysis, analysis_comment
        )
        if analysis.get("bullets"):
            snapshot["analysis"] = analysis

        # Ergebnisse und Empfehlungen generieren
        findings = await self._generate_findings(snapshot, co2_summary)
        recommendations = await self._generate_recommendations(findings, snapshot)
        summary_text = await self._generate_summary(snapshot, co2_summary)

        report = AuditReport(
            **data,
            status="ready",
            data_snapshot=snapshot,
            co2_summary=co2_summary,
            summary=summary_text,
            weather_correction_applied=include_weather_correction,
            findings=findings,
            recommendations=recommendations,
            scope=scope_config,
            generated_by_user_id=user_id,
            generated_at=datetime.now(timezone.utc),
        )
        self.db.add(report)
        await self.db.commit()
        await self.db.refresh(report)
        return report

    async def get_report(self, report_id: uuid.UUID) -> AuditReport | None:
        """Bericht mit Details laden."""
        return await self.db.get(AuditReport, report_id)

    async def update_report(
        self, report_id: uuid.UUID, data: dict
    ) -> AuditReport | None:
        """Bericht aktualisieren."""
        report = await self.db.get(AuditReport, report_id)
        if not report:
            return None

        for key, value in data.items():
            if value is not None:
                setattr(report, key, value)

        await self.db.commit()
        await self.db.refresh(report)
        return report

    async def delete_report(self, report_id: uuid.UUID) -> bool:
        """Bericht und zugehörige PDF-Datei löschen."""
        report = await self.db.get(AuditReport, report_id)
        if not report:
            return False

        # PDF-Datei löschen falls vorhanden
        if report.pdf_path:
            try:
                pdf_file = Path(report.pdf_path)
                if pdf_file.exists():
                    pdf_file.unlink()
            except OSError as e:
                logger.warning("pdf_delete_failed", path=report.pdf_path, error=str(e))

        await self.db.delete(report)
        await self.db.commit()
        return True

    async def get_report_status(self, report_id: uuid.UUID) -> dict | None:
        """Generierungsstatus eines Berichts abfragen."""
        report = await self.db.get(AuditReport, report_id)
        if not report:
            return None
        return {
            "report_id": report.id,
            "status": report.status,
            "error_message": report.error_message,
            "pdf_path": report.pdf_path,
        }

    # ── PDF-Generierung ──

    async def generate_pdf(self, report_id: uuid.UUID) -> str:
        """
        PDF-Bericht generieren mit Jinja2 + WeasyPrint.

        Gibt den Dateipfad des generierten PDFs zurück.
        """
        report = await self.db.get(AuditReport, report_id)
        if not report:
            raise ValueError("Bericht nicht gefunden")

        try:
            report.status = "generating"
            await self.db.commit()

            # Template rendern
            html_content = self._render_template(report)

            # PDF erzeugen
            logger.info("pdf_dir_debug", pdf_dir=str(PDF_DIR), cwd=str(__import__("os").getcwd()))
            PDF_DIR.mkdir(parents=True, exist_ok=True)
            pdf_filename = f"{report.id}.pdf"
            pdf_path = PDF_DIR / pdf_filename

            try:
                from weasyprint import HTML
                HTML(string=html_content).write_pdf(str(pdf_path))
            except ImportError:
                # Fallback: HTML als Datei speichern wenn WeasyPrint nicht verfügbar
                html_path = PDF_DIR / f"{report.id}.html"
                html_path.write_text(html_content, encoding="utf-8")
                pdf_path = html_path
                logger.warning("weasyprint_not_available", fallback="html")

            report.pdf_path = str(pdf_path)
            report.status = "ready"
            report.generated_at = datetime.now(timezone.utc)
            await self.db.commit()

            return str(pdf_path)

        except Exception as e:
            report.status = "error"
            report.error_message = str(e)
            await self.db.commit()
            raise

    def _render_template(self, report: AuditReport) -> str:
        """Jinja2-Template mit Report-Daten rendern."""
        from jinja2 import Environment, FileSystemLoader

        template_dir = Path(__file__).parent / "reporting" / "templates"
        if not template_dir.exists():
            # Fallback auf audit/templates
            template_dir = Path(__file__).parent.parent / "audit" / "templates"

        # Falls keine Templates vorhanden, eingebautes Template nutzen
        if not template_dir.exists() or not (template_dir / "base.html").exists():
            return self._render_builtin_template(report)

        env = Environment(loader=FileSystemLoader(str(template_dir)))
        template = env.get_template("base.html")

        et_labels = {
            "electricity": "Strom", "natural_gas": "Erdgas", "heating_oil": "Heizöl",
            "district_heating": "Fernwärme", "district_cooling": "Kälte (Fernkälte)",
            "water": "Wasser", "solar": "Solarstrom", "lpg": "Flüssiggas",
            "wood_pellets": "Holzpellets", "compressed_air": "Druckluft",
            "steam": "Dampf", "other": "Sonstige",
        }
        scope_labels = {
            "scope_1": "Scope 1", "scope_2": "Scope 2", "scope_3": "Scope 3",
        }

        # SVG-Charts serverseitig rendern – jeder Renderer in eigenem try/except
        snap = report.data_snapshot or {}
        charts = snap.get("charts", {})
        monthly_trend_svg = ""
        monthly_cost_svg = ""
        sankey_svg = ""
        yoy_svg = ""
        try:
            from app.services.reporting.chart_renderer import (
                render_bar_comparison_svg,
                render_monthly_cost_svg,
                render_monthly_trend_svg,
                render_sankey_svg,
            )
        except ImportError as e:
            logger.warning("chart_renderer_import_failed_template", error=str(e))
            render_monthly_trend_svg = render_monthly_cost_svg = None  # type: ignore[assignment]
            render_sankey_svg = render_bar_comparison_svg = None  # type: ignore[assignment]

        if render_monthly_trend_svg and snap.get("monthly_trend"):
            try:
                monthly_trend_svg = render_monthly_trend_svg(snap["monthly_trend"]) or ""
            except Exception as e:
                logger.warning("chart_render_monthly_trend_failed", error=str(e))

        cost_summary = snap.get("cost_summary", {})
        if render_monthly_cost_svg and cost_summary.get("available") and cost_summary.get("monthly_costs"):
            try:
                monthly_cost_svg = render_monthly_cost_svg(cost_summary["monthly_costs"]) or ""
            except Exception as e:
                logger.warning("chart_render_monthly_cost_failed", error=str(e))

        if render_sankey_svg and charts.get("sankey"):
            try:
                sankey_svg = render_sankey_svg(charts["sankey"]) or ""
            except Exception as e:
                logger.warning("chart_render_sankey_failed", error=str(e))

        if render_bar_comparison_svg and charts.get("yoy_comparison"):
            try:
                yoy_svg = render_bar_comparison_svg(charts["yoy_comparison"]) or ""
            except Exception as e:
                logger.warning("chart_render_yoy_failed", error=str(e))

        return template.render(
            report=report,
            snapshot=snap,
            co2=report.co2_summary or {},
            findings=report.findings or [],
            recommendations=report.recommendations or [],
            et_labels=et_labels,
            scope_labels=scope_labels,
            monthly_trend_svg=monthly_trend_svg,
            monthly_cost_svg=monthly_cost_svg,
            sankey_svg=sankey_svg,
            yoy_svg=yoy_svg,
        )

    def _render_builtin_template(self, report: AuditReport) -> str:  # noqa: PLR0912, PLR0914, PLR0915
        """Eingebautes HTML-Template für PDF-Generierung."""
        # Renderer mit Fehlerbehandlung importieren
        try:
            from app.services.reporting.chart_renderer import (
                render_bar_comparison_svg,
                render_energy_type_trend_svg,
                render_heatmap_svg,
                render_meter_tree_svg,
                render_monthly_cost_svg,
                render_monthly_trend_svg,
                render_sankey_svg,
                render_yoy_table_svg,
            )
        except ImportError as e:
            logger.warning("chart_renderer_import_failed", error=str(e))
            render_bar_comparison_svg = render_heatmap_svg = render_meter_tree_svg = None  # type: ignore[assignment]
            render_monthly_trend_svg = render_monthly_cost_svg = render_sankey_svg = None  # type: ignore[assignment]
            render_energy_type_trend_svg = render_yoy_table_svg = None  # type: ignore[assignment]

        def safe_render(fn, data, name: str = "chart") -> str:
            """Renderer mit try/except aufrufen, leeren String bei Fehler."""
            if fn is None or not data:
                return ""
            try:
                return fn(data) or ""
            except Exception as e:
                logger.warning(f"chart_render_{name}_failed", error=str(e))
                return ""

        snapshot = report.data_snapshot or {}
        co2 = report.co2_summary or {}
        findings = report.findings or []
        recommendations = report.recommendations or []
        charts = snapshot.get("charts", {})
        cost_summary = snapshot.get("cost_summary", {})
        energy_by_type = snapshot.get("energy_by_type", {})
        sustainability = snapshot.get("sustainability", {})
        amortization = snapshot.get("amortization", [])
        energy_yoy_table = snapshot.get("energy_yoy_table", [])
        consumer_categories = snapshot.get("consumer_categories", [])
        renewable_pct = snapshot.get("renewable_pct", 0.0)
        renewable_kwh_snap = snapshot.get("renewable_kwh", 0.0)
        prev_total_kwh_snap = snapshot.get("prev_total_kwh", 0.0)
        yoy_total_delta_pct_snap = snapshot.get("yoy_total_delta_pct")

        # ── Kennzahlen ──
        total_kwh = snapshot.get("total_consumption_kwh", 0)
        total_co2 = co2.get("total_co2_kg", 0)
        meter_count = snapshot.get("meter_count", 0)
        co2_intensity = co2.get("avg_co2_g_per_kwh", 0)
        energy_intensity = snapshot.get("energy_intensity_kwh_per_day", 0)
        energy_intensity_per_unit = snapshot.get("energy_intensity_per_unit")
        reference_unit = snapshot.get("reference_unit") or "m²"
        co2_trend = co2.get("trend_vs_previous_year")

        # YoY-Delta aus Vergleichsdaten berechnen
        yoy_delta_pct = None
        yoy_data = charts.get("yoy_comparison", {})
        if yoy_data:
            try:
                p1_data = yoy_data.get("period1", {}).get("data", {})
                p2_data = yoy_data.get("period2", {}).get("data", {})
                p1_total = sum(
                    sum(e.get("value", 0) for e in entries)
                    for entries in p1_data.values()
                )
                p2_total = sum(
                    sum(e.get("value", 0) for e in entries)
                    for entries in p2_data.values()
                )
                if p1_total > 0:
                    yoy_delta_pct = round((p2_total - p1_total) / p1_total * 100, 1)
            except Exception:
                pass

        # ── Management-Zusammenfassung: Kernaussagen ──
        bullets = []
        # Verbrauch je Energieart separat ausweisen (keine gemischte kWh-Summe)
        et_summary = energy_by_type
        if et_summary:
            for et_key, et_data in et_summary.items():
                et_label = et_data.get("label", et_key)
                et_total_n = et_data.get("total_native", 0)
                et_unit = et_data.get("unit", "kWh")
                if et_total_n > 0:
                    bullet = f"{et_label}: <strong>{et_total_n:,.1f}&nbsp;{et_unit}</strong>"
                    if yoy_delta_pct is not None and et_key == list(et_summary.keys())[0]:
                        sign = "+" if yoy_delta_pct > 0 else ""
                        bullet += f" ({sign}{yoy_delta_pct:.1f}&nbsp;% ggü.&nbsp;Vorjahr)"
                    bullets.append(bullet)
        else:
            # Fallback wenn energy_by_type fehlt
            if yoy_delta_pct is not None:
                sign = "+" if yoy_delta_pct > 0 else ""
                bullets.append(
                    f"Gesamtverbrauch: <strong>{total_kwh:,.0f}&nbsp;kWh</strong> "
                    f"({sign}{yoy_delta_pct:.1f}&nbsp;% ggü.&nbsp;Vorjahr)"
                )
            else:
                bullets.append(f"Gesamtverbrauch: <strong>{total_kwh:,.0f}&nbsp;kWh</strong>")

        if total_co2 > 0:
            co2_t = total_co2 / 1000
            co2_str = f"CO₂-Emissionen: <strong>{co2_t:,.2f}&nbsp;t&nbsp;CO₂e</strong>"
            if co2_intensity > 0:
                co2_str += f" (Intensität: {co2_intensity:.0f}&nbsp;g/kWh)"
            bullets.append(co2_str)

        top_consumers = snapshot.get("top_consumers", [])
        if top_consumers:
            top = top_consumers[0]
            top_native = top.get("consumption_native")
            top_unit = top.get("unit", "kWh")
            top_val_str = (
                f"{top_native:,.1f}&nbsp;{top_unit}"
                if top_native is not None and top_native > 0
                else f"{top['consumption_kwh']:,.0f}&nbsp;kWh"
            )
            bullets.append(
                f"Größter Verbraucher: <strong>{top['name']}</strong> ({top_val_str})"
            )

        if cost_summary.get("available"):
            cost_net = cost_summary.get("total_cost_net", 0)
            bullets.append(
                f"Gesamtkosten: <strong>{cost_net:,.2f}&nbsp;€</strong> netto"
            )

        if energy_intensity_per_unit is not None:
            bullets.append(
                f"Energieintensität Strom: "
                f"<strong>{energy_intensity_per_unit:,.1f}&nbsp;kWh/{reference_unit}</strong>"
            )
        elif energy_intensity > 0:
            bullets.append(
                f"Energieintensität: <strong>{energy_intensity:,.1f}&nbsp;kWh/Tag</strong>"
            )

        bullets_html = "".join(f"<li>{b}</li>" for b in bullets)

        # Lokalisierte Energieträger-Bezeichnungen
        ET_LABELS: dict[str, str] = {
            "electricity": "Strom",
            "natural_gas": "Erdgas",
            "heating_oil": "Heizöl",
            "district_heating": "Fernwärme",
            "district_cooling": "Kälte (Fernkälte)",
            "water": "Wasser",
            "solar": "Solarstrom",
            "lpg": "Flüssiggas",
            "wood_pellets": "Holzpellets",
            "compressed_air": "Druckluft",
            "steam": "Dampf",
            "other": "Sonstige",
        }

        # ── Tabellen ──
        energy_rows = ""
        for item in snapshot.get("energy_balance", []):
            et = item.get("energy_type", "")
            energy_rows += (
                f"<tr><td>{ET_LABELS.get(et, et)}</td>"
                f"<td class='num'>{item.get('consumption_kwh', 0):,.1f}</td>"
                f"<td class='num'>{item.get('share_percent', 0):.1f}%</td></tr>"
            )

        co2_rows = ""
        for item in co2.get("by_energy_type", []):
            et = item.get("energy_type", "")
            co2_rows += (
                f"<tr><td>{ET_LABELS.get(et, et)}</td>"
                f"<td class='num'>{item.get('co2_kg', 0):,.1f}</td>"
                f"<td class='num'>{item.get('consumption_kwh', 0):,.1f}</td></tr>"
            )

        top_rows = ""
        for item in top_consumers:
            native = item.get("consumption_native")
            unit = item.get("unit", "kWh")
            et = item.get("energy_type", "")
            if native is not None and native > 0:
                display_val = f"{native:,.1f}&nbsp;{unit}"
            else:
                display_val = f"{item.get('consumption_kwh', 0):,.1f}&nbsp;kWh"
            top_rows += (
                f"<tr><td>{item.get('name', '')}</td>"
                f"<td>{ET_LABELS.get(et, et)}</td>"
                f"<td class='num'>{display_val}</td></tr>"
            )

        findings_html = ""
        for f in findings:
            findings_html += (
                f"<div class='finding {f.get('severity', 'info')}'>"
                f"<strong>{f.get('title', '')}</strong>"
                f"<p>{f.get('description', '')}</p></div>"
            )

        reco_html = ""
        for r in recommendations:
            savings_parts = []
            if r.get("savings_kwh"):
                savings_parts.append(f"Einsparpotenzial: <strong>{r['savings_kwh']:,.0f}&nbsp;kWh/a</strong>")
            if r.get("savings_note"):
                savings_parts.append(f"<span style='color:#6B7280'>({r['savings_note']})</span>")
            savings = f"<p class='savings'>{' '.join(savings_parts)}</p>" if savings_parts else ""
            reco_html += (
                f"<div class='recommendation'>"
                f"<strong>{r.get('title', '')}</strong>"
                f"<p>{r.get('description', '')}</p>{savings}</div>"
            )

        # ── Vorjahresvergleichs-Tabelle ──
        yoy_table_rows = ""
        for item in energy_yoy_table:
            delta = item.get("delta_pct")
            if delta is not None:
                delta_color = "#DC2626" if delta > 5 else "#16A34A" if delta < -5 else "#374151"
                delta_str = f'<span style="color:{delta_color};font-weight:600">{delta:+.1f}%</span>'
            else:
                delta_str = "–"
            unit = item.get("unit", "kWh")
            yoy_table_rows += (
                f"<tr><td>{item.get('label', '')}</td>"
                f"<td class='num'>{item.get('prev_native', 0):,.1f}&nbsp;{unit}</td>"
                f"<td class='num'>{item.get('curr_native', 0):,.1f}&nbsp;{unit}</td>"
                f"<td class='num'>{delta_str}</td></tr>"
            )

        # ── Verbrauch nach Bereichen ──
        cat_rows = ""
        for cat in consumer_categories:
            cat_rows += (
                f"<tr><td>{cat.get('label', '')}</td>"
                f"<td class='num'>{cat.get('kwh', 0):,.1f}</td>"
                f"<td class='num'>{cat.get('pct', 0):.1f}%</td></tr>"
            )

        # ── KPI-Vergleichstabelle ──
        kpi_compare_rows = ""
        if prev_total_kwh_snap > 0 or float(total_kwh) > 0:
            delta_kwh = (
                round((float(total_kwh) - prev_total_kwh_snap) / prev_total_kwh_snap * 100, 1)
                if prev_total_kwh_snap > 0 else None
            )
            delta_kwh_str = f"{delta_kwh:+.1f}%" if delta_kwh is not None else "–"
            kpi_compare_rows += (
                f"<tr><td>Gesamtverbrauch (kWh-Äquiv.)</td><td class='num'>kWh</td>"
                f"<td class='num'>{prev_total_kwh_snap:,.0f}</td>"
                f"<td class='num'>{float(total_kwh):,.0f}</td>"
                f"<td class='num'>{delta_kwh_str}</td></tr>"
            )
        if co2_intensity > 0:
            kpi_compare_rows += (
                f"<tr><td>CO₂-Intensität</td><td class='num'>g&nbsp;CO₂/kWh</td>"
                f"<td class='num'>–</td>"
                f"<td class='num'>{co2_intensity:.0f}</td>"
                f"<td class='num'>–</td></tr>"
            )
        if cost_summary.get("available"):
            curr_cost = cost_summary.get("total_cost_net", 0)
            prev_cost = cost_summary.get("prev_year_cost_net")
            if prev_cost is not None:
                delta_cost = round((curr_cost - prev_cost) / prev_cost * 100, 1) if prev_cost > 0 else None
                delta_cost_str = f"{delta_cost:+.1f}%" if delta_cost is not None else "–"
                kpi_compare_rows += (
                    f"<tr><td>Energiekosten</td><td class='num'>€&nbsp;netto</td>"
                    f"<td class='num'>{prev_cost:,.2f}</td>"
                    f"<td class='num'>{curr_cost:,.2f}</td>"
                    f"<td class='num'>{delta_cost_str}</td></tr>"
                )
        if energy_intensity_per_unit is not None:
            kpi_compare_rows += (
                f"<tr><td>Energieintensität</td><td class='num'>kWh/{reference_unit}</td>"
                f"<td class='num'>–</td>"
                f"<td class='num'>{energy_intensity_per_unit:,.1f}</td>"
                f"<td class='num'>–</td></tr>"
            )

        # ── Maßnahmen & Ergebnisse (getrennt nach Status) ──
        STATUS_DONE = {"completed", "abgeschlossen", "done"}
        STATUS_PLANNED = {"planned", "geplant", "open", "offen"}
        objectives = sustainability.get("objectives", [])
        done_rows = ""
        planned_rows = ""
        for obj in objectives:
            status_raw = obj.get("status", "")
            prog = obj.get("progress_percent")
            prog_str = f"{prog:.0f}%" if prog is not None else "–"
            prog_bar = ""
            if prog is not None:
                bar_color = "#16A34A" if prog >= 80 else "#F59E0B" if prog >= 40 else "#1B5E7B"
                prog_bar = (
                    f"<div style='background:#E5E7EB;height:6pt;border-radius:3pt;margin-top:3pt'>"
                    f"<div style='background:{bar_color};height:6pt;border-radius:3pt;"
                    f"width:{min(prog, 100):.0f}%'></div></div>"
                )
            sav_str = ""
            if obj.get("total_savings_kwh", 0) > 0:
                sav_str = f"{obj['total_savings_kwh']:,.0f}&nbsp;kWh"
                if obj.get("total_savings_co2_kg", 0) > 0:
                    sav_str += f" / {obj['total_savings_co2_kg']:,.0f}&nbsp;kg&nbsp;CO₂"
            row = (
                f"<tr>"
                f"<td><strong>{obj.get('title', '')}</strong>"
                + (f"<br/><span style='color:#6B7280;font-size:8pt'>{obj.get('description', '')}</span>" if obj.get("description") else "")
                + f"</td>"
                f"<td class='num'>{sav_str}</td>"
                f"<td>{obj.get('target_date', '–')}</td>"
                f"<td>{obj.get('responsible', '–')}</td>"
                f"<td class='num'>{prog_str}{prog_bar}</td>"
                f"</tr>"
            )
            if status_raw.lower() in STATUS_DONE or (prog is not None and prog >= 100):
                done_rows += row
            else:
                planned_rows += row

        massnahmen_table_header = """
<table>
    <thead>
        <tr>
            <th>Ziel / Maßnahme</th>
            <th class="num">Einsparpotenzial</th>
            <th>Termin</th>
            <th>Verantwortlich</th>
            <th class="num">Fortschritt</th>
        </tr>
    </thead>"""
        massnahmen_parts = []
        if done_rows:
            massnahmen_parts.append(
                f"<h2>Abgeschlossene Maßnahmen</h2>{massnahmen_table_header}"
                f"<tbody>{done_rows}</tbody></table>"
            )
        if planned_rows:
            massnahmen_parts.append(
                f"<h2>Laufende &amp; geplante Maßnahmen</h2>{massnahmen_table_header}"
                f"<tbody>{planned_rows}</tbody></table>"
            )
        if not massnahmen_parts and objectives:
            massnahmen_parts.append(
                f"<h2>Alle Maßnahmen</h2>{massnahmen_table_header}"
                f"<tbody>"
                + "".join(
                    f"<tr><td><strong>{o.get('title', '')}</strong></td>"
                    f"<td class='num'>–</td>"
                    f"<td>{o.get('target_date', '–')}</td>"
                    f"<td>{o.get('responsible', '–')}</td>"
                    f"<td class='num'>–</td></tr>"
                    for o in objectives
                )
                + "</tbody></table>"
            )

        # Amortisations-Tabelle HTML
        amortization_html = ""
        if amortization:
            amort_rows = ""
            for a in amortization:
                payback = a.get("simple_payback_years")
                payback_str = f"{payback:.1f}&nbsp;a" if payback is not None else "–"
                npv = a.get("npv")
                npv_str = f"{npv:,.0f}&nbsp;€" if npv is not None else "–"
                roi = a.get("roi_pct")
                roi_str = f"{roi:.1f}%" if roi is not None else "–"
                profit_color = "#16A34A" if a.get("profitable") else "#DC2626"
                profit_sym = "✓" if a.get("profitable") else "✗"
                amort_rows += (
                    f"<tr>"
                    f"<td><strong>{a.get('title', '')}</strong>"
                    + (f"<br/><span style='color:#6B7280;font-size:8pt'>{a.get('type', '')}</span>" if a.get("type") else "")
                    + f"</td>"
                    f"<td class='num'>{a.get('investment', 0):,.0f}&nbsp;€</td>"
                    f"<td class='num'>{a.get('annual_savings_net', 0):,.0f}&nbsp;€/a</td>"
                    f"<td class='num'>{payback_str}</td>"
                    f"<td class='num'>{npv_str}</td>"
                    f"<td class='num'>{roi_str}</td>"
                    f"<td class='num' style='color:{profit_color};font-weight:700'>{profit_sym}</td>"
                    f"</tr>"
                )
            amortization_html = f"""
<h2>Amortisationsübersicht</h2>
<table>
    <thead>
        <tr>
            <th>Maßnahme</th>
            <th class="num">Investition</th>
            <th class="num">Einsparung/a</th>
            <th class="num">Amortisation</th>
            <th class="num">NPV</th>
            <th class="num">ROI</th>
            <th class="num">Rentabel</th>
        </tr>
    </thead>
    <tbody>{amort_rows}</tbody>
</table>"""

        # ── Energieart-Trennung: Sektionen je Energieart ──
        schema_strands = snapshot.get("schema_strands", [])
        sankey_by_type = charts.get("sankey_by_type", {})

        # Vorjahresvergleich pro Energieart als Lookup {energy_type → row}
        yoy_by_et: dict = {r["energy_type"]: r for r in energy_yoy_table}

        # HTML je Energieart (mit SVG-Trend, Sankey, Kennzahlen, Zählerliste)
        energy_type_sections_html = ""
        for et_key, et_data in energy_by_type.items():
            et_label = et_data.get("label", et_key)
            et_unit = et_data.get("unit", "kWh")
            et_color = et_data.get("color", "#1B5E7B")
            et_total = et_data.get("total_native", 0)
            et_kwh = et_data.get("total_kwh_equiv", 0)
            et_count = et_data.get("meter_count", 0)
            et_meters = et_data.get("top_meters", [])
            et_monthly = et_data.get("monthly_trend", [])

            # Trend-SVG für diese Energieart
            et_svg = ""
            if render_energy_type_trend_svg and et_monthly:
                try:
                    et_svg = render_energy_type_trend_svg(et_monthly, unit=et_unit, color=et_color) or ""
                except Exception as e:
                    logger.warning(f"chart_render_et_trend_{et_key}_failed", error=str(e))

            # Sankey-SVG für diese Energieart
            et_sankey_svg = ""
            if render_sankey_svg and sankey_by_type.get(et_key):
                try:
                    et_sankey_svg = render_sankey_svg(sankey_by_type[et_key]) or ""
                except Exception as e:
                    logger.warning(f"chart_render_et_sankey_{et_key}_failed", error=str(e))

            # Vorjahresvergleich-KPI für diese Energieart
            yoy_row = yoy_by_et.get(et_key)
            yoy_kpi_html = ""
            if yoy_row and yoy_row.get("prev_native", 0) > 0:
                delta = yoy_row.get("delta_pct")
                delta_color = "#DC2626" if delta is not None and delta > 5 else "#16A34A" if delta is not None and delta < -5 else "#374151"
                delta_str = f'<span style="color:{delta_color};font-weight:700">{delta:+.1f}%</span>' if delta is not None else "–"
                yoy_kpi_html = (
                    f"<div class='kpi-card'>"
                    f"<div class='value' style='font-size:13pt'>{yoy_row['prev_native']:,.1f}</div>"
                    f"<div class='unit'>{et_unit} (Vorjahr)</div>"
                    f"<div class='label'>Vorjahreszeitraum</div>"
                    f"</div>"
                    f"<div class='kpi-card'>"
                    f"<div class='value' style='font-size:13pt'>{delta_str}</div>"
                    f"<div class='unit'>&nbsp;</div>"
                    f"<div class='label'>Δ zum Vorjahr</div>"
                    f"</div>"
                )

            # Zähler-Tabelle
            et_meter_rows = ""
            for m in et_meters:
                nat = m.get("total_native", 0)
                kwh_e = m.get("total_kwh_equiv", 0)
                m_unit = m.get("unit", et_unit)
                et_meter_rows += (
                    f"<tr><td>{m.get('name', '')}</td>"
                    f"<td class='num'>{nat:,.1f}&nbsp;{m_unit}</td>"
                    + (f"<td class='num'>{kwh_e:,.1f}</td>" if m_unit != "kWh" else "")
                    + "</tr>"
                )

            kwh_col = "<th class='num'>kWh-Äquiv.</th>" if et_unit != "kWh" else ""
            energy_type_sections_html += f"""
<h2 style="color:{et_color};border-bottom:2px solid {et_color}">{et_label}</h2>
<div class="kpi-row">
    <div class="kpi-card">
        <div class="value" style="color:{et_color}">{et_total:,.1f}</div>
        <div class="unit">{et_unit}</div>
        <div class="label">Gesamtverbrauch</div>
    </div>
    {"<div class='kpi-card'><div class='value'>" + f"{et_kwh:,.1f}" + "</div><div class='unit'>kWh-Äquiv.</div><div class='label'>für CO₂-Berechnung</div></div>" if et_unit != "kWh" else ""}
    <div class="kpi-card">
        <div class="value">{et_count}</div>
        <div class="unit">Stk.</div>
        <div class="label">Zähler</div>
    </div>
    {yoy_kpi_html}
</div>
{"<table><thead><tr><th>Zähler</th><th class='num'>Verbrauch</th>" + kwh_col + "</tr></thead><tbody>" + et_meter_rows + "</tbody></table>" if et_meter_rows else ""}
{f'<figure>{et_svg}</figure>' if et_svg else ""}
{f'<h3>Energiefluss {et_label}</h3><figure>{et_sankey_svg}</figure>' if et_sankey_svg else ""}
"""

        # HTML für Schema-Stränge
        schema_strands_html = ""
        if schema_strands:
            strand_rows = ""
            for strand in schema_strands:
                strand_rows += (
                    f"<tr>"
                    f"<td><strong>{strand.get('schema_label', '')}</strong>"
                    f"<br/><span style='color:#6B7280;font-size:8pt'>{strand.get('root_meter_name', '')}</span></td>"
                    f"<td>{strand.get('energy_type', '')}</td>"
                    f"<td class='num'>{strand.get('total_native', 0):,.1f}&nbsp;{strand.get('unit', '')}</td>"
                    f"<td class='num'>{strand.get('total_kwh_equiv', 0):,.1f}&nbsp;kWh</td>"
                    f"<td class='num'>{strand.get('meter_count', 0)}</td>"
                    f"</tr>"
                )
            schema_strands_html = f"""
<h2>Auswertung nach Energieschema</h2>
<p>Verbrauch je Betrachtungspunkt (Z&auml;hlerstrang) gem&auml;&szlig; Energieschema.</p>
<table>
    <thead>
        <tr><th>Strang</th><th>Energieart</th><th class="num">Verbrauch</th><th class="num">kWh-&Auml;quiv.</th><th class="num">Z&auml;hler</th></tr>
    </thead>
    <tbody>{strand_rows}</tbody>
</table>"""

        # ── Diagramme rendern ──
        monthly_trend_svg = safe_render(
            render_monthly_trend_svg, snapshot.get("monthly_trend", []), "monthly_trend"
        )
        # YoY-Vergleich immer aus energy_yoy_table rendern (immer im Snapshot)
        yoy_svg = safe_render(render_yoy_table_svg, energy_yoy_table, "yoy_table")
        if not yoy_svg:
            # Fallback auf Analytics-Vergleich wenn yoy_table leer
            yoy_svg = safe_render(render_bar_comparison_svg, charts.get("yoy_comparison"), "yoy")
        sankey_svg = safe_render(render_sankey_svg, charts.get("sankey"), "sankey")
        heatmap_svg = safe_render(render_heatmap_svg, charts.get("heatmap"), "heatmap")
        tree_svg = safe_render(render_meter_tree_svg, charts.get("meter_tree"), "tree")
        cost_svg = safe_render(
            render_monthly_cost_svg,
            cost_summary.get("monthly_costs", []) if cost_summary.get("available") else [],
            "cost",
        )

        # ── Sektionsnummern ──
        sec = [2]  # Start nach Management-Zusammenfassung (1)

        def next_sec() -> int:
            n = sec[0]
            sec[0] += 1
            return n

        # Deckblatt-Scope-Info
        scope = report.scope or {}
        scope_info = ""
        if scope.get("site_id"):
            scope_info = f"<div class='scope'>Gefiltert nach Standort-ID: {scope['site_id']}</div>"
        elif scope.get("root_meter_id"):
            scope_info = f"<div class='scope'>Gefiltert nach Zählerstrang-ID: {scope['root_meter_id']}</div>"

        # KPI-Karten: pro Energieart eine Karte (native Einheit), dann CO₂
        kpi_cards = ""
        if et_summary:
            for et_key, et_data in et_summary.items():
                et_label_kpi = et_data.get("label", et_key)
                et_unit_kpi = et_data.get("unit", "kWh")
                et_color_kpi = et_data.get("color", "#1B5E7B")
                et_total_kpi = et_data.get("total_native", 0)
                kpi_cards += f"""
        <div class="kpi-card">
            <div class="value" style="color:{et_color_kpi}">{et_total_kpi:,.0f}</div>
            <div class="unit">{et_unit_kpi}</div>
            <div class="label">{et_label_kpi}</div>
        </div>"""
        else:
            kpi_cards += f"""
        <div class="kpi-card">
            <div class="value">{total_kwh:,.0f}</div>
            <div class="unit">kWh</div>
            <div class="label">Gesamtverbrauch</div>
        </div>"""

        kpi_cards += f"""
        <div class="kpi-card">
            <div class="value">{total_co2 / 1000:,.2f}</div>
            <div class="unit">t CO₂e</div>
            <div class="label">CO₂-Emissionen</div>
        </div>"""

        if co2_intensity > 0:
            kpi_cards += f"""
        <div class="kpi-card">
            <div class="value">{co2_intensity:.0f}</div>
            <div class="unit">g CO₂/kWh</div>
            <div class="label">CO₂-Intensität</div>
        </div>"""

        if yoy_delta_pct is not None:
            delta_color = "#DC2626" if yoy_delta_pct > 0 else "#16A34A"
            sign = "+" if yoy_delta_pct > 0 else ""
            kpi_cards += f"""
        <div class="kpi-card">
            <div class="value" style="color:{delta_color}">{sign}{yoy_delta_pct:.1f}%</div>
            <div class="unit">&nbsp;</div>
            <div class="label">vs. Vorjahr</div>
        </div>"""

        if cost_summary.get("available"):
            cost_net = cost_summary.get("total_cost_net", 0)
            kpi_cards += f"""
        <div class="kpi-card">
            <div class="value">{cost_net:,.0f}</div>
            <div class="unit">€ netto</div>
            <div class="label">Energiekosten</div>
        </div>"""

        if energy_intensity_per_unit is not None:
            kpi_cards += f"""
        <div class="kpi-card">
            <div class="value">{energy_intensity_per_unit:,.1f}</div>
            <div class="unit">kWh/{reference_unit}</div>
            <div class="label">Energieintensität</div>
        </div>"""
        elif energy_intensity > 0:
            kpi_cards += f"""
        <div class="kpi-card">
            <div class="value">{energy_intensity:,.1f}</div>
            <div class="unit">kWh/Tag</div>
            <div class="label">Energieintensität</div>
        </div>"""

        kpi_cards += f"""
        <div class="kpi-card">
            <div class="value">{meter_count}</div>
            <div class="unit">Stk.</div>
            <div class="label">Erfasste Zähler</div>
        </div>"""

        # ── Analyse-Narrativ ──
        analysis = snapshot.get("analysis", {})
        analysis_bullets = analysis.get("bullets", [])
        analysis_html = ""
        if analysis_bullets:
            li_items = "".join(f"<li>{b}</li>" for b in analysis_bullets)
            analysis_html = f"""
<h2>Ursachenanalyse</h2>
<ul class="summary-bullets">{li_items}</ul>"""

        # ── Witterungs-KPI (wenn Daten vorhanden) ──
        weather = analysis.get("weather") or {}
        weather_kpi = ""
        if weather.get("actual_hdd"):
            hdd_dev = weather.get("hdd_deviation_pct")
            dev_str = ""
            if hdd_dev is not None:
                dev_color = "#DC2626" if hdd_dev > 5 else "#16A34A" if hdd_dev < -5 else "#374151"
                dev_str = f' <span style="color:{dev_color};font-size:8pt">({hdd_dev:+.0f}% vs. LTM)</span>'
            weather_kpi = f"""
<div class="kpi-row" style="margin-top:8pt">
    <div class="kpi-card">
        <div class="value">{weather['actual_hdd']:.0f}</div>
        <div class="unit">HDD{dev_str}</div>
        <div class="label">Heizgradtage{' / ' + weather['station_name'] if weather.get('station_name') else ''}</div>
    </div>
    <div class="kpi-card">
        <div class="value">{weather['avg_temp']:.1f}°C</div>
        <div class="unit">&nbsp;</div>
        <div class="label">Mittlere Temperatur</div>
    </div>
    {f'<div class="kpi-card"><div class="value">{weather["heating_days"]}</div><div class="unit">Tage</div><div class="label">Heiztage</div></div>' if weather.get('heating_days') else ''}
</div>"""

        # ── Optionale Sektionen: Inhalte ohne Nummern bauen ──
        analyse_section = analysis_html + weather_kpi
        if yoy_svg:
            analyse_section += f"""
<h2>Jahresvergleich</h2>
<p>Monatlicher Verbrauchsvergleich mit dem Vorjahreszeitraum.</p>
<figure>{yoy_svg}</figure>"""

        if heatmap_svg:
            analyse_section += f"""
<h2>Lastprofil (Heatmap)</h2>
<p>Durchschnittlicher Verbrauch nach Wochentag und Tageszeit. Dunklere Bereiche zeigen höheren Verbrauch.</p>
<figure>{heatmap_svg}</figure>"""

        # Sankey-Body (ohne Sektionsnummer)
        sankey_body = ""
        if sankey_svg:
            sankey_body = f"""
<div class="section">
    <p>Visualisierung der Energieflüsse von Bezugsquellen über Hauptzähler und Unterzähler bis zu den Verbrauchern.</p>
    <figure>{sankey_svg}</figure>
</div>"""

        # Zählerstruktur-Body (ohne Sektionsnummer)
        tree_body = ""
        if tree_svg:
            tree_body = f"""
<div class="section">
    <p>Hierarchische Darstellung der erfassten Zähler.</p>
    <figure>{tree_svg}</figure>
</div>"""

        # Kosten-Body (ohne Sektionsnummer)
        cost_body = ""
        if cost_summary.get("available"):
            cost_kwh_ct = (cost_summary.get("total_cost_net", 0) / total_kwh * 100) if total_kwh > 0 else 0
            cost_body = f"""
<div class="section">
    <p>Gesamtkosten im Berichtszeitraum auf Basis der erfassten Zählerlesungen.</p>
    <div class="kpi-row">
        <div class="kpi-card">
            <div class="value">{cost_summary.get('total_cost_net', 0):,.2f}</div>
            <div class="unit">€ netto</div>
            <div class="label">Energiekosten gesamt</div>
        </div>
        <div class="kpi-card">
            <div class="value">{cost_summary.get('total_cost_gross', 0):,.2f}</div>
            <div class="unit">€ brutto</div>
            <div class="label">inkl. MwSt.</div>
        </div>
        <div class="kpi-card">
            <div class="value">{cost_kwh_ct:.1f}</div>
            <div class="unit">ct/kWh</div>
            <div class="label">Durchschnittspreis</div>
        </div>
    </div>
    {f'<h2>Monatlicher Kostenverlauf</h2><figure>{cost_svg}</figure>' if cost_svg else ''}
    {amortization_html}
</div>"""

        # ── Nachhaltigkeit HTML ──
        AMPEL_COLORS = {"gruen": "#16A34A", "rot": "#DC2626", "grau": "#9CA3AF"}
        AMPEL_SYMBOLS = {"gruen": "✓", "rot": "✗", "grau": "–"}

        # Nachhaltigkeits-Body (ohne Sektionsnummer)
        sustainability_body = ""
        if sustainability:
            sus_parts = []

            # EnPI-Tabelle
            enpis = sustainability.get("enpis", [])
            if enpis:
                enpi_rows = ""
                for ep in enpis:
                    ampel = ep.get("ampel", "grau")
                    a_color = AMPEL_COLORS.get(ampel, "#9CA3AF")
                    a_sym = AMPEL_SYMBOLS.get(ampel, "–")
                    lv = ep.get("latest_value")
                    tv = ep.get("target_value")
                    bv = ep.get("baseline_value")
                    enpi_rows += (
                        f"<tr>"
                        f"<td><strong>{ep['name']}</strong>"
                        + (f"<br/><span style='color:#6B7280;font-size:8pt'>{ep['description']}</span>" if ep.get("description") else "")
                        + "</td>"
                        f"<td class='num'>{f'{lv:,.2f}' if lv is not None else '–'}</td>"
                        f"<td class='num'>{f'{tv:,.2f}' if tv is not None else '–'}</td>"
                        f"<td class='num'>{f'{bv:,.2f}' if bv is not None else '–'}</td>"
                        f"<td class='num'>{ep.get('unit', '')}</td>"
                        f"<td class='num' style='color:{a_color};font-weight:700'>{a_sym}</td>"
                        "</tr>"
                    )
                sus_parts.append(f"""
<h2>Energieleistungskennzahlen (EnPI)</h2>
<table>
    <thead>
        <tr>
            <th>Kennzahl</th>
            <th class="num">Ist-Wert</th>
            <th class="num">Zielwert</th>
            <th class="num">Baseline</th>
            <th class="num">Einheit</th>
            <th class="num">Status</th>
        </tr>
    </thead>
    <tbody>{enpi_rows}</tbody>
</table>""")

            # Gebäude
            buildings = sustainability.get("buildings", [])
            total_area = sustainability.get("total_area_m2", 0)
            if buildings:
                bldg_rows = ""
                for b in buildings:
                    bldg_rows += (
                        f"<tr>"
                        f"<td>{b['name']}</td>"
                        f"<td>{b.get('building_type_label', b.get('building_type', '–'))}</td>"
                        f"<td class='num'>{b['area_m2']:,.0f}&nbsp;m²" if b['area_m2'] > 0 else "<td class='num'>–"
                        f"</td>"
                        f"<td class='num'>{b['building_year'] or '–'}</td>"
                        f"<td class='num'>{b.get('energy_certificate_class') or '–'}</td>"
                        "</tr>"
                    )
                sus_parts.append(f"""
<h2>Geb&auml;ude &amp; Liegenschaft</h2>
<table>
    <thead>
        <tr>
            <th>Geb&auml;ude</th>
            <th>Typ</th>
            <th class="num">Fl&auml;che</th>
            <th class="num">Baujahr</th>
            <th class="num">Energieausweis</th>
        </tr>
    </thead>
    <tbody>{bldg_rows}</tbody>
    <tfoot><tr>
        <td colspan="2"><strong>Gesamt</strong></td>
        <td class="num"><strong>{total_area:,.0f}&nbsp;m²</strong></td>
        <td colspan="2"></td>
    </tr></tfoot>
</table>""")

            # CO₂-Verlauf
            co2_hist = sustainability.get("co2_history", [])
            if len(co2_hist) >= 2:
                hist_rows = ""
                for entry in co2_hist:
                    hist_rows += (
                        f"<tr>"
                        f"<td>{entry['year']}</td>"
                        f"<td class='num'>{entry['co2_kg']:,.0f}&nbsp;kg</td>"
                        f"<td class='num'>{entry['co2_kg'] / 1000:,.2f}&nbsp;t&nbsp;CO₂e</td>"
                        "</tr>"
                    )
                sus_parts.append(f"""
<h2>CO&#8322;-Verlauf (historisch)</h2>
<table>
    <thead><tr><th>Jahr</th><th class="num">kg&nbsp;CO&#8322;e</th><th class="num">t&nbsp;CO&#8322;e</th></tr></thead>
    <tbody>{hist_rows}</tbody>
</table>""")

            # Anteil erneuerbarer Energien
            if renewable_pct > 0:
                sus_parts.append(f"""
<h2>Anteil erneuerbarer Energien</h2>
<div class="kpi-row">
    <div class="kpi-card">
        <div class="value" style="color:#10B981">{renewable_pct:.1f}%</div>
        <div class="unit">&nbsp;</div>
        <div class="label">Erneuerbare am Gesamtbezug</div>
    </div>
    <div class="kpi-card">
        <div class="value" style="color:#10B981">{renewable_kwh_snap:,.1f}</div>
        <div class="unit">kWh</div>
        <div class="label">Erneuerbare Energie (Solar, Pellets, …)</div>
    </div>
</div>""")

            if sus_parts:
                sustainability_body = f"""
<div class="section">
    <p>Übersicht der Kennzahlen, Gebäude und CO&#8322;-Entwicklung gemäß ISO&nbsp;50001.</p>
    {"".join(sus_parts)}
</div>"""

        # ── Neue Sektions-Bodies ──

        # Kennzahlen-Vergleichstabelle (nur wenn Vorjahreswerte vorhanden)
        kpi_section_body = ""
        if kpi_compare_rows:
            kpi_section_body = f"""
<div class="section">
    <p>Vergleich wesentlicher Energiekennzahlen mit dem Vorjahreszeitraum.</p>
    <table>
        <thead>
            <tr>
                <th>Kennzahl</th>
                <th class="num">Einheit</th>
                <th class="num">Vorjahr</th>
                <th class="num">Aktuell</th>
                <th class="num">Δ&nbsp;%</th>
            </tr>
        </thead>
        <tbody>{kpi_compare_rows}</tbody>
    </table>
</div>"""

        # Maßnahmen & Ergebnisse (getrennt nach Status)
        massnahmen_body = ""
        if massnahmen_parts:
            massnahmen_body = f"""
<div class="section">
    <p>Übersicht der Energieziele und Maßnahmen gemäß ISO&nbsp;50001, aufgeteilt nach Umsetzungsstatus.</p>
    {"".join(massnahmen_parts)}
</div>"""

        # Bewertung & Ausblick (auto-generiert)
        # Bevorzuge Snapshot-Wert (immer berechnet), Fallback auf Chart-Wert
        yoy_delta_for_bewertung = yoy_total_delta_pct_snap if yoy_total_delta_pct_snap is not None else yoy_delta_pct
        bewertung_parts = []
        if yoy_delta_for_bewertung is not None:
            direction = "gestiegen" if yoy_delta_for_bewertung > 0 else "gesunken"
            bewertung_parts.append(
                f"Der Gesamtenergieverbrauch ist im Vergleich zum Vorjahr um "
                f"<strong>{abs(yoy_delta_for_bewertung):.1f}%</strong> {direction}."
            )
        if cost_summary.get("available") and cost_summary.get("cost_savings") is not None:
            savings = cost_summary["cost_savings"]
            if abs(savings) > 0:
                sav_dir = "eingespart" if savings > 0 else "gestiegen"
                bewertung_parts.append(
                    f"Die Energiekosten haben sich gegenüber dem Vorjahr um "
                    f"<strong>{abs(savings):,.0f}&nbsp;€</strong> {sav_dir}."
                )
        if renewable_pct > 0:
            bewertung_parts.append(
                f"Der Anteil erneuerbarer Energien beträgt <strong>{renewable_pct:.1f}%</strong> "
                f"des Gesamtenergiebezugs."
            )
        if objectives:
            done_count = sum(
                1 for o in objectives
                if o.get("status", "").lower() in STATUS_DONE
                or (o.get("progress_percent") or 0) >= 100
            )
            total_obj = len(objectives)
            bewertung_parts.append(
                f"Von {total_obj} Energiezielen sind <strong>{done_count}</strong> abgeschlossen."
            )
        if not bewertung_parts:
            bewertung_parts.append(
                "Eine detaillierte Bewertung der Energieentwicklung ist anhand der oben "
                "dargestellten Kennzahlen und Verbrauchsdaten möglich."
            )
        bewertung_body = f"""
<div class="section">
    <p>{'</p><p>'.join(bewertung_parts)}</p>
    <p>Als Ausblick für den kommenden Berichtszeitraum wird empfohlen, die laufenden Maßnahmen
    konsequent umzusetzen und die Energieziele regelmäßig zu überwachen. Die Analyse der
    wesentlichen Energieverbraucher (SEU) sollte als Basis für gezielte Verbesserungsmaßnahmen
    genutzt werden.</p>
</div>"""

        # Kontinuierliche Verbesserung (KVP) aus ISO 50001
        kvp = sustainability.get("kvp", {}) if sustainability else {}
        kvp_body = ""
        if kvp or objectives:
            open_nc = kvp.get("open_nonconformities", 0)
            closed_nc = kvp.get("closed_nonconformities", 0)
            total_audits = kvp.get("total_audits", 0)
            last_review = kvp.get("last_review_date", "–")
            kvp_body = f"""
<div class="section">
    <p>Überblick über die KVP-Aktivitäten im Rahmen des ISO&nbsp;50001-Energiemanagementsystems.</p>
    <div class="kpi-row">
        <div class="kpi-card">
            <div class="value" style="color:{'#DC2626' if open_nc > 0 else '#16A34A'}">{open_nc}</div>
            <div class="unit">&nbsp;</div>
            <div class="label">Offene Abweichungen</div>
        </div>
        <div class="kpi-card">
            <div class="value" style="color:#16A34A">{closed_nc}</div>
            <div class="unit">&nbsp;</div>
            <div class="label">Geschlossene Abweichungen</div>
        </div>
        <div class="kpi-card">
            <div class="value">{total_audits}</div>
            <div class="unit">&nbsp;</div>
            <div class="label">Interne Audits (gesamt)</div>
        </div>
        <div class="kpi-card">
            <div class="value" style="font-size:12pt">{last_review}</div>
            <div class="unit">&nbsp;</div>
            <div class="label">Letztes Management-Review</div>
        </div>
    </div>
    {f'<p>Aktive Energieziele: <strong>{len(objectives)}</strong></p>' if objectives else ''}
</div>"""

        # Fazit (auto-generiert)
        fazit_parts = []
        total_kwh_f = float(total_kwh)
        if total_kwh_f > 0:
            fazit_parts.append(
                f"Der vorliegende Energiebericht dokumentiert den Energieverbrauch im Zeitraum "
                f"{report.period_start} bis {report.period_end}."
            )
        if yoy_delta_for_bewertung is not None:
            trend_word = "Anstieg" if yoy_delta_for_bewertung > 0 else "Rückgang"
            fazit_parts.append(
                f"Der {trend_word} des Gesamtverbrauchs von {abs(yoy_delta_for_bewertung):.1f}% "
                f"gegenüber dem Vorjahr {'erfordert weitere Analyse und Maßnahmen' if yoy_delta_for_bewertung > 0 else 'zeigt den Erfolg der umgesetzten Maßnahmen'}."
            )
        fazit_parts.append(
            "Die kontinuierliche Überwachung des Energieverbrauchs und die konsequente "
            "Umsetzung der Energieziele sind wesentliche Elemente zur Erfüllung der "
            "ISO&nbsp;50001-Anforderungen und zur nachhaltigen Reduktion des Energieeinsatzes."
        )
        fazit_body = f"""
<div class="section">
    <p>{'</p><p>'.join(fazit_parts)}</p>
</div>"""

        # ── Sektionsnummern in der richtigen Reihenfolge vergeben ──
        # Reihenfolge: 1. Mgmt-Summary, 2. Aktuelle Lage, 3. Analyse, 4. Kennzahlen,
        #              5. Maßnahmen, 6. CO₂, [7. Nachhaltigkeit], [8. Energiefluss],
        #              [9. Zählerstruktur], [10. Wirtschaftlichkeit], SEU,
        #              Bewertung, KVP, Erkenntnisse, Empfehlungen, Fazit
        sec[0] = 3  # Nummern 1+2 sind hardcoded
        n_analyse = next_sec()                # 3
        kpi_section = (
            f"<h1>{next_sec()}. Kennzahlen</h1>{kpi_section_body}"
            if kpi_section_body else ""
        )
        massnahmen_section = (
            f"<h1>{next_sec()}. Ma&szlig;nahmen &amp; Ergebnisse</h1>{massnahmen_body}"
            if massnahmen_body else ""
        )
        n_co2 = next_sec()
        sustainability_section = (
            f"<h1>{next_sec()}. Nachhaltigkeit &amp; ISO&nbsp;50001</h1>{sustainability_body}"
            if sustainability_body else ""
        )
        sankey_section = (
            f"<h1>{next_sec()}. Energiefluss (Sankey)</h1>{sankey_body}"
            if sankey_body else ""
        )
        tree_section = (
            f"<h1>{next_sec()}. Z&auml;hlerstruktur</h1>{tree_body}"
            if tree_body else ""
        )
        cost_section = (
            f"<h1>{next_sec()}. Wirtschaftlichkeit</h1>{cost_body}"
            if cost_body else ""
        )
        n_seu = next_sec()
        n_bewertung = next_sec()
        n_kvp = next_sec()
        n_findings = next_sec()
        n_reco = next_sec()
        n_fazit = next_sec()

        generated_str = report.generated_at.strftime("%d.%m.%Y") if report.generated_at else ""

        return f"""<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>{report.title}</title>
<style>
@page {{
    size: A4;
    margin: 25mm 20mm 30mm 25mm;
    @bottom-right {{ content: "Seite " counter(page) " von " counter(pages); font-size: 7pt; color: #6B7280; }}
    @bottom-center {{ content: "Energiebericht {report.period_start} \2013 {report.period_end}"; font-size: 7pt; color: #6B7280; }}
}}
@page cover {{ margin: 0; }}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{ font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10pt; color: #1F2937; line-height: 1.5; }}

.cover {{ page: cover; height: 297mm; display: flex; flex-direction: column; justify-content: center; align-items: center; background: linear-gradient(135deg, #1B5E7B 0%, #2A8CB5 100%); color: white; text-align: center; padding: 40pt; }}
.cover h1 {{ font-size: 26pt; margin-bottom: 12pt; font-weight: 700; }}
.cover .subtitle {{ font-size: 14pt; opacity: 0.9; }}
.cover .period {{ font-size: 12pt; margin-top: 24pt; opacity: 0.75; }}
.cover .meta {{ margin-top: 48pt; font-size: 9pt; opacity: 0.6; }}
.cover .scope {{ margin-top: 8pt; font-size: 9pt; opacity: 0.7; }}

h1 {{ font-size: 16pt; color: #1B5E7B; border-bottom: 2px solid #1B5E7B; padding-bottom: 5pt; margin: 24pt 0 10pt 0; page-break-before: always; }}
h1:first-of-type {{ page-break-before: auto; }}
h2 {{ font-size: 13pt; color: #1B5E7B; margin: 16pt 0 7pt 0; }}
h3 {{ font-size: 11pt; color: #374151; margin: 10pt 0 5pt 0; }}

.kpi-row {{ display: flex; gap: 10pt; margin: 12pt 0; page-break-inside: avoid; flex-wrap: wrap; }}
.kpi-card {{ flex: 1; min-width: 80pt; border: 1px solid #D1D5DB; border-radius: 5pt; padding: 10pt; text-align: center; background: #FAFAFA; }}
.kpi-card .value {{ font-size: 20pt; font-weight: 700; color: #1B5E7B; line-height: 1.1; }}
.kpi-card .label {{ font-size: 8pt; color: #6B7280; margin-top: 3pt; }}
.kpi-card .unit {{ font-size: 8pt; color: #9CA3AF; }}

ul.summary-bullets {{ margin: 8pt 0 12pt 16pt; }}
ul.summary-bullets li {{ margin: 4pt 0; font-size: 10pt; }}

table {{ width: 100%; border-collapse: collapse; margin: 8pt 0; font-size: 9pt; }}
thead th {{ background: #1B5E7B; color: white; padding: 5pt 7pt; text-align: left; font-weight: 600; }}
tbody td {{ padding: 4pt 7pt; border-bottom: 1px solid #E5E7EB; }}
tbody tr:nth-child(even) {{ background: #F9FAFB; }}
.num {{ text-align: right; font-variant-numeric: tabular-nums; }}
tfoot td {{ font-weight: 700; border-top: 2px solid #1B5E7B; padding: 5pt 7pt; }}

.finding, .recommendation {{ border-left: 4px solid #D1D5DB; padding: 7pt 11pt; margin: 7pt 0; background: #F9FAFB; border-radius: 0 3pt 3pt 0; }}
.finding.hoch {{ border-left-color: #DC2626; }}
.finding.mittel {{ border-left-color: #D97706; }}
.finding.niedrig {{ border-left-color: #16A34A; }}
.recommendation {{ border-left-color: #1B5E7B; }}
.savings {{ color: #16A34A; font-weight: 600; font-size: 9pt; margin-top: 3pt; }}

figure {{ page-break-inside: avoid; margin: 10pt 0; }}
figure svg {{ max-width: 100%; height: auto; display: block; }}

p {{ margin: 5pt 0; }}
.text-secondary {{ color: #6B7280; }}
.section {{ margin-bottom: 16pt; }}
</style>
</head>
<body>

<!-- Deckblatt -->
<div class="cover">
    <h1>{report.title}</h1>
    <div class="subtitle">Energiebericht nach ISO 50001</div>
    <div class="period">{report.period_start} bis {report.period_end}</div>
    {scope_info}
    <div class="meta">Erstellt am {generated_str}</div>
</div>

<!-- 1. Management-Zusammenfassung -->
<h1>1. Management-Zusammenfassung</h1>
<div class="section">
    <p>Dieser Bericht dokumentiert den Energieverbrauch im Zeitraum {report.period_start} bis {report.period_end} gem&auml;&szlig; ISO&nbsp;50001.</p>
    <ul class="summary-bullets">
        {bullets_html}
    </ul>
    <div class="kpi-row">
        {kpi_cards}
    </div>
</div>

<!-- 2. Energieverbrauch (Aktuelle Lage) -->
<h1>2. Energieverbrauch</h1>
<div class="section">
    <p>Aufschl&uuml;sselung des Energieverbrauchs je Energieart in nativer Einheit im Zeitraum {report.period_start} bis {report.period_end}.</p>
    {energy_type_sections_html if energy_type_sections_html else f"""
    <h2>Energiebilanz</h2>
    <table>
        <thead><tr><th>Energietr&auml;ger</th><th class='num'>Verbrauch (kWh)</th><th class='num'>Anteil</th></tr></thead>
        <tbody>{energy_rows}</tbody>
        <tfoot><tr><td>Gesamt</td><td class='num'>{total_kwh:,.1f}</td><td class='num'>100%</td></tr></tfoot>
    </table>
    {f'<figure>{monthly_trend_svg}</figure>' if monthly_trend_svg else ''}
    """}
    {f"""
    <h2>Vorjahresvergleich nach Energietr&auml;ger</h2>
    <table>
        <thead>
            <tr>
                <th>Energietr&auml;ger</th>
                <th class="num">Vorjahr</th>
                <th class="num">Aktuell</th>
                <th class="num">&Delta;&nbsp;%</th>
            </tr>
        </thead>
        <tbody>{yoy_table_rows}</tbody>
    </table>""" if yoy_table_rows else ""}
    {f"""
    <h2>Verbrauch nach Bereichen</h2>
    <p class="text-secondary">Aufschl&uuml;sselung nach Verbrauchergruppen (Consumer-Kategorien).</p>
    <table>
        <thead>
            <tr><th>Bereich</th><th class="num">kWh-&Auml;quiv.</th><th class="num">Anteil</th></tr>
        </thead>
        <tbody>{cat_rows}</tbody>
    </table>""" if cat_rows else ""}
    {schema_strands_html}
</div>

<!-- {n_analyse}. Analyse -->
<h1>{n_analyse}. Analyse</h1>
<div class="section">
    {analyse_section or '<p class="text-secondary">Keine Vergleichsdaten verf&uuml;gbar (Diagramme wurden nicht aktiviert).</p>'}
</div>

{kpi_section}

{massnahmen_section}

<!-- {n_co2}. CO₂-Bilanz -->
<h1>{n_co2}. CO&#8322;-Bilanz</h1>
<div class="section">
    <p>CO&#8322;-Emissionen nach Energietr&auml;ger. Intensit&auml;t: <strong>{co2_intensity:.0f}&nbsp;g&nbsp;CO&#8322;/kWh</strong>{f" ({'+' if co2_trend and co2_trend > 0 else ''}{co2_trend:.1f}&nbsp;% ggü.&nbsp;Vorjahr)" if co2_trend is not None else ""}.</p>
    <table>
        <thead>
            <tr><th>Energietr&auml;ger</th><th class="num">CO&#8322; (kg)</th><th class="num">Verbrauch (kWh)</th></tr>
        </thead>
        <tbody>{co2_rows}</tbody>
        <tfoot>
            <tr><td>Gesamt</td><td class="num">{total_co2:,.1f}</td><td class="num">{total_kwh:,.1f}</td></tr>
        </tfoot>
    </table>
</div>

{sustainability_section}
{sankey_section}
{tree_section}
{cost_section}

<!-- {n_seu}. Wesentliche Energieverbraucher -->
<h1>{n_seu}. Wesentliche Energieverbraucher (SEU)</h1>
<div class="section">
    <p>Die f&uuml;nf gr&ouml;&szlig;ten Energieverbraucher im Berichtszeitraum (Pareto-Analyse).</p>
    <table>
        <thead>
            <tr><th>Z&auml;hler</th><th>Energieart</th><th class="num">Verbrauch (native Einheit)</th></tr>
        </thead>
        <tbody>{top_rows}</tbody>
    </table>
</div>

<!-- {n_bewertung}. Bewertung & Ausblick -->
<h1>{n_bewertung}. Bewertung &amp; Ausblick</h1>
{bewertung_body}

<!-- {n_kvp}. Kontinuierliche Verbesserung -->
<h1>{n_kvp}. Kontinuierliche Verbesserung (KVP)</h1>
{kvp_body if kvp_body else '<div class="section"><p class="text-secondary">Keine KVP-Daten vorhanden.</p></div>'}

<!-- {n_findings}. Erkenntnisse -->
<h1>{n_findings}. Erkenntnisse und Befunde</h1>
<div class="section">
    {findings_html or '<p class="text-secondary">Keine besonderen Befunde.</p>'}
</div>

<!-- {n_reco}. Empfehlungen -->
<h1>{n_reco}. Empfehlungen</h1>
<div class="section">
    {reco_html or '<p class="text-secondary">Keine Empfehlungen generiert.</p>'}
</div>

<!-- {n_fazit}. Fazit -->
<h1>{n_fazit}. Fazit</h1>
{fazit_body}

</body>
</html>"""

    # ── Daten-Snapshot ──

    async def _create_data_snapshot(
        self,
        start: date,
        end: date,
        meter_ids: list[uuid.UUID] | None = None,
        reference_value: float | None = None,
        reference_unit: str | None = None,
    ) -> dict:
        """Eingefrorenen Daten-Snapshot für den Bericht erstellen."""
        from app.models.meter import Meter

        # Zähler ermitteln
        query = select(Meter).where(Meter.is_active == True)  # noqa: E712
        if meter_ids:
            query = query.where(Meter.id.in_(meter_ids))
        result = await self.db.execute(query)
        meters = list(result.scalars().all())

        # Verbrauch pro Zähler
        energy_balance = []
        total_kwh = Decimal("0")
        top_consumers = []

        for meter in meters:
            consumption_result = await self.db.execute(
                select(func.sum(MeterReading.consumption)).where(
                    MeterReading.meter_id == meter.id,
                    MeterReading.timestamp >= datetime.combine(
                        start, datetime.min.time(), tzinfo=timezone.utc
                    ),
                    MeterReading.timestamp < datetime.combine(
                        end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
                    ),
                )
            )
            raw = consumption_result.scalar() or Decimal("0")
            conv = CONVERSION_FACTORS.get(meter.unit, Decimal("1"))
            kwh = raw * conv
            total_kwh += kwh

            top_consumers.append({
                "meter_id": str(meter.id),
                "name": meter.name,
                "energy_type": meter.energy_type,
                "consumption_kwh": float(kwh),        # kWh-Äquivalent (nur für Sortierung)
                "consumption_native": float(raw),     # Nativer Wert in meter.unit
                "unit": meter.unit,
            })

        # Nach Energietyp gruppieren
        type_map: dict[str, float] = {}
        for tc in top_consumers:
            et = tc["energy_type"]
            type_map[et] = type_map.get(et, 0) + tc["consumption_kwh"]

        total_float = float(total_kwh)
        for et, val in type_map.items():
            energy_balance.append({
                "energy_type": et,
                "consumption_kwh": val,
                "share_percent": round(val / total_float * 100, 1) if total_float > 0 else 0,
            })

        # Top-5 sortieren
        top_consumers.sort(key=lambda x: -x["consumption_kwh"])
        top_consumers = top_consumers[:5]

        # Monatlicher Verlauf
        monthly_trend = []
        for month in range(1, 13):
            m_start = date(start.year, month, 1)
            if month == 12:
                m_end = date(start.year + 1, 1, 1)
            else:
                m_end = date(start.year, month + 1, 1)

            if m_start < start or m_start > end:
                continue

            monthly_query = (
                select(
                    Meter.unit,
                    func.sum(MeterReading.consumption).label("total"),
                )
                .join(MeterReading, MeterReading.meter_id == Meter.id)
                .where(
                    Meter.is_active == True,  # noqa: E712
                    MeterReading.timestamp >= datetime.combine(
                        m_start, datetime.min.time(), tzinfo=timezone.utc
                    ),
                    MeterReading.timestamp < datetime.combine(
                        m_end, datetime.min.time(), tzinfo=timezone.utc
                    ),
                )
                .group_by(Meter.unit)
            )
            if meter_ids:
                monthly_query = monthly_query.where(Meter.id.in_(meter_ids))
            result = await self.db.execute(monthly_query)
            month_kwh = Decimal("0")
            for row in result.all():
                c = CONVERSION_FACTORS.get(row.unit, Decimal("1"))
                month_kwh += (row.total or Decimal("0")) * c

            monthly_trend.append({
                "month": month,
                "consumption_kwh": float(month_kwh),
            })

        days_in_period = (end - start).days + 1
        energy_intensity_kwh_per_day = float(total_kwh) / days_in_period if days_in_period > 0 and total_kwh > 0 else 0

        # Verbrauch getrennt nach Energieart (native Einheit)
        energy_by_type = await self._create_energy_by_type(start, end, meter_ids, meters)

        # Schema-Stränge aus dem Energieschema
        schema_strands = await self._create_schema_strands(start, end, meter_ids)

        # Vorjahresvergleich nach Energieträger
        energy_yoy_table = await self._create_energy_yoy_table(start, end, meter_ids, energy_by_type)

        # Verbrauch nach Bereichen (Consumer-Kategorien)
        consumer_categories = await self._create_consumer_categories(start, end, meter_ids)

        # Anteil erneuerbarer Energien (Solar, Pellets, Biomasse)
        RENEWABLE_TYPES = {"solar", "wood_pellets", "biomass", "geothermal", "wind"}
        renewable_kwh = sum(
            v.get("total_kwh_equiv", 0)
            for k, v in energy_by_type.items()
            if k in RENEWABLE_TYPES
        )
        renewable_pct = round(renewable_kwh / float(total_kwh) * 100, 1) if float(total_kwh) > 0 else 0.0

        # Vorjahres-Gesamtverbrauch für Δ% im Summary
        prev_total_kwh = sum(row["prev_kwh"] for row in energy_yoy_table)
        yoy_total_delta_pct = None
        if prev_total_kwh > 0:
            yoy_total_delta_pct = round((float(total_kwh) - prev_total_kwh) / prev_total_kwh * 100, 1)

        return {
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "meter_count": len(meters),
            "total_consumption_kwh": float(total_kwh),
            "prev_total_kwh": round(prev_total_kwh, 1),
            "yoy_total_delta_pct": yoy_total_delta_pct,
            "energy_balance": energy_balance,
            "top_consumers": top_consumers,
            "monthly_trend": monthly_trend,
            "energy_by_type": energy_by_type,
            "energy_yoy_table": energy_yoy_table,
            "consumer_categories": consumer_categories,
            "renewable_kwh": round(renewable_kwh, 1),
            "renewable_pct": renewable_pct,
            "schema_strands": schema_strands,
            "energy_intensity_kwh_per_day": round(energy_intensity_kwh_per_day, 1),
            "days_in_period": days_in_period,
            "reference_value": reference_value,
            "reference_unit": reference_unit,
            "energy_intensity_per_unit": (
                round(float(total_kwh) / reference_value, 1)
                if reference_value and reference_value > 0 else None
            ),
        }

    async def _create_energy_by_type(
        self,
        start: date,
        end: date,
        meter_ids: list[uuid.UUID] | None,
        meters: list,
    ) -> dict:
        """Verbrauch getrennt nach Energieart – native Einheit je Typ."""
        LABELS: dict[str, str] = {
            "electricity": "Strom",
            "natural_gas": "Erdgas",
            "heating_oil": "Heizöl",
            "district_heating": "Fernwärme",
            "district_cooling": "Kälte",
            "water": "Wasser",
            "solar": "Solar",
            "lpg": "Flüssiggas",
            "wood_pellets": "Holzpellets",
            "compressed_air": "Druckluft",
            "steam": "Dampf",
            "other": "Sonstige",
        }
        # Energietyp-Farben für Diagramme
        ET_COLORS: dict[str, str] = {
            "electricity": "#F59E0B",
            "natural_gas": "#3B82F6",
            "heating_oil": "#8B5CF6",
            "district_heating": "#F97316",
            "district_cooling": "#0EA5E9",
            "water": "#06B6D4",
            "solar": "#10B981",
            "lpg": "#EC4899",
            "wood_pellets": "#84CC16",
            "compressed_air": "#6B7280",
            "steam": "#EF4444",
            "other": "#9CA3AF",
        }

        start_dt = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)
        end_dt = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)

        # Zähler nach Energieart gruppieren
        type_groups: dict[str, list] = {}
        for meter in meters:
            et = meter.energy_type or "other"
            type_groups.setdefault(et, []).append(meter)

        result: dict[str, dict] = {}
        for energy_type, type_meters in type_groups.items():
            unit_totals: dict[str, Decimal] = {}
            total_kwh_equiv = Decimal("0")
            meter_data: list[dict] = []

            for meter in type_meters:
                cons_result = await self.db.execute(
                    select(func.sum(MeterReading.consumption)).where(
                        MeterReading.meter_id == meter.id,
                        MeterReading.timestamp >= start_dt,
                        MeterReading.timestamp < end_dt,
                    )
                )
                raw = cons_result.scalar() or Decimal("0")
                unit = meter.unit or "kWh"
                conv = CONVERSION_FACTORS.get(unit, Decimal("1"))
                kwh_equiv = raw * conv
                total_kwh_equiv += kwh_equiv
                unit_totals[unit] = unit_totals.get(unit, Decimal("0")) + raw
                if float(raw) > 0:
                    meter_data.append({
                        "meter_id": str(meter.id),
                        "name": meter.name,
                        "unit": unit,
                        "total_native": float(raw),
                        "total_kwh_equiv": float(kwh_equiv),
                    })

            meter_data.sort(key=lambda x: -x["total_kwh_equiv"])

            # Primäreinheit: die mit dem höchsten Gesamtverbrauch
            primary_unit = (
                max(unit_totals, key=lambda u: unit_totals[u])
                if unit_totals else "kWh"
            )

            # Monatlicher Verlauf in Primäreinheit
            monthly_trend: list[dict] = []
            for month_num in range(1, 13):
                m_start = date(start.year, month_num, 1)
                m_end = (
                    date(start.year, month_num + 1, 1)
                    if month_num < 12
                    else date(start.year + 1, 1, 1)
                )
                if m_start < start or m_start > end:
                    continue

                m_query = (
                    select(Meter.unit, func.sum(MeterReading.consumption).label("total"))
                    .join(MeterReading, MeterReading.meter_id == Meter.id)
                    .where(
                        Meter.is_active == True,  # noqa: E712
                        Meter.energy_type == energy_type,
                        MeterReading.timestamp >= datetime.combine(
                            m_start, datetime.min.time(), tzinfo=timezone.utc
                        ),
                        MeterReading.timestamp < datetime.combine(
                            m_end, datetime.min.time(), tzinfo=timezone.utc
                        ),
                    )
                    .group_by(Meter.unit)
                )
                if meter_ids:
                    m_query = m_query.where(Meter.id.in_(meter_ids))

                m_result = await self.db.execute(m_query)
                month_unit_totals: dict[str, Decimal] = {}
                for row in m_result.all():
                    month_unit_totals[row.unit] = (
                        month_unit_totals.get(row.unit, Decimal("0")) + (row.total or Decimal("0"))
                    )
                monthly_trend.append({
                    "month": month_num,
                    "consumption_native": float(month_unit_totals.get(primary_unit, Decimal("0"))),
                })

            result[energy_type] = {
                "label": LABELS.get(energy_type, energy_type),
                "unit": primary_unit,
                "color": ET_COLORS.get(energy_type, "#1B5E7B"),
                "total_native": float(unit_totals.get(primary_unit, Decimal("0"))),
                "total_kwh_equiv": float(total_kwh_equiv),
                "meter_count": len(type_meters),
                "top_meters": meter_data[:5],
                "monthly_trend": monthly_trend,
            }

        return result

    async def _create_schema_strands(
        self,
        start: date,
        end: date,
        meter_ids: list[uuid.UUID] | None,
    ) -> list[dict]:
        """Schema-Stränge (Betrachtungspunkte aus Energieschema) mit Verbrauchsdaten."""
        start_dt = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)
        end_dt = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)

        # Schema-Wurzeln laden (schema_label gesetzt)
        schema_result = await self.db.execute(
            select(Meter)
            .where(Meter.schema_label.isnot(None), Meter.is_active == True)  # noqa: E712
            .order_by(Meter.schema_label)
        )
        schema_roots = list(schema_result.scalars().all())

        strands: list[dict] = []
        for root in schema_roots:
            # Rekursiv alle Zähler im Strang ermitteln
            strand_ids: list[uuid.UUID] = []
            queue: list[uuid.UUID] = [root.id]
            while queue:
                current_id = queue.pop(0)
                strand_ids.append(current_id)
                children_res = await self.db.execute(
                    select(Meter.id).where(
                        Meter.parent_meter_id == current_id,
                        Meter.is_active == True,  # noqa: E712
                    )
                )
                queue.extend(row[0] for row in children_res.all())

            # Scope-Filter anwenden
            if meter_ids:
                strand_ids = [m_id for m_id in strand_ids if m_id in meter_ids]
            if not strand_ids:
                continue

            # Zähler-Details laden
            meters_res = await self.db.execute(
                select(Meter).where(Meter.id.in_(strand_ids))
            )
            strand_meters = list(meters_res.scalars().all())

            # Verbrauch pro Zähler
            meter_consumptions: list[dict] = []
            unit_totals: dict[str, Decimal] = {}
            strand_total_kwh = Decimal("0")

            for meter in strand_meters:
                cons_res = await self.db.execute(
                    select(func.sum(MeterReading.consumption)).where(
                        MeterReading.meter_id == meter.id,
                        MeterReading.timestamp >= start_dt,
                        MeterReading.timestamp < end_dt,
                    )
                )
                raw = cons_res.scalar() or Decimal("0")
                unit = meter.unit or "kWh"
                conv = CONVERSION_FACTORS.get(unit, Decimal("1"))
                kwh = raw * conv
                strand_total_kwh += kwh
                unit_totals[unit] = unit_totals.get(unit, Decimal("0")) + raw
                if float(raw) > 0:
                    meter_consumptions.append({
                        "meter_id": str(meter.id),
                        "name": meter.name,
                        "energy_type": meter.energy_type,
                        "unit": unit,
                        "total_native": float(raw),
                        "total_kwh_equiv": float(kwh),
                        "is_root": meter.id == root.id,
                    })

            meter_consumptions.sort(key=lambda x: -x["total_kwh_equiv"])
            primary_unit = root.unit or "kWh"

            strands.append({
                "schema_label": root.schema_label,
                "root_meter_id": str(root.id),
                "root_meter_name": root.name,
                "energy_type": root.energy_type,
                "unit": primary_unit,
                "total_native": float(unit_totals.get(primary_unit, Decimal("0"))),
                "total_kwh_equiv": float(strand_total_kwh),
                "meter_count": len(strand_meters),
                "meters": meter_consumptions[:10],
            })

        return strands

    async def _create_weather_analysis(self, start: date, end: date) -> dict | None:
        """Witterungsanalyse: Heizgradtage Ist vs. Langzeitdurchschnitt."""
        from app.models.weather import MonthlyDegreeDays, WeatherStation

        # Erste aktive Wetterstation verwenden
        station_result = await self.db.execute(
            select(WeatherStation).where(WeatherStation.is_active == True).limit(1)  # noqa: E712
        )
        station = station_result.scalar_one_or_none()
        if not station:
            return None

        # Monatliche Gradtagszahlen für Berichtszeitraum
        monthly_result = await self.db.execute(
            select(MonthlyDegreeDays)
            .where(
                MonthlyDegreeDays.station_id == station.id,
                and_(
                    MonthlyDegreeDays.year * 100 + MonthlyDegreeDays.month
                    >= start.year * 100 + start.month,
                    MonthlyDegreeDays.year * 100 + MonthlyDegreeDays.month
                    <= end.year * 100 + end.month,
                ),
            )
            .order_by(MonthlyDegreeDays.year, MonthlyDegreeDays.month)
        )
        monthly = list(monthly_result.scalars().all())
        if not monthly:
            return None

        actual_hdd = sum(float(m.heating_degree_days) for m in monthly)
        # Langjähriges Mittel: wenn vorhanden, sonst actual_hdd (kein Vergleich möglich)
        has_ltm = any(m.long_term_avg_hdd is not None for m in monthly)
        reference_hdd = sum(
            float(m.long_term_avg_hdd if m.long_term_avg_hdd is not None else m.heating_degree_days)
            for m in monthly
        )
        avg_temp = sum(float(m.avg_temperature) for m in monthly) / len(monthly)
        total_heating_days = sum(m.heating_days for m in monthly)

        hdd_deviation_pct = (
            round((actual_hdd - reference_hdd) / reference_hdd * 100, 1)
            if reference_hdd > 0 and has_ltm else None
        )

        return {
            "station_name": station.name,
            "actual_hdd": round(actual_hdd, 1),
            "reference_hdd": round(reference_hdd, 1) if has_ltm else None,
            "hdd_deviation_pct": hdd_deviation_pct,
            "avg_temp": round(avg_temp, 1),
            "heating_days": total_heating_days,
            "has_ltm": has_ltm,
            "monthly_data": [
                {
                    "year": m.year,
                    "month": m.month,
                    "hdd": float(m.heating_degree_days),
                    "ltm_hdd": float(m.long_term_avg_hdd) if m.long_term_avg_hdd else None,
                    "avg_temp": float(m.avg_temperature),
                }
                for m in monthly
            ],
        }

    async def _create_analysis_narrative(
        self,
        snapshot: dict,
        weather_analysis: dict | None,
        analysis_comment: str | None,
    ) -> dict:
        """Analyse-Narrativ aus Witterung, Zähler-Treibern und Monatspeaks."""
        MONTH_NAMES = [
            "Januar", "Februar", "März", "April", "Mai", "Juni",
            "Juli", "August", "September", "Oktober", "November", "Dezember",
        ]
        bullets: list[str] = []

        # ── 1. Witterungsanalyse ──
        if weather_analysis:
            hdd_dev = weather_analysis.get("hdd_deviation_pct")
            actual_hdd = weather_analysis["actual_hdd"]
            ref_hdd = weather_analysis.get("reference_hdd")
            station = weather_analysis["station_name"]
            avg_temp = weather_analysis["avg_temp"]
            heating_days = weather_analysis.get("heating_days", 0)

            if hdd_dev is not None and abs(hdd_dev) > 3:
                direction = "kälter" if hdd_dev > 0 else "wärmer"
                bullets.append(
                    f"Witterung: Der Berichtszeitraum war <strong>{abs(hdd_dev):.0f}%</strong> {direction} "
                    f"als der Langzeitdurchschnitt ({actual_hdd:.0f}&nbsp;HDD ist vs. {ref_hdd:.0f}&nbsp;HDD "
                    f"Referenz, Station {station}, Ø&nbsp;{avg_temp:.1f}°C, {heating_days}&nbsp;Heiztage). "
                    + ("Ein erhöhter Heizenergieverbrauch ist daher witterungsbedingt plausibel."
                       if hdd_dev > 3 else
                       "Ein reduzierter Heizenergieverbrauch ist daher witterungsbedingt plausibel.")
                )
            elif actual_hdd > 0:
                bullets.append(
                    f"Witterung: Der Berichtszeitraum entsprach weitgehend dem Langzeitdurchschnitt "
                    f"({actual_hdd:.0f}&nbsp;HDD, Ø&nbsp;{avg_temp:.1f}°C, Station {station}). "
                    f"Witterungseinflüsse erklären Verbrauchsabweichungen nur in geringem Maße."
                )

        # ── 2. Zähler-Treiber aus YoY-Vergleich ──
        charts = snapshot.get("charts", {})
        yoy_data = charts.get("yoy_comparison", {})
        if yoy_data:
            p1_data = yoy_data.get("period1", {}).get("data", {})
            p2_data = yoy_data.get("period2", {}).get("data", {})

            # Meter-IDs aus beiden Perioden zusammenführen
            all_meter_ids = set(list(p1_data.keys()) + list(p2_data.keys()))

            # Meter-Namen aus Snapshot (top_consumers) und ggf. DB nachschlagen
            tc_map = {str(t["meter_id"]): t["name"] for t in snapshot.get("top_consumers", [])}

            # Delta pro Zähler berechnen
            meter_deltas: list[dict] = []
            for meter_id in all_meter_ids:
                p1_sum = sum(e.get("value", 0) for e in p1_data.get(meter_id, []))
                p2_sum = sum(e.get("value", 0) for e in p2_data.get(meter_id, []))
                delta = p2_sum - p1_sum
                if abs(delta) < 1:
                    continue
                # Name aus top_consumers oder DB
                if meter_id in tc_map:
                    name = tc_map[meter_id]
                else:
                    try:
                        import uuid as _uuid
                        m = await self.db.get(Meter, _uuid.UUID(meter_id))
                        name = m.name if m else f"Zähler {meter_id[:8]}"
                    except Exception:
                        name = f"Zähler {meter_id[:8]}"
                meter_deltas.append({"meter_id": meter_id, "name": name, "delta": delta})

            meter_deltas.sort(key=lambda x: abs(x["delta"]), reverse=True)
            top3 = meter_deltas[:3]
            if top3:
                # Zähler-Einheit aus top_consumers nachschlagen
                tc_unit_map = {
                    str(t["meter_id"]): t.get("unit", "kWh")
                    for t in snapshot.get("top_consumers", [])
                }
                parts = []
                for d in top3:
                    unit_d = tc_unit_map.get(d.get("meter_id", ""), "kWh")
                    sign = "+" if d["delta"] > 0 else ""
                    parts.append(f"{d['name']} ({sign}{d['delta']:,.0f}&nbsp;{unit_d})")
                bullets.append(
                    f"Haupttreiber (Jahresvergleich): {', '.join(parts)}."
                )

        # ── 3. Monatliche Peaks je Energieart ──
        energy_by_type_snap = snapshot.get("energy_by_type", {})
        if energy_by_type_snap:
            for et_key, et_data in energy_by_type_snap.items():
                et_label_n = et_data.get("label", et_key)
                et_unit_n = et_data.get("unit", "kWh")
                mt = [
                    m for m in et_data.get("monthly_trend", [])
                    if m.get("consumption_native", 0) > 0
                ]
                if len(mt) >= 2:
                    peak = max(mt, key=lambda m: m["consumption_native"])
                    low = min(mt, key=lambda m: m["consumption_native"])
                    avg = sum(m["consumption_native"] for m in mt) / len(mt)
                    peak_dev = (peak["consumption_native"] / avg - 1) * 100
                    low_dev = (low["consumption_native"] / avg - 1) * 100
                    bullets.append(
                        f"Monatliche Verteilung {et_label_n}: "
                        f"Spitzenmonat <strong>{MONTH_NAMES[peak['month'] - 1]}</strong> "
                        f"({peak['consumption_native']:,.1f}&nbsp;{et_unit_n}, "
                        f"{peak_dev:+.0f}%&nbsp;vs.&nbsp;Ø), "
                        f"Niedrigstmonat <strong>{MONTH_NAMES[low['month'] - 1]}</strong> "
                        f"({low['consumption_native']:,.1f}&nbsp;{et_unit_n}, "
                        f"{low_dev:+.0f}%&nbsp;vs.&nbsp;Ø)."
                    )

        # ── 4. Nutzer-Kommentar ──
        if analysis_comment and analysis_comment.strip():
            bullets.append(f"Hinweis: <em>{analysis_comment.strip()}</em>")

        return {"bullets": bullets, "weather": weather_analysis}

    async def _create_co2_summary(self, start: date, end: date) -> dict:
        """CO₂-Zusammenfassung für den Berichtszeitraum."""
        # Gesamt-CO₂
        total_result = await self.db.execute(
            select(
                func.sum(CO2Calculation.co2_kg),
                func.sum(CO2Calculation.consumption_kwh),
            ).where(
                CO2Calculation.period_start >= start,
                CO2Calculation.period_end <= end,
            )
        )
        total_co2, total_kwh = total_result.one()
        total_co2 = float(total_co2 or 0)
        total_kwh = float(total_kwh or 0)

        # Nach Energietyp
        by_type_result = await self.db.execute(
            select(
                Meter.energy_type,
                func.sum(CO2Calculation.co2_kg),
                func.sum(CO2Calculation.consumption_kwh),
            )
            .join(Meter, Meter.id == CO2Calculation.meter_id)
            .where(
                CO2Calculation.period_start >= start,
                CO2Calculation.period_end <= end,
            )
            .group_by(Meter.energy_type)
        )
        by_energy_type = [
            {
                "energy_type": et,
                "co2_kg": float(co2 or 0),
                "consumption_kwh": float(kwh or 0),
            }
            for et, co2, kwh in by_type_result.all()
        ]

        # Scope-Aufschlüsselung
        by_scope_result = await self.db.execute(
            select(
                EmissionFactor.scope,
                func.sum(CO2Calculation.co2_kg),
            )
            .join(EmissionFactor, EmissionFactor.id == CO2Calculation.emission_factor_id)
            .where(
                CO2Calculation.period_start >= start,
                CO2Calculation.period_end <= end,
            )
            .group_by(EmissionFactor.scope)
        )
        by_scope = [
            {"scope": scope, "co2_kg": float(co2 or 0)}
            for scope, co2 in by_scope_result.all()
        ]

        # Trend vs. Vorjahr
        prev_start = date(start.year - 1, start.month, start.day)
        prev_end = date(end.year - 1, end.month, end.day)
        prev_result = await self.db.execute(
            select(func.sum(CO2Calculation.co2_kg)).where(
                CO2Calculation.period_start >= prev_start,
                CO2Calculation.period_end <= prev_end,
            )
        )
        prev_co2 = float(prev_result.scalar() or 0)
        trend = None
        if prev_co2 > 0:
            trend = round((total_co2 - prev_co2) / prev_co2 * 100, 1)

        return {
            "total_co2_kg": total_co2,
            "total_consumption_kwh": total_kwh,
            "avg_co2_g_per_kwh": round(total_co2 * 1000 / total_kwh, 1) if total_kwh > 0 else 0,
            "by_energy_type": by_energy_type,
            "by_scope": by_scope,
            "trend_vs_previous_year": trend,
        }

    async def _create_cost_summary(
        self,
        start: date,
        end: date,
        meter_ids: list[uuid.UUID] | None = None,
    ) -> dict:
        """Kosten-Zusammenfassung aus MeterReading.cost_net/cost_gross."""
        start_dt = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)
        end_dt = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)

        # Gesamtsumme
        total_query = select(
            func.sum(MeterReading.cost_net),
            func.sum(MeterReading.cost_gross),
        ).where(
            MeterReading.timestamp >= start_dt,
            MeterReading.timestamp < end_dt,
            MeterReading.cost_net.is_not(None),
        )
        if meter_ids:
            total_query = total_query.where(MeterReading.meter_id.in_(meter_ids))

        result = await self.db.execute(total_query)
        total_cost_net, total_cost_gross = result.one()

        if total_cost_net is None:
            return {"available": False}

        total_cost_net = float(total_cost_net or 0)
        total_cost_gross = float(total_cost_gross or 0)

        # Monatliche Aufschlüsselung
        from sqlalchemy import extract
        monthly_query = (
            select(
                extract("year", MeterReading.timestamp).label("year"),
                extract("month", MeterReading.timestamp).label("month"),
                func.sum(MeterReading.cost_net).label("cost_net"),
            )
            .where(
                MeterReading.timestamp >= start_dt,
                MeterReading.timestamp < end_dt,
                MeterReading.cost_net.is_not(None),
            )
            .group_by("year", "month")
            .order_by("year", "month")
        )
        if meter_ids:
            monthly_query = monthly_query.where(MeterReading.meter_id.in_(meter_ids))

        monthly_result = await self.db.execute(monthly_query)
        monthly_costs = [
            {
                "month": f"{int(row.year)}-{int(row.month):02d}",
                "cost_net": float(row.cost_net or 0),
            }
            for row in monthly_result.all()
        ]

        # Vorjahreskosten für YoY-Vergleich
        try:
            prev_start = start.replace(year=start.year - 1)
            prev_end = end.replace(year=end.year - 1)
        except ValueError:
            prev_start = start - timedelta(days=365)
            prev_end = end - timedelta(days=365)

        prev_start_dt = datetime.combine(prev_start, datetime.min.time(), tzinfo=timezone.utc)
        prev_end_dt = datetime.combine(prev_end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)

        prev_query = select(func.sum(MeterReading.cost_net)).where(
            MeterReading.timestamp >= prev_start_dt,
            MeterReading.timestamp < prev_end_dt,
            MeterReading.cost_net.is_not(None),
        )
        if meter_ids:
            prev_query = prev_query.where(MeterReading.meter_id.in_(meter_ids))
        prev_result = await self.db.execute(prev_query)
        prev_cost_net = prev_result.scalar()
        prev_cost_net = float(prev_cost_net) if prev_cost_net is not None else None

        cost_savings = None
        if prev_cost_net is not None and prev_cost_net > 0:
            cost_savings = round(prev_cost_net - total_cost_net, 2)

        return {
            "available": True,
            "total_cost_net": total_cost_net,
            "total_cost_gross": total_cost_gross,
            "prev_year_cost_net": prev_cost_net,
            "cost_savings": cost_savings,
            "monthly_costs": monthly_costs,
        }

    async def _generate_findings(
        self, snapshot: dict, co2_summary: dict | None
    ) -> list[dict]:
        """Automatische Befunde basierend auf den Daten generieren."""
        findings = []

        # Prüfe dominanten Energieträger
        balance = snapshot.get("energy_balance", [])
        if balance:
            top = max(balance, key=lambda x: x["consumption_kwh"])
            if top["share_percent"] > 70:
                _et_lbl = {"electricity": "Strom", "natural_gas": "Erdgas", "heating_oil": "Heizöl", "wood_pellets": "Holzpellets", "district_heating": "Fernwärme", "solar": "Solarstrom"}.get(top["energy_type"], top["energy_type"])
                findings.append({
                    "title": f"Hohe Abhängigkeit von {_et_lbl}",
                    "description": f"Der Energieträger {_et_lbl} macht {top['share_percent']:.1f}% des Gesamtverbrauchs aus. Eine Diversifizierung sollte geprüft werden.",
                    "severity": "mittel",
                    "category": "energy_mix",
                })

        # CO₂-Trend
        if co2_summary and co2_summary.get("trend_vs_previous_year") is not None:
            trend = co2_summary["trend_vs_previous_year"]
            if trend > 5:
                findings.append({
                    "title": "CO₂-Emissionen gestiegen",
                    "description": f"Die CO₂-Emissionen sind um {trend:.1f}% gegenüber dem Vorjahreszeitraum gestiegen.",
                    "severity": "hoch",
                    "category": "co2",
                })
            elif trend < -5:
                findings.append({
                    "title": "CO₂-Reduktion erzielt",
                    "description": f"Die CO₂-Emissionen konnten um {abs(trend):.1f}% reduziert werden.",
                    "severity": "niedrig",
                    "category": "co2",
                })

        # Prüfe ob es Monate mit 0 Verbrauch gibt
        trend_data = snapshot.get("monthly_trend", [])
        zero_months = [t for t in trend_data if t.get("consumption_kwh", 0) == 0]
        if zero_months and len(zero_months) < len(trend_data):
            findings.append({
                "title": "Fehlende Verbrauchsdaten",
                "description": f"Für {len(zero_months)} Monat(e) liegen keine Verbrauchsdaten vor. Die Datenlücken sollten geschlossen werden.",
                "severity": "mittel",
                "category": "data_quality",
            })

        return findings

    async def _generate_recommendations(
        self, findings: list[dict], snapshot: dict | None = None
    ) -> list[dict]:
        """Empfehlungen basierend auf Befunden generieren, inkl. Einsparpotenzial-Schätzung."""
        recommendations = []
        total_kwh = float((snapshot or {}).get("total_consumption_kwh", 0))
        top_consumers = (snapshot or {}).get("top_consumers", [])
        top_kwh = float(top_consumers[0]["consumption_kwh"]) if top_consumers else 0

        for finding in findings:
            if finding.get("category") == "energy_mix":
                # Einsparpotenzial: ca. 10% durch Diversifizierung / Eigenproduktion (konservativ)
                savings = round(total_kwh * 0.10) if total_kwh > 0 else None
                recommendations.append({
                    "title": "Energiemix diversifizieren",
                    "description": (
                        "Prüfen Sie den Einsatz erneuerbarer Energien (PV-Anlage, Wärmepumpe) "
                        "um die Abhängigkeit von einem Energieträger zu reduzieren. "
                        "Eine 10-kWp-PV-Anlage erzeugt typischerweise ca. 9.500 kWh/a."
                    ),
                    "priority": "mittel",
                    "savings_kwh": savings,
                    "savings_note": "Schätzung: ~10% Eigenerzeugungspotenzial",
                })
            elif finding.get("category") == "co2" and finding.get("severity") == "hoch":
                # Einsparpotenzial: 15% durch Effizienzmaßnahmen (LED, Heizungsopt., Dämmung)
                savings = round(total_kwh * 0.15) if total_kwh > 0 else None
                recommendations.append({
                    "title": "CO₂-Reduktionsmaßnahmen einleiten",
                    "description": (
                        "Angesichts steigender Emissionen sollten kurzfristige Maßnahmen "
                        "(LED-Umrüstung ca. 50–70% Strom, Heizungsoptimierung ca. 10–15%) "
                        "sowie mittelfristige Investitionen (Gebäudedämmung, PV) geprüft werden."
                    ),
                    "priority": "hoch",
                    "savings_kwh": savings,
                    "savings_note": "Schätzung: ~15% durch kombinierte Effizienzmaßnahmen",
                })
            elif finding.get("category") == "data_quality":
                recommendations.append({
                    "title": "Datenerfassung verbessern",
                    "description": (
                        "Automatisierte Zählerablesung (Smart Meter, Shelly) implementieren "
                        "um Datenlücken zu vermeiden und die Messdatenqualität zu erhöhen."
                    ),
                    "priority": "hoch",
                    "savings_kwh": None,
                    "savings_note": None,
                })

        # Immer: Top-Verbraucher-Optimierung vorschlagen wenn vorhanden und signifikant
        if top_kwh > 0 and total_kwh > 0 and (top_kwh / total_kwh) > 0.30:
            top_name = top_consumers[0].get("name", "Hauptverbraucher")
            energy_type = top_consumers[0].get("energy_type", "")
            # Einsparschätzung je Energietyp: 10-20% Optimierungspotenzial
            factor = 0.20 if energy_type == "electricity" else 0.12
            savings = round(top_kwh * factor)
            recommendations.append({
                "title": f"Optimierung: {top_name}",
                "description": (
                    f"{top_name} ist mit {top_kwh:,.0f} kWh der größte Einzelverbraucher. "
                    f"Durch Betriebsoptimierung (Lastspitzen vermeiden, Bedarfsregelung, "
                    f"{'Frequenzumrichter / LED-Optimierung' if energy_type == 'electricity' else 'Dämmung / Thermostatregelung'}) "
                    f"lassen sich erfahrungsgemäß {int(factor * 100)}% einsparen."
                ),
                "priority": "hoch",
                "savings_kwh": savings,
                "savings_note": f"Schätzung: ~{int(factor * 100)}% Optimierungspotenzial am Hauptverbraucher",
            })

        return recommendations

    async def _create_sustainability_snapshot(self) -> dict:
        """
        ISO 50001 Nachhaltigkeitsdaten für den Bericht:
        Energieziele, Aktionspläne, EnPI, Gebäudedaten, CO₂-Historie.
        """
        from sqlalchemy.orm import selectinload

        from app.models.energy_review import (
            EnergyBaseline,
            EnergyPerformanceIndicator,
            EnPIValue,
        )
        from app.models.iso import ActionPlan, EnergyObjective
        from app.models.site import Building

        result: dict = {}

        # ── 1. Energieziele mit Aktionsplänen ──
        obj_result = await self.db.execute(
            select(EnergyObjective)
            .options(selectinload(EnergyObjective.action_plans))
            .order_by(EnergyObjective.target_date)
        )
        objectives = list(obj_result.scalars().all())

        STATUS_LABELS = {
            "planned": "Geplant",
            "in_progress": "In Umsetzung",
            "completed": "Abgeschlossen",
            "cancelled": "Abgebrochen",
            "on_hold": "Pausiert",
        }

        objectives_data = []
        for obj in objectives:
            total_savings_kwh = 0.0
            total_savings_eur = 0.0
            total_savings_co2_kg = 0.0
            actions = []
            for action in obj.action_plans:
                total_savings_kwh += float(action.expected_savings_kwh or 0)
                total_savings_eur += float(action.expected_savings_eur or 0)
                total_savings_co2_kg += float(action.expected_savings_co2_kg or 0)
                actions.append({
                    "title": action.title,
                    "responsible": action.responsible_person,
                    "status": action.status,
                    "status_label": STATUS_LABELS.get(action.status, action.status),
                    "target_date": action.target_date.isoformat() if action.target_date else None,
                    "savings_kwh": float(action.expected_savings_kwh or 0),
                    "savings_eur": float(action.expected_savings_eur or 0),
                    "savings_co2_kg": float(action.expected_savings_co2_kg or 0),
                })

            # Fortschritt berechnen
            progress = float(obj.progress_percent) if obj.progress_percent else None
            current = float(obj.current_value) if obj.current_value else None
            baseline = float(obj.baseline_value) if obj.baseline_value else 0.0

            objectives_data.append({
                "title": obj.title,
                "description": obj.description,
                "target_type": obj.target_type,
                "target_value": float(obj.target_value),
                "target_unit": obj.target_unit,
                "baseline_value": baseline,
                "baseline_period": obj.baseline_period,
                "target_date": obj.target_date.isoformat() if obj.target_date else None,
                "responsible": obj.responsible_person,
                "status": obj.status,
                "status_label": STATUS_LABELS.get(obj.status, obj.status),
                "current_value": current,
                "progress_percent": progress,
                "actions": actions,
                "total_savings_kwh": total_savings_kwh,
                "total_savings_eur": total_savings_eur,
                "total_savings_co2_kg": total_savings_co2_kg,
            })
        result["objectives"] = objectives_data

        # ── 2. EnPI mit aktuellstem Wert und aktiver Baseline ──
        enpi_result = await self.db.execute(
            select(EnergyPerformanceIndicator)
            .where(EnergyPerformanceIndicator.is_active == True)  # noqa: E712
            .options(
                selectinload(EnergyPerformanceIndicator.values),
                selectinload(EnergyPerformanceIndicator.baselines),
            )
            .order_by(EnergyPerformanceIndicator.name)
        )
        enpis = list(enpi_result.scalars().all())

        enpi_data = []
        for enpi in enpis:
            # Letzten bekannten Wert
            latest_value = None
            if enpi.values:
                latest = max(enpi.values, key=lambda v: v.period_end)
                latest_value = float(latest.enpi_value)

            # Aktive Baseline
            current_baseline = None
            active_baselines = [b for b in enpi.baselines if b.is_current]
            if active_baselines:
                current_baseline = float(active_baselines[0].baseline_value)

            target = float(enpi.target_value) if enpi.target_value else None

            # Ampel-Status
            ampel = "grau"
            if latest_value is not None and target is not None:
                if enpi.target_direction == "lower":
                    ampel = "gruen" if latest_value <= target else "rot"
                else:
                    ampel = "gruen" if latest_value >= target else "rot"

            enpi_data.append({
                "name": enpi.name,
                "description": enpi.description,
                "unit": enpi.unit,
                "formula_type": enpi.formula_type,
                "target_value": target,
                "target_direction": enpi.target_direction,
                "latest_value": latest_value,
                "baseline_value": current_baseline,
                "ampel": ampel,
            })
        result["enpis"] = enpi_data

        # ── 3. Gebäudedaten mit building_type ──
        BUILDING_TYPE_LABELS: dict[str, str] = {
            "residential": "Wohngebäude",
            "office": "Bürogebäude",
            "industrial": "Industriegebäude",
            "commercial": "Gewerbegebäude",
            "educational": "Bildungseinrichtung",
            "healthcare": "Gesundheitseinrichtung",
            "hotel": "Hotel / Beherbergung",
            "retail": "Einzelhandel",
            "other": "Sonstiges Gebäude",
        }

        buildings_result = await self.db.execute(
            select(Building).where(Building.is_active == True)  # noqa: E712
        )
        buildings = list(buildings_result.scalars().all())

        total_area_m2 = 0.0
        buildings_data = []
        for b in buildings:
            area = float(b.gross_floor_area_m2 or 0)
            total_area_m2 += area
            buildings_data.append({
                "name": b.name,
                "building_type": b.building_type,
                "building_type_label": BUILDING_TYPE_LABELS.get(
                    b.building_type or "", b.building_type or "Unbekannt"
                ),
                "area_m2": area,
                "building_year": b.building_year,
                "energy_certificate_class": b.energy_certificate_class,
            })
        result["buildings"] = buildings_data
        result["total_area_m2"] = total_area_m2

        # ── 4. CO₂-Verlauf nach Kalenderjahr ──
        try:
            from sqlalchemy import extract
            co2_hist = await self.db.execute(
                select(
                    extract("year", CO2Calculation.period_start).label("year"),
                    func.sum(CO2Calculation.co2_kg).label("co2_kg"),
                )
                .group_by(extract("year", CO2Calculation.period_start))
                .order_by(extract("year", CO2Calculation.period_start))
            )
            result["co2_history"] = [
                {"year": int(row.year), "co2_kg": float(row.co2_kg or 0)}
                for row in co2_hist.all()
            ]
        except Exception as e:
            logger.warning("sustainability_co2_history_failed", error=str(e))
            result["co2_history"] = []

        # ── 5. KVP-Daten (Kontinuierliche Verbesserung) ──
        try:
            from app.models.iso import InternalAudit, ManagementReview, Nonconformity

            nc_result = await self.db.execute(
                select(func.count(Nonconformity.id)).where(
                    Nonconformity.status != "closed"
                )
            )
            open_nc = nc_result.scalar() or 0

            nc_closed_result = await self.db.execute(
                select(func.count(Nonconformity.id)).where(
                    Nonconformity.status == "closed"
                )
            )
            closed_nc = nc_closed_result.scalar() or 0

            audit_result = await self.db.execute(
                select(func.count(InternalAudit.id))
            )
            total_audits = audit_result.scalar() or 0

            mr_result = await self.db.execute(
                select(ManagementReview.review_date)
                .order_by(ManagementReview.review_date.desc())
                .limit(1)
            )
            mr_row = mr_result.first()
            last_review = mr_row[0].isoformat() if mr_row and mr_row[0] else None

            result["kvp"] = {
                "open_nonconformities": open_nc,
                "closed_nonconformities": closed_nc,
                "total_audits": total_audits,
                "last_review_date": last_review,
            }
        except Exception as e:
            logger.warning("sustainability_kvp_failed", error=str(e))
            result["kvp"] = {}

        return result

    async def _create_energy_yoy_table(
        self,
        start: date,
        end: date,
        meter_ids: list[uuid.UUID] | None,
        energy_by_type: dict,
    ) -> list[dict]:
        """
        Vorjahresvergleich nach Energieträger für die Berichtstabelle.
        Gibt [{energy_type, label, unit, prev_native, curr_native, prev_kwh, curr_kwh, delta_pct}]
        """
        from app.models.meter import Meter

        try:
            prev_start = start.replace(year=start.year - 1)
            prev_end = end.replace(year=end.year - 1)
        except ValueError:
            prev_start = start - timedelta(days=365)
            prev_end = end - timedelta(days=365)

        prev_start_dt = datetime.combine(prev_start, datetime.min.time(), tzinfo=timezone.utc)
        prev_end_dt = datetime.combine(prev_end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)

        result = []
        for et_key, et_data in energy_by_type.items():
            curr_kwh = et_data.get("total_kwh_equiv", 0.0)
            curr_native = et_data.get("total_native", 0.0)
            unit = et_data.get("unit", "kWh")
            label = et_data.get("label", et_key)

            q = (
                select(Meter.unit, func.sum(MeterReading.consumption).label("total"))
                .join(MeterReading, MeterReading.meter_id == Meter.id)
                .where(
                    Meter.is_active == True,  # noqa: E712
                    Meter.energy_type == et_key,
                    MeterReading.timestamp >= prev_start_dt,
                    MeterReading.timestamp < prev_end_dt,
                )
                .group_by(Meter.unit)
            )
            if meter_ids:
                q = q.where(Meter.id.in_(meter_ids))

            q_result = await self.db.execute(q)
            prev_kwh = 0.0
            prev_native = 0.0
            for row in q_result.all():
                conv = float(CONVERSION_FACTORS.get(row.unit, Decimal("1")))
                prev_kwh += float(row.total or 0) * conv
                if row.unit == unit:
                    prev_native += float(row.total or 0)

            delta_pct = None
            if prev_kwh > 0:
                delta_pct = round((curr_kwh - prev_kwh) / prev_kwh * 100, 1)

            result.append({
                "energy_type": et_key,
                "label": label,
                "unit": unit,
                "prev_native": round(prev_native, 1),
                "curr_native": round(curr_native, 1),
                "prev_kwh": round(prev_kwh, 1),
                "curr_kwh": round(curr_kwh, 1),
                "delta_pct": delta_pct,
            })

        return result

    async def _create_consumer_categories(
        self,
        start: date,
        end: date,
        meter_ids: list[uuid.UUID] | None,
    ) -> list[dict]:
        """Verbrauch nach Consumer-Kategorien (Produktionsbereiche)."""
        from sqlalchemy.orm import selectinload

        from app.models.consumer import Consumer

        CATEGORY_LABELS: dict[str, str] = {
            "production": "Produktion",
            "building": "Gebäude/Heizung",
            "administration": "Verwaltung",
            "lighting": "Beleuchtung",
            "hvac": "Klima/Lüftung",
            "compressed_air": "Druckluft",
            "cooling": "Kälteerzeugung",
            "it": "IT/Rechenzentrum",
            "other": "Sonstiges",
        }

        start_dt = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)
        end_dt = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)

        consumers_result = await self.db.execute(
            select(Consumer)
            .options(selectinload(Consumer.meters))
            .where(Consumer.is_active == True)  # noqa: E712
        )
        consumers = list(consumers_result.scalars().all())

        category_kwh: dict[str, float] = {}
        total_kwh = 0.0

        for consumer in consumers:
            consumer_kwh = 0.0
            for meter in consumer.meters:
                if not getattr(meter, "is_active", True):
                    continue
                if meter_ids and meter.id not in meter_ids:
                    continue
                cons_result = await self.db.execute(
                    select(func.sum(MeterReading.consumption)).where(
                        MeterReading.meter_id == meter.id,
                        MeterReading.timestamp >= start_dt,
                        MeterReading.timestamp < end_dt,
                    )
                )
                raw = float(cons_result.scalar() or 0)
                conv = float(CONVERSION_FACTORS.get(getattr(meter, "unit", "kWh") or "kWh", Decimal("1")))
                consumer_kwh += raw * conv

            cat = getattr(consumer, "category", None) or "other"
            category_kwh[cat] = category_kwh.get(cat, 0) + consumer_kwh
            total_kwh += consumer_kwh

        if total_kwh == 0:
            return []

        return [
            {
                "category": cat,
                "label": CATEGORY_LABELS.get(cat, cat),
                "kwh": round(kwh, 1),
                "pct": round(kwh / total_kwh * 100, 1),
            }
            for cat, kwh in sorted(category_kwh.items(), key=lambda x: -x[1])
            if kwh > 0
        ]

    async def _create_amortization_summary(self) -> list[dict]:
        """Amortisationsübersicht für den PDF-Bericht."""
        from app.services.economics_service import EconomicsService

        try:
            svc = EconomicsService(self.db)
            items = await svc.get_amortization_overview()
            return [
                {
                    "title": item.get("title", ""),
                    "type": item.get("type", ""),
                    "investment": item.get("investment", 0),
                    "annual_savings_net": item.get("annual_savings_net", 0),
                    "simple_payback_years": item.get("simple_payback_years"),
                    "npv": item.get("npv"),
                    "roi_pct": item.get("roi_pct"),
                    "profitable": item.get("profitable", False),
                    "price_source": item.get("price_source", "fallback"),
                }
                for item in items
            ]
        except Exception as e:
            logger.warning("amortization_summary_failed", error=str(e))
            return []

    async def _generate_summary(self, snapshot: dict, co2_summary: dict | None) -> str:
        """Management-Zusammenfassung automatisch erstellen."""
        total_kwh = snapshot.get("total_consumption_kwh", 0)
        meter_count = snapshot.get("meter_count", 0)
        period = f"{snapshot.get('period_start', '')} bis {snapshot.get('period_end', '')}"

        parts = [
            f"Im Berichtszeitraum {period} wurden insgesamt {total_kwh:,.0f} kWh Energie "
            f"über {meter_count} erfasste Zähler verbraucht."
        ]

        if co2_summary:
            total_co2 = co2_summary.get("total_co2_kg", 0)
            parts.append(
                f"Die damit verbundenen CO₂-Emissionen betragen {total_co2:,.0f} kg."
            )
            trend = co2_summary.get("trend_vs_previous_year")
            if trend is not None:
                if trend > 0:
                    parts.append(
                        f"Dies entspricht einem Anstieg von {trend:.1f}% gegenüber dem Vorjahreszeitraum."
                    )
                elif trend < 0:
                    parts.append(
                        f"Dies entspricht einer Reduktion von {abs(trend):.1f}% gegenüber dem Vorjahreszeitraum."
                    )

        balance = snapshot.get("energy_balance", [])
        if balance:
            top = max(balance, key=lambda x: x["consumption_kwh"])
            _et_lbl2 = {"electricity": "Strom", "natural_gas": "Erdgas", "heating_oil": "Heizöl", "wood_pellets": "Holzpellets", "district_heating": "Fernwärme", "solar": "Solarstrom"}.get(top["energy_type"], top["energy_type"])
            parts.append(
                f"Den größten Anteil am Energieverbrauch hat {_et_lbl2} "
                f"mit {top['share_percent']:.1f}% ({top['consumption_kwh']:,.0f} kWh)."
            )

        return " ".join(parts)
