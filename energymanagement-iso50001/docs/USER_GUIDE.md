# Benutzerhandbuch – Energy Management ISO 50001

## 1. Erste Schritte

### 1.1 Installation
Das Add-on wird über den Home Assistant Add-on Store installiert:
1. Einstellungen → Add-ons → Add-on Store
2. Repository hinzufügen (URL des GitHub-Repositories)
3. „Energy Management ISO 50001" installieren
4. Add-on starten

### 1.2 Erstanmeldung
- Beim ersten Start wird ein Setup-Assistent angezeigt
- Admin-Benutzer mit sicherem Passwort erstellen
- Das System leitet automatisch zum Dashboard weiter

### 1.3 Grundkonfiguration
Unter **Einstellungen** → **Organisation**:
- Firmenname und Adresse eintragen
- Logo-URL hinterlegen (wird in Berichten verwendet)
- Kontaktdaten für ISO-Dokumente pflegen

---

## 2. Standort- & Gebäudestruktur

### 2.1 Standorte anlegen
Unter **Standorte** → „Neuer Standort":
- Name, Adresse und Geo-Koordinaten eingeben
- Koordinaten bestimmen die zugehörige Wetterstation automatisch
- CO₂-Region wird aus dem Standort abgeleitet

### 2.2 Gebäude
Jedem Standort können Gebäude zugeordnet werden:
- Flächen in m² angeben (Brutto, Netto, beheizt, gekühlt)
- Gebäudetyp wählen (Büro, Produktion, Wohnen etc.)
- Der Gebäudetyp bestimmt die Referenzwerte für Benchmarking

### 2.3 Nutzungseinheiten
Gebäude können in Nutzungseinheiten unterteilt werden:
- z.B. Büroetage, Serverraum, Werkstatt
- Eigene Fläche und Personenzahl je Einheit
- Zielwerte für EnPI (kWh/m²) pro Einheit konfigurierbar

---

## 3. Zähler & Verbrauchserfassung

### 3.1 Zähler anlegen
Unter **Zähler** → „Neuer Zähler":
- Energietyp wählen (Strom, Gas, Wasser, Fernwärme etc.)
- Einheit wählen (kWh, m³, MWh, l)
- Datenquelle wählen (manuell, Shelly, Modbus, HA Entity)
- Zuordnung zu Nutzungseinheit (für EnPI-Berechnung)

### 3.2 Manuelle Eingabe
Unter **Zählerstände**:
- Zähler auswählen, Datum und Stand eingeben
- Verbrauch wird automatisch als Differenz zum Vorwert berechnet
- Plausibilitätsprüfung warnt bei ungewöhnlichen Werten

### 3.3 Automatische Erfassung
Unter **Integrationen**:
- **Shelly**: IP-Adresse eingeben, Kanal wählen → automatisches Polling
- **Modbus**: Host, Port, Register konfigurieren
- **Home Assistant**: HA Entity-ID zuordnen

### 3.4 CSV/Excel Import
Unter **Datenimport**:
- CSV- oder XLSX-Datei hochladen
- Spalten-Mapping konfigurieren (Zeitstempel, Zähler, Wert)
- Mappings können für wiederkehrende Importe gespeichert werden

---

## 4. CO₂-Emissionen

### 4.1 Dashboard
Die **CO₂-Emissionen**-Seite zeigt:
- Gesamt-CO₂ im aktuellen Jahr vs. Vorjahr
- Aufschlüsselung nach Energietyp (Pie-Chart)
- Scope-Aufschlüsselung (Scope 1 / Scope 2) nach GHG Protocol
- Monatlicher Trend

### 4.2 Emissionsfaktoren
- Vorkonfigurierte Faktoren aus deutschen Quellen (BAFA, UBA)
- Eigene Faktoren können ergänzt werden
- Prioritätskaskade: monatlich → jährlich → neuester verfügbarer

### 4.3 Export
Unter CO₂-Emissionen → „Export":
- **GHG Protocol CSV**: Detailliert nach Scope, Quelle, Standort
- **EMAS CSV**: Kernindikatoren mit Anteil-% pro Energieträger
- Beide Formate sind Excel-kompatibel (Semikolon, UTF-8 BOM)

---

## 5. Analysen & Benchmarking

### 5.1 Diagramme
Die **Analysen**-Seite bietet:
- Zeitreihen (Line/Area): Verbrauchsverlauf, Zoom-fähig
- Balkendiagramme: Monats-/Jahresvergleich
- Sankey-Diagramm: Energieflüsse
- Heatmap: Verbrauch nach Wochentag × Stunde

### 5.2 Benchmarking
Unter Analysen → Benchmarks:
- **kWh/m²**: Verbrauch pro Quadratmeter Nutzfläche
- **kWh/Mitarbeiter**: Verbrauch pro Person
- **Referenzwerte**: Vergleich mit VDI 3807 (Ampel: Gut/Mittel/Schlecht)
- **Zielwert-Abweichung**: Ist vs. Soll in Prozent
- Aggregation pro Gebäude und Energietyp

### 5.3 Anomalie-Erkennung
Automatische Erkennung ungewöhnlicher Verbrauchsmuster:
- Tagesverbrauch > X× Durchschnitt wird als Anomalie markiert
- Schwellenwert und Zeitraum konfigurierbar

---

## 6. Witterungskorrektur

### 6.1 Prinzip
Heizenergieverbrauch wird anhand von Gradtagszahlen bereinigt:
- Heizgradtage (HDD): Wie kalt war es?
- Kühlgradtage (CDD): Wie warm war es?
- Korrigierter Verbrauch ermöglicht fairen Jahresvergleich

