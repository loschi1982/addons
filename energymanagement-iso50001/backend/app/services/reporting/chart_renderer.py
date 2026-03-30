"""
chart_renderer.py – SVG-Diagramme für PDF-Berichte.

Rendert Diagramme als inline-SVG-Strings, die direkt in
HTML-Templates eingebettet werden können (WeasyPrint-kompatibel).
"""

import io
import math
from typing import Any

import structlog

logger = structlog.get_logger()

# Farbpalette (Petrol-Töne + Akzentfarben)
COLORS = [
    "#1B5E7B", "#2A8CB5", "#4CAF50", "#FF9800", "#E91E63",
    "#9C27B0", "#00BCD4", "#795548", "#607D8B", "#F44336",
]

MONTH_LABELS = [
    "Jan", "Feb", "Mär", "Apr", "Mai", "Jun",
    "Jul", "Aug", "Sep", "Okt", "Nov", "Dez",
]

WEEKDAY_LABELS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]


def render_heatmap_svg(heatmap_data: list[dict], width: int = 600, height: int = 220) -> str:
    """
    Heatmap als SVG rendern: Stunde (x) × Wochentag (y).

    heatmap_data: Liste von {weekday, hour, value, ...}
    """
    if not heatmap_data:
        return ""

    margin_left = 30
    margin_top = 25
    margin_right = 60  # Platz für Legende
    margin_bottom = 20
    cell_w = (width - margin_left - margin_right) / 24
    cell_h = (height - margin_top - margin_bottom) / 7

    values = [d.get("value", 0) for d in heatmap_data]
    max_val = max(values) if values else 1
    if max_val == 0:
        max_val = 1

    # Daten in Matrix umwandeln
    matrix: dict[tuple[int, int], float] = {}
    for d in heatmap_data:
        matrix[(int(d["weekday"]), int(d["hour"]))] = d.get("value", 0)

    svg_parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'style="width:{width}px;height:{height}px;font-family:Arial,sans-serif;font-size:8px">'
    ]

    # Zellen zeichnen
    for wd in range(7):
        for hr in range(24):
            val = matrix.get((wd, hr), 0)
            intensity = val / max_val
            # Farbverlauf: Weiß → Petrol
            r_c = int(255 - intensity * (255 - 27))
            g_c = int(255 - intensity * (255 - 94))
            b_c = int(255 - intensity * (255 - 123))
            x = margin_left + hr * cell_w
            y = margin_top + wd * cell_h
            svg_parts.append(
                f'<rect x="{x:.1f}" y="{y:.1f}" width="{cell_w:.1f}" height="{cell_h:.1f}" '
                f'fill="rgb({r_c},{g_c},{b_c})" stroke="white" stroke-width="1"/>'
            )

    # Y-Achse: Wochentage
    for wd in range(7):
        y = margin_top + wd * cell_h + cell_h / 2 + 3
        svg_parts.append(
            f'<text x="{margin_left - 4}" y="{y:.1f}" text-anchor="end" fill="#374151">'
            f'{WEEKDAY_LABELS[wd]}</text>'
        )

    # X-Achse: Stunden (nur jede 3.)
    for hr in range(0, 24, 3):
        x = margin_left + hr * cell_w + cell_w / 2
        y = margin_top - 5
        svg_parts.append(
            f'<text x="{x:.1f}" y="{y:.1f}" text-anchor="middle" fill="#374151">{hr}h</text>'
        )

    # Legende
    legend_x = width - margin_right + 10
    legend_h = height - margin_top - margin_bottom
    for i in range(10):
        frac = i / 9
        r_c = int(255 - frac * (255 - 27))
        g_c = int(255 - frac * (255 - 94))
        b_c = int(255 - frac * (255 - 123))
        ly = margin_top + (9 - i) * (legend_h / 10)
        svg_parts.append(
            f'<rect x="{legend_x}" y="{ly:.1f}" width="12" height="{legend_h / 10 + 1:.1f}" '
            f'fill="rgb({r_c},{g_c},{b_c})"/>'
        )
    svg_parts.append(
        f'<text x="{legend_x + 16}" y="{margin_top + 6}" fill="#374151">{max_val:.1f}</text>'
    )
    svg_parts.append(
        f'<text x="{legend_x + 16}" y="{height - margin_bottom}" fill="#374151">0</text>'
    )

    svg_parts.append("</svg>")
    return "\n".join(svg_parts)


