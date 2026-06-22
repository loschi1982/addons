"""FastAPI-App des Vertragsnavigators.

Bedient die interne API (App <-> Frontend) und liefert das statische Frontend
aus. Hinter HA-Ingress wird das Frontend mit passendem ``<base href>`` und
``apiBase`` ausgeliefert (Header ``X-Ingress-Path``).
"""

from __future__ import annotations

import secrets
import sqlite3
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response
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


# --- Authentifizierung (Login mit Paperless-Zugangsdaten) ----------------

SESSION_COOKIE = "vn_session"
SESSION_TTL = 12 * 60 * 60  # 12 Stunden

#: aktive Sessions: Token -> Ablauf-Zeitstempel (in-memory, Single-Process).
_sessions: Dict[str, float] = {}

#: Öffentliche Pfade (ohne Login erreichbar).
_OEFFENTLICH = {"/", "/api/login", "/api/logout", "/api/auth/status"}


def _neue_session() -> str:
    token = secrets.token_urlsafe(32)
    _sessions[token] = time.time() + SESSION_TTL
    return token


def _ist_angemeldet(request: Request) -> bool:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return False
    ablauf = _sessions.get(token)
    if not ablauf:
        return False
    if ablauf < time.time():
        _sessions.pop(token, None)
        return False
    return True


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if not get_settings().passwortschutz:
        return await call_next(request)
    pfad = request.url.path
    if pfad in _OEFFENTLICH or pfad.startswith("/static"):
        return await call_next(request)
    if pfad.startswith("/api/") and not _ist_angemeldet(request):
        return JSONResponse(status_code=401, content={"detail": "Nicht angemeldet"})
    return await call_next(request)


@app.get("/api/auth/status")
def auth_status(request: Request):
    settings = get_settings()
    return {
        "erforderlich": settings.passwortschutz,
        "angemeldet": (not settings.passwortschutz) or _ist_angemeldet(request),
    }


@app.post("/api/logout")
def logout(request: Request):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        _sessions.pop(token, None)
    antwort = JSONResponse({"ok": True})
    antwort.delete_cookie(SESSION_COOKIE, path="/")
    return antwort


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


@app.post("/api/login")
def login(payload: models.LoginRequest, client: PaperlessClient = Depends(get_client)):
    if not client.pruefe_zugangsdaten(payload.username, payload.password):
        raise HTTPException(401, "Benutzername oder Passwort falsch")
    token = _neue_session()
    antwort = JSONResponse({"ok": True})
    antwort.set_cookie(
        SESSION_COOKIE, token, httponly=True, samesite="lax", max_age=SESSION_TTL, path="/"
    )
    return antwort


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


#: Erlaubte Verweis-Arten (Nachtrag -> Originalvertrag).
ERLAUBTE_ARTEN = {"ergänzt", "erweitert", "geändert", "gestrichen"}


def _dokument_titel(conn: sqlite3.Connection, doc_id: int) -> str:
    row = conn.execute("SELECT titel FROM dokumente WHERE id=?", (doc_id,)).fetchone()
    return row["titel"] if row else f"Dokument {doc_id}"


def _verweis_fuer_dokument(conn: sqlite3.Connection, v: sqlite3.Row, doc_id: int) -> dict:
    """Bereitet einen Verweis aus Sicht des angezeigten Dokuments auf."""
    if v["ziel_dokument_id"] == doc_id:
        rolle = "ziel"
        eigene_seite, eigene_text = v["ziel_seite"], v["ziel_text"]
        andere_id, andere_seite, andere_text = v["quelle_dokument_id"], v["quelle_seite"], v["quelle_text"]
    else:
        rolle = "quelle"
        eigene_seite, eigene_text = v["quelle_seite"], v["quelle_text"]
        andere_id, andere_seite, andere_text = v["ziel_dokument_id"], v["ziel_seite"], v["ziel_text"]
    return {
        "id": v["id"],
        "art": v["art"],
        "rolle": rolle,
        "eigene_seite": eigene_seite,
        "eigene_text": eigene_text,
        "andere_dokument_id": andere_id,
        "andere_dokument_titel": _dokument_titel(conn, andere_id),
        "andere_seite": andere_seite,
        "andere_text": andere_text,
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
        # Browser-erreichbare URL fuer den "in Paperless oeffnen"-Link (Detailansicht).
        "paperless_external_url": settings.paperless_external_url,
        "konfiguriert": bool(settings.paperless_url and settings.paperless_token),
    }


