# API-Dokumentation – Energy Management ISO 50001

**Basis-URL:** `/api/v1/`
**Authentifizierung:** JWT Bearer Token (Header: `Authorization: Bearer <token>`)
**Inhaltstyp:** `application/json`

---

## Authentifizierung

### Login
```
POST /api/v1/auth/login
Body: { "username": "string", "password": "string" }
→ 200: { "access_token": "...", "refresh_token": "...", "token_type": "bearer" }
→ 401: Ungültige Anmeldedaten
```

### Token erneuern
```
POST /api/v1/auth/refresh
Body: { "refresh_token": "string" }
→ 200: { "access_token": "..." }
```

### Profil
```
GET /api/v1/auth/profile
→ 200: { "id": "uuid", "username": "...", "email": "...", "role": "..." }
```

---

## Standorte & Gebäude

### Standorte
```
GET    /api/v1/sites                    # Liste aller Standorte
POST   /api/v1/sites                    # Neuen Standort erstellen
GET    /api/v1/sites/{id}               # Einzelner Standort
PUT    /api/v1/sites/{id}               # Standort aktualisieren
DELETE /api/v1/sites/{id}               # Standort löschen
GET    /api/v1/sites/{id}/buildings     # Gebäude eines Standorts
POST   /api/v1/sites/{id}/buildings     # Gebäude erstellen
```

### Gebäude
```
GET    /api/v1/sites/buildings/{id}     # Einzelnes Gebäude
PUT    /api/v1/sites/buildings/{id}     # Gebäude aktualisieren
DELETE /api/v1/sites/buildings/{id}     # Gebäude löschen
```

---

## Zähler & Verbrauch

### Zähler
```
GET    /api/v1/meters                   # Liste (Filter: energy_type, site_id, is_active)
POST   /api/v1/meters                   # Neuen Zähler erstellen
GET    /api/v1/meters/{id}              # Einzelner Zähler
PUT    /api/v1/meters/{id}              # Zähler aktualisieren
DELETE /api/v1/meters/{id}              # Zähler löschen
```

### Zählerstände
```
GET    /api/v1/readings                 # Liste (Filter: meter_id, start_date, end_date)
POST   /api/v1/readings                 # Einzelnen Zählerstand erstellen
POST   /api/v1/readings/bulk            # Mehrere Zählerstände importieren
```

### Verbraucher
```
GET    /api/v1/consumers                # Liste
POST   /api/v1/consumers                # Erstellen
GET    /api/v1/consumers/{id}           # Einzeln
PUT    /api/v1/consumers/{id}           # Aktualisieren
DELETE /api/v1/consumers/{id}           # Löschen
```

---

## CO₂-Emissionen

### Dashboard & Zusammenfassung
```
GET /api/v1/emissions/dashboard         # CO₂-Dashboard (Query: ?year=2024)
GET /api/v1/emissions/summary           # Zusammenfassung (?start_date, ?end_date)
```

### Export
```
GET /api/v1/emissions/export            # CSV-Export
    Query-Parameter:
    - start_date (Pflicht): YYYY-MM-DD
    - end_date (Pflicht): YYYY-MM-DD
    - format: "ghg" (GHG Protocol) | "emas" (EMAS Kernindikatoren)
    → 200: text/csv (Semikolon-getrennt, UTF-8 BOM)
```

### Emissionsfaktoren
```
GET  /api/v1/emissions/factors          # Liste (Filter: energy_type, year, source_id)
POST /api/v1/emissions/factors          # Eigenen Faktor erstellen
GET  /api/v1/emissions/factors/sources  # Verfügbare Quellen
```

### Neuberechnung
```
POST /api/v1/emissions/calculate        # CO₂-Neuberechnung anstoßen
    Query: ?start_date, ?end_date, ?meter_ids (kommagetrennt)
```

---

## Analysen