def render_bar_comparison_svg(
    comparison_data: dict,
    width: int = 600,
    height: int = 300,
) -> str:
    """
    Jahresvergleich als gruppiertes Balkendiagramm.

    comparison_data: {period1: {start, end, data: {meter_id: [{period, value}]}},
                      period2: {start, end, data: {meter_id: [{period, value}]}}}
    """
    if not comparison_data:
        return ""

    p1 = comparison_data.get("period1", {})
    p2 = comparison_data.get("period2", {})
    p1_data = p1.get("data", {})
    p2_data = p2.get("data", {})

    # Monatliche Summen bilden
    def monthly_sums(data: dict) -> dict[int, float]:
        sums: dict[int, float] = {}
        for meter_entries in data.values():
            for entry in meter_entries:
                period_str = entry.get("period", "")
                if not period_str:
                    continue
                try:
                    month = int(period_str[5:7])
                except (ValueError, IndexError):
                    continue
                sums[month] = sums.get(month, 0) + entry.get("value", 0)
        return sums

    sums1 = monthly_sums(p1_data)
    sums2 = monthly_sums(p2_data)
    all_months = sorted(set(list(sums1.keys()) + list(sums2.keys())))

    if not all_months:
        return ""

    margin_left = 60
    margin_top = 30
    margin_bottom = 40
    margin_right = 20
    chart_w = width - margin_left - margin_right
    chart_h = height - margin_top - margin_bottom

    max_val = max(
        max(sums1.values(), default=0),
        max(sums2.values(), default=0),
    )
    if max_val == 0:
        max_val = 1

    group_width = chart_w / len(all_months)
    bar_width = group_width * 0.35

    p1_label = p1.get("start", "")[:4] if p1.get("start") else "Vorjahr"
    p2_label = p2.get("start", "")[:4] if p2.get("start") else "Aktuell"

    svg_parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'style="width:{width}px;height:{height}px;font-family:Arial,sans-serif;font-size:9px">'
    ]

    # Y-Achse Linien
    for i in range(5):
        y = margin_top + chart_h * (1 - i / 4)
        val = max_val * i / 4
        svg_parts.append(
            f'<line x1="{margin_left}" y1="{y:.1f}" x2="{width - margin_right}" '
            f'y2="{y:.1f}" stroke="#E5E7EB"/>'
        )
        svg_parts.append(
            f'<text x="{margin_left - 5}" y="{y + 3:.1f}" text-anchor="end" fill="#6B7280">'
            f'{val:,.0f}</text>'
        )

    # Balken
    for idx, month in enumerate(all_months):
        x_group = margin_left + idx * group_width
        v1 = sums1.get(month, 0)
        v2 = sums2.get(month, 0)
        h1 = (v1 / max_val) * chart_h
        h2 = (v2 / max_val) * chart_h

        # Vorjahr (grau)
        svg_parts.append(
            f'<rect x="{x_group + group_width * 0.1:.1f}" '
            f'y="{margin_top + chart_h - h1:.1f}" '
            f'width="{bar_width:.1f}" height="{h1:.1f}" fill="#9CA3AF" rx="2"/>'
        )
        # Aktuell (petrol)
        svg_parts.append(
            f'<rect x="{x_group + group_width * 0.1 + bar_width + 2:.1f}" '
            f'y="{margin_top + chart_h - h2:.1f}" '
            f'width="{bar_width:.1f}" height="{h2:.1f}" fill="#1B5E7B" rx="2"/>'
        )
        # Monatslabel
        label_x = x_group + group_width / 2
        svg_parts.append(
            f'<text x="{label_x:.1f}" y="{height - margin_bottom + 15}" '
            f'text-anchor="middle" fill="#374151">{MONTH_LABELS[month - 1]}</text>'
        )

    # Legende
    lx = margin_left + 10
    ly = margin_top - 10
    svg_parts.append(f'<rect x="{lx}" y="{ly - 6}" width="10" height="10" fill="#9CA3AF" rx="1"/>')
    svg_parts.append(f'<text x="{lx + 14}" y="{ly + 3}" fill="#374151">{p1_label}</text>')
    svg_parts.append(f'<rect x="{lx + 80}" y="{ly - 6}" width="10" height="10" fill="#1B5E7B" rx="1"/>')
    svg_parts.append(f'<text x="{lx + 94}" y="{ly + 3}" fill="#374151">{p2_label}</text>')

    # kWh-Achse
    svg_parts.append(
        f'<text x="{margin_left - 5}" y="{margin_top - 10}" text-anchor="end" '
        f'fill="#6B7280" font-size="8">kWh</text>'
    )

    svg_parts.append("</svg>")
    return "\n".join(svg_parts)


