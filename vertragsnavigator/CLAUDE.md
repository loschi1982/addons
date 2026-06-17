# Vertragsnavigator – CLAUDE.md

## Projektübersicht
Home-Assistant-Add-on, das Verträge aus **Paperless-ngx** thematisch erschließt:
Textstellen markieren, Themen zuordnen, abhängige Absätze über Dokumente hinweg
verknüpfen und aus einer Themenübersicht direkt an die richtige PDF-Seite im
Paperless-Viewer springen. Paperless bleibt das Archiv; dieses Add-on ist eine
Navigations-/Strukturebene darüber.

## Tech-Stack
- **Backend**: Python 3.12, FastAPI, uvicorn (Single-Process)
- **DB**: SQLite (stdlib `sqlite3`), Datei `/data/vertragsnavigator.db`
- **Frontend**: Vanilla JS + HTML + CSS (kein Framework), via FastAPI StaticFiles
- **PDF**: `pypdf` (Seitenzuordnung)
- **Paperless**: REST-API über `httpx`, Token-Auth
- **Container**: Alpine 3.20 (bringt Python 3.12), HA-Add-on via Ingress

## Projektstruktur
```
vertragsnavigator/
├── config.yaml          # HA-Add-on-Metadaten + Options/Schema
├── build.yaml           # Base-Image pro arch (alpine:3.20)
├── Dockerfile           # pip install, COPY app/, CMD run.sh
├── run.sh               # liest /data/options.json -> env, startet uvicorn :8099
├── requirements.txt / requirements-dev.txt
├── pytest.ini
├── app/
│   ├── main.py          # FastAPI-App, Routing, Ingress-HTML, StaticFiles
│   ├── config.py        # Settings aus Umgebung (PAPERLESS_URL/TOKEN, VN_DB_PATH)
│   ├── paperless.py     # Paperless-API-Client
│   ├── pagination.py    # Seitenzuordnung (Markierung -> PDF-Seite)
│   ├── db.py            # SQLite-Zugriff + Schema-Init
│   ├── models.py        # Pydantic-Schemas
│   └── static/          # index.html, app.js, style.css
└── tests/               # pytest (pagination, notes, api)
```

## Konventionen
- **Sprache**: Code-Kommentare/Docstrings auf Deutsch.
- **API** intern unter `/api/…` (siehe Spec §6). Schreibende Markierungs-Ops
  spiegeln einen Hinweis ins Paperless-Notizfeld.
- **Ingress**: `main.py` liest Header `X-Ingress-Path` und injiziert
  `<base href>` + `window.__VN__.apiBase` in die `index.html`. Frontend nutzt
  relative Assets + `apiBase`-Prefix für Fetches.

## Wichtige Design-Entscheidungen / Abweichungen von der Spec
1. **Paperless Notes-API**: `notes` ist ein **Array von Note-Objekten** mit
   eigenen Endpunkten (`POST`/`DELETE` auf `/api/documents/{id}/notes/`), KEIN
   String via `PATCH`. Der Vertragsnavigator-Hinweis (Prefix
   `Vertragsnavigator:`) wird daher als eigene Note geführt und bei Änderung
   gelöscht+neu gepostet; fremde Notizen bleiben unberührt
   (`paperless.set_navigator_hint`).
2. **Seitenzuordnung**: Paperless liefert keinen seitenweisen OCR-Text. Lösung:
   PDF via `/api/documents/{id}/download/` laden, mit `pypdf` seitenweise Text
   extrahieren, markierten Text per Substring-Match (+ Offset-Disambiguierung)
   zuordnen (`pagination.finde_seite`). **Kritischster Punkt** – an echten
   Dokumenten gegenprüfen.
3. **Base-Image**: `alpine:3.20` statt HA-base-python (Python 3.12 garantiert,
   keine Tag-Unsicherheit, kein bashio – Optionen werden in `run.sh` per
   `python3` aus `/data/options.json` gelesen).

## Befehle
```bash
# Tests (Dev)
pip install -r requirements-dev.txt
pytest

# Lokaler Dev-Run ohne HA
PAPERLESS_URL=http://host:8000 PAPERLESS_TOKEN=xxx VN_DB_PATH=./dev.db \
  uvicorn app.main:app --port 8099
# -> http://localhost:8099/

# Docker-Build-Check
docker build -t vertragsnavigator .
```

## Status
- [x] Phase 1: Add-on-Hülle, Paperless-Verbindung, Vertragsbaum, OCR-Anzeige
- [x] Phase 2: Markieren + Kontextmenü, Themen, Themenübersicht + Sprungmarken
- [x] Phase 3: Verknüpfungen, Hauptvertrag-Hierarchie, Paperless-Notiz-Spiegel
- [x] UI v0.2.0: Spalte 3 = Themenliste, Klick öffnet Zusammenfassungs-Overlay
- [x] UI v0.3.0: PDF-Ansicht via PDF.js (CDN) mit markierbarer Textebene —
      Markieren direkt im PDF (exakte Seite), bestehende Marken im PDF hervorgehoben;
      Umschalter PDF/Text (reiner Frontend-Umbau)
- [x] v0.4.0: Notiz/Post-It je Markierung in der Zusammenfassung anlegen/bearbeiten
      (`PATCH /api/markierungen/{id}` + `MarkierungUpdate`)
- [x] v0.4.x: PDF-Zoom (+/-, Ansicht bleibt erhalten), fixe Kopfleiste, In-App-Sprung
- [x] v0.5.0: Themen umbenennen/löschen (`PATCH`/`DELETE /api/themen/{id}`)
- [x] v0.6.0: Verweise zwischen PDFs (Tabelle `verweise`, `POST`/`DELETE /api/verweise`,
      in `/api/docs/{id}`): gerichtete Änderung Nachtrag→Original, Redline im PDF
      (Durchstreichung + eingeblendeter Nachtragstext), 2-Schritt-Erstellung im Kontextmenü
- [x] v0.6.x: Verweis-Annotationen in rechter Randspalte + blasse Verbindungslinien (SVG)
- [x] v0.7.0: Paperless-Tags übernommen (`get_tags`, in `/api/docs` als `tags`),
      Vertragsbaum nach Objekt (Tag) gruppierbar, Hierarchie per Drag & Drop
- [ ] Phase 4 (optional, später): Ähnlichkeitsvorschläge für Abhängigkeiten
- [ ] **Offen**: Seitenzuordnung + Paperless-API-Version an echter Instanz
      verifizieren (Tests laufen bisher nur gegen synthetische PDFs/Mocks).