```
GET /api/v1/analytics/timeseries        # Zeitreihen (?meter_ids, ?start_date, ?end_date, ?granularity)
GET /api/v1/analytics/comparison        # Periodenvergleich
GET /api/v1/analytics/distribution      # Verteilung nach Typ/Standort
GET /api/v1/analytics/sankey            # Sankey-Daten (Energieflüsse)
GET /api/v1/analytics/heatmap           # Heatmap (Wochentag × Stunde)
GET /api/v1/analytics/benchmarks        # EnPI-Benchmarks (?year)
    → { year, meters: [...], buildings: [...] }
    Jeder Meter-Eintrag: consumption_kwh, kwh_per_m2, kwh_per_person,
    reference_values (VDI 3807), rating (good/medium/poor)
GET /api/v1/analytics/anomalies         # Anomalie-Erkennung (?threshold, ?days)
GET /api/v1/analytics/weather-corrected # Witterungsbereinigter Verbrauch
GET /api/v1/analytics/co2-reduction-path # CO₂-Reduktionspfad
```

---

## ISO 50001 Management

### Kontext (Kap. 4)
```
GET    /api/v1/iso/context              # Alle Kontexte
POST   /api/v1/iso/context              # Kontext erstellen
GET    /api/v1/iso/context/{id}         # Einzeln
PUT    /api/v1/iso/context/{id}         # Aktualisieren
DELETE /api/v1/iso/context/{id}         # Löschen
```

### Energiepolitik (Kap. 5.2)
```
GET    /api/v1/iso/policies             # Alle Politiken
POST   /api/v1/iso/policies             # Neue Version erstellen
GET    /api/v1/iso/policies/{id}        # Einzeln
PUT    /api/v1/iso/policies/{id}        # Aktualisieren
DELETE /api/v1/iso/policies/{id}        # Löschen
```

### Rollen (Kap. 5.3)
```
GET    /api/v1/iso/roles                # Alle Rollen
POST   /api/v1/iso/roles                # Rolle erstellen
PUT    /api/v1/iso/roles/{id}           # Aktualisieren
DELETE /api/v1/iso/roles/{id}           # Löschen
```

### Energieziele & Aktionspläne (Kap. 6.2)
```
GET    /api/v1/iso/objectives           # Alle Ziele
POST   /api/v1/iso/objectives           # Ziel erstellen
PUT    /api/v1/iso/objectives/{id}      # Aktualisieren
DELETE /api/v1/iso/objectives/{id}      # Löschen
POST   /api/v1/iso/objectives/{id}/actions  # Aktionsplan erstellen
PUT    /api/v1/iso/actions/{id}         # Aktionsplan aktualisieren
DELETE /api/v1/iso/actions/{id}         # Aktionsplan löschen
```

### Risiken & Chancen (Kap. 6.1)
```
GET    /api/v1/iso/risks                # Alle Risiken
POST   /api/v1/iso/risks                # Risiko erstellen (Score auto: likelihood × impact)
PUT    /api/v1/iso/risks/{id}           # Aktualisieren
DELETE /api/v1/iso/risks/{id}           # Löschen
```

### Dokumente (Kap. 7.5)
```
GET    /api/v1/iso/documents            # Alle Dokumente
POST   /api/v1/iso/documents            # Dokument erstellen
GET    /api/v1/iso/documents/{id}       # Einzeln
PUT    /api/v1/iso/documents/{id}       # Aktualisieren
DELETE /api/v1/iso/documents/{id}       # Löschen
GET    /api/v1/iso/documents/review-due # Fällige Überprüfungen (?days=30)
POST   /api/v1/iso/documents/{id}/upload # Datei hochladen
```

### Rechtskataster (Kap. 6.1.3)
```
GET    /api/v1/iso/legal                # Alle Anforderungen
POST   /api/v1/iso/legal                # Erstellen
PUT    /api/v1/iso/legal/{id}           # Aktualisieren
DELETE /api/v1/iso/legal/{id}           # Löschen
```

### Internes Audit (Kap. 9.2)
```
GET    /api/v1/iso/audits               # Alle Audits
POST   /api/v1/iso/audits               # Audit erstellen
PUT    /api/v1/iso/audits/{id}          # Aktualisieren
DELETE /api/v1/iso/audits/{id}          # Löschen
GET    /api/v1/iso/audits/checklist     # ISO 50001 Audit-Checkliste (20 Klauseln)
POST   /api/v1/iso/audits/{id}/findings # Befund erstellen
PUT    /api/v1/iso/findings/{id}        # Befund aktualisieren
POST   /api/v1/iso/findings/{id}/create-nc  # Befund → Nichtkonformität
```

