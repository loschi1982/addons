"""Tests fuer die Seitenzuordnung (kritischster Punkt des Projekts).

Erzeugt synthetische Mehrseiten-PDFs mit reportlab und prueft, ob ein
markierter Textauszug der richtigen Seite zugeordnet wird.
"""

import io

import pytest

reportlab = pytest.importorskip("reportlab")
from reportlab.lib.pagesizes import A4  # noqa: E402
from reportlab.pdfgen import canvas  # noqa: E402

from app import pagination  # noqa: E402


def _pdf(seiten_texte):
    """Baut ein PDF, bei dem jede Seite die angegebenen Zeilen enthaelt."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    for text in seiten_texte:
        y = 800
        for zeile in text.split("\n"):
            c.drawString(50, y, zeile)
            y -= 20
        c.showPage()
    c.save()
    return buf.getvalue()


def test_seiten_text_zaehlt_seiten():
    pdf = _pdf(["Seite eins Text", "Seite zwei Text", "Seite drei Text"])
    seiten = pagination.seiten_text(pdf)
    assert len(seiten) == 3
    assert "eins" in seiten[0].lower()
    assert "drei" in seiten[2].lower()


def test_eindeutiger_treffer_auf_seite_zwei():
    seiten_texte = [
        "Praeambel und Einleitung",
        "Eindeutige Kennung Alpha Haftungsklausel",
        "Schlussbestimmungen",
    ]
    seiten = pagination.seiten_text(_pdf(seiten_texte))
    assert pagination.finde_seite(seiten, "Eindeutige Kennung Alpha") == 2


def test_treffer_auf_erster_seite_ohne_offset():
    seiten_texte = ["Vertragsgegenstand Lieferung", "Mittelteil", "Anhang"]
    seiten = pagination.seiten_text(_pdf(seiten_texte))
    assert pagination.finde_seite(seiten, "Vertragsgegenstand Lieferung") == 1


def test_mehrdeutig_wird_per_offset_disambiguiert():
    seiten_texte = [
        "Gemeinsamer Satz auf erster Seite",
        "Andere Inhalte hier",
        "Gemeinsamer Satz auf dritter Seite",
    ]
    seiten = pagination.seiten_text(_pdf(seiten_texte))
    content = "\n".join(seiten)
    # Offset nahe am Ende -> dritte Seite erwartet
    offset = len(content) - 10
    assert pagination.finde_seite(seiten, "Gemeinsamer Satz", offset, content) == 3
    # Offset am Anfang -> erste Seite erwartet
    assert pagination.finde_seite(seiten, "Gemeinsamer Satz", 0, content) == 1


def test_leerer_auszug_liefert_seite_eins():
    seiten = pagination.seiten_text(_pdf(["Irgendetwas"]))
    assert pagination.finde_seite(seiten, "   ") == 1


def test_unauffindbarer_text_faellt_zurueck():
    seiten = pagination.seiten_text(_pdf(["Nur dieser Inhalt"]))
    # nicht vorhanden -> Fallback Seite 1 (kein Absturz)
    assert pagination.finde_seite(seiten, "voellig anderer text") == 1
