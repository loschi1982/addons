# Vertragsnavigator

Erschließt Verträge aus Paperless-ngx thematisch und verlinkt zurück ins
Original-PDF.

## Voraussetzungen
- Eine laufende **Paperless-ngx**-Instanz, erreichbar aus dem HA-Netzwerk.
- Ein **API-Token** (Paperless: *Einstellungen → API-Token*).

## Konfiguration
| Option                   | Pflicht | Beschreibung                                                                 |
|--------------------------|---------|-----------------------------------------------------------------------------|
| `paperless_url`          | ja      | Interne API-URL (App → Paperless), z. B. `http://ca5234a0-paperless-ngx:8000` (Add-on-Hostname, ohne Slash am Ende) |
| `paperless_token`        | ja      | API-Token für die Token-Authentifizierung                                   |
| `paperless_external_url` | nein    | Optional/Legacy. Wird **nicht** mehr für die Sprungmarken benötigt (das PDF kommt über das Add-on selbst). Kann leer bleiben. |

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
- Die **Sprungmarke** liefert das PDF über das Add-on selbst aus
  (`…/api/pdf/{id}#page={n}`) und springt im Browser-PDF-Viewer zur Seite.
  Dafür ist **keine** `paperless_external_url` nötig.
- Im Paperless-Notizfeld erscheint ein Hinweis wie
  `Vertragsnavigator: Seiten 4, 7, 12 in Themenuebersicht erfasst.` – andere
  Notizen bleiben unberührt.
- **Tags** werden nicht verändert.

## Daten
SQLite-Datei unter `/data/vertragsnavigator.db` (von HA-Snapshots erfasst).
