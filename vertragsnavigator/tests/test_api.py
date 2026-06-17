"""Integrationstests der internen API (FastAPI TestClient).

Paperless wird durch einen Fake-Client ersetzt; die SQLite-DB liegt in tmp.
"""

import pytest
from fastapi.testclient import TestClient


class FakeClient:
    """Minimaler Ersatz fuer den Paperless-Client."""

    def __init__(self):
        self.hinweise = []
        self.docs = {
            1: {"title": "Hauptvertrag", "content": "Die Haftung ist begrenzt. Laufzeit zwei Jahre.", "notes": [], "page_count": 3, "tags": [10]},
            2: {"title": "Nachtrag A", "content": "Ergaenzung zur Laufzeit.", "notes": [], "page_count": 1, "tags": [10, 20]},
        }

    def list_documents(self):
        return [{"id": i, "title": d["title"], "tags": d.get("tags", [])} for i, d in self.docs.items()]

    def get_tags(self):
        return {10: "Elbphilharmonie", 20: "Laeiszhalle"}

    def get_document(self, doc_id):
        d = self.docs[doc_id]
        return {"id": doc_id, **d}

    def download_pdf(self, doc_id, original=False):
        return b""

    def set_navigator_hint(self, doc_id, zusammenfassung):
        self.hinweise.append((doc_id, zusammenfassung))


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VN_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("PAPERLESS_URL", "http://paperless.local")
    monkeypatch.setenv("PAPERLESS_TOKEN", "tok")

    from app import main

    fake = FakeClient()
    main.app.dependency_overrides[main.get_client] = lambda: fake
    main._seiten_cache.clear()

    with TestClient(main.app) as c:
        c.fake = fake
        yield c

    main.app.dependency_overrides.clear()


def test_config(client):
    r = client.get("/api/config")
    assert r.status_code == 200
    body = r.json()
    assert body["konfiguriert"] is True
    # Ohne gesetzte externe URL ist das Feld leer (kein Paperless-Detail-Link).
    assert body["paperless_external_url"] == ""


def test_pdf_inline(client):
    r = client.get("/api/pdf/1")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert "inline" in r.headers.get("content-disposition", "")


def test_vertragsbaum_und_detail(client):
    r = client.get("/api/docs")
    assert r.status_code == 200
    docs = r.json()
    assert {d["id"] for d in docs} == {1, 2}
    # Tags (Objekte) werden aus Paperless übernommen und als Namen geliefert
    byid = {d["id"]: d for d in docs}
    assert byid[1]["tags"] == ["Elbphilharmonie"]
    assert byid[2]["tags"] == ["Elbphilharmonie", "Laeiszhalle"]

    r = client.get("/api/docs/1")
    detail = r.json()
    assert detail["titel"] == "Hauptvertrag"
    assert "Haftung" in detail["content"]
    assert detail["markierungen"] == []


def test_thema_anlegen_und_unique(client):
    r = client.post("/api/themen", json={"name": "Haftung"})
    assert r.status_code == 200
    assert r.json()["name"] == "Haftung"

    # doppelt -> 409
    r = client.post("/api/themen", json={"name": "Haftung"})
    assert r.status_code == 409


def test_markierung_workflow(client):
    tid = client.post("/api/themen", json={"name": "Haftung"}).json()["id"]

    # Seite explizit -> kein PDF-Download noetig
    r = client.post(
        "/api/markierungen",
        json={"dokument_id": 1, "thema_id": tid, "textauszug": "Haftung ist begrenzt", "seite": 2},
    )
    assert r.status_code == 200
    m = r.json()
    assert m["seite"] == 2

    # Baum zeigt Markierungszahl
    docs = {d["id"]: d for d in client.get("/api/docs").json()}
    assert docs[1]["anzahl_markierungen"] == 1

    # Hinweis wurde nach Paperless gespiegelt (inkl. Themenname)
    assert client.fake.hinweise[-1] == (1, "Haftung (S. 2)")

    # Uebersicht enthaelt das Thema mit der Markierung
    gruppen = client.get("/api/uebersicht").json()
    haftung = next(g for g in gruppen if g["name"] == "Haftung")
    assert len(haftung["markierungen"]) == 1
    assert haftung["markierungen"][0]["dokument_titel"] == "Hauptvertrag"
    assert haftung["markierungen"][0]["seite"] == 2


def test_seitenzuordnung_ueber_pdf_wenn_seite_fehlt(client, monkeypatch):
    # download_pdf liefert leer -> seiten_text wuerde scheitern; wir patchen die
    # Seitentexte direkt, um die serverseitige Zuordnung zu pruefen.
    from app import main

    monkeypatch.setattr(
        main, "_seiten_text", lambda c, doc_id: ["erste seite", "die laufzeit klausel", "dritte"]
    )
    r = client.post(
        "/api/markierungen",
        json={"dokument_id": 1, "textauszug": "Laufzeit Klausel"},
    )
    assert r.status_code == 200
    assert r.json()["seite"] == 2


