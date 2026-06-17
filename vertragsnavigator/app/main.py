"""FastAPI-App des Vertragsnavigators.

Bedient die interne API (App <-> Frontend) und liefert das statische Frontend
aus. Hinter HA-Ingress wird das Frontend mit passendem ``<base href>`` und
``apiBase`` ausgeliefert (Header ``X-Ingress-Path``).
"""

from __future__ import annotations

import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import db, models, pagination
from .config import get_settings
from .paperless import PaperlessClient, PaperlessError

STATIC_DIR = Path(__file__).parent / "static"

#: Cache fuer seitenweise PDF-Texte (pro Dokument), um Mehrfach-Downloads zu sparen.
_seiten_cache: Dict[int, List[str]] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="Vertragsnavigator", lifespan=lifespan)


# --- Abhaengigkeiten & Hilfsfunktionen -----------------------------------

def get_client() -> PaperlessClient:
    """Baut einen Paperless-Client aus den aktuellen Einstellungen."""
    settings = get_settings()
    if not settings.paperless_url:
        raise HTTPException(
            status_code=503,
            detail="Paperless-URL ist nicht konfiguriert. Bitte in den Add-on-Optionen setzen.",
        )
    return PaperlessClient(settings.paperless_url, settings.paperless_token)


def _jetzt() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_dokument(conn: sqlite3.Connection, doc_id: int, titel: str) -> None:
    """Stellt sicher, dass eine lokale Dokumentzeile existiert (Titel aktuell)."""
    conn.execute("INSERT OR IGNORE INTO dokumente (id, titel) VALUES (?, ?)", (doc_id, titel))
    conn.execute("UPDATE dokumente SET titel=? WHERE id=? AND titel<>?", (titel, doc_id, titel))


def _markierung_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "dokument_id": row["dokument_id"],
        "thema_id": row["thema_id"],
        "seite": row["seite"],
        "textauszug": row["textauszug"],
        "notiz": row["notiz"],
        "erstellt_am": row["erstellt_am"],
    }


def _seiten_text(client: PaperlessClient, doc_id: int) -> List[str]:
    if doc_id not in _seiten_cache:
        pdf = client.download_pdf(doc_id)
        _seiten_cache[doc_id] = pagination.seiten_text(pdf)
    return _seiten_cache[doc_id]


def _aktualisiere_hinweis(client: PaperlessClient, dokument_id: int) -> None:
    """Spiegelt die erfassten Themen/Seiten als Notiz nach Paperless (best effort).

    Beispiel-Notiz: "Vertragsnavigator: Haftung (S. 4, 7), Laufzeit (S. 12),
    ohne Thema (S. 5) in Themenübersicht erfasst."
    """
    with db.verbindung() as conn:
        rows = conn.execute(
            "SELECT m.seite AS seite, t.name AS thema "
            "FROM markierungen m LEFT JOIN themen t ON t.id = m.thema_id "
            "WHERE m.dokument_id=? ORDER BY m.seite",
            (dokument_id,),
        ).fetchall()

    gruppen: Dict[str, set] = {}
    for r in rows:
        name = r["thema"] or "ohne Thema"
        gruppen.setdefault(name, set()).add(r["seite"])

    # Themen alphabetisch, "ohne Thema" zuletzt
    def _key(name: str):
        return (name == "ohne Thema", name.lower())

    teile = []
    for name in sorted(gruppen, key=_key):
        seiten = ", ".join(str(s) for s in sorted(gruppen[name]))
        teile.append(f"{name} (S. {seiten})")
    zusammenfassung = ", ".join(teile)

    try:
        client.set_navigator_hint(dokument_id, zusammenfassung)
    except PaperlessError:
        # Der Notiz-Spiegel darf die Hauptoperation nie blockieren.
        pass