def render_meter_tree_svg(
    tree_nodes: list[dict],
    width: int = 600,
    height: int = 0,
) -> str:
    """
    Zählerbaum als SVG rendern.

    tree_nodes: Liste von {id, name, energy_type, parent_id, unit}
    """
    if not tree_nodes:
        return ""

    # Baum aufbauen
    by_id = {n["id"]: n for n in tree_nodes}
    children: dict[str | None, list[str]] = {}
    for n in tree_nodes:
        pid = n.get("parent_id")
        children.setdefault(pid, []).append(n["id"])

    # Root-Knoten (ohne parent oder parent nicht in tree)
    roots = [n["id"] for n in tree_nodes if n.get("parent_id") is None or n["parent_id"] not in by_id]

    # Layout berechnen: DFS mit Y-Zähler
    node_positions: dict[str, tuple[int, int]] = {}  # id → (depth, y_index)
    y_counter = [0]

    def layout(node_id: str, depth: int):
        kids = children.get(node_id, [])
        if not kids:
            node_positions[node_id] = (depth, y_counter[0])
            y_counter[0] += 1
        else:
            for kid in kids:
                layout(kid, depth + 1)
            child_ys = [node_positions[k][1] for k in kids]
            node_positions[node_id] = (depth, (min(child_ys) + max(child_ys)) / 2)

    for root in roots:
        layout(root, 0)

    if not node_positions:
        return ""

    max_depth = max(d for d, _ in node_positions.values())
    total_rows = y_counter[0]
    row_h = 35
    col_w = 180
    auto_height = total_rows * row_h + 40
    if height == 0:
        height = auto_height
    width = max(width, (max_depth + 1) * col_w + 40)

    # Energietyp-Farben
    type_colors = {
        "electricity": "#1B5E7B",
        "gas": "#FF9800",
        "heat": "#E91E63",
        "water": "#00BCD4",
        "oil": "#795548",
    }

    svg_parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'style="width:{width}px;height:{height}px;font-family:Arial,sans-serif;font-size:9px">'
    ]

    # Verbindungslinien
    for n in tree_nodes:
        if n.get("parent_id") and n["parent_id"] in node_positions:
            pd, py = node_positions[n["parent_id"]]
            cd, cy = node_positions[n["id"]]
            px = 20 + pd * col_w + 130
            cx = 20 + cd * col_w
            p_y = 20 + py * row_h + 12
            c_y = 20 + cy * row_h + 12
            mid_x = (px + cx) / 2
            svg_parts.append(
                f'<path d="M{px},{p_y} C{mid_x},{p_y} {mid_x},{c_y} {cx},{c_y}" '
                f'fill="none" stroke="#D1D5DB" stroke-width="1.5"/>'
            )

    # Knoten
    for node_id, (depth, y_idx) in node_positions.items():
        node = by_id[node_id]
        x = 20 + depth * col_w
        y = 20 + y_idx * row_h
        color = type_colors.get(node.get("energy_type", ""), "#607D8B")

        svg_parts.append(
            f'<rect x="{x}" y="{y}" width="130" height="24" rx="4" '
            f'fill="white" stroke="{color}" stroke-width="1.5"/>'
        )
        svg_parts.append(
            f'<rect x="{x}" y="{y}" width="4" height="24" rx="2" fill="{color}"/>'
        )
        # Name (gekürzt auf 18 Zeichen)
        name = node["name"][:18]
        svg_parts.append(
            f'<text x="{x + 10}" y="{y + 15}" fill="#1F2937" font-size="9">{name}</text>'
        )

    svg_parts.append("</svg>")
    return "\n".join(svg_parts)