### 6.2 Konfiguration
Bei Zählern mit Heizungs-/Kühlungsbezug:
- „Witterungskorrektur" aktivieren
- Referenzstandort wird automatisch zugeordnet
- Wetterdaten werden stündlich von Bright Sky API abgerufen

---

## 7. ISO 50001 Management

### 7.1 Kontext (Kap. 4)
Unter **ISO 50001** → Tab „Kontext":
- Anwendungsbereich des EnMS definieren
- Grenzen und interessierte Parteien dokumentieren

### 7.2 Energiepolitik (Kap. 5)
Tab „Energiepolitik":
- Versionierte Energiepolitik erstellen
- Nur eine Version kann als „aktuell" markiert sein
- Ältere Versionen bleiben als Historie erhalten

### 7.3 Rollen & Verantwortlichkeiten (Kap. 5.3)
Tab „Rollen":
- EnMS-Rollen definieren (Energiemanager, Energiebeauftragter etc.)
- Verantwortlichkeiten und Befugnisse zuweisen
- Personen zuordnen

### 7.4 Energieziele & Aktionspläne (Kap. 6.2)
Tab „Energieziele":
- Messbare Ziele mit Basis- und Zielwert definieren
- Aktionspläne mit Verantwortlichen und Fristen zuordnen
- Fortschrittsbalken zeigt automatisch den Status

### 7.5 Risiken & Chancen (Kap. 6.1)
Tab „Risiken":
- Risiken und Chancen erfassen
- Eintrittswahrscheinlichkeit und Auswirkung bewerten (je 1–5)
- Risikoscore wird automatisch berechnet (Likelihood × Impact)
- 5×5-Risikomatrix visualisiert die Bewertung

### 7.6 Dokumentenlenkung (Kap. 7.5)
Tab „Dokumente":
- Dokumente hochladen und versionieren
- Überprüfungstermine festlegen
- Warnung bei fälligen Überprüfungen (konfigurierbar)

### 7.7 Rechtskataster
Tab „Rechtliche Anforderungen":
- Gesetze, Verordnungen, Normen erfassen
- Compliance-Status tracken (konform/teilweise/nicht konform)
- Ampel-Übersicht

### 7.8 Internes Audit (Kap. 9.2)
Tab „Audits":
- Audits planen und durchführen
- **ISO 50001 Checkliste**: 20 Klauseln (4.1–10.2) mit Bewertung
- Befunde erfassen (Beobachtung, Neben-/Hauptabweichung)
- Befund → Nichtkonformität mit einem Klick

### 7.9 Managementbewertung (Kap. 9.3)
Tab „Management Reviews":
- **Auto-Prefill**: Daten werden automatisch aus dem System aggregiert
  (EnPI-Status, Audit-Ergebnisse, offene NKs, Compliance, Zielfortschritt)
- Entscheidungen und Maßnahmen dokumentieren

### 7.10 Nichtkonformitäten & CAPA (Kap. 10.1)
Tab „Nichtkonformitäten":
- NKs mit Schweregrad (minor/major) erfassen
- **5-Why Ursachenanalyse**: Strukturierte Formulareingabe
- Korrekturmaßnahmen zuordnen
- Wirksamkeitsprüfung dokumentieren
- Überfällige NKs werden rot markiert

---

## 8. Berichte

### 8.1 Berichtserstellung
Unter **Berichte**:
- Berichtstyp wählen (Energieaudit, Monatsbericht, Jahresbericht)
- Zeitraum und Zählerauswahl konfigurieren
- PDF wird als Hintergrund-Task generiert

### 8.2 Berichtsinhalt
Jeder Bericht enthält:
- Energiebilanz nach Energieträger
- CO₂-Bilanz mit Scope-Aufschlüsselung
- Witterungsbereinigter Verbrauch (wenn aktiviert)
- EnPI-Kennzahlen
- Trendanalyse vs. Vorjahr

---

## 9. Einstellungen

### 9.1 Organisation
Firmenname, Adresse, Logo – werden in Berichten und ISO-Dokumenten verwendet.

### 9.2 Branding
Farben für UI und Berichte anpassen:
- Primärfarbe (Standard: #1B5E7B Petrol)
- Sekundärfarbe, Akzentfarbe
- Live-Vorschau der Farbwahl

### 9.3 Berichte
Standard-Einstellungen für die Berichtsgenerierung:
- Berichtssprache (DE/EN)
- Standard-Zeitraum
- Logo, Witterungskorrektur, CO₂ ein-/ausschalten

### 9.4 EnPI
Konfiguration der Energieleistungskennzahlen:
- Aktive Kennzahlen wählen (kWh/m², kWh/Mitarbeiter etc.)
- Referenzstandard (VDI 3807, DIN V 18599)

### 9.5 Benachrichtigungen
- Dokumenten-Überprüfungs-Erinnerung (Tage vor Fälligkeit)
- Audit-Erinnerung (Tage vor geplanter Durchführung)

---

## 10. Sprache

Das System unterstützt Deutsch und Englisch:
- Sprachumschalter in der Sidebar (Globe-Symbol)
- Sprache wird im Browser gespeichert
- Berichtssprache separat konfigurierbar

---

## 11. Tastaturkürzel & Navigation

- Seitenleiste ein-/ausklappen: Klick auf Pfeil-Symbol
- Alle Seiten sind über die Seitenleiste erreichbar
- Breadcrumbs ermöglichen Navigation in Unter-Seiten
