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
from sqlalchemy import func, select
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

PDF_DIR = Path(__file__).parent.parent.parent / "data" / "reports"


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

        if scope_config.get("include_heatmap") and meter_ids:
            try:
                # Heatmap für den ersten (Haupt-)Zähler
                charts["heatmap"] = await analytics.get_heatmap(
                    meter_ids[0], period_start, period_end
                )
            except Exception as e:
                logger.warning("chart_heatmap_failed", error=str(e))

        if scope_config.get("include_yoy_comparison"):
            try:
                prev_start = date(period_start.year - 1, period_start.month, period_start.day)
                prev_end = date(period_end.year - 1, period_end.month, period_end.day)
                charts["yoy_comparison"] = await analytics.get_comparison(
                    meter_ids=meter_ids,
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
            period_start, period_end, meter_ids
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
        }

        # Diagramm-Daten sammeln
        charts = await self._collect_chart_data(
            period_start, period_end, meter_ids, scope_config
        )
        if charts:
            snapshot["charts"] = charts

        # CO₂-Zusammenfassung
        co2_summary = None
        if include_co2:
            co2_summary = await self._create_co2_summary(period_start, period_end)

        # Ergebnisse und Empfehlungen generieren
        findings = await self._generate_findings(snapshot, co2_summary)
        recommendations = await self._generate_recommendations(findings)
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

        return template.render(
            report=report,
            snapshot=report.data_snapshot or {},
            co2=report.co2_summary or {},
            findings=report.findings or [],
            recommendations=report.recommendations or [],
        )

    def _render_builtin_template(self, report: AuditReport) -> str:
        """Eingebautes HTML-Template für PDF-Generierung."""
        from app.services.reporting.chart_renderer import (
            render_bar_comparison_svg,
            render_heatmap_svg,
            render_meter_tree_svg,
            render_sankey_svg,
        )

        snapshot = report.data_snapshot or {}
        co2 = report.co2_summary or {}
        findings = report.findings or []
        recommendations = report.recommendations or []
        charts = snapshot.get("charts", {})
        scope = report.scope or {}

        # Energiebilanz-Tabelle
        energy_rows = ""
        for item in snapshot.get("energy_balance", []):
            energy_rows += f"""
            <tr>
                <td>{item.get('energy_type', '')}</td>
                <td class="num">{item.get('consumption_kwh', 0):,.1f}</td>
                <td class="num">{item.get('share_percent', 0):.1f}%</td>
            </tr>"""

        # CO₂-Tabelle
        co2_rows = ""
        for item in co2.get("by_energy_type", []):
            co2_rows += f"""
            <tr>
                <td>{item.get('energy_type', '')}</td>
                <td class="num">{item.get('co2_kg', 0):,.1f}</td>
                <td class="num">{item.get('consumption_kwh', 0):,.1f}</td>
            </tr>"""

        # Top-Verbraucher
        top_rows = ""
        for item in snapshot.get("top_consumers", []):
            top_rows += f"""
            <tr>
                <td>{item.get('name', '')}</td>
                <td>{item.get('energy_type', '')}</td>
                <td class="num">{item.get('consumption_kwh', 0):,.1f}</td>
            </tr>"""

        # Befunde
        findings_html = ""
        for f in findings:
            severity_class = f.get("severity", "info")
            findings_html += f"""
            <div class="finding {severity_class}">
                <strong>{f.get('title', '')}</strong>
                <p>{f.get('description', '')}</p>
            </div>"""

        # Empfehlungen
        reco_html = ""
        for r in recommendations:
            reco_html += f"""
            <div class="recommendation">
                <strong>{r.get('title', '')}</strong>
                <p>{r.get('description', '')}</p>
                {f'<p class="savings">Einsparpotenzial: {r.get("savings_kwh", 0):,.0f} kWh/a</p>' if r.get('savings_kwh') else ''}
            </div>"""

        total_kwh = snapshot.get("total_consumption_kwh", 0)
        total_co2 = co2.get("total_co2_kg", 0)
        meter_count = snapshot.get("meter_count", 0)

        # ── Diagramm-Sektionen rendern ──
        chart_sections = ""
        section_num = 4  # Nächste Kapitelnummer nach Energiebilanz, CO₂, SEU

        if charts.get("meter_tree"):
            tree_svg = render_meter_tree_svg(charts["meter_tree"])
            if tree_svg:
                section_num += 1
                chart_sections += f"""
<h1>{section_num}. Zählerstruktur</h1>
<div class="section">
    <p>Hierarchische Darstellung der erfassten Zähler und deren Zuordnung.</p>
    <figure>{tree_svg}</figure>
</div>"""

        if charts.get("sankey"):
            sankey_svg = render_sankey_svg(charts["sankey"])
            if sankey_svg:
                section_num += 1
                chart_sections += f"""
<h1>{section_num}. Energiefluss (Sankey)</h1>
<div class="section">
    <p>Visualisierung der Energieflüsse von Bezugsquellen über Hauptzähler und Unterzähler bis zu den Verbrauchern.</p>
    <figure>{sankey_svg}</figure>
</div>"""

        if charts.get("heatmap"):
            heatmap_svg = render_heatmap_svg(charts["heatmap"])
            if heatmap_svg:
                section_num += 1
                chart_sections += f"""
<h1>{section_num}. Lastprofil (Heatmap)</h1>
<div class="section">
    <p>Durchschnittlicher Verbrauch nach Wochentag und Tageszeit. Dunklere Bereiche zeigen höheren Verbrauch.</p>
    <figure>{heatmap_svg}</figure>
</div>"""

        if charts.get("yoy_comparison"):
            yoy_svg = render_bar_comparison_svg(charts["yoy_comparison"])
            if yoy_svg:
                section_num += 1
                chart_sections += f"""
<h1>{section_num}. Jahresvergleich</h1>
<div class="section">
    <p>Monatlicher Verbrauchsvergleich mit dem Vorjahreszeitraum.</p>
    <figure>{yoy_svg}</figure>
</div>"""

        # Befunde/Empfehlungen-Nummer dynamisch
        findings_num = section_num + 1
        reco_num = section_num + 2

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
    @bottom-center {{ content: "Energiebericht {report.period_start} – {report.period_end}"; font-size: 7pt; color: #6B7280; }}
}}
@page cover {{ margin: 0; }}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{ font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; font-size: 10pt; color: #1F2937; line-height: 1.5; }}

/* Deckblatt */
.cover {{ page: cover; height: 297mm; display: flex; flex-direction: column; justify-content: center; align-items: center; background: linear-gradient(135deg, #1B5E7B 0%, #2A8CB5 100%); color: white; text-align: center; }}
.cover h1 {{ font-size: 28pt; margin-bottom: 12pt; }}
.cover .subtitle {{ font-size: 16pt; opacity: 0.9; }}
.cover .period {{ font-size: 12pt; margin-top: 24pt; opacity: 0.7; }}
.cover .meta {{ margin-top: 48pt; font-size: 9pt; opacity: 0.6; }}
.cover .scope {{ margin-top: 12pt; font-size: 10pt; opacity: 0.8; }}

/* Überschriften */
h1 {{ font-size: 18pt; color: #1B5E7B; border-bottom: 2px solid #1B5E7B; padding-bottom: 6pt; margin: 24pt 0 12pt 0; page-break-before: always; }}
h1:first-of-type {{ page-break-before: auto; }}
h2 {{ font-size: 14pt; color: #1B5E7B; margin: 18pt 0 8pt 0; }}
h3 {{ font-size: 12pt; color: #374151; margin: 12pt 0 6pt 0; }}

/* KPI-Karten */
.kpi-row {{ display: flex; gap: 12pt; margin: 12pt 0; page-break-inside: avoid; }}
.kpi-card {{ flex: 1; border: 1px solid #D1D5DB; border-radius: 6pt; padding: 12pt; text-align: center; }}
.kpi-card .value {{ font-size: 24pt; font-weight: 700; color: #1B5E7B; }}
.kpi-card .label {{ font-size: 9pt; color: #6B7280; margin-top: 4pt; }}
.kpi-card .unit {{ font-size: 9pt; color: #9CA3AF; }}

/* Tabellen */
table {{ width: 100%; border-collapse: collapse; margin: 8pt 0; font-size: 9pt; }}
thead th {{ background: #1B5E7B; color: white; padding: 6pt 8pt; text-align: left; font-weight: 600; }}
tbody td {{ padding: 5pt 8pt; border-bottom: 1px solid #E5E7EB; }}
tbody tr:nth-child(even) {{ background: #F9FAFB; }}
.num {{ text-align: right; font-variant-numeric: tabular-nums; }}
tfoot td {{ font-weight: 700; border-top: 2px solid #1B5E7B; padding: 6pt 8pt; }}

/* Befunde & Empfehlungen */
.finding, .recommendation {{ border-left: 4px solid #D1D5DB; padding: 8pt 12pt; margin: 8pt 0; background: #F9FAFB; border-radius: 0 4pt 4pt 0; }}
.finding.hoch {{ border-left-color: #DC2626; }}
.finding.mittel {{ border-left-color: #D97706; }}
.finding.niedrig {{ border-left-color: #16A34A; }}
.recommendation {{ border-left-color: #1B5E7B; }}
.savings {{ color: #16A34A; font-weight: 600; font-size: 9pt; margin-top: 4pt; }}

/* Diagramme */
figure {{ page-break-inside: avoid; margin: 12pt 0; }}
figure svg {{ max-width: 100%; height: auto; }}

/* Sonstige */
p {{ margin: 6pt 0; }}
.text-secondary {{ color: #6B7280; }}
.section {{ margin-bottom: 18pt; }}
</style>
</head>
<body>

<!-- Deckblatt -->
<div class="cover">
    <h1>{report.title}</h1>
    <div class="subtitle">Energiebericht nach ISO 50001</div>
    <div class="period">{report.period_start} bis {report.period_end}</div>
    <div class="meta">Erstellt am {report.generated_at.strftime('%d.%m.%Y') if report.generated_at else ''}</div>
</div>

<!-- Management-Zusammenfassung -->
<h1>1. Management-Zusammenfassung</h1>
<div class="section">
    <p>{report.summary or 'Keine Zusammenfassung verfügbar.'}</p>
    <div class="kpi-row">
        <div class="kpi-card">
            <div class="value">{total_kwh:,.0f}</div>
            <div class="unit">kWh</div>
            <div class="label">Gesamtverbrauch</div>
        </div>
        <div class="kpi-card">
            <div class="value">{total_co2:,.0f}</div>
            <div class="unit">kg CO₂</div>
            <div class="label">CO₂-Emissionen</div>
        </div>
        <div class="kpi-card">
            <div class="value">{meter_count}</div>
            <div class="unit">Stk.</div>
            <div class="label">Erfasste Zähler</div>
        </div>
    </div>
</div>

<!-- Energiebilanz -->
<h1>2. Energiebilanz</h1>
<div class="section">
    <p>Aufschlüsselung des Gesamtverbrauchs nach Energieträger im Berichtszeitraum.</p>
    <table>
        <thead>
            <tr><th>Energieträger</th><th class="num">Verbrauch (kWh)</th><th class="num">Anteil</th></tr>
        </thead>
        <tbody>{energy_rows}</tbody>
        <tfoot>
            <tr><td>Gesamt</td><td class="num">{total_kwh:,.1f}</td><td class="num">100%</td></tr>
        </tfoot>
    </table>
</div>

<!-- CO₂-Bilanz -->
<h1>3. CO₂-Bilanz</h1>
<div class="section">
    <p>CO₂-Emissionen nach Energieträger und Scope-Aufschlüsselung.</p>
    <table>
        <thead>
            <tr><th>Energieträger</th><th class="num">CO₂ (kg)</th><th class="num">Verbrauch (kWh)</th></tr>
        </thead>
        <tbody>{co2_rows}</tbody>
        <tfoot>
            <tr><td>Gesamt</td><td class="num">{total_co2:,.1f}</td><td class="num">{total_kwh:,.1f}</td></tr>
        </tfoot>
    </table>
</div>

<!-- Top-Verbraucher -->
<h1>4. Wesentliche Energieverbraucher (SEU)</h1>
<div class="section">
    <p>Die fünf größten Energieverbraucher im Berichtszeitraum (Pareto-Analyse).</p>
    <table>
        <thead>
            <tr><th>Zähler</th><th>Energietyp</th><th class="num">Verbrauch (kWh)</th></tr>
        </thead>
        <tbody>{top_rows}</tbody>
    </table>
</div>

<!-- Diagramm-Sektionen (dynamisch) -->
{chart_sections}

<!-- Befunde -->
<h1>{findings_num}. Erkenntnisse und Befunde</h1>
<div class="section">
    {findings_html or '<p class="text-secondary">Keine besonderen Befunde.</p>'}
</div>

<!-- Empfehlungen -->
<h1>{reco_num}. Maßnahmen und Empfehlungen</h1>
<div class="section">
    {reco_html or '<p class="text-secondary">Keine Empfehlungen generiert.</p>'}
</div>

</body>
</html>"""

    # ── Daten-Snapshot ──

    async def _create_data_snapshot(
        self,
        start: date,
        end: date,
        meter_ids: list[uuid.UUID] | None = None,
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
                "consumption_kwh": float(kwh),
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

        return {
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "meter_count": len(meters),
            "total_consumption_kwh": float(total_kwh),
            "energy_balance": energy_balance,
            "top_consumers": top_consumers,
            "monthly_trend": monthly_trend,
        }

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
                findings.append({
                    "title": f"Hohe Abhängigkeit von {top['energy_type']}",
                    "description": f"Der Energieträger {top['energy_type']} macht {top['share_percent']:.1f}% des Gesamtverbrauchs aus. Eine Diversifizierung sollte geprüft werden.",
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

    async def _generate_recommendations(self, findings: list[dict]) -> list[dict]:
        """Empfehlungen basierend auf Befunden generieren."""
        recommendations = []

        for finding in findings:
            if finding.get("category") == "energy_mix":
                recommendations.append({
                    "title": "Energiemix diversifizieren",
                    "description": "Prüfen Sie den Einsatz erneuerbarer Energien (PV-Anlage, Wärmepumpe) um die Abhängigkeit von einem Energieträger zu reduzieren.",
                    "priority": "mittel",
                    "savings_kwh": None,
                })
            elif finding.get("category") == "co2" and finding.get("severity") == "hoch":
                recommendations.append({
                    "title": "CO₂-Reduktionsmaßnahmen einleiten",
                    "description": "Angesichts steigender Emissionen sollten kurzfristige Maßnahmen (LED-Umrüstung, Heizungsoptimierung) sowie mittelfristige Investitionen (Gebäudedämmung, PV) geprüft werden.",
                    "priority": "hoch",
                    "savings_kwh": None,
                })
            elif finding.get("category") == "data_quality":
                recommendations.append({
                    "title": "Datenerfassung verbessern",
                    "description": "Automatisierte Zählerablesung (Smart Meter, Shelly) implementieren um Datenlücken zu vermeiden.",
                    "priority": "hoch",
                    "savings_kwh": None,
                })

        return recommendations

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
            parts.append(
                f"Den größten Anteil am Energieverbrauch hat {top['energy_type']} "
                f"mit {top['share_percent']:.1f}% ({top['consumption_kwh']:,.0f} kWh)."
            )

        return " ".join(parts)