def render_sankey_svg(
    sankey_data: dict,
    width: int = 700,
    height: int = 400,
) -> str:
    """
    Vereinfachtes Sankey-Diagramm als SVG.

    sankey_data: {nodes: [{id, label, type, depth}], links: [{source, target, value, direction}]}
    """
    nodes = sankey_data.get("nodes", [])
    links = sankey_data.get("links", [])

    if not nodes or not links:
        return ""

    # Nur Verbrauchslinks (keine Einspeisung für PDF-Darstellung)
    consumption_links = [l for l in links if l.get("direction") != "feed_in" and l.get("value", 0) > 0]
    if not consumption_links:
        return ""

    margin = {"left": 20, "right": 20, "top": 30, "bottom": 20}
    chart_w = width - margin["left"] - margin["right"]
    chart_h = height - margin["top"] - margin["bottom"]

    # Spalten nach Tiefe gruppieren
    max_depth = max((n.get("depth", 0) for n in nodes), default=0)
    if max_depth == 0:
        max_depth = 1
    col_width = chart_w / (max_depth + 1)
    node_width = 20

    # Knoten nach Tiefe gruppieren
    cols: dict[int, list[int]] = {}
    for idx, n in enumerate(nodes):
        d = n.get("depth", 0)
        cols.setdefault(d, []).append(idx)

    # Knotengrößen basierend auf Gesamtfluss berechnen
    node_values: dict[int, float] = {}
    for link in consumption_links:
        src = link["source"]
        tgt = link["target"]
        val = link["value"]
        node_values[src] = max(node_values.get(src, 0), node_values.get(src, 0) + val - node_values.get(src, 0))
        node_values[tgt] = node_values.get(tgt, 0) + val

    # Eingehenden Fluss als Knotengröße nehmen (oder ausgehend für Quellen)
    for link in consumption_links:
        src = link["source"]
        if src not in node_values:
            node_values[src] = link["value"]
        else:
            node_values[src] = max(node_values[src], link["value"])

    total_value = sum(node_values.get(idx, 0) for idx in cols.get(0, []))
    if total_value == 0:
        total_value = 1

    # Y-Positionen berechnen
    node_positions: dict[int, tuple[float, float, float]] = {}  # idx → (x, y, height)
    for depth, node_idxs in cols.items():
        x = margin["left"] + depth * col_width
        col_total = sum(node_values.get(i, 0) for i in node_idxs)
        if col_total == 0:
            col_total = 1
        gap = 8
        available_h = chart_h - gap * (len(node_idxs) - 1)
        y = margin["top"]
        for idx in node_idxs:
            val = node_values.get(idx, 0)
            h = max((val / col_total) * available_h, 12)
            node_positions[idx] = (x, y, h)
            y += h + gap

    # Typ-Farben
    type_colors = {
        "quelle": "#1B5E7B",
        "hauptzaehler": "#2A8CB5",
        "unterzaehler": "#4CAF50",
        "verbraucher": "#FF9800",
        "eigenproduktion": "#8BC34A",
        "einspeisung": "#9C27B0",
    }

    svg_parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'style="width:{width}px;height:{height}px;font-family:Arial,sans-serif;font-size:8px">'
    ]

    # Links als Pfade
    for link in consumption_links:
        src = link["source"]
        tgt = link["target"]
        if src not in node_positions or tgt not in node_positions:
            continue
        sx, sy, sh = node_positions[src]
        tx, ty, th = node_positions[tgt]
        val = link["value"]
        # Linkhöhe proportional
        link_h = max((val / max(node_values.get(src, 1), 1)) * sh, 2)
        link_h_t = max((val / max(node_values.get(tgt, 1), 1)) * th, 2)

        x1 = sx + node_width
        x2 = tx
        y1 = sy + sh / 2 - link_h / 2
        y2 = ty + th / 2 - link_h_t / 2

        svg_parts.append(
            f'<path d="M{x1},{y1} C{(x1 + x2) / 2},{y1} {(x1 + x2) / 2},{y2} {x2},{y2} '
            f'L{x2},{y2 + link_h_t} C{(x1 + x2) / 2},{y2 + link_h_t} {(x1 + x2) / 2},{y1 + link_h} {x1},{y1 + link_h} Z" '
            f'fill="#1B5E7B" fill-opacity="0.15" stroke="none"/>'
        )

    # Knoten zeichnen
    for idx, (x, y, h) in node_positions.items():
        node = nodes[idx] if idx < len(nodes) else {}
        color = type_colors.get(node.get("type", ""), "#607D8B")
        label = node.get("label", "")

        svg_parts.append(
            f'<rect x="{x}" y="{y:.1f}" width="{node_width}" height="{h:.1f}" '
            f'rx="3" fill="{color}"/>'
        )
        # Label rechts oder links
        text_x = x + node_width + 4
        if x + node_width + 100 > width:
            text_x = x - 4
            anchor = "end"
        else:
            anchor = "start"
        text_y = y + h / 2 + 3
        short_label = label[:20]
        svg_parts.append(
            f'<text x="{text_x}" y="{text_y:.1f}" text-anchor="{anchor}" '
            f'fill="#1F2937" font-size="8">{short_label}</text>'
        )

    svg_parts.append("</svg>")
    return "\n".join(svg_parts)
