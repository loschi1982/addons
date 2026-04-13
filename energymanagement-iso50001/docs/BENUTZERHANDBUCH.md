# Benutzerhandbuch – Energiemanagementsystem ISO 50001

**Version:** 1.0 | **Stand:** 2026-04 | **Sprache:** Deutsch

> Dieses Handbuch erklärt alle Funktionen des Systems. Es ist als Markdown-Datei bearbeitbar
> und kann direkt in VS Code, Obsidian, GitHub oder als PDF exportiert werden.

---

## Inhaltsverzeichnis

1. [Systemübersicht](#1-systemübersicht)
2. [Erste Schritte – Einrichtung](#2-erste-schritte--einrichtung)
3. [Benutzerverwaltung](#3-benutzerverwaltung)
4. [Standorte & Gebäude](#4-standorte--gebäude)
5. [Zähler & Verbrauchsdaten](#5-zähler--verbrauchsdaten)
6. [Dashboard & Analysen](#6-dashboard--analysen)
7. [CO₂-Emissionen](#7-co-emissionen)
8. [Berichte & PDF-Export](#8-berichte--pdf-export)
9. [ISO 50001 Management](#9-iso-50001-management)
10. [Energiebewertung (EnPI, SEU, Baseline)](#10-energiebewertung-enpi-seu-baseline)
11. [Benchmarking](#11-benchmarking)
12. [Schulungen](#12-schulungen)
13. [BMS-Regelstrategien](#13-bms-regelstrategien)
14. [Lieferverträge](#14-lieferverträge)
15. [Wirtschaftlichkeit](#15-wirtschaftlichkeit)
16. [Wetterdaten & Witterungskorrektur](#16-wetterdaten--witterungskorrektur)
17. [Klimasensoren & Raumklima](#17-klimasensoren--raumklima)
18. [Datenimport](#18-datenimport)
19. [Geräteintegrationen](#19-geräteintegrationen)
20. [Einstellungen & Systemverwaltung](#20-einstellungen--systemverwaltung)
21. [Glossar](#21-glossar)

---

## 1. Systemübersicht

Das Energiemanagementsystem unterstützt Organisationen bei der Umsetzung der **ISO 50001**
(Energiemanagementsysteme) und der **GEFMA 124** (Energiemanagement im Facility Management).

### Systemarchitektur

```
┌─────────────────────────────────────────────────────────────┐
│                    Web-Browser (Port 8099)                   │
│                  React 18 + TypeScript SPA                   │
└─────────────────────┬───────────────────────────────────────┘
                       │ HTTP / REST API
┌─────────────────────▼───────────────────────────────────────┐
│              FastAPI Backend  /api/v1/                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │  Auth    │ │ Meters   │ │ Reports  │ │ ISO 50001    │  │
│  │  Users   │ │ Readings │ │ Analytics│ │ EnPI/SEU     │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
└─────────────────────┬───────────────────────────────────────┘
                       │
┌─────────────────────▼───────────────────────────────────────┐
│              TimescaleDB (PostgreSQL + Zeitreihen)           │
└─────────────────────────────────────────────────────────────┘
```

### Hauptfunktionsbereiche

```
Energiemanagementsystem
│
├── Verbrauchserfassung
│   ├── Manuelle Zählerstände
│   ├── Automatisch (Shelly, Modbus, BACnet, KNX, HA)
│   └── CSV/Excel-Import
│
├── Analysen & Berichte
│   ├── Dashboard (KPIs, Trends, Anomalien)
│   ├── Monatstrend, Jahresvergleich, Lastprofil
│   └── PDF-Berichte (ISO 50001 konform)
│
├── ISO 50001 Compliance
│   ├── Kontext, Politik, Rollen (Kap. 4–5)
│   ├── Ziele, Risiken, SEU, EnPI, Baseline (Kap. 6)
│   ├── Schulungen, Dokumente (Kap. 7)
│   ├── Audits, Nichtkonformitäten (Kap. 9–10)
│   └── Managementbewertung (Kap. 9.3)
│
├── Energie-Controlling
│   ├── Benchmarking (VDI 3807, GEFMA 124, BAFA)
│   ├── Lieferverträge (Soll/Ist-Vergleich)
│   ├── Kostenumlage auf Nutzungseinheiten
│   └── Wirtschaftlichkeit (Amortisation, ROI)
│
└── Infrastruktur
    ├── Standorte → Gebäude → Nutzungseinheiten
    ├── Klimasensoren & Raumkomfort
    ├── Wetterdaten (DWD) & Witterungskorrektur
    └── CO₂-Bilanz (GHG Protocol, EMAS)
```

### Systemanforderungen

| Komponente | Anforderung |
|------------|-------------|
| Browser | Chrome 90+, Firefox 88+, Edge 90+ |
| Bildschirmauflösung | min. 1280×768 |
| Netzwerk | Zugang zu Port 8099 |
| Für PDF-Export | WeasyPrint (serverseitig, bereits installiert) |

---

## 2. Erste Schritte – Einrichtung

### 2.1 Erstmalige Anmeldung

Beim ersten Start des Systems öffnet sich automatisch die **Einrichtungsseite**.

**Schritt-für-Schritt:**

```
1. Browser öffnen: http://localhost:8099
   ↓
2. Weiterleitung zur Einrichtungsseite (/setup)
   ↓
3. Admin-Konto anlegen:
   • Benutzername: admin (oder frei wählbar)
   • E-Mail: admin@ihre-organisation.de
   • Passwort: min. 8 Zeichen, Groß- + Kleinbuchstaben + Zahl
   ↓
4. "Konto erstellen" klicken
   ↓
5. Automatische Weiterleitung zum Dashboard
```

> **Sicherheitshinweis:** Notieren Sie das Admin-Passwort an einem sicheren Ort.
> Es gibt keine automatische Passwort-Wiederherstellungsfunktion.

### 2.2 Empfohlene Reihenfolge der Einrichtung

```
Woche 1: Infrastruktur
  [1] Standorte anlegen     → /sites
  [2] Gebäude anlegen       → /sites/{id}/buildings
  [3] Nutzungseinheiten     → /sites/{id}/buildings/{id}/units
  [4] Zähler anlegen        → /meters
  [5] Erste Zählerstände    → /readings

Woche 2: Analysen aktivieren
  [6] Emissionsfaktoren     → /emissions/factors
  [7] Wetterdaten laden     → /weather
  [8] Dashboard prüfen      → /dashboard
  [9] Ersten Bericht        → /reports

Woche 3: ISO 50001
  [10] Kontext & Politik    → /iso
  [11] SEU identifizieren   → /energy-review
  [12] EnPI definieren      → /energy-review
  [13] Ziele setzen         → /iso/objectives
```

---

## 3. Benutzerverwaltung

### 3.1 Rollen & Berechtigungen

Das System verwendet ein **rollenbasiertes Berechtigungssystem**. Standardrollen:

| Rolle | Kann lesen | Kann schreiben | ISO verwalten | Admin |
|-------|-----------|----------------|---------------|-------|
| Viewer | ✓ | – | – | – |
| Operator | ✓ | ✓ (Zählerstände) | – | – |
| Energy Manager | ✓ | ✓ | ✓ | – |
| Administrator | ✓ | ✓ | ✓ | ✓ |

### 3.2 Benutzer anlegen

```
Navigation: Benutzer (Seitenleiste links)
  ↓
"Neuen Benutzer anlegen" klicken
  ↓
Formular ausfüllen:
  • Benutzername (eindeutig)
  • E-Mail-Adresse
  • Vollständiger Name
  • Rolle zuweisen
  • Temporäres Passwort setzen
  ↓
Speichern → Benutzer erhält Einladung
```

> **Hinweis:** Beim ersten Login wird der Benutzer zur Passwortänderung aufgefordert.

### 3.3 Audit-Log

Alle Aktionen werden protokolliert. Einsehbar unter:
- Navigation → **Benutzer** → Tab **Audit-Log**
- Oder direkt: `GET /api/v1/audit` (nur Administratoren)

Protokollierte Ereignisse: Login, Passwortänderung, Zählerstand-Erfassung, Berichts-Generierung, ISO-Dokumentenänderungen.

---

## 4. Standorte & Gebäude

### 4.1 Hierarchie

```
Organisation
└── Standort A (z.B. "Hauptverwaltung München")
    ├── Gebäude 1 (z.B. "Verwaltungsbau")
    │   ├── Nutzungseinheit: Büro EG (350 m²)
    │   ├── Nutzungseinheit: Büro OG1 (350 m²)
    │   └── Nutzungseinheit: Lager UG (200 m²)
    └── Gebäude 2 (z.B. "Werkshalle")
        └── Nutzungseinheit: Produktion (1200 m²)
└── Standort B (z.B. "Zweigstelle Hamburg")
    └── ...
```

### 4.2 Standort anlegen

```
Navigation: Standorte
  ↓
"Neuen Standort" Button
  ↓
Pflichtfelder:
  • Name des Standorts
  • Adresse (für Kartenansicht)
  • GPS-Koordinaten (optional, für Wetterstation-Zuordnung)
  ↓
Speichern
```

### 4.3 Gebäude & Nutzungseinheiten

Nach dem Standort: Gebäude anlegen (Baujahr, Fläche m², Geschosse), dann Nutzungseinheiten (Typ, Fläche, Mieter/Kostenstelle).

**Nutzungseinheit-Typen:**

| Typ | Beschreibung |
|-----|-------------|
| `office` | Bürofläche |
| `production` | Produktionsfläche |
| `warehouse` | Lagerfläche |
| `residential` | Wohnfläche |
| `retail` | Handelsfläche |
| `common` | Gemeinschaftsfläche |
| `technical` | Technikfläche |

---

## 5. Zähler & Verbrauchsdaten

### 5.1 Unterstützte Energieträger

| Kürzel | Energieträger | Einheit |
|--------|--------------|---------|
| `electricity` | Strom | kWh |
| `gas` | Erdgas | kWh / m³ |
| `water` | Wasser | m³ |
| `district_heating` | Fernwärme | kWh |
| `district_cooling` | Fernkälte | kWh |
| `oil` | Heizöl | Liter |
| `pellets` | Holzpellets | kg |
| `solar` | Solarstrom (Einspeisung/Eigenverbrauch) | kWh |

### 5.2 Datenquellen

```
Zähler-Datenquellen
│
├── manual          → Manuelle Eingabe über Web-UI oder API
├── shelly          → Shelly Plug / EM / 3EM (WLAN-Steckdosen)
├── modbus          → Modbus TCP/RTU (Industrie-Protokoll)
├── knx             → KNX/EIB Gebäudebus
├── bacnet          → BACnet/IP (Gebäudeautomation)
├── mqtt            → MQTT-Broker (IoT-Geräte)
└── home_assistant  → Home Assistant Entity (Sensor)
```

### 5.3 Zähler anlegen

```
Navigation: Zähler → "Neuer Zähler"
  ↓
Grunddaten:
  • Name (z.B. "Hauptzähler Strom Gebäude A")
  • Zählernummer (aus Abrechnungsunterlagen)
  • Energieträger + Einheit
  ↓
Zuordnung:
  • Gebäude / Nutzungseinheit
  • Übergeordneter Zähler (für Baumstruktur)
  ↓
Datenquelle wählen:
  • Manual → fertig
  • Shelly → IP-Adresse eingeben + Kanal
  • Modbus → Host, Port, Unit-ID, Register-Adresse
  • Home Assistant → Entity-ID (z.B. sensor.stromzaehler_kwh)
  ↓
Speichern → Verbindungstest starten
```

### 5.4 Zähler-Baum (Hierarchie)

Der **Meter Map**-Bereich (`/meter-map`) visualisiert die Zählerhierarchie als interaktives Flussdiagramm:

```
Hauptzähler Strom (EHZ-001) ──── 245.000 kWh/a
├── Gebäude A Gesamt (EHZ-002) ── 180.000 kWh/a
│   ├── Büro EG (EHZ-003) ─────── 45.000 kWh/a
│   ├── Büro OG1 (EHZ-004) ────── 52.000 kWh/a
│   └── Klima (EHZ-005) ──────── 83.000 kWh/a ⚠ SEU
└── Werkshalle (EHZ-006) ──────── 65.000 kWh/a
    (Nicht erfasst: 65.000 kWh/a ← Differenz aus Hauptzähler)
```

> **Tipp:** Nicht erfasster Verbrauch (graue Balken im Schema) deutet auf fehlende Unterzähler hin.

### 5.5 Zählerstände erfassen

**Manuell:**
```
Navigation: Zählerstände → "Neuer Zählerstand"
  • Zähler auswählen
  • Datum und Uhrzeit
  • Zählerstand (Ablesewert, nicht Verbrauch)
  • Kosten (optional, für Wirtschaftlichkeitsauswertung)
  • Rechnung hochladen (optional)
```

**Automatisch (polling):**
Automatische Zähler werden regelmäßig abgefragt (Intervall konfigurierbar in Einstellungen).
Manueller Poll: Zähler → Zähler auswählen → "Jetzt abfragen".

### 5.6 Plausibilitätsprüfung

Das System prüft automatisch:
- Rückwärts laufende Zähler
- Ausreißer > 3σ (statistische Standardabweichung)
- Doppelte Zeitstempel
- Chronologisch falsche Reihenfolge

⚠ Verdächtige Werte werden im Dashboard als Anomalien angezeigt.

---

## 6. Dashboard & Analysen

### 6.1 Dashboard-Übersicht

```
┌────────────────────────────────────────────────────────┐
│  KPI-Karten (obere Zeile)                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ Gesamt-  │ │  CO₂-   │ │ Energie- │ │  Aktive  │ │
│  │ verbrauch│ │Emissionen│ │  kosten  │ │  Zähler  │ │
│  │ 245 MWh  │ │ 48,2 t  │ │ 32.400 €│ │    12    │ │
│  │ ▼ -8%   │ │ ▼ -12%  │ │ ▼ -5%   │ │          │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
│                                                        │
│  ┌──────────────────────┐  ┌─────────────────────┐    │
│  │  Monatsverbrauch     │  │  Energieträger-     │    │
│  │  [Balkendiagramm]    │  │  verteilung         │    │
│  │                      │  │  [Kreisdiagramm]    │    │
│  └──────────────────────┘  └─────────────────────┘    │
│                                                        │
│  ┌──────────────────────┐  ┌─────────────────────┐    │
│  │  Top-Verbraucher     │  │  EnPI-Status        │    │
│  │  1. Klima    34%     │  │  ⚡ kWh/m²: 120     │    │
│  │  2. Beleucht. 22%    │  │  🎯 Ziel: 108       │    │
│  │  3. IT-Infra  18%    │  │  ▼ -10% Trend       │    │
│  └──────────────────────┘  └─────────────────────┘    │
└────────────────────────────────────────────────────────┘
```

### 6.2 Analysetools

| Tool | Beschreibung | Typischer Einsatz |
|------|-------------|-------------------|
| **Zeitreihe** | Verbrauch über Zeit, mehrere Zähler | Trendanalyse |
| **Heatmap** | Verbrauch nach Wochentag × Stunde | Nutzungszeiten erkennen |
| **Sankey** | Energiefluss Hauptzähler → Unterzähler | Energiebilanz visualisieren |
| **Jahresvergleich** | Monat-für-Monat aktuell vs. Vorjahr | Fortschrittskontrolle |
| **Energiebilanz** | Alle Energieträger monatlich tabellarisch | Berichtswesen |
| **Lastprofil** | Leistungskurve kW, Spitzenwerte | Spitzenlast-Vermeidung |
| **Anomalien** | Statistische Ausreißer (3σ) | Leckage, Defekte |
| **Kostenumlage** | Kosten je Nutzungseinheit nach m² | Betriebskostenabrechnung |
| **Wetterbereinigte Werte** | Witterungskorrektur nach VDI 3807 | Vergleichbarkeit |

### 6.3 Anomalieerkennung

Anomalien werden automatisch erkannt und auf dem Dashboard hervorgehoben:

```
⚠ Anomalie erkannt: Hauptzähler Strom
   Datum: 15.03.2025 (Montag 03:14 Uhr)
   Verbrauch: 48,3 kWh (erwartet: 8,2 kWh)
   Abweichung: +489% / +5,2σ
   → Mögliche Ursache: Vergessenes Gerät, Leckstrom, Heizstab
```

---

## 7. CO₂-Emissionen

### 7.1 Bilanzierungsmethodik

Das System folgt dem **GHG Protocol** (Greenhouse Gas Protocol):

```
Scope 1 – Direkte Emissionen
  → Erdgas, Heizöl, Pellets (Verbrennung vor Ort)

Scope 2 – Indirekte Emissionen (eingekaufte Energie)
  → Strom, Fernwärme, Fernkälte

Scope 3 – Vorgelagerte Emissionen
  → Wasser (Aufbereitung), Abwasser
```

### 7.2 Emissionsfaktoren

Standardmäßig hinterlegte Faktoren (jährlich aktualisierbar):

| Energieträger | Faktor | Quelle |
|---------------|--------|--------|
| Strom (DE) | 380 g CO₂e/kWh | UBA (aktuell) |
| Erdgas | 201 g CO₂e/kWh | BAFA |
| Fernwärme | 280 g CO₂e/kWh | Netzbetreiber |
| Heizöl | 266 g CO₂e/kWh | BAFA |
| Wasser | 0,35 kg CO₂e/m³ | UBA |

> **Tipp:** Eigene Faktoren (z.B. Ökostrom-Zertifikat, eigener Emissionsfaktor Fernwärme)
> können unter Emissionen → Emissionsfaktoren → "Neuer Faktor" hinterlegt werden.

### 7.3 GHG-Protocol-Export

```
Navigation: CO₂-Emissionen → Tab "Export"
  ↓
Format wählen:
  • GHG Protocol (CSV) → für externe Berichterstattung
  • EMAS (CSV) → für EU Eco-Management Audit Scheme
  ↓
Zeitraum wählen → Exportieren
```

---

## 8. Berichte & PDF-Export

### 8.1 Berichtstypen

| Typ | Inhalt | ISO 50001 Bezug |
|-----|--------|----------------|
| `annual` | Jahresbericht komplett | §9.1, §9.3 |
| `quarterly` | Quartalsbericht | §9.1 |
| `monthly` | Monatlicher Überblick | – |
| `custom` | Frei definierter Zeitraum | – |
| `audit_report` | Audit-Dokumentation | §9.2 |

### 8.2 Bericht erstellen

```
Navigation: Berichte → "Neuer Bericht"
  ↓
Grunddaten:
  • Titel
  • Berichtstyp (Jahres-, Quartals-, Monatsbericht)
  • Zeitraum (von – bis)
  ↓
Optionen:
  [✓] Charts einbinden (Monatstrend, Heatmap, Sankey)
  [✓] Jahresvergleich
  [✓] CO₂-Bilanz
  [✓] Anomalien
  [✓] Erkenntnisse & Empfehlungen
  ↓
"Bericht anlegen" → Daten werden gesammelt (Snapshot)
  ↓
"PDF generieren" → WeasyPrint erstellt PDF (10–30 Sekunden)
  ↓
"PDF herunterladen" oder "Vorschau"
```

### 8.3 Berichtsstruktur (PDF)

```
1. Deckblatt (Firmenlogo, Zeitraum, Erstelldatum)
2. Management-Zusammenfassung
   • Gesamtverbrauch + Trend ggü. Vorjahr
   • CO₂-Emissionen und -Intensität
   • Größter Verbraucher
   • Gesamtkosten (wenn vorhanden)
3. Energiebilanz-Tabelle (monatlich nach Energieträger)
4. Monatlicher Trendverlauf (Balkendiagramm)
5. Jahresvergleich (aktuell vs. Vorjahr)
6. CO₂-Bilanz (Scope 1/2/3)
7. Energiefluss (Sankey-Diagramm)
8. Wirtschaftlichkeit (wenn Kostendaten vorhanden)
9. Signifikante Energieverbraucher (SEU-Liste)
10. Erkenntnisse & Empfehlungen
```

---

## 9. ISO 50001 Management

### 9.1 Kapitelübersicht der Norm

```
ISO 50001:2018 – Umsetzung im System
│
├── Kap. 4 – Kontext der Organisation
│   ├── 4.1 Interne/externe Faktoren        → /iso (Tab: Kontext)
│   └── 4.2 Interessierte Parteien          → /iso (Tab: Kontext)
│
├── Kap. 5 – Führung
│   ├── 5.2 Energiepolitik                  → /iso (Tab: Politik)
│   └── 5.3 Rollen & Verantwortlichkeiten   → /iso (Tab: Rollen)
│
├── Kap. 6 – Planung
│   ├── 6.1 Risiken & Chancen               → /iso (Tab: Risiken)
│   ├── 6.2 Energieziele & -maßnahmen       → /iso (Tab: Ziele)
│   └── 6.3 Energetische Bewertung          → /energy-review
│       ├── SEU (Signifikante Energieverbraucher)
│       ├── EnPI (Energieleistungskennzahlen)
│       └── Baseline (Energetische Ausgangsbasis)
│
├── Kap. 7 – Unterstützung
│   ├── 7.2 Kompetenz                       → /trainings
│   ├── 7.3 Bewusstsein                     → /trainings
│   ├── 7.4 Kommunikation                   → (manuell in Dokumenten)
│   └── 7.5 Dokumentierte Information       → /iso (Tab: Dokumente)
│
├── Kap. 8 – Betrieb
│   ├── 8.1 Planung & Steuerung             → /control-strategies
│   └── 8.2 Auslegung                       → /energy-review
│
├── Kap. 9 – Bewertung der Leistung
│   ├── 9.1 Überwachung & Messung           → /analytics, /readings
│   ├── 9.1.2 Rechtliche Anforderungen      → /iso (Tab: Rechtliches)
│   ├── 9.2 Internes Audit                  → /iso (Tab: Audits)
│   └── 9.3 Managementbewertung             → /iso (Tab: Reviews)
│
└── Kap. 10 – Verbesserung
    ├── 10.1 Nichtkonformitäten             → /iso (Tab: NKs)
    └── 10.2 Ständige Verbesserung          → /iso (Tab: Ziele)
```

### 9.2 Typischer ISO 50001 Arbeitszyklus

```
PLAN ──────────────────────────────────────────────────────────
  1. Organisationskontext erfassen (interne/externe Faktoren)
  2. Energiepolitik dokumentieren und genehmigen lassen
  3. Energetische Bewertung: SEU identifizieren
  4. Energieleistungskennzahlen (EnPI) festlegen
  5. Energetische Ausgangsbasis (Baseline) festlegen
  6. Energieziele und Maßnahmenpläne erstellen
  7. Risiken und Chancen bewerten

DO ────────────────────────────────────────────────────────────
  8. Maßnahmen durchführen (Maßnahmenpläne)
  9. Schulungen durchführen (Bewusstsein, Kompetenz)
  10. BMS-Regelstrategien dokumentieren und überwachen
  11. Verbrauchsdaten erfassen (laufend)

CHECK ─────────────────────────────────────────────────────────
  12. EnPI-Werte berechnen und mit Baseline vergleichen
  13. Internes Audit durchführen
  14. Auditfeststellungen dokumentieren
  15. Managementbewertung erstellen (jährlich)

ACT ───────────────────────────────────────────────────────────
  16. Nichtkonformitäten beheben
  17. Ziele anpassen (PDCA-Zyklus neu starten)
```

### 9.3 Internes Audit – Workflow

```
1. Audit anlegen
   Navigation: ISO 50001 → Audits → "Neues Audit"
   • Titel, Termin, Auditor, Umfang festlegen

2. Checkliste nutzen
   Automatisch generierte Prüfpunkte zu allen ISO-Kapiteln
   → Jeden Punkt als: Konform / Teilkonform / Nichtkonform markieren

3. Auditfeststellungen erfassen
   Für jeden Befund:
   • Beschreibung des Befunds
   • ISO-Klausel-Bezug
   • Evidenz (Foto, Dokument)

4. Aus Feststellung → Nichtkonformität erstellen
   "Nichtkonformität erstellen" Button
   → Automatisch mit Feststellungsdaten befüllt

5. Maßnahmenplan vorschlagen (KI-Unterstützung)
   "Ziel vorschlagen" → System generiert Entwurf
   → Review und Anpassung → Speichern

6. Abschluss: Audit-Status auf "Abgeschlossen"
```

### 9.4 Managementbewertung

Die **automatische Vorausfüllung** (`GET /api/v1/iso/reviews/prefill`) erstellt einen Entwurf mit:
- Aktuellem Energieverbrauch vs. Baseline
- EnPI-Übersicht (Ziele erreicht/nicht erreicht)
- Offene Nichtkonformitäten
- Abgeschlossene Schulungen
- Auditdaten des Jahres

```
Navigation: ISO 50001 → Management Reviews → "Neue Bewertung"
  → "Vorausfüllen" klicken
  → Daten prüfen und ergänzen
  → Beschlüsse und Maßnahmen eintragen
  → Genehmigen
```

---

## 10. Energiebewertung (EnPI, SEU, Baseline)

### 10.1 Signifikante Energieverbraucher (SEU)

**SEU-Identifikation (automatisch):**
```
Navigation: Energiebewertung → SEU
  → "Vorschläge laden" (nutzt Verbrauchsdaten der letzten 12 Monate)
  → System zeigt Zähler sortiert nach Verbrauchsanteil:
     1. Klimaanlage  Gebäude A     34%  → Als SEU markieren
     2. Beleuchtung  Gesamt        22%  → Als SEU markieren
     3. IT-Infrastr. Serverraum    18%  → Als SEU markieren
     4. Restliche Verbraucher      26%  → nicht SEU
```

**Faustregel:** Alle Verbraucher, die zusammen ≥ 80% des Gesamtverbrauchs ausmachen, sind typische SEU-Kandidaten.

### 10.2 Energieleistungskennzahlen (EnPI)

**Häufige EnPI-Formeln:**

| EnPI | Formel | Typischer Wert (Büro) |
|------|--------|----------------------|
| Spezifischer Stromverbrauch | kWh(Strom) / m² | 80–200 kWh/m²·a |
| Spezifischer Wärmeverbrauch | kWh(Wärme) / m² | 60–150 kWh/m²·a |
| CO₂-Intensität | kg CO₂ / kWh | 0,38 kg/kWh (Strom DE) |
| Verbrauch je Mitarbeiter | kWh / Vollzeitmitarbeiter | 1.500–4.000 kWh/MA |

**EnPI erstellen:**
```
Navigation: Energiebewertung → EnPI → "Neuer EnPI"
  • Bezeichnung (z.B. "Stromverbrauch je m²")
  • Zähler auswählen (Zähler = Energiemenge)
  • Bezugsgröße:
    - Feste Zahl (z.B. Gebäudefläche 2.400 m²)
    - Variable (z.B. Produktionsmenge, Heizgradtage)
  • Einheit (kWh/m², CO₂/Einheit, ...)
  → "Berechnen" → Monatswerte werden ermittelt
```

### 10.3 Energetische Ausgangsbasis (Baseline)

Die Baseline ist der Referenzzeitraum für spätere Vergleiche (i.d.R. 1–3 Jahre vor Einführung des EnMS).

```
Navigation: Energiebewertung → Baselines → "Neue Baseline"
  • Bezeichnung (z.B. "Baseline Strom 2022–2023")
  • Energieträger
  • Zeitraum (mindestens 12 Monate empfohlen)
  • Bezugsgröße für Normierung
  ↓
"Baseline vs. Ist-Vergleich":
  Zeigt, wie viel Energie im Vergleich zur Baseline eingespart wurde.
```

---

## 11. Benchmarking

Das System enthält **35 Referenzwerte** nach VDI 3807, GEFMA 124 und BAFA für 11 Gebäudetypen.

### 11.1 Gebäudetypen & Referenzwerte (Beispiele)

| Gebäudetyp | Strom gut | Strom mittel | Wärme gut | Wärme mittel |
|------------|-----------|--------------|-----------|--------------|
| Büro | ≤80 kWh/m² | ≤150 kWh/m² | ≤80 kWh/m² | ≤130 kWh/m² |
| Schule | ≤40 kWh/m² | ≤80 kWh/m² | ≤90 kWh/m² | ≤150 kWh/m² |
| Krankenhaus | ≤180 kWh/m² | ≤300 kWh/m² | ≤180 kWh/m² | ≤280 kWh/m² |
| Hotel | ≤120 kWh/m² | ≤200 kWh/m² | ≤130 kWh/m² | ≤200 kWh/m² |

### 11.2 Eigenen Wert vergleichen

```
Navigation: Benchmarking → "Eigenen Wert vergleichen"
  ↓
Eingaben:
  • Gebäudetyp: z.B. "Bürogebäude"
  • Energieträger: z.B. "Strom"
  • Eigener Wert: 145 kWh/m²·a
  ↓
Ergebnis:
  Bewertung: ⬤ MITTEL (zwischen Gut-Schwelle 80 und Schlecht-Schwelle 150)
  Verbesserungspotenzial: 65 kWh/m²·a (bis zum "Gut"-Niveau)
  Quelle: VDI 3807
```

---

## 12. Schulungen

### 12.1 Dokumentationspflicht nach ISO 50001

**Kap. 7.2 – Kompetenz:** Qualifikation des Personals, das Einfluss auf die Energieleistung hat.
**Kap. 7.3 – Bewusstsein:** Alle relevanten Personen müssen über die Energiepolitik informiert sein.

### 12.2 Schulungstypen

| Typ | Beschreibung | Empfohlene Häufigkeit |
|-----|-------------|----------------------|
| `awareness` | Energiebewusstsein allgemein | Jährlich |
| `technical` | Technische Schulung (Gebäudetechnik) | Bedarfsbasiert |
| `management` | Managementschulung (ISO 50001) | Bei Änderungen |
| `external` | Externe Weiterbildung | Bedarfsbasiert |
| `onboarding` | Einarbeitung neuer Mitarbeiter | Bei Neueinstellung |

### 12.3 Fälligkeitsverfolgung

Das System warnt automatisch, wenn eine Wiederholungsschulung in **90 Tagen** fällig ist.
Überfällige Schulungen werden rot markiert.

```
Navigation: Schulungen
  → Dashboard zeigt: 3 Schulungen fällig (davon 1 überfällig)
  → Schulung auswählen → "Wiederholungstermin anlegen"
```

---

## 13. BMS-Regelstrategien

### 13.1 Zweck

Dokumentiert Sollwerte für Heizung, Kühlung, Lüftung und Beleuchtung.
Vergleicht diese mit tatsächlichen Klimasensormessungen (Soll-/Ist-Vergleich).

### 13.2 Typische Regelparameter

| Parameter | Typischer Wert |
|-----------|---------------|
| Heiz-Solltemperatur | 21°C (Betrieb), 18°C (Nacht) |
| Kühl-Solltemperatur | 26°C |
| CO₂-Grenzwert | 1.000 ppm |
| Betriebszeiten | Mo–Fr 06:00–22:00 |

### 13.3 Compliance-Prüfung

```
Navigation: Regelstrategien → Strategie auswählen
  ↓
"Soll-/Ist-Vergleich"
  Zeitraum wählen → "Vergleich laden"
  ↓
Ergebnis:
  Temperatur-Soll: 21°C | Temperatur-Ist: 22,3°C | ⚠ Abweichung +1,3 K
  CO₂-Grenzwert: 1.000 ppm | CO₂-Ist: 856 ppm | ✓ Konform
```

**Toleranz Temperatur:** ±1 K (nach EN 15232).

---

## 14. Lieferverträge

### 14.1 Vertragsfelder

| Feld | Beschreibung |
|------|-------------|
| Lieferant | Energieversorger |
| Energieträger | Strom, Gas, Fernwärme etc. |
| Vertragsmenge (kWh/a) | Vereinbartes Jahresvolumen |
| Preis (ct/kWh) | Arbeitspreis |
| Grundpreis | Monatlicher Fixkostenanteil |
| Laufzeit | Gültigkeitszeitraum |

### 14.2 Soll-/Ist-Vergleich

```
Navigation: Lieferverträge → Vertrag auswählen → "Vertragsvergleich"
  ↓
Ergebnis für Zeitraum 2025:
  Vertragsmenge: 200.000 kWh/a
  Tatsächlicher Verbrauch: 182.000 kWh/a
  Abweichung: -18.000 kWh (-9%)
  Progn. Jahresverbrauch: 191.000 kWh
  Kostendifferenz: -1.440 €
```

---

## 15. Wirtschaftlichkeit

### 15.1 Amortisationsberechnung

Für Investitionen (z.B. LED-Beleuchtung, Dämmung, neue Anlage):

```
Navigation: Wirtschaftlichkeit
  → Maßnahmen aus ISO-Zielen werden automatisch einbezogen
  ↓
Kennzahlen:
  • Investitionskosten: 45.000 €
  • Jährliche Einsparung: 8.200 € (= 18.000 kWh × 0,32 €/kWh + Wartung)
  • Statische Amortisationszeit: 5,5 Jahre
  • Kapitalwert (NPV bei 5% Diskontierungssatz): +28.400 €
  • Interne Rendite (IRR): 14,2%
```

---

## 16. Wetterdaten & Witterungskorrektur

### 16.1 Warum Witterungskorrektur?

Ein kalter Winter führt zu höherem Heizenergieverbrauch – der Jahresvergleich wäre ohne
Korrektur nicht aussagekräftig. Die **Witterungskorrektur nach VDI 3807** macht
Verbrauchswerte verschiedener Jahre vergleichbar.

### 16.2 Wetterdaten einrichten

```
1. Navigation: Wetterdaten → "Nächste Station finden"
   GPS-Koordinaten eingeben → System schlägt DWD-Station vor

2. Station speichern und Daten herunterladen:
   "Daten laden" für gewünschten Zeitraum
   → Tägliche Temperaturen und Heizgradtage werden gespeichert

3. Witterungskorrektur konfigurieren:
   Wetterdaten → "Korrektur-Konfigurationen" → "Neu"
   • Zähler zuordnen
   • Heizgrenztemperatur (i.d.R. 15°C)
   • Referenz-Heizgradtage
```

### 16.3 Heizgradtage (HGT)

| Klimazone | Typische HGT 15/15 | Referenz |
|-----------|-------------------|---------|
| München | 3.600–4.200 Kd | DWD TRY |
| Hamburg | 3.200–3.800 Kd | DWD TRY |
| Frankfurt | 3.000–3.500 Kd | DWD TRY |

---

## 17. Klimasensoren & Raumklima

### 17.1 Unterstützte Sensoren

| Schnittstelle | Beispielgeräte |
|---------------|---------------|
| Home Assistant | Alle HA-kompatiblen Sensoren |
| KNX | MDT, Siemens, ABB CO₂-Raumregler |
| Modbus | Bacnet-Raumcontroller |
| Manuell | Protokoll-Import |

### 17.2 Messwerte

| Messgröße | Einheit | Komfort-Richtwert |
|-----------|---------|-------------------|
| Temperatur | °C | 20–22°C (Heizperiode) |
| Relative Feuchte | % rH | 40–60% rH |
| CO₂-Konzentration | ppm | < 1.000 ppm (DIN EN 13779) |
| Taupunkttemperatur | °C | > 10°C (kein Kondensat) |
| Fanger-PMV | -3 bis +3 | -0,5 bis +0,5 |

---

## 18. Datenimport

### 18.1 Unterstützte Formate

| Format | Trennzeichen | Datumformate |
|--------|-------------|-------------|
| CSV | Komma, Semikolon, Tabulator | ISO 8601, DE (TT.MM.JJJJ) |
| Excel | .xlsx | Beliebig |

### 18.2 Import-Workflow

```
1. Datei hochladen
   Navigation: Datenimport → Datei auswählen → "Hochladen"

2. Spaltenzuordnung
   System erkennt Spalten automatisch:
   ┌─────────────────┬──────────────────┬───────────────┐
   │ Spalte in Datei │ Erkannter Typ    │ System-Feld   │
   ├─────────────────┼──────────────────┼───────────────┤
   │ Datum           │ Zeitstempel ✓    │ timestamp     │
   │ Zählerstand     │ Numerisch ✓      │ value         │
   │ Kosten          │ Numerisch ✓      │ cost_gross    │
   │ Notiz           │ Text             │ notes         │
   └─────────────────┴──────────────────┴───────────────┘

3. Zähler zuordnen (wenn mehrere Zähler in einer Datei)

4. Import starten
   → Erfolg: "247 Zählerstände importiert"
   → Fehler: Zeilen mit Fehler werden angezeigt

5. Import rückgängig machen (falls nötig)
   Importhistorie → Import auswählen → "Rückgängig"
```

### 18.3 Import-Vorlage erstellen

```csv
# Beispiel CSV-Datei für Stromzähler
Datum,Zählerstand_kWh,Kosten_EUR
01.01.2025,10000.0,
01.02.2025,10850.5,
01.03.2025,11620.0,
```

---

## 19. Geräteintegrationen

### 19.1 Home Assistant

```
Voraussetzung: HA läuft, Long-Lived Access Token vorhanden

Konfiguration:
  Einstellungen → Integrationen → Home Assistant
  • URL: http://homeassistant.local:8123 (oder IP)
  • Long-Lived Token: aus HA → Profil → Langzeittoken

Verwendung:
  Zähler anlegen → Datenquelle "Home Assistant"
  → Entity-ID eingeben (z.B. sensor.strom_gesamt_kwh)
  → "Verbindungstest" → "Speichern"
```

### 19.2 Shelly

```
Unterstützte Geräte: Shelly Plug S, Shelly EM, Shelly 3EM

Konfiguration:
  Zähler anlegen → Datenquelle "Shelly"
  • IP-Adresse des Geräts (z.B. 192.168.178.50)
  • Kanal (0 für Kanal A, 1 für Kanal B)
  → Gerät muss im lokalen Netz erreichbar sein
```

### 19.3 Modbus TCP/RTU

```
Konfiguration:
  Zähler anlegen → Datenquelle "Modbus"
  • Host / IP
  • Port (Standard: 502)
  • Unit-ID (Slave-Adresse)
  • Register-Adresse (Holding Register des Energiezählers)
  • Skalierungsfaktor (z.B. 0.001 wenn Register in Wh, Zähler in kWh)
```

### 19.4 BACnet/IP

```
Konfiguration:
  Integrationen → BACnet → "Geräte entdecken"
  → Netzwerk-Scan nach BACnet-Geräten
  → Gerät auswählen → Objekte anzeigen
  → Objekt-ID des Energiezähler-Werts notieren
  → Zähler anlegen → Datenquelle "BACnet" → IDs eingeben
```

---

## 20. Einstellungen & Systemverwaltung

### 20.1 Systemeinstellungen (Übersicht)

| Kategorie | Einstellung | Beschreibung |
|-----------|------------|-------------|
| `organization` | `.name`, `.logo` | Organisationsname und Logo für Berichte |
| `reports` | `.author`, `.footer` | Standard-Berichtsautor, Fußzeile |
| `enpi` | `.baseline_year` | Standard-Basisjahr für EnPI |
| `notifications` | `.email_alerts` | E-Mail-Benachrichtigungen |
| `polling` | `.interval_minutes` | Abfrageintervall für automatische Zähler |

### 20.2 Datensicherung

**Empfehlung:** Wöchentlicher Export, gespeichert auf separatem Medium.

```
Navigation: Einstellungen → Tab "System" → "Backup erstellen"
  → Download: backup_JJJJMMTT.json.gz

Backup einspielen:
  Einstellungen → "Backup importieren" → Datei auswählen
  ⚠ ACHTUNG: Überschreibt alle vorhandenen Daten!
```

### 20.3 System-Health

```
Navigation: Einstellungen → Tab "Status"

Dienste:
  ✓ Datenbank (PostgreSQL/TimescaleDB)
  ✓ Task-Queue (Celery + Redis)
  ✓ Home Assistant (falls konfiguriert)
  ✓ Wetter-API (Bright Sky/DWD)
  ✓ CO₂-API (Electricity Maps)
```

---

## 21. Glossar

| Begriff | Bedeutung |
|---------|-----------|
| **EnPI** | Energy Performance Indicator – Energieleistungskennzahl (z.B. kWh/m²) |
| **SEU** | Significant Energy Use – Signifikanter Energieverbraucher (>80%-Regel) |
| **Baseline** | Energetische Ausgangsbasis als Referenz für Vergleiche |
| **HGT** | Heizgradtage – Maß für den Heizenergiebedarf einer Klimaperiode |
| **PDCA** | Plan-Do-Check-Act – Kontinuierlicher Verbesserungsprozess |
| **GHG Protocol** | Greenhouse Gas Protocol – Standard zur CO₂-Bilanzierung |
| **EMAS** | Eco-Management and Audit Scheme – EU-Umweltmanagementsystem |
| **VDI 3807** | Verein Dt. Ingenieure – Energieverbrauchskennwerte für Gebäude |
| **GEFMA 124** | Leitfaden Energiemanagement im Facility Management |
| **BAFA** | Bundesamt für Wirtschaft und Ausfuhrkontrolle (Emissionsfaktoren) |
| **UBA** | Umweltbundesamt (Emissionsfaktoren Strom) |
| **BACnet** | Building Automation and Control Networks (Gebäudeautomations-Protokoll) |
| **KNX** | Konnex – europäischer Gebäudebus-Standard |
| **Modbus** | Serielles Kommunikationsprotokoll für industrielle Elektronik |
| **PMV** | Predicted Mean Vote – Fanger-Komfortindex (-3 kalt bis +3 heiß) |
| **Scope 1/2/3** | GHG-Protocol-Kategorien: direkte / indirekte / vorgelagerte Emissionen |
| **ppm** | Parts per million – Einheit für CO₂-Konzentration in der Luft |
| **NTC** | Nichtkonformität (Nonconformity) – Abweichung von ISO-Anforderungen |

---

## Anhang: Tastenkürzel & Tipps

| Aktion | Tipp |
|--------|------|
| Seitenleiste ein-/ausklappen | Klick auf Pfeil-Icon oben links |
| Sprache wechseln | Klick auf DE/EN in der Fußzeile der Seitenleiste |
| PDF-Bericht öffnen | Berichte → Bericht auswählen → "PDF herunterladen" |
| Zähler-Hierarchie sehen | Navigation → "Zähler" → Tab "Baumansicht" |
| ISO-Audit-Checkliste | ISO 50001 → Audits → "Checkliste anzeigen" |
| Backup erstellen | Einstellungen → System → "Backup erstellen" |
| Logs einsehen | Einstellungen → System → Tab "Protokoll" |
| Cache leeren | Einstellungen → System → "Cache leeren" |

---

*Dieses Handbuch ist eine lebendige Dokumentation. Bei Fragen oder Anpassungsbedarf
bitte die entsprechenden Abschnitte direkt in dieser Markdown-Datei bearbeiten.*
