"""Tests fuer den Paperless-Notiz-Spiegel (Abschnitt 3.2 der Spec).

Wichtig: Der eigene Hinweis (Prefix ``Vertragsnavigator:``) wird ersetzt,
fremde Notizen bleiben unberuehrt.
"""

from app.paperless import HINWEIS_PREFIX, PaperlessClient


def _client_mit_notes(notes):
    """Liefert einen Client, dessen Notiz-Operationen aufgezeichnet werden."""
    client = PaperlessClient("http://paperless.local", "token")
    geloescht = []
    hinzugefuegt = []
    client.get_notes = lambda doc_id: notes
    client.delete_note = lambda doc_id, note_id: geloescht.append(note_id)
    client.add_note = lambda doc_id, text: hinzugefuegt.append(text)
    return client, geloescht, hinzugefuegt


def test_ersetzt_eigene_note_und_laesst_fremde_unberuehrt():
    notes = [
        {"id": 1, "note": "Wichtige fremde Notiz vom Nutzer"},
        {"id": 2, "note": "Vertragsnavigator: Seiten 1, 2 in Themenuebersicht erfasst."},
    ]
    client, geloescht, hinzugefuegt = _client_mit_notes(notes)

    client.set_navigator_hint(5, [3, 1, 7, 1])

    assert geloescht == [2]  # nur die eigene Note geloescht
    assert len(hinzugefuegt) == 1
    assert hinzugefuegt[0].startswith(HINWEIS_PREFIX)
    assert "1, 3, 7" in hinzugefuegt[0]  # sortiert + dedupliziert


def test_ohne_seiten_wird_nur_geloescht():
    notes = [{"id": 9, "note": "Vertragsnavigator: Seite 4 in Themenuebersicht erfasst."}]
    client, geloescht, hinzugefuegt = _client_mit_notes(notes)

    client.set_navigator_hint(1, [])

    assert geloescht == [9]
    assert hinzugefuegt == []


def test_singular_bei_einer_seite():
    client, _, hinzugefuegt = _client_mit_notes([])
    client.set_navigator_hint(1, [4])
    assert "Seite 4" in hinzugefuegt[0]
    assert "Seiten" not in hinzugefuegt[0]


def test_plural_bei_mehreren_seiten():
    client, _, hinzugefuegt = _client_mit_notes([])
    client.set_navigator_hint(1, [4, 7])
    assert "Seiten 4, 7" in hinzugefuegt[0]
