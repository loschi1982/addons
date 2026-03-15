# PDF-Generator für Wartungsprotokolle (CAFM-Modul).
# Verwendet fpdf2 — leichtgewichtig, pure Python, keine Systemabhängigkeiten.

import os
from datetime import date

from fpdf import FPDF

from backend.vdma_templates import DIN276_KOSTENGRUPPEN


def generate_maintenance_pdf(log, schedule, plant) -> str:
    """Erstellt ein Wartungsprotokoll als PDF und gibt den relativen Pfad zurück.

    Args:
        log: MaintenanceLog-Instanz (mit results, technician, performed_at, notes)
        schedule: MaintenanceSchedule-Instanz (mit title, checklist)
        plant: PlantData-Instanz (mit hersteller, modell, din276_kg etc.)

    Returns:
        Relativer Pfad zur PDF-Datei (z.B. /uploads/cafm/42/protokolle/5_2026-03-11.pdf)
    """
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    # ── Header ──
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "Wartungsprotokoll", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.ln(4)

    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 7, schedule.title if schedule else "Wartung", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.ln(8)

    # ── Anlagendaten ──
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Anlagendaten", new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(100, 100, 100)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(3)

    pdf.set_font("Helvetica", "", 10)
    if plant:
        _row(pdf, "Hersteller", plant.hersteller or "–")
        _row(pdf, "Modell", plant.modell or "–")
        _row(pdf, "Seriennummer", plant.seriennummer or "–")
        _row(pdf, "Baujahr", str(plant.baujahr) if plant.baujahr else "–")
        _row(pdf, "Standort", plant.standort_detail or "–")
        _row(pdf, "Status", plant.status or "–")
        kg = plant.din276_kg or ""
        kg_info = DIN276_KOSTENGRUPPEN.get(kg, {})
        kg_label = f"KG {kg} – {kg_info.get('label', '')}" if kg else "–"
        _row(pdf, "DIN 276 KG", kg_label)
        _row(pdf, "VDMA-Gewerk", kg_info.get("gewerk", "–"))
    pdf.ln(4)

    # ── Durchführung ──
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Durchführung", new_x="LMARGIN", new_y="NEXT")
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(3)

    pdf.set_font("Helvetica", "", 10)
    _row(pdf, "Techniker", log.technician)
    _row(pdf, "Datum", log.performed_at[:10] if log.performed_at else "–")
    _row(pdf, "Intervall", f"{schedule.interval_months} Monate" if schedule else "–")
    pdf.ln(4)

    # ── Checkliste ──
    results = log.results if hasattr(log, "results") and isinstance(log.results, list) else []
    if results:
        pdf.set_font("Helvetica", "B", 12)
        pdf.cell(0, 8, "Checkliste", new_x="LMARGIN", new_y="NEXT")
        pdf.line(10, pdf.get_y(), 200, pdf.get_y())
        pdf.ln(3)

        # Tabellen-Header.
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(8, 7, "#", border=1, align="C")
        pdf.cell(95, 7, "Prüfpunkt", border=1)
        pdf.cell(20, 7, "Status", border=1, align="C")
        pdf.cell(67, 7, "Bemerkung", border=1)
        pdf.ln()

        pdf.set_font("Helvetica", "", 9)
        for i, item in enumerate(results, 1):
            text = item.get("text", "")
            ok = item.get("ok", False)
            note = item.get("note", "")
            status_str = "OK" if ok else "Mangel"

            # Zeilenhöhe dynamisch.
            h = 6
            pdf.cell(8, h, str(i), border=1, align="C")
            pdf.cell(95, h, _trunc(text, 55), border=1)
            pdf.cell(20, h, status_str, border=1, align="C")
            pdf.cell(67, h, _trunc(note, 38), border=1)
            pdf.ln()

        pdf.ln(4)

    # ── Bemerkungen ──
    if log.notes:
        pdf.set_font("Helvetica", "B", 12)
        pdf.cell(0, 8, "Bemerkungen", new_x="LMARGIN", new_y="NEXT")
        pdf.line(10, pdf.get_y(), 200, pdf.get_y())
        pdf.ln(3)
        pdf.set_font("Helvetica", "", 10)
        pdf.multi_cell(0, 5, log.notes)
        pdf.ln(4)

    # ── Footer ──
    pdf.ln(10)
    pdf.set_font("Helvetica", "I", 8)
    pdf.cell(0, 5, f"Erstellt am {date.today().isoformat()} – AR Building CAFM", align="C")

    # Datei speichern.
    object_id = plant.object_id if plant else 0
    out_dir = f"/data/uploads/cafm/{object_id}/protokolle"
    os.makedirs(out_dir, exist_ok=True)

    filename = f"{log.id}_{date.today().isoformat()}.pdf"
    abs_path = os.path.join(out_dir, filename)
    pdf.output(abs_path)

    # Relativer Pfad für DB und URL.
    return f"/uploads/cafm/{object_id}/protokolle/{filename}"


def _row(pdf: FPDF, label: str, value: str):
    """Zeile mit Label (fett) + Wert."""
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(45, 6, label + ":", align="R")
    pdf.cell(3, 6, "")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, value, new_x="LMARGIN", new_y="NEXT")


def _trunc(text: str, max_len: int) -> str:
    """Kürzt Text auf max_len Zeichen."""
    if len(text) <= max_len:
        return text
    return text[: max_len - 1] + "…"
