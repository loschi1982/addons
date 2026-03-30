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
        # Renderer mit Fehlerbehandlung importieren
        try:
            from app.services.reporting.chart_renderer import (
                render_bar_comparison_svg,
                render_heatmap_svg,
                render_meter_tree_svg,
                render_monthly_cost_svg,
                render_monthly_trend_svg,
                render_sankey_svg,
            )
        except ImportError as e:
            logger.warning("chart_renderer_import_failed", error=str(e))
            render_bar_comparison_svg = render_heatmap_svg = render_meter_tree_svg = None  # type: ignore[assignment]
            render_monthly_trend_svg = render_monthly_cost_svg = render_sankey_svg = None  # type: ignore[assignment]

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
        if yoy_delta_pct is not None:
            sign = "+" if yoy_delta_pct > 0 else ""
            bullets.append(
                f"Gesamtverbrauch: <strong>{total_kwh:,.0f} kWh</strong> "
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
        if top_consumers and total_kwh > 0:
            top = top_consumers[0]
            top_share = top["consumption_kwh"] / total_kwh * 100
            bullets.append(
                f"Größter Verbraucher: <strong>{top['name']}</strong> mit {top_share:.1f}&nbsp;% Anteil"
            )

        if cost_summary.get("available"):
            cost_net = cost_summary.get("total_cost_net", 0)
            cost_kwh_ct = (cost_net / total_kwh * 100) if total_kwh > 0 else 0
            bullets.append(
                f"Gesamtkosten: <strong>{cost_net:,.2f}&nbsp;€</strong> netto "
                f"({cost_kwh_ct:.1f}&nbsp;ct/kWh)"
            )

        if energy_intensity_per_unit is not None:
            bullets.append(
                f"Energieintensität: <strong>{energy_intensity_per_unit:,.1f}&nbsp;kWh/{reference_unit}</strong>"
            )
        elif energy_intensity > 0:
            bullets.append(f"Energieintensität: <strong>{energy_intensity:,.1f}&nbsp;kWh/Tag</strong>")

        bullets_html = "".join(f"<li>{b}</li>" for b in bullets)

        # ── Tabellen ──
        energy_rows = ""
        for item in snapshot.get("energy_balance", []):
            energy_rows += (
                f"<tr><td>{item.get('energy_type', '')}</td>"
                f"<td class='num'>{item.get('consumption_kwh', 0):,.1f}</td>"
                f"<td class='num'>{item.get('share_percent', 0):.1f}%</td></tr>"
            )

        co2_rows = ""
        for item in co2.get("by_energy_type", []):
            co2_rows += (
                f"<tr><td>{item.get('energy_type', '')}</td>"
                f"<td class='num'>{item.get('co2_kg', 0):,.1f}</td>"
                f"<td class='num'>{item.get('consumption_kwh', 0):,.1f}</td></tr>"
            )

        top_rows = ""
        for item in top_consumers:
            top_rows += (
                f"<tr><td>{item.get('name', '')}</td>"
                f"<td>{item.get('energy_type', '')}</td>"
                f"<td class='num'>{item.get('consumption_kwh', 0):,.1f}</td></tr>"
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

        # ── Diagramme rendern ──
        monthly_trend_svg = safe_render(
            render_monthly_trend_svg, snapshot.get("monthly_trend", []), "monthly_trend"
        )
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

        # KPI-Karten (erweitert)
        kpi_cards = f"""
        <div class="kpi-card">
            <div class="value">{total_kwh:,.0f}</div>
            <div class="unit">kWh</div>
            <div class="label">Gesamtverbrauch</div>
        </div>
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

        # ── Optionale Sektionen ──
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

        sankey_section = ""
        if sankey_svg:
            s = next_sec()
            sankey_section = f"""
<h1>{s}. Energiefluss (Sankey)</h1>
<div class="section">
    <p>Visualisierung der Energieflüsse von Bezugsquellen über Hauptzähler und Unterzähler bis zu den Verbrauchern.</p>
    <figure>{sankey_svg}</figure>
</div>"""

        tree_section = ""
        if tree_svg:
            s = next_sec()
            tree_section = f"""
<h1>{s}. Zählerstruktur</h1>
<div class="section">
    <p>Hierarchische Darstellung der erfassten Zähler.</p>
    <figure>{tree_svg}</figure>
</div>"""

        cost_section = ""
        if cost_summary.get("available"):
            cost_kwh_ct = (cost_summary.get("total_cost_net", 0) / total_kwh * 100) if total_kwh > 0 else 0
            cost_sec = next_sec()
            cost_section = f"""
<h1>{cost_sec}. Wirtschaftlichkeit</h1>
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
</div>"""

        n_analyse = next_sec()
        n_co2 = next_sec()
        n_seu = next_sec()
        n_findings = next_sec()
        n_reco = next_sec()

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

<!-- {next_sec() - 1 if False else 2}. Aktuelle Lage -->
<h1>2. Aktuelle Lage</h1>
<div class="section">
    <h2>Energiebilanz nach Tr&auml;ger</h2>
    <p>Aufschl&uuml;sselung des Gesamtverbrauchs nach Energietr&auml;ger.</p>
    <table>
        <thead>
            <tr><th>Energietr&auml;ger</th><th class="num">Verbrauch (kWh)</th><th class="num">Anteil</th></tr>
        </thead>
        <tbody>{energy_rows}</tbody>
        <tfoot>
            <tr><td>Gesamt</td><td class="num">{total_kwh:,.1f}</td><td class="num">100%</td></tr>
        </tfoot>
    </table>
    {f'<h2>Monatlicher Verbrauchsverlauf</h2><p>Verbrauch nach Monaten im Berichtszeitraum. Die gestrichelte Linie zeigt den Monatsdurchschnitt.</p><figure>{monthly_trend_svg}</figure>' if monthly_trend_svg else ''}
</div>

<!-- {n_analyse}. Analyse -->
<h1>{n_analyse}. Analyse</h1>
<div class="section">
    {analyse_section or '<p class="text-secondary">Keine Vergleichsdaten verf&uuml;gbar (Diagramme wurden nicht aktiviert).</p>'}
</div>

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

{sankey_section}
{tree_section}
{cost_section}

<!-- {n_seu}. Wesentliche Energieverbraucher -->
<h1>{n_seu}. Wesentliche Energieverbraucher (SEU)</h1>
<div class="section">
    <p>Die f&uuml;nf gr&ouml;&szlig;ten Energieverbraucher im Berichtszeitraum (Pareto-Analyse).</p>
    <table>
        <thead>
            <tr><th>Z&auml;hler</th><th>Energietyp</th><th class="num">Verbrauch (kWh)</th></tr>
        </thead>
        <tbody>{top_rows}</tbody>
    </table>
</div>

<!-- {n_findings}. Erkenntnisse -->
<h1>{n_findings}. Erkenntnisse und Befunde</h1>
<div class="section">
    {findings_html or '<p class="text-secondary">Keine besonderen Befunde.</p>'}
</div>

<!-- {n_reco}. Maßnahmen -->
<h1>{n_reco}. Ma&szlig;nahmen und Empfehlungen</h1>
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

        days_in_period = (end - start).days + 1
        energy_intensity_kwh_per_day = float(total_kwh) / days_in_period if days_in_period > 0 and total_kwh > 0 else 0

        return {
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "meter_count": len(meters),
            "total_consumption_kwh": float(total_kwh),
            "energy_balance": energy_balance,
            "top_consumers": top_consumers,
            "monthly_trend": monthly_trend,
            "energy_intensity_kwh_per_day": round(energy_intensity_kwh_per_day, 1),
            "days_in_period": days_in_period,
            "reference_value": reference_value,
            "reference_unit": reference_unit,
            "energy_intensity_per_unit": (
                round(float(total_kwh) / reference_value, 1)
                if reference_value and reference_value > 0 else None
            ),
        }

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
                meter_deltas.append({"name": name, "delta": delta})

            meter_deltas.sort(key=lambda x: abs(x["delta"]), reverse=True)
            top3 = meter_deltas[:3]
            if top3:
                parts = [
                    f"{d['name']} ({'+' if d['delta'] > 0 else ''}{d['delta']:,.0f}&nbsp;kWh)"
                    for d in top3
                ]
                bullets.append(
                    f"Haupttreiber (Jahresvergleich): {', '.join(parts)}."
                )

        # ── 3. Monatliche Peaks ──
        monthly_trend = [m for m in snapshot.get("monthly_trend", []) if m.get("consumption_kwh", 0) > 0]
        if len(monthly_trend) >= 2:
            peak = max(monthly_trend, key=lambda m: m["consumption_kwh"])
            low = min(monthly_trend, key=lambda m: m["consumption_kwh"])
            avg = sum(m["consumption_kwh"] for m in monthly_trend) / len(monthly_trend)
            peak_name = MONTH_NAMES[peak["month"] - 1]
            low_name = MONTH_NAMES[low["month"] - 1]
            peak_dev = (peak["consumption_kwh"] / avg - 1) * 100
            low_dev = (low["consumption_kwh"] / avg - 1) * 100
            bullets.append(
                f"Monatliche Verteilung: Spitzenmonat <strong>{peak_name}</strong> mit "
                f"{peak['consumption_kwh']:,.0f}&nbsp;kWh ({peak_dev:+.0f}%&nbsp;vs.&nbsp;Ø), "
                f"Niedrigstmonat <strong>{low_name}</strong> mit "
                f"{low['consumption_kwh']:,.0f}&nbsp;kWh ({low_dev:+.0f}%&nbsp;vs.&nbsp;Ø)."
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

        return {
            "available": True,
            "total_cost_net": total_cost_net,
            "total_cost_gross": total_cost_gross,
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
