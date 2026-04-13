# API-Referenz – Energiemanagement ISO 50001

Alle Endpunkte unter `http://localhost:8099/api/v1/`.  
Für Authentifizierung zuerst einen Token holen (siehe Abschnitt 1).

**Variablen in dieser Referenz:**
```bash
BASE="http://localhost:8099/api/v1"
TOKEN="<Ihr JWT-Token>"
```

---

## 1. Authentifizierung

### Login (Token holen)
```bash
curl -s -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "IhrPasswort"}' | python3 -m json.tool
```

**Token speichern:**
```bash
TOKEN=$(curl -s -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "IhrPasswort"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
echo "Token: $TOKEN"
```

### Aktuelles Benutzerprofil abrufen
```bash
curl -s "$BASE/auth/me" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Passwort ändern
```bash
curl -s -X PUT "$BASE/auth/me/password" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"current_password": "alt", "new_password": "neuPasswort123"}'
```

### Setup-Status prüfen (erster Start)
```bash
curl -s "$BASE/auth/setup/status"
```

### Erstes Admin-Konto anlegen
```bash
curl -s -X POST "$BASE/auth/setup" \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "email": "admin@firma.de", "password": "SicheresPasswort1!"}'
```

---

## 2. System & Diagnose

### Systemstatus (alle Dienste)
```bash
curl -s "$BASE/system/status" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Version
```bash
curl -s "$BASE/system/version" -H "Authorization: Bearer $TOKEN"
```

### Anwendungslogs abrufen
```bash
curl -s "$BASE/system/logs" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Auf Updates prüfen
```bash
curl -s "$BASE/system/updates/check" -H "Authorization: Bearer $TOKEN"
```

### Health-Check
```bash
curl -s "$BASE/health"
```

---

## 3. Benutzerverwaltung

### Alle Benutzer auflisten
```bash
curl -s "$BASE/users" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Neuen Benutzer anlegen
```bash
curl -s -X POST "$BASE/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "hans.muster",
    "email": "hans.muster@firma.de",
    "full_name": "Hans Muster",
    "password": "TempPass123!",
    "role_id": "<UUID der Rolle>"
  }'
```

### Benutzer sperren/entsperren
```bash
# Entsperren
curl -s -X POST "$BASE/users/<USER_ID>/unlock" -H "Authorization: Bearer $TOKEN"
```

### Alle Rollen auflisten
```bash
curl -s "$BASE/users/roles/list" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Alle Berechtigungen auflisten
```bash
curl -s "$BASE/users/roles/permissions" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

---

## 4. Standorte & Gebäude

### Alle Standorte auflisten
```bash
curl -s "$BASE/sites" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Neuen Standort anlegen
```bash
curl -s -X POST "$BASE/sites" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Hauptgebäude",
    "address": "Musterstraße 1, 12345 Musterstadt",
    "latitude": 48.137154,
    "longitude": 11.576124
  }'
```

### Gebäude eines Standorts auflisten
```bash
SITE_ID="<UUID>"
curl -s "$BASE/sites/$SITE_ID/buildings" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Gebäude anlegen
```bash
curl -s -X POST "$BASE/sites/$SITE_ID/buildings" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Verwaltungsbau A",
    "year_built": 1985,
    "area_m2": 2400.0,
    "floors": 4
  }'
```

### Nutzungseinheit anlegen
```bash
BUILDING_ID="<UUID>"
curl -s -X POST "$BASE/sites/$SITE_ID/buildings/$BUILDING_ID/units" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Büro EG",
    "usage_type": "office",
    "area_m2": 350.0,
    "floor": 0,
    "tenant": "Eigenbetrieb"
  }'
```

---

## 5. Zähler