### Managementbewertung (Kap. 9.3)
```
GET    /api/v1/iso/reviews              # Alle Reviews
POST   /api/v1/iso/reviews              # Review erstellen
PUT    /api/v1/iso/reviews/{id}         # Aktualisieren
DELETE /api/v1/iso/reviews/{id}         # Löschen
GET    /api/v1/iso/reviews/prefill      # Auto-Prefill (?period_start, ?period_end)
    → { enpi_status, audit_results, open_findings, open_ncs,
        compliance_status, energy_policy_adequacy, objectives, ... }
```

### Nichtkonformitäten (Kap. 10.1)
```
GET    /api/v1/iso/nonconformities      # Alle NKs
POST   /api/v1/iso/nonconformities      # NK erstellen
PUT    /api/v1/iso/nonconformities/{id} # Aktualisieren
DELETE /api/v1/iso/nonconformities/{id} # Löschen
POST   /api/v1/iso/nonconformities/{id}/create-action-plan  # NK → Aktionsplan
    Query: ?objective_id (optional)
```

---

## Einstellungen

```
GET    /api/v1/settings                 # Alle Einstellungen (?category)
GET    /api/v1/settings/{key}           # Einzelne Einstellung
PUT    /api/v1/settings/{key}           # Aktualisieren
    Body: { "value": { ... } }
POST   /api/v1/settings/cache/clear     # Cache leeren (Admin)
```

**Verfügbare Schlüssel:**
- `organization` – Name, Logo, Adresse, Kontakt
- `branding` – Primär-/Sekundär-/Akzentfarbe
- `report_defaults` – Berichtssprache, Zeitraum, Optionen
- `enpi_config` – Aktive Kennzahlen, Referenzstandard
- `notifications` – E-Mail, Erinnerungsfristen

---

## Weitere Module

### Dashboard
```
GET /api/v1/dashboard                   # Komplette Dashboard-Daten
    Query: ?period_start, ?period_end, ?granularity
```

### Wetterdaten
```
GET /api/v1/weather/stations            # Wetterstationen
GET /api/v1/weather/records             # Wetterdaten (?station_id, ?start, ?end)
GET /api/v1/weather/degree-days         # Gradtagszahlen
```

### Klimasensoren
```
GET  /api/v1/climate/sensors            # Sensoren
GET  /api/v1/climate/readings           # Messwerte
POST /api/v1/climate/readings           # Messwert erstellen
```

### Berichte
```
GET    /api/v1/reports                  # Alle Berichte
POST   /api/v1/reports/generate         # Bericht generieren
GET    /api/v1/reports/{id}             # Bericht abrufen
GET    /api/v1/reports/{id}/pdf         # PDF herunterladen
DELETE /api/v1/reports/{id}             # Bericht löschen
```

### Datenimport
```
POST /api/v1/imports/csv                # CSV importieren
POST /api/v1/imports/xlsx               # Excel importieren
GET  /api/v1/imports/mappings           # Gespeicherte Mappings
```

### Integrationen
```
GET  /api/v1/integrations/ha/entities   # HA Entities
POST /api/v1/integrations/shelly/scan   # Shelly-Geräte scannen
GET  /api/v1/integrations/status        # Status aller Integrationen
```

### Benutzer (Admin)
```
GET    /api/v1/users                    # Alle Benutzer
POST   /api/v1/users                    # Benutzer erstellen
PUT    /api/v1/users/{id}               # Aktualisieren
DELETE /api/v1/users/{id}               # Löschen
```

---

## Fehlerantworten

```json
{
  "detail": "Beschreibung des Fehlers"
}
```

| Status | Bedeutung              |
|--------|------------------------|
| 400    | Ungültige Anfrage      |
| 401    | Nicht authentifiziert   |
| 403    | Keine Berechtigung     |
| 404    | Nicht gefunden         |
| 422    | Validierungsfehler     |
| 500    | Serverfehler           |

## Pagination

Listen-Endpunkte unterstützen:
```
?page=1&page_size=20
→ { "items": [...], "total": 42, "page": 1, "page_size": 20, "pages": 3 }
```