def _wuerde_zyklus(conn: sqlite3.Connection, doc_id: int, eltern_id: int) -> bool:
    """Prueft, ob ``doc_id`` Vorfahre von ``eltern_id`` ist (=> Zyklus)."""
    aktuell: Optional[int] = eltern_id
    besucht = set()
    while aktuell is not None and aktuell not in besucht:
        if aktuell == doc_id:
            return True
        besucht.add(aktuell)
        row = conn.execute("SELECT eltern_id FROM dokumente WHERE id=?", (aktuell,)).fetchone()
        aktuell = row["eltern_id"] if row else None
    return False


@app.exception_handler(PaperlessError)
async def _paperless_error_handler(request: Request, exc: PaperlessError):
    return JSONResponse(status_code=502, content={"detail": str(exc)})


# --- Konfiguration -------------------------------------------------------

@app.get("/api/config")
def app_config():
    settings = get_settings()
    return {
        "paperless_url": settings.paperless_url,
        # Basis fuer Sprungmarken im Browser: externe URL, sonst interne URL.
        "sprung_url": settings.paperless_external_url or settings.paperless_url,
        "konfiguriert": bool(settings.paperless_url and settings.paperless_token),
    }


# --- Dokumente / Vertragsbaum --------------------------------------------

@app.get("/api/docs")
def liste_dokumente(client: PaperlessClient = Depends(get_client)):
    """Vertragsbaum: alle Paperless-Dokumente, angereichert um lokale Daten."""
    paperless_docs = client.list_documents()
    with db.verbindung() as conn:
        eltern = {r["id"]: r["eltern_id"] for r in conn.execute("SELECT id, eltern_id FROM dokumente")}
        zaehler = {
            r["dokument_id"]: r["n"]
            for r in conn.execute(
                "SELECT dokument_id, COUNT(*) AS n FROM markierungen GROUP BY dokument_id"
            )
        }
        ergebnis = []
        for d in paperless_docs:
            did = d["id"]
            titel = d.get("title") or f"Dokument {did}"
            _ensure_dokument(conn, did, titel)
            ergebnis.append(
                {
                    "id": did,
                    "titel": titel,
                    "eltern_id": eltern.get(did),
                    "anzahl_markierungen": zaehler.get(did, 0),
                }
            )
    return ergebnis


@app.get("/api/docs/{doc_id}")
def dokument_detail(doc_id: int, client: PaperlessClient = Depends(get_client)):
    """OCR-Text + vorhandene Markierungen eines Dokuments."""
    dok = client.get_document(doc_id)
    titel = dok.get("title") or f"Dokument {doc_id}"
    content = dok.get("content") or ""
    with db.verbindung() as conn:
        _ensure_dokument(conn, doc_id, titel)
        rows = conn.execute(
            "SELECT * FROM markierungen WHERE dokument_id=? ORDER BY seite, id", (doc_id,)
        ).fetchall()
        eltern = conn.execute("SELECT eltern_id FROM dokumente WHERE id=?", (doc_id,)).fetchone()
    return {
        "id": doc_id,
        "titel": titel,
        "content": content,
        "page_count": dok.get("page_count"),
        "eltern_id": eltern["eltern_id"] if eltern else None,
        "markierungen": [_markierung_dict(r) for r in rows],
    }


@app.post("/api/docs/{doc_id}/parent")
def hauptvertrag_setzen(
    doc_id: int,
    payload: models.ParentUpdate,
    client: PaperlessClient = Depends(get_client),
):
    """Ordnet einem Dokument einen Hauptvertrag zu (oder loest die Zuordnung)."""
    eltern = payload.eltern_id
    if eltern is not None and eltern == doc_id:
        raise HTTPException(400, "Ein Dokument kann nicht sein eigener Hauptvertrag sein")

    dok = client.get_document(doc_id)
    with db.verbindung() as conn:
        _ensure_dokument(conn, doc_id, dok.get("title") or f"Dokument {doc_id}")
        if eltern is not None:
            if conn.execute("SELECT 1 FROM dokumente WHERE id=?", (eltern,)).fetchone() is None:
                edok = client.get_document(eltern)
                _ensure_dokument(conn, eltern, edok.get("title") or f"Dokument {eltern}")
            if _wuerde_zyklus(conn, doc_id, eltern):
                raise HTTPException(400, "Zuordnung wuerde einen Zyklus erzeugen")
        conn.execute("UPDATE dokumente SET eltern_id=? WHERE id=?", (eltern, doc_id))
    return {"ok": True, "id": doc_id, "eltern_id": eltern}


