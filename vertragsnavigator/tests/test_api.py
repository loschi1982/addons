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
            1: {"title": "Hauptvertrag", "content": "Die Haftung ist begrenzt. Laufzeit zwei Jahre.", "notes": [], "page_count": 3},
            2: {"title": "Nachtrag A", "content": "Ergaenzung zur Laufzeit.", "notes": [], "page_count": 1},
        }

    def list_documents(self):
        return [{"id": i, "title": d["title"]} for i, d in self.docs.items()]

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
