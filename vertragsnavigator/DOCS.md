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
| `paperless_external_url` | nein    | Vom **Browser** erreichbare Paperless-URL (z. B. `https://homeassistant.elphi.musik/ca5234a0_paperless-ngx`). Nur für den zusätzlichen „🗂 Paperless"-Link (Detailansicht mit Notizen). Leer = dieser Link wird ausgeblendet; der PDF-Seitensprung funktioniert trotzdem. |

Nach dem Speichern das Add-on **starten** und über die **Seitenleiste** öffnen.

## Bedienung
1. **Links** ein Dokument im Vertragsbaum wählen.
2. **Mitte**: Standardmäßig wird das **PDF** angezeigt (vertraute Vertragsoptik)
   mit einer unsichtbaren, **markierbaren Textebene** darüber. Text mit der Maus
   markieren, **Rechtsklick** öffnet das Kontextmenü:
   - *Zu Thema hinzufügen* (bestehendes Thema oder „+ Neues Thema").
   - *Verknüpfen mit …* – danach auf eine andere hervorgehobene Stelle klicken.
   - *Notiz hinzufügen*.
   Bereits erfasste Stellen sind im PDF farbig hervorgehoben. Die Seitenzahl ist
   beim Markieren im PDF exakt bekannt. Über den Umschalter **„PDF" / „Text"** im
   Dokumentkopf kann auf den reinen OCR-Text gewechselt werden (ebenfalls
   markierbar).
3. **Rechts**: die **Themenliste** (nur die angelegten Themen + Anzahl). Klick auf
   ein Thema öffnet die **Zusammenfassung** als Overlay – alle Markierungen des
   Themas getrennt, je mit Quelle, PDF-Sprunglink und ggf. „🗂 Paperless"-Link.
4. Im Dokumentkopf lässt sich ein **Hauptvertrag** zuordnen (Nachträge).

## Hinweise
- Die **PDF-Ansicht** nutzt PDF.js, das beim Öffnen vom CDN (cdnjs) geladen wird –
  der Browser braucht dafür Internet. Ohne Internet auf die **„Text"**-Ansicht
  wechseln.
- Beim Markieren in der **„Text"**-Ansicht wird die **Seitenzuordnung** aus dem PDF
  berechnet (Paperless liefert keinen seitenweisen Text); im **PDF** ist die Seite
  exakt bekannt.
- In der Themen-Zusammenfassung gibt es pro Markierung Links:
  - **📄 … · S. n** – liefert das PDF über das Add-on aus (`…/api/pdf/{id}#page={n}`)
    und springt im Browser-PDF-Viewer auf die Seite. Braucht **keine** externe URL.
  - **🗂 Paperless** – öffnet die Paperless-Detailansicht (mit Notizen/Metadaten),
    ohne Seitensprung. Nur sichtbar, wenn `paperless_external_url` gesetzt ist.
- Im Paperless-Notizfeld erscheint ein Hinweis wie
  `Vertragsnavigator: Seiten 4, 7, 12 in Themenuebersicht erfasst.` – andere
  Notizen bleiben unberührt.
- **Tags** werden nicht verändert.

## Daten
SQLite-Datei unter `/data/vertragsnavigator.db` (von HA-Snapshots erfasst).