# --- Themen --------------------------------------------------------------

@app.get("/api/themen", response_model=List[models.Thema])
def themen_liste():
    with db.verbindung() as conn:
        rows = conn.execute("SELECT * FROM themen ORDER BY name").fetchall()
    return [dict(r) for r in rows]


@app.post("/api/themen", response_model=models.Thema)
def thema_anlegen(payload: models.ThemaCreate):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Themenname darf nicht leer sein")
    erstellt = _jetzt()
    with db.verbindung() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO themen (name, erstellt_am) VALUES (?, ?)", (name, erstellt)
            )
        except sqlite3.IntegrityError:
            raise HTTPException(409, "Thema existiert bereits")
        row = conn.execute("SELECT * FROM themen WHERE id=?", (cur.lastrowid,)).fetchone()
    return dict(row)


# --- Markierungen --------------------------------------------------------

@app.post("/api/markierungen", response_model=models.Markierung)
def markierung_anlegen(
    payload: models.MarkierungCreate,
    client: PaperlessClient = Depends(get_client),
):
    dok = client.get_document(payload.dokument_id)
    titel = dok.get("title") or f"Dokument {payload.dokument_id}"
    content = dok.get("content") or ""

    seite = payload.seite if (payload.seite and payload.seite > 0) else None
    if seite is None:
        try:
            seiten = _seiten_text(client, payload.dokument_id)
            seite = pagination.finde_seite(seiten, payload.textauszug, payload.offset, content)
        except Exception:
            # Seitenzuordnung darf das Anlegen nicht verhindern -> Fallback Seite 1.
            seite = 1

    erstellt = _jetzt()
    with db.verbindung() as conn:
        _ensure_dokument(conn, payload.dokument_id, titel)
        if payload.thema_id is not None:
            if conn.execute("SELECT 1 FROM themen WHERE id=?", (payload.thema_id,)).fetchone() is None:
                raise HTTPException(404, "Thema nicht gefunden")
        cur = conn.execute(
            "INSERT INTO markierungen (dokument_id, thema_id, seite, textauszug, notiz, erstellt_am)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (payload.dokument_id, payload.thema_id, seite, payload.textauszug, payload.notiz, erstellt),
        )
        row = conn.execute("SELECT * FROM markierungen WHERE id=?", (cur.lastrowid,)).fetchone()
        ergebnis = _markierung_dict(row)

    _aktualisiere_hinweis(client, payload.dokument_id)
    return ergebnis


