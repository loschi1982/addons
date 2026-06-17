"""Paperless-ngx API-Client.

Deckt die vom Vertragsnavigator genutzten Endpunkte ab. Wichtige, durch
Recherche bestaetigte Punkte:

* ``notes`` ist ein **Array von Note-Objekten** mit eigenen Endpunkten
  (``POST``/``DELETE`` auf ``/api/documents/{id}/notes/``) – kein String via
  ``PATCH``. Der Vertragsnavigator-Hinweis wird daher als eigene Note gefuehrt
  und bei Aenderung ersetzt; fremde Notizen bleiben unberuehrt.
* Der OCR-Text (``content``) ist Fliesstext ohne Seitengrenzen; die
  Seitenzuordnung erfolgt ueber den PDF-Download (siehe ``pagination``).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import httpx

#: Prefix, an dem der Vertragsnavigator seine eigene Notiz erkennt.
HINWEIS_PREFIX = "Vertragsnavigator:"


class PaperlessError(Exception):
    """Fehler bei der Kommunikation mit Paperless-ngx."""


class PaperlessClient:
    """Schlanker, synchroner Client (ausreichend fuer Single-User-Betrieb)."""

    def __init__(self, base_url: str, token: str, timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout

    # --- intern ----------------------------------------------------------

    def _headers(self) -> Dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = f"Token {self.token}"
        return headers

    def _request(self, method: str, pfad: str, **kwargs: Any) -> httpx.Response:
        url = f"{self.base_url}{pfad}"
        try:
            with httpx.Client(timeout=self.timeout, headers=self._headers()) as client:
                antwort = client.request(method, url, **kwargs)
        except httpx.HTTPError as exc:
            raise PaperlessError(f"Verbindung zu Paperless fehlgeschlagen: {exc}") from exc
        if antwort.status_code >= 400:
            raise PaperlessError(
                f"Paperless antwortete mit {antwort.status_code} fuer {method} {pfad}: "
                f"{antwort.text[:300]}"
            )
        return antwort

    # --- Dokumente -------------------------------------------------------

    def list_documents(self) -> List[Dict[str, Any]]:
        """Holt alle Dokumente (folgt der Paginierung)."""
        dokumente: List[Dict[str, Any]] = []
        pfad: Optional[str] = "/api/documents/?page_size=250"
        while pfad:
            antwort = self._request("GET", pfad)
            daten = antwort.json()
            dokumente.extend(daten.get("results", []))
            naechste = daten.get("next")
            if naechste:
                # absolute URL auf relativen Pfad reduzieren
                pfad = naechste.replace(self.base_url, "")
            else:
                pfad = None
        return dokumente

    def get_document(self, doc_id: int) -> Dict[str, Any]:
        """Metadaten inkl. ``content`` (OCR), ``notes`` und ``page_count``."""
        return self._request("GET", f"/api/documents/{doc_id}/").json()

    def get_tags(self) -> Dict[int, str]:
        """Liefert eine Zuordnung Tag-ID -> Tag-Name (folgt der Paginierung)."""
        tags: Dict[int, str] = {}
        pfad: Optional[str] = "/api/tags/?page_size=250"
        while pfad:
            antwort = self._request("GET", pfad)
            daten = antwort.json()
            for t in daten.get("results", []):
                tags[t["id"]] = t.get("name", str(t["id"]))
            naechste = daten.get("next")
            pfad = naechste.replace(self.base_url, "") if naechste else None
        return tags

    def download_pdf(self, doc_id: int, original: bool = False) -> bytes:
        """Laedt das PDF herunter (Archiv-Version, optional Original)."""
        pfad = f"/api/documents/{doc_id}/download/"
        if original:
            pfad += "?original=true"
        return self._request("GET", pfad).content

    # --- Notizen ---------------------------------------------------------

    def get_notes(self, doc_id: int) -> List[Dict[str, Any]]:
        """Liest die Notizen eines Dokuments (aus den Dokument-Metadaten)."""
        dok = self.get_document(doc_id)
        notes = dok.get("notes") or []
        # Manche Versionen liefern eine Liste, defensiv absichern
        return notes if isinstance(notes, list) else []

    def add_note(self, doc_id: int, text: str) -> Dict[str, Any]:
        """Legt eine neue Notiz an."""
        antwort = self._request(
            "POST", f"/api/documents/{doc_id}/notes/", json={"note": text}
        )
        try:
            return antwort.json()
        except ValueError:
            return {}

    def delete_note(self, doc_id: int, note_id: int) -> None:
        """Loescht eine einzelne Notiz."""
        self._request("DELETE", f"/api/documents/{doc_id}/notes/{note_id}/")

    def set_navigator_hint(self, doc_id: int, zusammenfassung: Optional[str]) -> None:
        """Ersetzt den Vertragsnavigator-Hinweis im Notizfeld.

        ``zusammenfassung`` ist der Themen-/Seiten-Text, z. B.
        ``"Haftung (S. 4, 7), Laufzeit (S. 12)"``. Bestehende
        ``Vertragsnavigator:``-Notizen werden geloescht, danach wird (sofern
        eine Zusammenfassung vorliegt) eine neue, menschenlesbare Notiz
        gepostet. Fremde Notizen bleiben unberuehrt.
        """
        for note in self.get_notes(doc_id):
            text = (note.get("note") or "").lstrip()
            if text.startswith(HINWEIS_PREFIX):
                note_id = note.get("id")
                if note_id is not None:
                    self.delete_note(doc_id, note_id)

        if zusammenfassung:
            self.add_note(
                doc_id,
                f"{HINWEIS_PREFIX} {zusammenfassung} in Themenübersicht erfasst.",
            )
