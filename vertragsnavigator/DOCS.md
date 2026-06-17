# Vertragsnavigator

Erschließt Verträge aus Paperless-ngx thematisch und verlinkt zurück ins
Original-PDF.

## Voraussetzungen
- Eine laufende **Paperless-ngx**-Instanz, erreichbar aus dem HA-Netzwerk.
- Ein **API-Token** (Paperless: *Einstellungen → API-Token*).

## Konfiguration
| Option            | Pflicht | Beschreibung                                    |
|-------------------|---------|-------------------------------------------------|
| `paperless_url`   | ja      | Basis-URL, z. B. `http://homeassistant.local:8000` (ohne Slash am Ende) |
| `paperless_token` | ja      | API-Token für die Token-Authentifizierung       |

Nach dem Speichern das Add-on **starten** und über die **Seitenleiste** öffnen.

## Bedienung
1. **Links** ein Dokument im Vertragsbaum wählen.
2. **Mitte**: Im OCR-Text Text mit der Maus markieren, **Rechtsklick** öffnet das
   Kontextmenü:
   - *Zu Thema hinzufügen* (bestehendes Thema oder „+ Neues Thema").
   - *Verknüpfen mit …* – danach auf eine andere hervorgehobene Stelle klicken.
   - *Notiz hinzufügen*.
3. **Rechts**: Themenübersicht. Klick auf eine Quelle öffnet das PDF im
   Paperless-Viewer auf der passenden Seite.
4. Im Dokumentkopf lässt sich ein **Hauptvertrag** zuordnen (Nachträge).

## Hinweise
- Die **Seitenzuordnung** wird aus dem PDF berechnet (Paperless liefert keinen
  seitenweisen Text). Bitte an deinen Dokumenten gegenprüfen.
- Im Paperless-Notizfeld erscheint ein Hinweis wie
  `Vertragsnavigator: Seiten 4, 7, 12 in Themenuebersicht erfasst.` – andere
  Notizen bleiben unberührt.
- **Tags** werden nicht verändert.

## Daten
SQLite-Datei unter `/data/vertragsnavigator.db` (von HA-Snapshots erfasst).