def test_thema_umbenennen_und_loeschen(client):
    tid = client.post("/api/themen", json={"name": "Haftung"}).json()["id"]

    # Umbenennen
    r = client.patch("/api/themen/" + str(tid), json={"name": "Haftungsklauseln"})
    assert r.status_code == 200
    assert r.json()["name"] == "Haftungsklauseln"

    # Markierung an dem Thema
    m = client.post(
        "/api/markierungen",
        json={"dokument_id": 1, "thema_id": tid, "textauszug": "Haftung ist begrenzt", "seite": 1},
    ).json()

    # UNIQUE-Konflikt beim Umbenennen
    tid2 = client.post("/api/themen", json={"name": "Laufzeit"}).json()["id"]
    assert client.patch("/api/themen/" + str(tid2), json={"name": "Haftungsklauseln"}).status_code == 409

    # Löschen -> Markierung bleibt erhalten, thema_id wird NULL
    assert client.delete("/api/themen/" + str(tid)).status_code == 200
    detail = client.get("/api/docs/1").json()
    mk = next(x for x in detail["markierungen"] if x["id"] == m["id"])
    assert mk["thema_id"] is None

    # Erneutes Löschen -> 404
    assert client.delete("/api/themen/" + str(tid)).status_code == 404


def test_notiz_aktualisieren(client):
    m = client.post(
        "/api/markierungen",
        json={"dokument_id": 1, "textauszug": "Haftung ist begrenzt", "seite": 1},
    ).json()

    r = client.patch("/api/markierungen/" + str(m["id"]), json={"notiz": "Wichtig!"})
    assert r.status_code == 200
    assert r.json()["notiz"] == "Wichtig!"

    gruppen = client.get("/api/uebersicht").json()
    alle = {mk["id"]: mk for g in gruppen for mk in g["markierungen"]}
    assert alle[m["id"]]["notiz"] == "Wichtig!"

    # Leeren der Notiz
    r = client.patch("/api/markierungen/" + str(m["id"]), json={"notiz": None})
    assert r.json()["notiz"] is None

    # Unbekannte Markierung -> 404
    assert client.patch("/api/markierungen/99999", json={"notiz": "x"}).status_code == 404


def test_verweise(client):
    # Nachtrag (Doc 2) ändert eine Stelle im Originalvertrag (Doc 1)
    r = client.post(
        "/api/verweise",
        json={
            "quelle_dokument_id": 2,
            "quelle_seite": 1,
            "quelle_text": "Ergaenzung zur Laufzeit",
            "ziel_dokument_id": 1,
            "ziel_seite": 2,
            "ziel_text": "Laufzeit zwei Jahre",
            "art": "geändert",
        },
    )
    assert r.status_code == 200
    vid = r.json()["id"]

    # Im Originalvertrag als "ziel" sichtbar
    d1 = client.get("/api/docs/1").json()
    v1 = next(v for v in d1["verweise"] if v["id"] == vid)
    assert v1["rolle"] == "ziel"
    assert v1["eigene_seite"] == 2
    assert v1["andere_dokument_id"] == 2
    assert v1["art"] == "geändert"

    # Im Nachtrag als "quelle" sichtbar
    d2 = client.get("/api/docs/2").json()
    v2 = next(v for v in d2["verweise"] if v["id"] == vid)
    assert v2["rolle"] == "quelle"
    assert v2["eigene_seite"] == 1

    # Ungültige Art -> 400
    bad = client.post(
        "/api/verweise",
        json={
            "quelle_dokument_id": 2, "quelle_seite": 1, "quelle_text": "x",
            "ziel_dokument_id": 1, "ziel_seite": 1, "ziel_text": "y", "art": "unsinn",
        },
    )
    assert bad.status_code == 400

    # Löschen (+ 404 beim zweiten Mal)
    assert client.delete("/api/verweise/" + str(vid)).status_code == 200
    assert client.delete("/api/verweise/" + str(vid)).status_code == 404


def test_hauptvertrag_hierarchie(client):
    # Beide Dokumente lokal bekannt machen
    client.get("/api/docs")
    r = client.post("/api/docs/2/parent", json={"eltern_id": 1})
    assert r.status_code == 200

    docs = {d["id"]: d for d in client.get("/api/docs").json()}
    assert docs[2]["eltern_id"] == 1

    # Zyklus verhindern: 1 -> 2 (waere Zyklus, da 2 Kind von 1)
    r = client.post("/api/docs/1/parent", json={"eltern_id": 2})
    assert r.status_code == 400

    # Selbstbezug verhindern
    r = client.post("/api/docs/1/parent", json={"eltern_id": 1})
    assert r.status_code == 400


def test_verknuepfung_und_loeschen(client):
    m1 = client.post(
        "/api/markierungen",
        json={"dokument_id": 1, "textauszug": "Haftung ist begrenzt", "seite": 1},
    ).json()
    m2 = client.post(
        "/api/markierungen",
        json={"dokument_id": 2, "textauszug": "Ergaenzung zur Laufzeit", "seite": 1},
    ).json()

    r = client.post(
        "/api/verknuepfungen",
        json={"markierung_a_id": m1["id"], "markierung_b_id": m2["id"]},
    )
    assert r.status_code == 200

    gruppen = client.get("/api/uebersicht").json()
    alle = {mk["id"]: mk for g in gruppen for mk in g["markierungen"]}
    assert m2["id"] in alle[m1["id"]]["verknuepft_mit"]

    # Markierung loeschen entfernt auch ihre Verknuepfungen
    assert client.delete("/api/markierungen/" + str(m1["id"])).status_code == 200
    gruppen = client.get("/api/uebersicht").json()
    alle = {mk["id"]: mk for g in gruppen for mk in g["markierungen"]}
    assert m1["id"] not in alle
    assert alle[m2["id"]]["verknuepft_mit"] == []


def test_verknuepfung_self_verboten(client):
    m1 = client.post(
        "/api/markierungen",
        json={"dokument_id": 1, "textauszug": "Haftung ist begrenzt", "seite": 1},
    ).json()
    r = client.post(
        "/api/verknuepfungen",
        json={"markierung_a_id": m1["id"], "markierung_b_id": m1["id"]},
    )
    assert r.status_code == 400
