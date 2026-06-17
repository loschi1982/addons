# Vertragsnavigator

Home-Assistant-Add-on, das Verträge aus **Paperless-ngx** thematisch erschließt.
Markiere relevante Textstellen, ordne sie Themen zu, verknüpfe abhängige Absätze
über Dokumente hinweg und springe aus der Themenübersicht direkt an die richtige
Seite im Original-PDF.

Paperless-ngx bleibt das Archiv – dieses Add-on legt eine Navigations- und
Strukturebene darüber.

## Funktionen
- **Vertragsbaum**: alle Paperless-Dokumente, optional als Hauptvertrag →
  Nachtrag-Hierarchie.
- **Dokumentenansicht**: OCR-Volltext, erfasste Stellen hervorgehoben, Markieren
  per Maus + Rechtsklick-Kontextmenü.
- **Themen**: Textausschnitte Themen zuordnen (z. B. Haftung, Laufzeit).
- **Themenübersicht**: alle Zuordnungen je Thema, mit Sprungmarke ins PDF
  (`…/documents/{id}/preview/#page={n}`).
- **Verknüpfungen**: abhängige Absätze manuell verbinden.
- **Paperless-Spiegel**: erfasste Seiten werden als menschenlesbare Notiz ins
  Paperless-Notizfeld geschrieben (fremde Notizen bleiben unberührt).

## Installation (HA Custom Repository)
1. In Home Assistant: **Einstellungen → Add-ons → Add-on-Store → ⋮ →
   Repositories** und die URL dieses Repos hinzufügen.
2. **Vertragsnavigator** installieren.
3. Unter **Konfiguration** setzen:
   - `paperless_url` – z. B. `http://homeassistant.local:8000`
   - `paperless_token` – API-Token aus Paperless (Einstellungen → API-Token)
4. Add-on starten und über die HA-Seitenleiste öffnen (Ingress).

## Konfiguration
| Option            | Beschreibung                          |
|-------------------|---------------------------------------|
| `paperless_url`   | Basis-URL der Paperless-ngx-Instanz   |
| `paperless_token` | Token-Auth (`Authorization: Token …`) |

## Daten & Backup
Alle App-Daten liegen in der SQLite-Datei `/data/vertragsnavigator.db` innerhalb
des Add-ons und werden von HA-Snapshots erfasst.

## Entwicklung
Siehe [CLAUDE.md](CLAUDE.md) für Architektur, Befehle und Design-Entscheidungen.

```bash
pip install -r requirements-dev.txt
pytest
```