### Alle Zähler auflisten
```bash
curl -s "$BASE/meters" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Mit Filter (nur aktive Stromzähler):
curl -s "$BASE/meters?energy_type=electricity&is_active=true" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Zähler-Baum abrufen
```bash
curl -s "$BASE/meters/tree" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Neuen Zähler anlegen (manuell)
```bash
curl -s -X POST "$BASE/meters" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Hauptzähler Strom",
    "meter_number": "EHZ-001",
    "energy_type": "electricity",
    "unit": "kWh",
    "data_source": "manual",
    "building_id": "<UUID>"
  }'
```

### Zähler manuell abfragen (Poll)
```bash
METER_ID="<UUID>"
curl -s -X POST "$BASE/meters/$METER_ID/poll" -H "Authorization: Bearer $TOKEN"
```

### Alle automatischen Zähler abfragen
```bash
curl -s -X POST "$BASE/meters/poll-all" -H "Authorization: Bearer $TOKEN"
```

### Verbindungstest Zähler
```bash
curl -s "$BASE/meters/$METER_ID/test-connection" -H "Authorization: Bearer $TOKEN"
```

---

## 6. Zählerstände

### Zählerstände auflisten
```bash
curl -s "$BASE/readings?meter_id=$METER_ID&page_size=20" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Verbrauchsübersicht abrufen
```bash
curl -s "$BASE/readings/consumption/summary?meter_id=$METER_ID&period_start=2025-01-01&period_end=2025-12-31" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Zählerstand manuell eintragen
```bash
curl -s -X POST "$BASE/readings" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "meter_id": "<UUID>",
    "timestamp": "2025-12-31T23:00:00Z",
    "value": 12345.67,
    "reading_type": "meter_reading",
    "cost_gross": 245.80
  }'
```

### Mehrere Zählerstände auf einmal (Bulk)
```bash
curl -s -X POST "$BASE/readings/bulk" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '[
    {"meter_id": "<UUID1>", "timestamp": "2025-12-01T00:00:00Z", "value": 1000.0},
    {"meter_id": "<UUID2>", "timestamp": "2025-12-01T00:00:00Z", "value": 500.5}
  ]'
```

---

## 7. Dashboard & Analysen

### Dashboard-Daten abrufen
```bash
curl -s "$BASE/dashboard?date_from=2025-01-01&date_to=2025-12-31" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### EnPI-Übersicht
```bash
curl -s "$BASE/dashboard/enpi" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Zeitreihe abrufen
```bash
curl -s "$BASE/analytics/timeseries?meter_ids=$METER_ID&start=2025-01-01&end=2025-12-31&interval=month" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Anomalieerkennung
```bash
curl -s "$BASE/analytics/anomalies?meter_ids=$METER_ID&start=2025-01-01&end=2025-12-31" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Sankey-Diagramm-Daten
```bash
curl -s "$BASE/analytics/sankey?period_start=2025-01-01&period_end=2025-12-31" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Heatmap (Wochentag × Stunde)
```bash
curl -s "$BASE/analytics/heatmap?meter_id=$METER_ID&year=2025" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Jahresvergleich (Monat für Monat)
```bash
curl -s "$BASE/analytics/monthly-comparison?year_a=2024&year_b=2025" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Energiebilanz (monatlich nach Energieträger)
```bash
curl -s "$BASE/analytics/energy-balance?start=2025-01-01&end=2025-12-31" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Kostenumlage auf Nutzungseinheiten
```bash
curl -s "$BASE/analytics/cost-allocation?start=2025-01-01&end=2025-12-31" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Lastprofil & Spitzenlasterkennung
```bash
curl -s "$BASE/analytics/load-profile?start_date=2025-06-01&end_date=2025-06-30" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Wetterbereinigte Verbrauchswerte
```bash
curl -s "$BASE/analytics/weather-corrected?meter_id=$METER_ID&year=2025" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

---

## 8. CO₂-Emissionen

### CO₂-Dashboard
```bash
curl -s "$BASE/emissions/dashboard?year=2025" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### CO₂-Zusammenfassung
```bash
curl -s "$BASE/emissions/summary?period_start=2025-01-01&period_end=2025-12-31" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### CO₂-Emissionsfaktoren auflisten
```bash
curl -s "$BASE/emissions/factors" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### CO₂ neu berechnen
```bash
curl -s -X POST "$BASE/emissions/calculate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"year": 2025}'
```

