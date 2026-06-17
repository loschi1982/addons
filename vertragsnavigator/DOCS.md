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
| `passwortschutz`         | nein    | Wenn aktiv (Standard), verlangt das Add-on einen **Login mit den Paperless-Zugangsdaten** (zusätzlich zur HA-Anmeldung). Auf `false` setzen, um den Login abzuschalten (Notausgang, falls die Paperless-Anmeldung nicht erreichbar ist). |

Nach dem Speichern das Add-on **starten** und über die **Seitenleiste** öffnen.

## Anmeldung
Standardmäßig erscheint beim Öffnen eine **Login-Maske**. Melde dich mit deinem
**Paperless-Benutzernamen und -Passwort** an (dieselben Zugangsdaten wie in Paperless;
geprüft via Paperless-API). Die Sitzung gilt ca. 12 Stunden bzw. bis zum Add-on-Neustart;
rechts oben kannst du dich **abmelden**. Der Login lässt sich über die Option
`passwortschutz: false` deaktivieren.

## Bedienung
1. **Links** der Vertragsbaum. Oben **„Objekt"** wählt die Gruppierung: **Alle Objekte**
   (gruppiert nach Paperless-**Tags**), ein **einzelnes Objekt** (nur dessen Verträge)
   oder **keine Gruppierung**. Tags werden aus Paperless übernommen (und dort nicht
   verändert). Per **Drag & Drop** lässt sich ein Vertrag auf einen anderen ziehen →
   er wird dessen **Nachtrag**; Ziehen auf einen Objekt-Kopf/freie Fläche macht ihn
   wieder zum **Hauptvertrag**. Klick auf ein Dokument öffnet es.
2. **Mitte**: Standardmäßig wird das **PDF** angezeigt (vertraute Vertragsoptik)
   mit einer unsichtbaren, **markierbaren Textebene** darüber. Text mit der Maus
   markieren, **Rechtsklick** öffnet das Kontextmenü:
   - *Zu Thema hinzufügen* (bestehendes Thema oder „+ Neues Thema").
   - *Verknüpfen mit …* – danach auf eine andere hervorgehobene Stelle klicken.
   - *Notiz hinzufügen*.
   Bereits erfasste Stellen sind im PDF farbig hervorgehoben. Die Seitenzahl ist
   beim Markieren im PDF exakt bekannt. Über den Umschalter **„PDF" / „Text"** im
   Dokumentkopf kann auf den reinen OCR-Text gewechselt werden (ebenfalls
   markierbar). Mit **„+" / „−"** im Dokumentkopf lässt sich das PDF zoomen.
3. **Rechts**: die **Themenliste** (nur die angelegten Themen + Anzahl). Klick auf
   ein Thema öffnet die **Zusammenfassung** als Overlay – alle Markierungen des
   Themas getrennt, je mit Quelle, PDF-Sprunglink und ggf. „🗂 Paperless"-Link.
   Pro Markierung kann dort eine **Notiz (Post-It)** angelegt/bearbeitet werden.
   Im Overlay-Kopf lässt sich das Thema **umbenennen (✎)** oder **löschen (🗑)** –
   beim Löschen bleiben die Markierungen erhalten und werden „Ohne Thema".
4. Im Dokumentkopf lässt sich ein **Hauptvertrag** zuordnen (Nachträge).
5. **Verweise zwischen PDFs** (Änderungen durch Nachträge): Im **Nachtrag** die Stelle
   markieren → Rechtsklick → **„↪ Verweis von hier starten"**. Dann den
   **Originalvertrag** öffnen, dort die betroffene Stelle markieren → Rechtsklick →
   **„Verweis abschließen"** und die **Art** wählen (ergänzt / erweitert / geändert /
   gestrichen). Im Original-PDF wird die Stelle markiert (durchgestrichen bei
   gestrichen/geändert, dezent unterstrichen bei ergänzt/erweitert), und der
   **Nachtragstext erscheint als Notiz in der rechten Randspalte** auf Höhe der
   Stelle (mit einer blassen Verbindungslinie zur Markierung) – ohne den
   Originaltext zu überdecken. Ein Klick auf die Randnotiz springt
   zum Gegenstück im anderen PDF; das **✕** löscht den Verweis. (Wird die Stelle im
   PDF-Text nicht eindeutig gefunden, ist die Randnotiz gestrichelt umrandet.)

## Hinweise
- Die **PDF-Ansicht** nutzt PDF.js, das beim Öffnen vom CDN (cdnjs) geladen wird –
  der Browser braucht dafür Internet. Ohne Internet auf die **„Text"**-Ansicht
  wechseln.
- Beim Markieren in der **„Text"**-Ansicht wird die **Seitenzuordnung** aus dem PDF
  berechnet (Paperless liefert keinen seitenweisen Text); im **PDF** ist die Seite
  exakt bekannt.
- In der Themen-Zusammenfassung gibt es pro Markierung Links:
  - **📄 … · S. n** – öffnet das Dokument **im Add-on** (mittlere PDF-Ansicht) und
    scrollt zur Markierung bzw. Seite. Kein neues Fenster, keine externe URL nötig.
  - **🗂 Paperless** – öffnet die Paperless-Detailansicht (mit Notizen/Metadaten)
    in einem neuen Tab. Nur sichtbar, wenn `paperless_external_url` gesetzt ist.
- Im Paperless-Notizfeld erscheint ein Hinweis wie
  `Vertragsnavigator: Seiten 4, 7, 12 in Themenuebersicht erfasst.` – andere
  Notizen bleiben unberührt.
- **Tags** werden nicht verändert.

## Daten
SQLite-Datei unter `/data/vertragsnavigator.db` (von HA-Snapshots erfasst).
