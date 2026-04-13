"""
schema_report.py – PDF-Auswertung für Energieschema-Zählerstränge.

Generiert einen vollständigen HTML/PDF-Bericht für einen Zähler-Teilbaum
(Energieschema) mit Baumvisualisierung, Verbrauchstabelle und KPIs.
"""

from __future__ import annotations

import io
import uuid
from datetime import date
from pathlib import Path

import structlog

logger = structlog.get_logger()


def _flatten_tree(
    node: dict,
    parent_id: str | None = None,
    result: list[dict] | None = None,
) -> list[dict]:
    """Rekursiven Teilbaum in flache Liste für render_meter_tree_svg konvertieren."""
    if result is None:
        result = []
    result.append({
        "id": str(node["id"]),
        "name": node["name"],
        "energy_type": node.get("energy_type", ""),
        "unit": node.get("unit", "kWh"),
        "parent_id": parent_id,
        "consumption": float(node.get("consumption") or 0),
        "cost": float(node.get("cost") or 0) if node.get("cost") is not None else None,
        "unaccounted": float(node.get("unaccounted") or 0) if node.get("unaccounted") is not None else None,
        "consumers": node.get("consumers", []),
    })
    for child in node.get("children", []):
        _flatten_tree(child, str(node["id"]), result)
    return result


def _et_label(et: str) -> str:
    labels = {
        "electricity": "Strom", "natural_gas": "Erdgas", "heating_oil": "Heizöl",
        "district_heating": "Fernwärme", "district_cooling": "Fernkälte",
        "water": "Wasser", "solar": "Solarstrom", "lpg": "Flüssiggas",
        "wood_pellets": "Holzpellets", "compressed_air": "Druckluft",
        "steam": "Dampf", "other": "Sonstige",
    }
    return labels.get(et, et)


def _et_color(et: str) -> str:
    colors = {
        "electricity": "#F59E0B", "natural_gas": "#3B82F6", "heating_oil": "#8B5CF6",
        "district_heating": "#F97316", "district_cooling": "#06B6D4",
        "water": "#06B6D4", "solar": "#10B981",
    }
    return colors.get(et, "#6B7280")