### GHG-Protocol-Export (CSV)
```bash
curl -s "$BASE/emissions/export?year=2025&format=ghg" \
  -H "Authorization: Bearer $TOKEN" -o ghg_export_2025.csv
```

---

## 9. Berichte

### Alle Berichte auflisten
```bash
curl -s "$BASE/reports" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Neuen Bericht anlegen
```bash
curl -s -X POST "$BASE/reports" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Jahresbericht 2025",
    "report_type": "annual",
    "period_start": "2025-01-01",
    "period_end": "2025-12-31",
    "include_charts": true,
    "include_anomalies": true,
    "include_co2": true,
    "include_yoy_comparison": true
  }'
```

### PDF generieren
```bash
REPORT_ID="<UUID>"
curl -s -X POST "$BASE/reports/$REPORT_ID/generate" \
  -H "Authorization: Bearer $TOKEN"
```

### PDF herunterladen
```bash
curl -s "$BASE/reports/$REPORT_ID/pdf" \
  -H "Authorization: Bearer $TOKEN" \
  -o bericht_2025.pdf
```

### Berichts-Status prüfen
```bash
curl -s "$BASE/reports/$REPORT_ID/status" -H "Authorization: Bearer $TOKEN"
```

### HTML-Vorschau (im Browser öffnen)
```bash
curl -s "$BASE/reports/$REPORT_ID/preview" \
  -H "Authorization: Bearer $TOKEN" -o vorschau.html && xdg-open vorschau.html
```

---

## 10. ISO 50001 Management

### Organisationskontext abrufen
```bash
curl -s "$BASE/iso/context" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Energiepolitik abrufen
```bash
curl -s "$BASE/iso/policies" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Energieziele auflisten
```bash
curl -s "$BASE/iso/objectives" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Neues Energieziel anlegen
```bash
curl -s -X POST "$BASE/iso/objectives" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Stromverbrauch -10% bis 2026",
    "target_value": 90.0,
    "target_unit": "percent",
    "baseline_year": 2024,
    "target_year": 2026,
    "status": "active"
  }'
```

### Audits auflisten
```bash
curl -s "$BASE/iso/audits" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Audit anlegen
```bash
curl -s -X POST "$BASE/iso/audits" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Internes Audit Q1/2025",
    "audit_date": "2025-03-15",
    "auditor": "Maria Muster",
    "status": "planned",
    "scope": "Energieverbrauch Verwaltungsgebäude"
  }'
```

### Nichtkonformitäten auflisten
```bash
curl -s "$BASE/iso/nonconformities" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Managementbewertung anlegen
```bash
curl -s -X POST "$BASE/iso/reviews" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Managementbewertung 2025",
    "review_date": "2025-12-01",
    "chairperson": "CEO Max Mustermann"
  }'
```

### Managementbewertung vorausfüllen (auto)
```bash
curl -s "$BASE/iso/reviews/prefill" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### ISO 50001-Audit-Checkliste abrufen
```bash
curl -s "$BASE/iso/audits/checklist" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Maßnahmenplan aus Auditfeststellung vorschlagen
```bash
FINDING_ID="<UUID>"
curl -s "$BASE/iso/findings/$FINDING_ID/suggest-objective" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

---

## 11. Energiebewertung (EnPI, SEU, Baseline)

### Signifikante Energieverbraucher (SEU) auflisten
```bash
curl -s "$BASE/energy-review/seu" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### SEU-Vorschläge abrufen (automatisch aus Verbrauchsdaten)
```bash
curl -s "$BASE/energy-review/seu/suggestions?period_start=2025-01-01&period_end=2025-12-31" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### EnPIs auflisten
```bash
curl -s "$BASE/energy-review/enpi" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### EnPI berechnen
```bash
ENPI_ID="<UUID>"
curl -s -X POST "$BASE/energy-review/enpi/$ENPI_ID/calculate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"period_start": "2025-01-01", "period_end": "2025-12-31"}'
```