@app.delete("/api/markierungen/{markierung_id}")
def markierung_loeschen(
    markierung_id: int,
    client: PaperlessClient = Depends(get_client),
):
    with db.verbindung() as conn:
        row = conn.execute(
            "SELECT dokument_id FROM markierungen WHERE id=?", (markierung_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Markierung nicht gefunden")
        dokument_id = row["dokument_id"]
        conn.execute(
            "DELETE FROM verknuepfungen WHERE markierung_a_id=? OR markierung_b_id=?",
            (markierung_id, markierung_id),
        )
        conn.execute("DELETE FROM markierungen WHERE id=?", (markierung_id,))

    _aktualisiere_hinweis(client, dokument_id)
    return {"ok": True}


# --- Verknuepfungen ------------------------------------------------------

@app.post("/api/verknuepfungen", response_model=models.Verknuepfung)
def verknuepfung_anlegen(payload: models.VerknuepfungCreate):
    if payload.markierung_a_id == payload.markierung_b_id:
        raise HTTPException(400, "Eine Markierung kann nicht mit sich selbst verknuepft werden")
    with db.verbindung() as conn:
        for mid in (payload.markierung_a_id, payload.markierung_b_id):
            if conn.execute("SELECT 1 FROM markierungen WHERE id=?", (mid,)).fetchone() is None:
                raise HTTPException(404, f"Markierung {mid} nicht gefunden")
        cur = conn.execute(
            "INSERT INTO verknuepfungen (markierung_a_id, markierung_b_id) VALUES (?, ?)",
            (payload.markierung_a_id, payload.markierung_b_id),
        )
        vid = cur.lastrowid
    return {
        "id": vid,
        "markierung_a_id": payload.markierung_a_id,
        "markierung_b_id": payload.markierung_b_id,
    }


@app.delete("/api/verknuepfungen/{verknuepfung_id}")
def verknuepfung_loeschen(verknuepfung_id: int):
    with db.verbindung() as conn:
        cur = conn.execute("DELETE FROM verknuepfungen WHERE id=?", (verknuepfung_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Verknuepfung nicht gefunden")
    return {"ok": True}


# --- Themenuebersicht ----------------------------------------------------

@app.get("/api/uebersicht")
def uebersicht():
    """Themen + zugeordnete Markierungen (inkl. Verknuepfungen), gruppiert."""
    with db.verbindung() as conn:
        themen = conn.execute("SELECT * FROM themen ORDER BY name").fetchall()
        markierungen = conn.execute(
            """
            SELECT m.*, d.titel AS dokument_titel
            FROM markierungen m
            JOIN dokumente d ON d.id = m.dokument_id
            ORDER BY m.seite, m.id
            """
        ).fetchall()
        verkn = conn.execute("SELECT * FROM verknuepfungen").fetchall()

    links: Dict[int, set] = {}
    for v in verkn:
        links.setdefault(v["markierung_a_id"], set()).add(v["markierung_b_id"])
        links.setdefault(v["markierung_b_id"], set()).add(v["markierung_a_id"])

    def m_dict(m: sqlite3.Row) -> dict:
        return {
            "id": m["id"],
            "dokument_id": m["dokument_id"],
            "dokument_titel": m["dokument_titel"],
            "seite": m["seite"],
            "textauszug": m["textauszug"],
            "notiz": m["notiz"],
            "verknuepft_mit": sorted(links.get(m["id"], set())),
        }

    gruppen = []
    for t in themen:
        gruppen.append(
            {
                "thema_id": t["id"],
                "name": t["name"],
                "markierungen": [m_dict(m) for m in markierungen if m["thema_id"] == t["id"]],
            }
        )
    ohne = [m_dict(m) for m in markierungen if m["thema_id"] is None]
    if ohne:
        gruppen.append({"thema_id": None, "name": "Ohne Thema", "markierungen": ohne})
    return gruppen


# --- Frontend ------------------------------------------------------------

def _asset_version() -> str:
    """Cache-Busting-Marke: aendert sich bei jeder neuen app.js (Image-Build)."""
    try:
        return str(int((STATIC_DIR / "app.js").stat().st_mtime))
    except OSError:
        return "0"


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    """Liefert das Frontend, ingress-tauglich aufbereitet."""
    ingress = request.headers.get("X-Ingress-Path", "").rstrip("/")
    html = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    base_tag = f'<base href="{ingress}/">' if ingress else ""
    config_tag = f'<script>window.__VN__={{apiBase:"{ingress}"}};</script>'
    ver = _asset_version()
    html = (
        html.replace("<!--BASE-->", base_tag)
        .replace("<!--CONFIG-->", config_tag)
        .replace('href="static/style.css"', f'href="static/style.css?v={ver}"')
        .replace('src="static/app.js"', f'src="static/app.js?v={ver}"')
    )
    return HTMLResponse(html)


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
