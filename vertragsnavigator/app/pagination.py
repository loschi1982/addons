"""Seitenzuordnung: markierten Text der richtigen PDF-Seite zuordnen.

Paperless-ngx liefert den OCR-Text nur als Fliesstext (Feld ``content``) ohne
harte Seitengrenzen. Um eine Markierung einer Seitenzahl zuzuordnen, laden wir
das PDF herunter, extrahieren den Text seitenweise mit ``pypdf`` und ordnen den
markierten Text der passenden Seite zu.

Laut Spezifikation (Abschnitt 4.4 / 10) ist dies der kritischste technische
Punkt des Projekts. Die Logik ist daher bewusst defensiv aufgebaut:

1. Direkter Substring-Treffer pro Seite (Hauptweg).
2. Bei Mehrdeutigkeit: Disambiguierung ueber die Zeichenposition (Offset).
3. Bei Seitenuebergang/OCR-Abweichung: laengstes passendes Teilstueck.
4. Letzter Fallback: Offset-Mapping, sonst Seite 1.
"""

from __future__ import annotations

import io
import re
from typing import List, Optional

try:  # pypdf ist Laufzeit-Abhaengigkeit, in Tests ggf. nicht vorhanden
    from pypdf import PdfReader
except ImportError:  # pragma: no cover
    PdfReader = None  # type: ignore[assignment]


_WHITESPACE = re.compile(r"\s+")


def _normalisiere(text: str) -> str:
    """Vereinheitlicht Text fuer robustes Matching.

    Reduziert beliebigen Whitespace (inkl. Zeilenumbrueche) auf einzelne
    Leerzeichen und wandelt in Kleinschreibung. So werden Layout-Unterschiede
    zwischen ``content`` und dem PDF-Textlayer weitgehend ausgeglichen.
    """
    return _WHITESPACE.sub(" ", text or "").strip().lower()


def seiten_text(pdf_bytes: bytes) -> List[str]:
    """Extrahiert den Text jeder PDF-Seite (Index 0 = Seite 1)."""
    if PdfReader is None:
        raise RuntimeError("pypdf ist nicht installiert")
    reader = PdfReader(io.BytesIO(pdf_bytes))
    return [(seite.extract_text() or "") for seite in reader.pages]


def _seite_per_teilstueck(norm_seiten: List[str], ziel: str) -> Optional[int]:
    """Sucht das laengste Praefix des Auszugs, das ganz auf einer Seite liegt.

    Faengt Faelle ab, in denen die Markierung ueber eine Seitengrenze laeuft
    oder die OCR leicht abweicht.
    """
    woerter = ziel.split(" ")
    for laenge in range(len(woerter), 0, -1):
        teil = " ".join(woerter[:laenge])
        if len(teil) < 4:
            break
        for i, seite in enumerate(norm_seiten):
            if teil and teil in seite:
                return i + 1
    return None


def _seite_aus_offset(
    norm_seiten: List[str],
    content: Optional[str],
    offset: Optional[int],
) -> Optional[int]:
    """Bestimmt die Seite anhand der Zeichenposition (Offset) im ``content``.

    Lokalisiert jede Seite sequentiell im normalisierten ``content`` und bildet
    daraus kumulative Seitengrenzen. Der im Originaltext gemessene Offset wird
    proportional in den normalisierten Raum uebertragen. Dient nur der
    Disambiguierung bzw. als Fallback.
    """
    if content is None or offset is None or not content:
        return None
    norm_content = _normalisiere(content)
    if not norm_content:
        return None

    grenzen: List[tuple] = []  # (start, end, seite)
    pos = 0
    for i, seite in enumerate(norm_seiten):
        if not seite:
            continue
        probe = seite[:80] if len(seite) > 80 else seite
        idx = norm_content.find(probe, pos)
        if idx == -1:
            idx = norm_content.find(seite[:40], pos)
        if idx == -1:
            continue
        start = idx
        end = idx + len(seite)
        grenzen.append((start, end, i + 1))
        pos = max(pos, start + len(probe))

    if not grenzen:
        return None

    # Offset (Originalraum) proportional in den normalisierten Raum uebertragen
    norm_off = int(round(offset * len(norm_content) / max(1, len(content))))
    norm_off = max(0, min(norm_off, len(norm_content) - 1))

    for start, end, seite in grenzen:
        if start <= norm_off < end:
            return seite
    # naechstgelegene Seitengrenze
    beste = min(grenzen, key=lambda g: abs(g[0] - norm_off))
    return beste[2]


def finde_seite(
    seiten: List[str],
    textauszug: str,
    offset_im_content: Optional[int] = None,
    content: Optional[str] = None,
) -> int:
    """Ordnet einen markierten Textauszug einer 1-basierten Seitenzahl zu."""
    if not seiten:
        return 1
    ziel = _normalisiere(textauszug)
    if not ziel:
        return 1
    norm_seiten = [_normalisiere(s) for s in seiten]

    # 1) Direkter Substring-Treffer pro Seite
    treffer = [i for i, seite in enumerate(norm_seiten) if ziel in seite]
    if len(treffer) == 1:
        return treffer[0] + 1
    if len(treffer) > 1:
        seite = _seite_aus_offset(norm_seiten, content, offset_im_content)
        if seite is not None and (seite - 1) in treffer:
            return seite
        return treffer[0] + 1

    # 2) Kein voller Treffer -> laengstes passendes Teilstueck
    seite = _seite_per_teilstueck(norm_seiten, ziel)
    if seite is not None:
        return seite

    # 3) Offset-Fallback
    seite = _seite_aus_offset(norm_seiten, content, offset_im_content)
    return seite if seite is not None else 1