### Alle EnPIs neu berechnen
```bash
curl -s -X POST "$BASE/energy-review/enpi/calculate-all" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"period_start": "2025-01-01", "period_end": "2025-12-31"}'
```

### Baselines auflisten
```bash
curl -s "$BASE/energy-review/baselines" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Baseline vs. Ist-Vergleich
```bash
BASELINE_ID="<UUID>"
curl -s "$BASE/energy-review/baselines/$BASELINE_ID/comparison?year=2025" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

---

## 12. Benchmarking

### Alle Referenzwerte auflisten
```bash
curl -s "$BASE/benchmarks" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Gefiltert (z.B. Bürogebäude, Strom):
curl -s "$BASE/benchmarks?building_type=office&energy_type=electricity" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Eigenen Wert vergleichen
```bash
curl -s "$BASE/benchmarks/compare?building_type=office&energy_type=electricity&actual_value=145" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Benchmark-Übersicht
```bash
curl -s "$BASE/benchmarks/overview" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

---

## 13. Schulungen

### Schulungen auflisten
```bash
curl -s "$BASE/trainings" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Gefiltert nach Status und Jahr:
curl -s "$BASE/trainings?status=planned&year=2025" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Schulungsstatistiken
```bash
curl -s "$BASE/trainings/stats" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Neue Schulung anlegen
```bash
curl -s -X POST "$BASE/trainings" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "ISO 50001 Grundlagenschulung",
    "training_type": "awareness",
    "iso_clause": "7.3",
    "training_date": "2025-03-20",
    "duration_hours": 4.0,
    "location": "Schulungsraum 1",
    "trainer": "Energiebeauftragter",
    "status": "planned",
    "recurrence_months": 24
  }'
```

---

## 14. BMS-Regelstrategien

### Regelstrategien auflisten
```bash
curl -s "$BASE/control-strategies" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Neue Regelstrategie anlegen
```bash
curl -s -X POST "$BASE/control-strategies" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Büroheizung Hauptgebäude",
    "strategy_type": "heating",
    "setpoint_heating": 21.0,
    "setpoint_night_reduction": 3.0,
    "max_co2_ppm": 1000,
    "operating_days": ["mon","tue","wed","thu","fri"],
    "operating_time_start": "06:00",
    "operating_time_end": "19:00",
    "is_active": true
  }'
```

### Soll-/Ist-Vergleich abrufen
```bash
STRATEGY_ID="<UUID>"
curl -s "$BASE/control-strategies/$STRATEGY_ID/compliance?period_start=2025-01-01&period_end=2025-03-31" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

---

## 15. Lieferverträge

### Verträge auflisten
```bash
curl -s "$BASE/contracts" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Ablaufende Verträge prüfen
```bash
curl -s "$BASE/contracts/expiring?days=90" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Vertragsvergleich (Soll/Ist)
```bash
CONTRACT_ID="<UUID>"
curl -s "$BASE/contracts/$CONTRACT_ID/comparison?period_start=2025-01-01&period_end=2025-12-31" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

---

## 16. Wetterdaten & Witterungskorrektur

### Nächste Wetterstation finden
```bash
curl -s -X POST "$BASE/weather/stations/nearest" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"latitude": 48.137154, "longitude": 11.576124}'
```

### Heizgradtage abrufen
```bash
STATION_ID="<UUID>"
curl -s "$BASE/weather/degree-days?station_id=$STATION_ID&year=2025&heating_limit=15" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Wetterdaten herunterladen (DWD/Bright Sky)
```bash
curl -s -X POST "$BASE/weather/fetch" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"station_id": "<UUID>", "date_from": "2025-01-01", "date_to": "2025-12-31"}'
```

---

## 17. Klimasensoren

### Klimasensoren auflisten
```bash
curl -s "$BASE/climate/sensors" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Komfort-Dashboard abrufen
```bash
curl -s "$BASE/climate/comfort" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Zonenübersicht
```bash
curl -s "$BASE/climate/zones/summary?period_start=2025-01-01&period_end=2025-01-31" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

