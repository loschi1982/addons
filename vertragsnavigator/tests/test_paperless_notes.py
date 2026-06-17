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
        {"id": 2, "note": "Vertragsnavigator: alter Stand in Themenübersicht erfasst."},
    ]
    client, geloescht, hinzugefuegt = _client_mit_notes(notes)

    client.set_navigator_hint(5, "Haftung (S. 1, 2)")

    assert geloescht == [2]  # nur die eigene Note geloescht
    assert len(hinzugefuegt) == 1
    assert hinzugefuegt[0].startswith(HINWEIS_PREFIX)
    assert "Haftung (S. 1, 2)" in hinzugefuegt[0]
    assert hinzugefuegt[0].endswith("in Themenübersicht erfasst.")


def test_ohne_zusammenfassung_wird_nur_geloescht():
    notes = [{"id": 9, "note": "Vertragsnavigator: Laufzeit (S. 4) in Themenübersicht erfasst."}]
    client, geloescht, hinzugefuegt = _client_mit_notes(notes)

    client.set_navigator_hint(1, "")

    assert geloescht == [9]
    assert hinzugefuegt == []


def test_themenname_im_hinweis():
    client, _, hinzugefuegt = _client_mit_notes([])
    client.set_navigator_hint(1, "Haftung (S. 4, 7), Laufzeit (S. 12)")
    assert "Haftung (S. 4, 7)" in hinzugefuegt[0]
    assert "Laufzeit (S. 12)" in hinzugefuegt[0]