def render_schema_html(
    tree: dict,
    period_start: date,
    period_end: date,
    schema_label: str | None = None,
) -> str:
    """
    HTML-Bericht für einen Zähler-Teilbaum erzeugen.

    tree: Rückgabe von MeterService.get_subtree()
    """
    # Renderer importieren
    tree_svg = ""
    try:
        from app.services.reporting.chart_renderer import render_meter_tree_svg
        flat = _flatten_tree(tree)
        tree_nodes_for_svg = [
            {"id": n["id"], "name": n["name"], "energy_type": n["energy_type"],
             "parent_id": n["parent_id"], "unit": n["unit"]}
            for n in flat
        ]
        tree_svg = render_meter_tree_svg(tree_nodes_for_svg, width=700) or ""
    except Exception as e:
        logger.warning("schema_report_tree_svg_failed", error=str(e))

    root_consumption = float(tree.get("consumption") or 0)
    root_unit = tree.get("unit", "kWh")
    root_et = tree.get("energy_type", "")
    title = schema_label or tree.get("name", "Energieschema")
    label = _et_label(root_et)
    color = _et_color(root_et)

    # Alle Knoten für Tabelle (flach, mit Verbrauchsdaten)
    all_nodes = _flatten_tree(tree)

    # Tabellen-HTML
    table_rows = ""
    for n in all_nodes:
        depth = 0
        # Einrückung anhand Parent-Kette ermitteln
        pid = n["parent_id"]
        curr = n
        while pid is not None:
            depth += 1
            parent = next((x for x in all_nodes if x["id"] == pid), None)
            if parent is None:
                break
            pid = parent["parent_id"]

        indent = "&nbsp;&nbsp;&nbsp;&nbsp;" * depth
        is_root = n["parent_id"] is None
        name_style = "font-weight:700;" if is_root else ""
        cons = n["consumption"]
        share = (cons / root_consumption * 100) if root_consumption > 0 else 0
        cost = n["cost"]
        unaccounted = n["unaccounted"]
        cons_str = f"{cons:,.1f}&nbsp;{n['unit']}"
        share_str = f"{share:.1f}%" if not is_root else "100%"
        cost_str = f"{cost:,.2f}&nbsp;€" if cost is not None and cost > 0 else "–"
        unacc_str = f"{unaccounted:,.1f}&nbsp;{n['unit']}" if unaccounted is not None and abs(unaccounted) > 0.01 else "–"
        unacc_color = "#DC2626" if unaccounted is not None and unaccounted > 0.5 else "#374151"

        consumers_html = ""
        if n["consumers"]:
            cnames = ", ".join(c.get("name", "") for c in n["consumers"][:3])
            if len(n["consumers"]) > 3:
                cnames += f" +{len(n['consumers'])-3}"
            consumers_html = f"<br/><span style='color:#6B7280;font-size:7pt'>&#x1F4CC; {cnames}</span>"

        table_rows += (
            f"<tr>"
            f"<td style='{name_style}'>{indent}{n['name']}{consumers_html}</td>"
            f"<td style='text-align:right'>{cons_str}</td>"
            f"<td style='text-align:right'>{share_str}</td>"
            f"<td style='text-align:right'>{cost_str}</td>"
            f"<td style='text-align:right;color:{unacc_color}'>{unacc_str}</td>"
            f"</tr>"
        )

    # CSS
    css = """
body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 9pt;
       color: #1F2937; margin: 0; padding: 0; }
.cover { background: #1B5E7B; color: white; padding: 48pt 40pt;
         page-break-after: always; }
.cover h1 { font-size: 24pt; margin: 0 0 8pt; }
.cover .sub { font-size: 12pt; opacity: 0.85; margin: 0 0 4pt; }
.cover .period { font-size: 10pt; opacity: 0.7; }
.cover .badge { display:inline-block; background:rgba(255,255,255,0.15);
                padding:3pt 8pt; border-radius:4pt; font-size:9pt; margin-top:12pt; }
h1.section { font-size: 14pt; color: #1B5E7B; border-bottom: 2pt solid #1B5E7B;
             padding-bottom: 4pt; margin: 20pt 0 12pt; }
.kpis { display:flex; gap:16pt; margin:0 0 16pt; flex-wrap:wrap; }
.kpi { background:#F8FAFC; border:1pt solid #E5E7EB; border-radius:6pt;
       padding:10pt 16pt; flex:1; min-width:100pt; }
.kpi .val { font-size:16pt; font-weight:700; color:#1B5E7B; }
.kpi .lbl { font-size:8pt; color:#6B7280; margin-top:2pt; }
.chart-container { margin:0 0 20pt; }
table { width:100%; border-collapse:collapse; font-size:8pt; }
th { background:#1B5E7B; color:white; padding:5pt 8pt; text-align:left;
     font-weight:600; }
th:not(:first-child) { text-align:right; }
td { padding:4pt 8pt; border-bottom:1pt solid #E5E7EB; vertical-align:top; }
tr:nth-child(even) td { background:#F9FAFB; }
.note { font-size:8pt; color:#6B7280; margin-top:8pt; }
@page { size: A4 portrait; margin: 20mm 15mm; }
"""

    # KPI-Karten
    total_cost = sum(n["cost"] for n in all_nodes if n["cost"] is not None and n["parent_id"] is None)
    meter_count = len(all_nodes)

    kpis_html = (
        f"<div class='kpis'>"
        f"<div class='kpi'><div class='val'>{root_consumption:,.1f}&nbsp;{root_unit}</div>"
        f"<div class='lbl'>Gesamtverbrauch</div></div>"
        f"<div class='kpi'><div class='val'>{meter_count}</div>"
        f"<div class='lbl'>Zähler im Strang</div></div>"
    )
    if total_cost and total_cost > 0:
        kpis_html += (
            f"<div class='kpi'><div class='val'>{total_cost:,.2f}&nbsp;€</div>"
            f"<div class='lbl'>Energiekosten (netto)</div></div>"
        )
    kpis_html += "</div>"

    svg_section = ""
    if tree_svg:
        svg_section = (
            f"<h1 class='section'>2. Zählerstruktur</h1>"
            f"<div class='chart-container'>{tree_svg}</div>"
        )

    return f"""<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>Energieschema – {title}</title>
<style>{css}</style>
</head>
<body>

<div class="cover">
  <h1>{title}</h1>
  <div class="sub">Energieschema-Auswertung &middot; {label}</div>
  <div class="period">{period_start.strftime('%d.%m.%Y')} bis {period_end.strftime('%d.%m.%Y')}</div>
  <div class="badge" style="background:rgba(255,255,255,0.2)">
    <span style="display:inline-block;width:8pt;height:8pt;border-radius:50%;
                 background:{color};margin-right:4pt;vertical-align:middle"></span>
    {label}
  </div>
</div>

<h1 class="section">1. Kennzahlen</h1>
{kpis_html}

{svg_section}

<h1 class="section">{3 if tree_svg else 2}. Verbrauch je Zähler</h1>
<table>
  <thead>
    <tr>
      <th>Zähler / Unterzähler</th>
      <th style="text-align:right">Verbrauch</th>
      <th style="text-align:right">Anteil</th>
      <th style="text-align:right">Kosten</th>
      <th style="text-align:right">Nicht zug. (&Delta;)</th>
    </tr>
  </thead>
  <tbody>
    {table_rows}
  </tbody>
</table>
<p class="note">
  Δ = Verbrauch des Elternzählers, der keinem Unterzähler zugeordnet ist (Verluste/nicht erfasste Verbr.).<br/>
  Zeitraum: {period_start.strftime('%d.%m.%Y')} – {period_end.strftime('%d.%m.%Y')}
</p>

</body>
</html>"""


async def generate_schema_pdf(
    tree: dict,
    period_start: date,
    period_end: date,
    schema_label: str | None = None,
) -> bytes:
    """HTML → PDF-Bytes via WeasyPrint."""
    html = render_schema_html(tree, period_start, period_end, schema_label)
    try:
        from weasyprint import HTML as WeasyprintHTML
        pdf_bytes = WeasyprintHTML(string=html, base_url=None).write_pdf()
        return pdf_bytes
    except ImportError:
        logger.warning("weasyprint_not_available_schema")
        return html.encode("utf-8")