# --- Dokumente / Vertragsbaum --------------------------------------------

@app.get("/api/docs")
def liste_dokumente(client: PaperlessClient = Depends(get_client)):
    """Vertragsbaum: alle Paperless-Dokumente, angereichert um lokale Daten."""
    paperless_docs = client.list_documents()
    try:
        tags_map = client.get_tags()
    except PaperlessError:
        tags_map = {}  # Tags sind optional – Listing darf daran nicht scheitern
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
            tag_namen = [tags_map.get(tid, str(tid)) for tid in (d.get("tags") or [])]
            ergebnis.append(
                {
                    "id": did,
                    "titel": titel,
                    "eltern_id": eltern.get(did),
                    "anzahl_markierungen": zaehler.get(did, 0),
                    "tags": tag_namen,
                }
            )
    return ergebnis


# --- Suche ---------------------------------------------------------------

def _passt(hay: str, woerter: List[str], modus: str, phrase: str) -> bool:
    if modus == "phrase":
        return phrase.lower() in hay
    if modus == "oder":
        return any(w.lower() in hay for w in woerter)
    return all(w.lower() in hay for w in woerter)  # und / stichwort


def _lokale_suche(woerter, modus, phrase, doc_filter):
    """Durchsucht Markierungen/Notizen und Themen (SQLite)."""
    treffer = []
    with db.verbindung() as conn:
        rows = conn.execute(
            "SELECT m.id, m.dokument_id, m.seite, m.textauszug, m.notiz, "
            "d.titel AS dokument_titel, t.name AS thema_name "
            "FROM markierungen m JOIN dokumente d ON d.id = m.dokument_id "
            "LEFT JOIN themen t ON t.id = m.thema_id ORDER BY m.seite, m.id"
        ).fetchall()
        for r in rows:
            if doc_filter is not None and r["dokument_id"] not in doc_filter:
                continue
            hay = ((r["textauszug"] or "") + " " + (r["notiz"] or "")).lower()
            if not _passt(hay, woerter, modus, phrase):
                continue
            treffer.append(
                {
                    "typ": "markierung",
                    "dokument_id": r["dokument_id"],
                    "dokument_titel": r["dokument_titel"],
                    "seite": r["seite"],
                    "thema_name": r["thema_name"],
                    "textauszug": r["textauszug"],
                    "notiz": r["notiz"],
                    "markierung_id": r["id"],
                }
            )
        for r in conn.execute("SELECT id, name FROM themen ORDER BY name").fetchall():
            if _passt((r["name"] or "").lower(), woerter, modus, phrase):
                treffer.append({"typ": "thema", "thema_id": r["id"], "name": r["name"]})
    return treffer


@app.get("/api/suche")
def suche(
    q: str = "",
    modus: str = "stichwort",
    tag: str = "",
    client: PaperlessClient = Depends(get_client),
):
    q = (q or "").strip()
    if not q:
        return {"dokumente": [], "lokal": []}
    woerter = q.split()

    if modus == "phrase":
        query = '"' + q + '"'
    elif modus == "und":
        query = " AND ".join(woerter)
    elif modus == "oder":
        query = " OR ".join(woerter)
    else:
        query = q

    # Objekt-Tag -> ID
    tag_id = None
    if tag:
        try:
            for tid, name in client.get_tags().items():
                if name == tag:
                    tag_id = tid
                    break
        except PaperlessError:
            tag_id = None
    tag_ids = [tag_id] if tag_id else None

    try:
        dokumente = client.suche_dokumente(query, tag_ids=tag_ids)
    except PaperlessError:
        dokumente = []

    doc_filter = None
    if tag_id:
        try:
            doc_filter = set(client.dokument_ids_mit_tag(tag_id))
        except PaperlessError:
            doc_filter = None

    return {"dokumente": dokumente, "lokal": _lokale_suche(woerter, modus, q, doc_filter)}


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
        vrows = conn.execute(
            "SELECT * FROM verweise WHERE quelle_dokument_id=? OR ziel_dokument_id=?",
            (doc_id, doc_id),
        ).fetchall()
        verweise = [_verweis_fuer_dokument(conn, v, doc_id) for v in vrows]
    return {
        "id": doc_id,
        "titel": titel,
        "content": content,
        "page_count": dok.get("page_count"),
        "eltern_id": eltern["eltern_id"] if eltern else None,
        "markierungen": [_markierung_dict(r) for r in rows],
        "verweise": verweise,
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


# --- PDF-Proxy (fuer Sprungmarken) --------------------------------------

@app.get("/api/pdf/{doc_id}")
def pdf_inline(doc_id: int, client: PaperlessClient = Depends(get_client)):
    """Liefert das Original-PDF inline aus (Proxy zu Paperless).

    Ermoeglicht Sprungmarken (#page=n) ueber die eigene Ingress-URL: Der
    Browser muss weder den internen Paperless-Hostnamen aufloesen noch laeuft
    der Aufruf in das Paperless-Ingress-Problem (SPA faengt /api/ ab). Das PDF
    wird intern per Token geladen und unveraendert weitergereicht.
    """
    pdf = client.download_pdf(doc_id)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="dokument-{doc_id}.pdf"'},
    )


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