---

## 18. Datenimport

### CSV/Excel-Datei hochladen und Spalten erkennen
```bash
curl -s -X POST "$BASE/imports/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@verbrauchsdaten.csv"
```

### Import verarbeiten (nach Spaltenzuordnung)
```bash
curl -s -X POST "$BASE/imports/process" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "batch_id": "<UUID aus Upload>",
    "column_mapping": {
      "timestamp": "Datum",
      "value": "Zählerstand_kWh"
    },
    "meter_id": "<UUID>"
  }'
```

### Importhistorie anzeigen
```bash
curl -s "$BASE/imports/history" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

---

## 19. Geräte-Discovery & Integrationen

### Alle Geräte entdecken
```bash
curl -s "$BASE/integrations/discover" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Home Assistant – Entities auflisten
```bash
curl -s "$BASE/integrations/ha/entities" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Shelly-Gerät testen
```bash
curl -s -X POST "$BASE/integrations/shelly/test" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"host": "192.168.178.50"}'
```

### Modbus-Verbindung testen
```bash
curl -s -X POST "$BASE/integrations/modbus/test" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"host": "192.168.178.100", "port": 502, "unit_id": 1}'
```

### BACnet – Geräte entdecken
```bash
curl -s "$BASE/integrations/bacnet/discover" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

---

## 20. Einstellungen

### Alle Einstellungen abrufen
```bash
curl -s "$BASE/settings" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Einstellung setzen
```bash
curl -s -X PUT "$BASE/settings/organization.name" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '"Muster GmbH & Co. KG"'
```

### Cache leeren
```bash
curl -s -X POST "$BASE/settings/cache/clear" -H "Authorization: Bearer $TOKEN"
```

### Home-Assistant-Verbindung testen
```bash
curl -s -X POST "$BASE/settings/integrations/test/ha" -H "Authorization: Bearer $TOKEN"
```

---

## 21. Datensicherung

### Vollexport (JSON, komprimiert)
```bash
curl -s "$BASE/backup/export" \
  -H "Authorization: Bearer $TOKEN" \
  -o backup_$(date +%Y%m%d).json.gz
```

### Backup einspielen
```bash
curl -s -X POST "$BASE/backup/import" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@backup_20250101.json.gz"
```

### Backup inspizieren (ohne Import)
```bash
curl -s -X POST "$BASE/backup/inspect" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@backup_20250101.json.gz"
```

---

## 22. Audit-Log

### Systemereignisse abrufen (nur Admin)
```bash
curl -s "$BASE/audit?page=1&page_size=50" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

---

## Praktische Shell-Funktionen (in ~/.bashrc einfügen)

```bash
# Energiemanagementsystem – Hilfsfunktionen
ENMS_BASE="http://localhost:8099/api/v1"

enms_login() {
  TOKEN=$(curl -s -X POST "$ENMS_BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\": \"$1\", \"password\": \"$2\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
  export ENMS_TOKEN="$TOKEN"
  echo "Eingeloggt. Token gespeichert als \$ENMS_TOKEN"
}

enms_get() {
  curl -s "${ENMS_BASE}${1}" -H "Authorization: Bearer $ENMS_TOKEN" | python3 -m json.tool
}

enms_post() {
  curl -s -X POST "${ENMS_BASE}${1}" \
    -H "Authorization: Bearer $ENMS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$2" | python3 -m json.tool
}

# Verwendung:
# enms_login admin MeinPasswort
# enms_get /dashboard
# enms_get /meters
# enms_post /emissions/calculate '{"year": 2025}'
```
