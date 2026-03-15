# PDF-Generator für Wartungsprotokolle (CAFM-Modul).
# Verwendet fpdf2 — leichtgewichtig, pure Python, keine Systemabhängigkeiten.
# Unterstützt Branding: Logo, Kopfzeile, Fußzeile aus /data/cafm_pdf_settings.json.

import json
import os
from datetime import date

from fpdf import FPDF

from backend.vdma_templates import DIN276_KOSTENGRUPPEN

PDF_SETTINGS_PATH = "/data/cafm_pdf_settings.json"

DEFAULT_PDF_SETTINGS = {
    "company_name": "",
    "header_line1": "",
    "header_line2": "",
    "footer_text": "Erstellt mit AR Building CAFM",
    "logo_path": "",
    "show_logo": True,
    "show_header": True,
    "show_footer": True,
}


def _load_pdf_settings() -> dict:
    if os.path.exists(PDF_SETTINGS_PATH):
        try:
            with open(PDF_SETTINGS_PATH, "r") as f:
                data = json.load(f)
            for k, v in DEFAULT_PDF_SETTINGS.items():
                if k not in data:
                    data[k] = v
            return data
        except Exception:
            pass
    return DEFAULT_PDF_SETTINGS.copy()


class BrandedPDF(FPDF):
    """FPDF-Unterklasse mit konfigurierbarer Kopf- und Fußzeile."""

    def __init__(self, settings: dict):
        super().__init__()
        self.branding = settings

    def header(self):
        if not self.branding.get("show_header", True):
            return

        start_x = 10
        logo_width = 0

        # Logo einbetten.
        logo_path = self.branding.get("logo_path", "")
        if logo_path and self.branding.get("show_logo", True):
            abs_logo = f"/data{logo_path}"
            if os.path.exists(abs_logo):
                try:
                    self.image(abs_logo, x=10, y=8, h=16)
                    logo_width = 22
                    start_x = 10 + logo_width
                except Exception:
                    logo_width = 0

        # Firmenname / Kopfzeilen.
        company = self.branding.get("company_name", "")
        line1 = self.branding.get("header_line1", "")
        line2 = self.branding.get("header_line2", "")

        has_branding_text = company or line1 or line2

        if has_branding_text:
            text_x = start_x
            text_w = 190 - logo_width

            if company:
                self.set_font("Helvetica", "B", 12)
                self.set_xy(text_x, 8)
                self.cell(text_w, 6, company, align="L")

            if line1:
                self.set_font("Helvetica", "", 9)
                self.set_xy(text_x, 14)
                self.cell(text_w, 5, line1, align="L")

            if line2:
                self.set_font("Helvetica", "", 9)
                self.set_xy(text_x, 19)
                self.cell(text_w, 5, line2, align="L")

            # Trennlinie.
            self.set_draw_color(180, 180, 180)
            self.line(10, 27, 200, 27)
            self.set_y(30)
        elif logo_width > 0:
            self.set_draw_color(180, 180, 180)
            self.line(10, 27, 200, 27)
            self.set_y(30)
        else:
            self.set_y(10)

    def footer(self):
        if not self.branding.get("show_footer", True):
            return

        self.set_y(-20)
        self.set_draw_color(180, 180, 180)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(3)

        footer_text = self.branding.get("footer_text", "")
        if footer_text:
            self.set_font("Helvetica", "I", 8)
            self.cell(0, 4, footer_text, align="L")

        # Seitenzahl rechts.
        self.set_font("Helvetica", "I", 8)
        self.set_x(-30)
        self.cell(20, 4, f"Seite {self.page_no()}/{{nb}}", align="R")