@app.patch("/api/themen/{thema_id}", response_model=models.Thema)
def thema_umbenennen(thema_id: int, payload: models.ThemaUpdate):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Themenname darf nicht leer sein")
    with db.verbindung() as conn:
        if conn.execute("SELECT 1 FROM themen WHERE id=?", (thema_id,)).fetchone() is None:
            raise HTTPException(404, "Thema nicht gefunden")
        try:
            conn.execute("UPDATE themen SET name=? WHERE id=?", (name, thema_id))
        except sqlite3.IntegrityError:
            raise HTTPException(409, "Thema existiert bereits")
        row = conn.execute("SELECT * FROM themen WHERE id=?", (thema_id,)).fetchone()
    return dict(row)


@app.delete("/api/themen/{thema_id}")
def thema_loeschen(thema_id: int):
    """Löscht ein Thema; zugeordnete Markierungen bleiben erhalten (Thema -> NULL)."""
    with db.verbindung() as conn:
        if conn.execute("SELECT 1 FROM themen WHERE id=?", (thema_id,)).fetchone() is None:
            raise HTTPException(404, "Thema nicht gefunden")
        conn.execute("UPDATE markierungen SET thema_id=NULL WHERE thema_id=?", (thema_id,))
        conn.execute("DELETE FROM themen WHERE id=?", (thema_id,))
    return {"ok": True}


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


@app.patch("/api/markierungen/{markierung_id}", response_model=models.Markierung)
def markierung_aktualisieren(markierung_id: int, payload: models.MarkierungUpdate):
    """Setzt/ändert die Notiz (Post-It) einer bestehenden Markierung."""
    with db.verbindung() as conn:
        if conn.execute("SELECT 1 FROM markierungen WHERE id=?", (markierung_id,)).fetchone() is None:
            raise HTTPException(404, "Markierung nicht gefunden")
        conn.execute(
            "UPDATE markierungen SET notiz=? WHERE id=?", (payload.notiz, markierung_id)
        )
        row = conn.execute("SELECT * FROM markierungen WHERE id=?", (markierung_id,)).fetchone()
    return _markierung_dict(row)


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


# --- Verweise (gerichtete Änderungen zwischen PDFs) ----------------------

@app.post("/api/verweise")
def verweis_anlegen(payload: models.VerweisCreate):
    if payload.art not in ERLAUBTE_ARTEN:
        raise HTTPException(400, f"Unbekannte Verweis-Art: {payload.art}")
    erstellt = _jetzt()
    with db.verbindung() as conn:
        cur = conn.execute(
            "INSERT INTO verweise (quelle_dokument_id, quelle_seite, quelle_text, "
            "ziel_dokument_id, ziel_seite, ziel_text, art, erstellt_am) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                payload.quelle_dokument_id,
                payload.quelle_seite,
                payload.quelle_text,
                payload.ziel_dokument_id,
                payload.ziel_seite,
                payload.ziel_text,
                payload.art,
                erstellt,
            ),
        )
        vid = cur.lastrowid
    return {"id": vid}


@app.delete("/api/verweise/{verweis_id}")
def verweis_loeschen(verweis_id: int):
    with db.verbindung() as conn:
        cur = conn.execute("DELETE FROM verweise WHERE id=?", (verweis_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Verweis nicht gefunden")
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
    # index.html nie cachen, damit die ?v=-Marken der Assets stets aktuell sind.
    return HTMLResponse(html, headers={"Cache-Control": "no-store"})


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