def generate_maintenance_pdf(log, schedule, plant) -> str:
    """Erstellt ein Wartungsprotokoll als PDF und gibt den relativen Pfad zurück.

    Args:
        log: MaintenanceLog-Instanz (mit results, technician, performed_at, notes)
        schedule: MaintenanceSchedule-Instanz (mit title, checklist)
        plant: PlantData-Instanz (mit hersteller, modell, din276_kg etc.)

    Returns:
        Relativer Pfad zur PDF-Datei (z.B. /uploads/cafm/42/protokolle/5_2026-03-11.pdf)
    """
    settings = _load_pdf_settings()
    pdf = BrandedPDF(settings)
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=25)
    pdf.add_page()

    # ── Titel ──
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "Wartungsprotokoll", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.ln(2)

    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 7, schedule.title if schedule else "Wartung", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.ln(6)

    # ── Anlagendaten ──
    _section_header(pdf, "Anlagendaten")

    pdf.set_font("Helvetica", "", 10)
    if plant:
        _row(pdf, "Hersteller", plant.hersteller or "\u2013")
        _row(pdf, "Modell", plant.modell or "\u2013")
        _row(pdf, "Seriennummer", plant.seriennummer or "\u2013")
        _row(pdf, "Baujahr", str(plant.baujahr) if plant.baujahr else "\u2013")
        _row(pdf, "Standort", plant.standort_detail or "\u2013")
        _row(pdf, "Status", plant.status or "\u2013")
        kg = plant.din276_kg or ""
        kg_info = DIN276_KOSTENGRUPPEN.get(kg, {})
        kg_label = f"KG {kg} \u2013 {kg_info.get('label', '')}" if kg else "\u2013"
        _row(pdf, "DIN 276 KG", kg_label)
        _row(pdf, "VDMA-Gewerk", kg_info.get("gewerk", "\u2013"))
        if plant.anlagen_variante:
            _row(pdf, "Anlagenvariante", plant.anlagen_variante)
    pdf.ln(4)

    # ── Durchführung ──
    _section_header(pdf, "Durchführung")

    pdf.set_font("Helvetica", "", 10)
    _row(pdf, "Techniker", log.technician)
    _row(pdf, "Datum", log.performed_at[:10] if log.performed_at else "\u2013")
    _row(pdf, "Intervall", f"{schedule.interval_months} Monate" if schedule else "\u2013")
    pdf.ln(4)

    # ── Checkliste ──
    results = log.results if hasattr(log, "results") and isinstance(log.results, list) else []
    if results:
        _section_header(pdf, "Checkliste")

        # Zusammenfassung.
        ok_count = sum(1 for r in results if r.get("ok") is True)
        fail_count = sum(1 for r in results if r.get("ok") is False)
        pdf.set_font("Helvetica", "I", 9)
        pdf.cell(0, 5, f"{len(results)} Prüfpunkte | {ok_count} OK | {fail_count} Mängel",
                 new_x="LMARGIN", new_y="NEXT")
        pdf.ln(2)

        # Tabellen-Header.
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_fill_color(240, 240, 240)
        pdf.cell(8, 7, "#", border=1, align="C", fill=True)
        pdf.cell(95, 7, "Prüfpunkt", border=1, fill=True)
        pdf.cell(20, 7, "Status", border=1, align="C", fill=True)
        pdf.cell(67, 7, "Bemerkung", border=1, fill=True)
        pdf.ln()

        pdf.set_font("Helvetica", "", 9)
        for i, item in enumerate(results, 1):
            text = item.get("text", "")
            ok = item.get("ok", False)
            note = item.get("note", "")
            status_str = "OK" if ok else "Mangel"

            h = 6
            pdf.cell(8, h, str(i), border=1, align="C")
            pdf.cell(95, h, _trunc(text, 55), border=1)
            pdf.cell(20, h, status_str, border=1, align="C")
            pdf.cell(67, h, _trunc(note, 38), border=1)
            pdf.ln()

        pdf.ln(4)

    # ── Bemerkungen ──
    if log.notes:
        _section_header(pdf, "Bemerkungen")
        pdf.set_font("Helvetica", "", 10)
        pdf.multi_cell(0, 5, log.notes)
        pdf.ln(4)

    # ── Unterschriftenzeile ──
    pdf.ln(10)
    pdf.set_font("Helvetica", "", 9)
    y = pdf.get_y()
    pdf.set_draw_color(100, 100, 100)

    # Datum + Ort.
    pdf.line(10, y, 90, y)
    pdf.set_xy(10, y + 1)
    pdf.cell(80, 5, "Datum, Ort", align="C")

    # Unterschrift Techniker.
    pdf.line(110, y, 200, y)
    pdf.set_xy(110, y + 1)
    pdf.cell(90, 5, f"Unterschrift ({log.technician})", align="C")

    # Datei speichern.
    object_id = plant.object_id if plant else 0
    out_dir = f"/data/uploads/cafm/{object_id}/protokolle"
    os.makedirs(out_dir, exist_ok=True)

    filename = f"{log.id}_{date.today().isoformat()}.pdf"
    abs_path = os.path.join(out_dir, filename)
    pdf.output(abs_path)

    # Relativer Pfad für DB und URL.
    return f"/uploads/cafm/{object_id}/protokolle/{filename}"


def _section_header(pdf: FPDF, title: str):
    """Sektionsüberschrift mit Linie."""
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, title, new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(100, 100, 100)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(3)


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
    return text[: max_len - 1] + "\u2026"
