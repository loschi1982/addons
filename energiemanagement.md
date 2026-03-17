# Home Assistant Add-on: Energy Management System (ISO 50001)
# Claude Code – Vollständige Projektbeschreibung

## Projektübersicht

Erstelle ein Home Assistant Add-on für ein umfassendes Energiemanagementsystem nach ISO 50001. Das Add-on wird als eigenständiger Docker-Container betrieben, der über die Home Assistant Supervisor API kommuniziert und eine eigene Web-Oberfläche bereitstellt. Es ermöglicht das Erfassen, Visualisieren und Auswerten sämtlicher Energieverbräuche (Strom, Gas, Wasser, Wärme, Kälte etc.) aus verschiedenen Quellen – sowohl automatisiert über Protokolle wie Modbus, KNX und Shelly als auch manuell über Formulareingaben und Datei-Importe.

Zusätzlich berechnet das System automatisch die CO₂-Bilanz aller Energieverbräuche auf Basis aktueller Emissionsfaktoren und führt eine Witterungskorrektur des Heizenergieverbrauchs auf Basis lokaler Wetterdaten (Gradtagszahlen) durch. Beide Module fließen direkt in die Audit-Berichte ein.

---

## 1. Technologie-Stack

### Backend
- **Sprache:** Python 3.12+
- **Framework:** FastAPI (async) mit Uvicorn als ASGI-Server
- **Datenbank:** TimescaleDB (PostgreSQL + Zeitreihen-Extension) als separater Add-on-Container
  - **Relationale Daten** (Zähler, Verbraucher, Benutzer, Standorte, ISO-Dokumente): Normale PostgreSQL-Tabellen
  - **Zeitreihendaten** (Zählerstände, Klimamesswerte, Wetterdaten, CO₂-Berechnungen): TimescaleDB-Hypertables mit automatischem Time-Partitioning
  - **Warum TimescaleDB statt reinem PostgreSQL oder InfluxDB:**
    - Hypertables partitionieren Zeitreihendaten automatisch in Chunks (z.B. monatsweise) → schnelle Abfragen über Jahre
    - Continuous Aggregates berechnen monatliche/jährliche Summen automatisch vor → Dashboard lädt in Millisekunden
    - Kompression älterer Chunks spart 90–95% Speicherplatz → Jahre an Daten auf SD-Karte möglich
    - Volle SQL-Kompatibilität → SQLAlchemy, JOINs zwischen Zeitreihen und Stammdaten, keine zweite Query-Sprache
    - Eine Datenbank statt zwei → einfacheres Backup, einfacherer Betrieb auf Home-Assistant-Hardware
  - **Fallback:** Für einfache Installationen ohne Zeitreihen-Anforderungen kann reines PostgreSQL verwendet werden (Hypertables werden dann als normale Tabellen erstellt)
- **ORM:** SQLAlchemy 2.x (async) mit Alembic für Migrationen
- **Task Queue:** Celery mit Redis (für Report-Generierung, Wetterdaten-Sync und Hintergrund-Imports)
- **PDF-Generierung:** WeasyPrint (HTML/CSS → PDF über Jinja2-Templates)
- **CSV/Excel-Verarbeitung:** pandas + openpyxl
- **HTTP-Client:** httpx (async) für externe API-Aufrufe (Wetter, CO₂-Faktoren)

#### TimescaleDB-Konfiguration

```python
"""
timescale_setup.py – Einrichtung der TimescaleDB-Zeitreihentabellen.

TimescaleDB ist eine Erweiterung für PostgreSQL, die speziell für
Zeitreihendaten optimiert ist. Sie macht aus einer normalen Tabelle
eine "Hypertable", die intern automatisch in Zeitabschnitte (Chunks)
aufgeteilt wird. Das beschleunigt Abfragen über große Zeiträume enorm.

Stell dir vor: Statt 10 Millionen Zählerstände in einer einzigen
riesigen Tabelle zu durchsuchen, schaut die Datenbank nur in den
Chunks nach, die den gewünschten Zeitraum abdecken.
"""

async def setup_timescaledb(engine):
    """
    Wandelt die Zeitreihen-Tabellen in TimescaleDB-Hypertables um
    und richtet automatische Aggregationen und Kompression ein.
    
    Wird einmalig beim ersten Start und nach Migrationen aufgerufen.
    """
    async with engine.begin() as conn:
        # TimescaleDB-Extension aktivieren
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS timescaledb"))

        # ── Zählerstände als Hypertable ──
        # Partitionierung nach Zeitstempel, ein Chunk pro Monat
        # So kann die DB bei "Zeige mir den Verbrauch von März 2024"
        # direkt den richtigen Chunk laden, statt alles zu durchsuchen
        await conn.execute(text("""
            SELECT create_hypertable(
                'meter_readings',      -- Tabellenname
                'timestamp',           -- Zeitstempel-Spalte
                chunk_time_interval => INTERVAL '1 month',
                if_not_exists => TRUE
            )
        """))

        # ── Klimamesswerte als Hypertable ──
        await conn.execute(text("""
            SELECT create_hypertable(
                'climate_readings', 'timestamp',
                chunk_time_interval => INTERVAL '1 month',
                if_not_exists => TRUE
            )
        """))

        # ── Wetterdaten als Hypertable ──
        await conn.execute(text("""
            SELECT create_hypertable(
                'weather_records', 'date',
                chunk_time_interval => INTERVAL '1 year',
                if_not_exists => TRUE
            )
        """))

        # ── Continuous Aggregate: Monatliche Verbrauchssummen ──
        # TimescaleDB berechnet diese Zusammenfassung automatisch im
        # Hintergrund, sodass das Dashboard die Monatswerte nicht
        # jedes Mal aus Millionen Einzelwerten berechnen muss.
        await conn.execute(text("""
            CREATE MATERIALIZED VIEW IF NOT EXISTS monthly_consumption
            WITH (timescaledb.continuous) AS
            SELECT
                meter_id,
                time_bucket('1 month', timestamp) AS month,
                SUM(consumption) AS total_consumption,
                COUNT(*) AS reading_count,
                MIN(value) AS min_value,
                MAX(value) AS max_value,
                FIRST(value, timestamp) AS first_reading,
                LAST(value, timestamp) AS last_reading
            FROM meter_readings
            WHERE consumption IS NOT NULL
            GROUP BY meter_id, time_bucket('1 month', timestamp)
        """))

        # ── Continuous Aggregate: Tägliche Klimadaten ──
        await conn.execute(text("""
            CREATE MATERIALIZED VIEW IF NOT EXISTS daily_climate
            WITH (timescaledb.continuous) AS
            SELECT
                sensor_id,
                time_bucket('1 day', timestamp) AS day,
                AVG(temperature) AS avg_temp,
                MIN(temperature) AS min_temp,
                MAX(temperature) AS max_temp,
                AVG(humidity) AS avg_humidity
            FROM climate_readings
            GROUP BY sensor_id, time_bucket('1 day', timestamp)
        """))

        # ── Automatische Kompression ──
        # Daten älter als 6 Monate werden komprimiert.
        # Das spart 90-95% Speicherplatz — wichtig auf HA-Hardware
        # mit begrenztem Speicher (SD-Karte, SSD).
        # Komprimierte Daten sind weiterhin abfragbar, nur das
        # Einfügen neuer Werte in komprimierte Chunks ist nicht möglich.
        await conn.execute(text("""
            ALTER TABLE meter_readings SET (
                timescaledb.compress,
                timescaledb.compress_segmentby = 'meter_id',
                timescaledb.compress_orderby = 'timestamp DESC'
            )
        """))
        await conn.execute(text("""
            SELECT add_compression_policy('meter_readings', INTERVAL '6 months',
                                          if_not_exists => TRUE)
        """))

        await conn.execute(text("""
            ALTER TABLE climate_readings SET (
                timescaledb.compress,
                timescaledb.compress_segmentby = 'sensor_id',
                timescaledb.compress_orderby = 'timestamp DESC'
            )
        """))
        await conn.execute(text("""
            SELECT add_compression_policy('climate_readings', INTERVAL '6 months',
                                          if_not_exists => TRUE)
        """))

        # ── Optionale Datenaufbewahrung ──
        # Rohdaten älter als X Jahre automatisch löschen (konfigurierbar).
        # Die Continuous Aggregates (Monatssummen) bleiben erhalten.
        # Standard: deaktiviert (alle Rohdaten behalten)
        # Kann in den Systemeinstellungen aktiviert werden:
        # SELECT add_retention_policy('meter_readings', INTERVAL '5 years');
```

#### Docker-Container-Architektur

```yaml
# docker-compose.yml für das Add-on
services:
  # TimescaleDB als Datenbank-Container
  # Basiert auf dem offiziellen TimescaleDB-Image mit PostgreSQL 16
  timescaledb:
    image: timescale/timescaledb:latest-pg16
    environment:
      POSTGRES_DB: energy_management
      POSTGRES_USER: energy
      POSTGRES_PASSWORD: ${DB_PASSWORD}  # Aus HA-Secrets
    volumes:
      - timescaledb_data:/var/lib/postgresql/data
    # Ressourcen-Limits für HA-Hardware (Raspberry Pi etc.)
    deploy:
      resources:
        limits:
          memory: 512M    # Anpassbar in config.yaml
        reservations:
          memory: 256M

  # Redis für Celery Task Queue und Caching
  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    deploy:
      resources:
        limits:
          memory: 128M

  # Das eigentliche Energy-Management-Backend
  backend:
    build: ./backend
    depends_on:
      - timescaledb
      - redis
    environment:
      DATABASE_URL: postgresql+asyncpg://energy:${DB_PASSWORD}@timescaledb:5432/energy_management
      REDIS_URL: redis://redis:6379/0

  # Celery Worker für Hintergrund-Tasks
  celery_worker:
    build: ./backend
    command: celery -A app.celery worker
    depends_on:
      - timescaledb
      - redis

  # Celery Beat für geplante Tasks (Wetterdaten-Sync, Kompression)
  celery_beat:
    build: ./backend
    command: celery -A app.celery beat
    depends_on:
      - timescaledb
      - redis
```

### Frontend
- **Framework:** React 18 mit TypeScript
- **Build-Tool:** Vite
- **State Management:** Zustand oder Redux Toolkit
- **UI-Bibliothek:** Shadcn/ui + Tailwind CSS (angelehnt an Home Assistant Design)
- **Diagramme:** Recharts oder Apache ECharts
- **Drag & Drop:** dnd-kit (für Schema-Editor)
- **PDF-Viewer:** react-pdf (Vorschau vor Download)

#### Auslieferung (Produktion)
Das React-Frontend wird als **statische SPA** gebaut und vom FastAPI-Backend ausgeliefert.
Kein separater Node-Server, kein Nginx — ein einziger Uvicorn-Prozess serviert API und Frontend:

```python
"""
main.py – FastAPI App-Factory.

In der Produktionsumgebung liefert FastAPI sowohl die REST-API
(unter /api/v1/) als auch das React-Frontend (als statische Dateien)
aus. Das spart einen zusätzlichen Webserver-Prozess und vereinfacht
das Docker-Setup für Home Assistant.
"""
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

def create_app() -> FastAPI:
    app = FastAPI(title="Energy Management", version="1.0.0")

    # --- API-Router einbinden ---
    # Alle API-Endpunkte leben unter /api/v1/
    app.include_router(api_router, prefix="/api/v1")

    # --- React-Frontend als statische Dateien ausliefern ---
    # Nach "npm run build" liegen die fertigen Dateien in frontend/dist/
    # Diese werden hier als statische Dateien gemountet.
    frontend_dir = Path(__file__).parent.parent.parent / "frontend" / "dist"
    if frontend_dir.exists():
        # Statische Assets (JS, CSS, Bilder) unter /assets/
        app.mount("/assets", StaticFiles(directory=frontend_dir / "assets"), name="assets")

        # Alle anderen Routen → index.html (React-Router übernimmt das Routing)
        # Das ist nötig, weil React ein Single-Page-App ist:
        # Wenn jemand direkt /meters/123 aufruft, muss der Server
        # trotzdem index.html zurückgeben, damit React starten und
        # die richtige Seite anzeigen kann.
        @app.get("/{full_path:path}")
        async def serve_spa(full_path: str):
            file_path = frontend_dir / full_path
            if file_path.exists() and file_path.is_file():
                return FileResponse(file_path)
            return FileResponse(frontend_dir / "index.html")

    return app
```

#### Entwicklung (Dev-Server)
Während der Entwicklung laufen Frontend und Backend als **getrennte Prozesse**,
damit Vite Hot Module Replacement (sofortige Aktualisierung bei Code-Änderungen)
bereitstellen kann:

```
Backend:  uvicorn app.main:app --reload --port 8000
Frontend: npm run dev                    → Vite auf Port 5173
```

Vite leitet API-Requests automatisch an das Backend weiter:

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Alle Requests an /api/ werden an das Backend weitergeleitet.
      // So kann das Frontend in der Entwicklung genauso API-Calls
      // machen wie in der Produktion — nur dass Vite dazwischensitzt
      // und die Frontend-Dateien live aktualisiert.
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // WebSocket-Verbindungen für Live-Updates
      '/api/v1/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
  build: {
    // Die gebauten Dateien landen in frontend/dist/
    // Von dort liefert FastAPI sie in der Produktion aus
    outDir: 'dist',
    sourcemap: false,  // Kein Sourcemap in Produktion
  },
});
```

#### Docker Multi-Stage Build
Das Dockerfile baut das Frontend in einem Node-Stage und kopiert
die statischen Dateien in den Python-Stage:

```dockerfile
# ── Stage 1: Frontend bauen ──
# Node.js wird nur zum Bauen gebraucht, nicht zur Laufzeit
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci                          # Abhängigkeiten installieren
COPY frontend/ ./
RUN npm run build                   # React → statische Dateien in dist/

# ── Stage 2: Backend + fertige Frontend-Dateien ──
# Das finale Image enthält nur Python + die fertigen statischen Dateien
FROM python:3.12-slim
WORKDIR /app

# Python-Abhängigkeiten installieren
COPY backend/pyproject.toml backend/poetry.lock* ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Backend-Code kopieren
COPY backend/ ./backend/

# Frontend-Build aus Stage 1 kopieren (nur die fertigen Dateien, kein Node.js)
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Uvicorn starten — liefert API + Frontend aus
CMD ["uvicorn", "backend.app.main:create_app", "--host", "0.0.0.0", "--port", "8099", "--factory"]
```

### Home Assistant Integration
- **Supervisor API** für Add-on-Lifecycle
- **REST API / WebSocket API** für Entity-Zugriff (Sensoren, Zähler)
- **Ingress** für die eingebettete Web-Oberfläche im HA-Dashboard
- **Long-Lived Access Tokens** für die Authentifizierung

### Containerisierung
- **Dockerfile** basierend auf den Home Assistant Add-on Base Images
- **config.yaml** nach Home Assistant Add-on-Spezifikation (Ports, Ingress, Optionen)

---

## 2. Datenmodell

### 2.1 Zähler (Meter)

```python
class Meter(Base):
    __tablename__ = "meters"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str]                          # z.B. "Hauptstromzähler EG"
    description: Mapped[str | None]
    meter_number: Mapped[str | None]           # Physische Zählernummer
    energy_type: Mapped[EnergyType]            # Enum: ELECTRICITY, GAS, WATER, HEAT, COOLING, COMPRESSED_AIR, STEAM, OTHER
    unit: Mapped[str]                          # kWh, m³, MWh, l, etc.
    data_source: Mapped[DataSource]            # Enum: SHELLY, MODBUS, KNX, HOME_ASSISTANT_ENTITY, MANUAL, CSV_IMPORT, API
    source_config: Mapped[dict]                # JSON: Verbindungsparameter je nach Quelle
    parent_meter_id: Mapped[uuid.UUID | None]  # Hierarchie: Unterzähler-Beziehung
    location: Mapped[str | None]               # Gebäude / Stockwerk / Raum
    cost_center: Mapped[str | None]            # Kostenstelle
    tariff_info: Mapped[dict | None]           # JSON: Preis pro Einheit, Grundgebühr, Zeitzone
    is_weather_corrected: Mapped[bool] = mapped_column(default=False)  # Witterungskorrektur anwenden
    co2_factor_override: Mapped[Decimal | None]  # Manueller CO₂-Faktor (überschreibt automatischen)
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]

    readings = relationship("MeterReading", back_populates="meter")
    consumers = relationship("Consumer", secondary="meter_consumer", back_populates="meters")
    schema_position = relationship("SchemaPosition", uselist=False, back_populates="meter")
```

### 2.2 Zählerstand (MeterReading)

```python
class MeterReading(Base):
    __tablename__ = "meter_readings"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    meter_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("meters.id"))
    timestamp: Mapped[datetime]                # Zeitpunkt der Ablesung
    value: Mapped[Decimal]                     # Absolutwert des Zählerstands
    consumption: Mapped[Decimal | None]        # Berechneter Verbrauch seit letzter Ablesung
    source: Mapped[ReadingSource]              # Enum: AUTOMATIC, MANUAL, IMPORT, BILLING
    quality: Mapped[DataQuality]               # Enum: MEASURED, ESTIMATED, CORRECTED
    notes: Mapped[str | None]
    import_batch_id: Mapped[uuid.UUID | None]  # Referenz auf Import-Vorgang
    created_at: Mapped[datetime]
```

### 2.3 Verbraucher (Consumer)

```python
class Consumer(Base):
    __tablename__ = "consumers"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str]                          # z.B. "Klimaanlage Serverraum"
    category: Mapped[str]                      # z.B. Beleuchtung, HVAC, Produktion, IT
    rated_power: Mapped[Decimal | None]        # Nennleistung in kW
    operating_hours: Mapped[Decimal | None]    # Geschätzte Betriebsstunden/Jahr
    location: Mapped[str | None]
    priority: Mapped[int] = mapped_column(default=0)  # Für Energieaudit-Relevanz
    notes: Mapped[str | None]
    is_active: Mapped[bool] = mapped_column(default=True)

    meters = relationship("Meter", secondary="meter_consumer", back_populates="consumers")
```

### 2.4 Schema (EnergySchema)

```python
class EnergySchema(Base):
    __tablename__ = "energy_schemas"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str]                          # z.B. "Gebäude A – Stromverteilung"
    schema_type: Mapped[str]                   # z.B. "electricity_distribution", "water_network"
    description: Mapped[str | None]
    is_default: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]

class SchemaPosition(Base):
    __tablename__ = "schema_positions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    schema_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("energy_schemas.id"))
    meter_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("meters.id"))
    x: Mapped[float]                           # Position im Canvas
    y: Mapped[float]
    width: Mapped[float] = mapped_column(default=200)
    height: Mapped[float] = mapped_column(default=100)
    style_config: Mapped[dict | None]          # Farbe, Icon, Label-Position
    connections: Mapped[list[dict] | None]     # Verbindungslinien zu anderen Positionen
```

### 2.5 Wetterdaten (WeatherData)

```python
class WeatherStation(Base):
    __tablename__ = "weather_stations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str]                          # z.B. "Hamburg-Fuhlsbüttel"
    dwd_station_id: Mapped[str | None]         # DWD-Stationskennung
    latitude: Mapped[float]
    longitude: Mapped[float]
    altitude: Mapped[float | None]             # Höhe in m ü. NN
    data_source: Mapped[str]                   # Enum: DWD_OPENDATA, BRIGHT_SKY_API, MANUAL, CSV_IMPORT
    is_active: Mapped[bool] = mapped_column(default=True)

class WeatherRecord(Base):
    __tablename__ = "weather_records"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    station_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("weather_stations.id"))
    date: Mapped[date]                         # Tagesdatum
    temp_avg: Mapped[Decimal]                  # Tagesmitteltemperatur in °C
    temp_min: Mapped[Decimal | None]
    temp_max: Mapped[Decimal | None]
    heating_degree_days: Mapped[Decimal | None] # Heizgradtage (Gt20/15 nach VDI 3807)
    cooling_degree_days: Mapped[Decimal | None] # Kühlgradtage
    sunshine_hours: Mapped[Decimal | None]
    precipitation_mm: Mapped[Decimal | None]
    wind_speed_avg: Mapped[Decimal | None]     # m/s
    source: Mapped[str]                        # Enum: AUTOMATIC, MANUAL, IMPORT

class MonthlyDegreeDays(Base):
    """Vorberechnete monatliche Gradtagszahlen für schnellen Zugriff"""
    __tablename__ = "monthly_degree_days"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    station_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("weather_stations.id"))
    year: Mapped[int]
    month: Mapped[int]
    heating_degree_days: Mapped[Decimal]       # Summe Heizgradtage des Monats (Gt20/15)
    cooling_degree_days: Mapped[Decimal]       # Summe Kühlgradtage des Monats
    avg_temperature: Mapped[Decimal]           # Monatsmitteltemperatur
    heating_days: Mapped[int]                  # Anzahl Heiztage (Tagesmittel < 15°C)
    long_term_avg_hdd: Mapped[Decimal | None]  # Langjähriges Mittel HDD dieses Monats (Referenz)
```

### 2.6 CO₂-Emissionsfaktoren (EmissionFactor)

```python
class EmissionFactorSource(Base):
    """Quellen für Emissionsfaktoren"""
    __tablename__ = "emission_factor_sources"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str]                          # z.B. "UBA Strommix DE", "BAFA", "Electricity Maps"
    source_type: Mapped[str]                   # Enum: UBA, BAFA, ELECTRICITY_MAPS, GEMIS, PROBAS, MANUAL, CUSTOM
    description: Mapped[str | None]
    url: Mapped[str | None]                    # Quell-URL / API-Endpunkt
    is_default: Mapped[bool] = mapped_column(default=False)
    last_updated: Mapped[datetime | None]

class EmissionFactor(Base):
    """CO₂-Emissionsfaktoren pro Energieträger und Zeitraum"""
    __tablename__ = "emission_factors"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("emission_factor_sources.id"))
    energy_type: Mapped[EnergyType]            # ELECTRICITY, GAS, HEAT, etc.
    year: Mapped[int | None]                   # Jahr der Gültigkeit (None = zeitlos)
    month: Mapped[int | None]                  # Monat (None = Jahresmittel)
    region: Mapped[str] = mapped_column(default="DE")  # ISO-Ländercode oder Zone
    co2_g_per_kwh: Mapped[Decimal]             # g CO₂ pro kWh (Hauptwert)
    co2eq_g_per_kwh: Mapped[Decimal | None]    # g CO₂-Äquivalente (inkl. CH₄, N₂O)
    includes_upstream: Mapped[bool] = mapped_column(default=False)  # Inkl. Vorketten?
    scope: Mapped[str] = mapped_column(default="scope_2")  # scope_1, scope_2, scope_3
    valid_from: Mapped[date | None]
    valid_to: Mapped[date | None]
    notes: Mapped[str | None]

class CO2Calculation(Base):
    """Berechnete CO₂-Emissionen pro Zähler und Zeitraum"""
    __tablename__ = "co2_calculations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    meter_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("meters.id"))
    period_start: Mapped[date]
    period_end: Mapped[date]
    consumption_kwh: Mapped[Decimal]           # Verbrauch im Zeitraum (umgerechnet in kWh)
    emission_factor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("emission_factors.id"))
    co2_kg: Mapped[Decimal]                    # Berechnete CO₂-Emissionen in kg
    co2eq_kg: Mapped[Decimal | None]           # CO₂-Äquivalente in kg
    calculation_method: Mapped[str]            # Enum: ANNUAL_AVG, MONTHLY, REALTIME, MANUAL
    calculated_at: Mapped[datetime]
```

### 2.7 Witterungskorrektur (WeatherCorrection)

```python
class WeatherCorrectionConfig(Base):
    """Konfiguration der Witterungskorrektur pro Zähler"""
    __tablename__ = "weather_correction_configs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    meter_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("meters.id"))
    station_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("weather_stations.id"))
    method: Mapped[str]                        # Enum: VDI_3807, DEGREE_DAY_RATIO, REGRESSION
    indoor_temp: Mapped[Decimal] = mapped_column(default=20)   # Raum-Solltemperatur in °C
    heating_limit: Mapped[Decimal] = mapped_column(default=15)  # Heizgrenze in °C
    cooling_limit: Mapped[Decimal] = mapped_column(default=24)  # Kühlgrenze in °C (für Kälte)
    reference_year: Mapped[int | None]         # Referenzjahr für Normierung
    reference_hdd: Mapped[Decimal | None]      # Langjähriges Mittel der Heizgradtage
    base_load_percent: Mapped[Decimal | None]  # Witterungsunabhängiger Grundlastanteil in %
    is_active: Mapped[bool] = mapped_column(default=True)

class WeatherCorrectedConsumption(Base):
    """Witterungskorrigierte Verbrauchswerte"""
    __tablename__ = "weather_corrected_consumption"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    meter_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("meters.id"))
    period_start: Mapped[date]
    period_end: Mapped[date]
    raw_consumption: Mapped[Decimal]           # Gemessener Verbrauch
    corrected_consumption: Mapped[Decimal]     # Witterungsbereinigter Verbrauch
    correction_factor: Mapped[Decimal]         # Korrekturfaktor (Referenz-GTZ / Ist-GTZ)
    actual_hdd: Mapped[Decimal]                # Tatsächliche Heizgradtage im Zeitraum
    reference_hdd: Mapped[Decimal]             # Referenz-Heizgradtage
    method: Mapped[str]                        # Verwendete Methode
    calculated_at: Mapped[datetime]
```

### 2.8 Audit-Bericht (AuditReport)

```python
class AuditReport(Base):
    __tablename__ = "audit_reports"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str]
    report_type: Mapped[ReportType]            # Enum: MONTHLY, QUARTERLY, ANNUAL, CUSTOM, AUDIT
    period_start: Mapped[date]
    period_end: Mapped[date]
    status: Mapped[ReportStatus]               # Enum: DRAFT, GENERATING, COMPLETED, FAILED
    data_snapshot: Mapped[dict]                # JSON: Eingefrorene Daten zum Zeitpunkt der Erstellung
    co2_summary: Mapped[dict | None]           # JSON: CO₂-Bilanz-Zusammenfassung
    weather_correction_applied: Mapped[bool] = mapped_column(default=False)
    findings: Mapped[list[dict] | None]        # Auffälligkeiten, Abweichungen
    recommendations: Mapped[list[dict] | None] # Maßnahmenvorschläge
    pdf_path: Mapped[str | None]               # Pfad zur generierten PDF
    generated_at: Mapped[datetime | None]
    created_at: Mapped[datetime]
```

---

## 3. Standort-, Gebäude- & Nutzungseinheiten-Verwaltung

### 3.1 Zweck

Der Standort ist die zentrale Ordnungseinheit des Systems: CO₂-Emissionsfaktoren sind regional unterschiedlich (Strommix variiert nach Land/Region), Gradtagszahlen und Wetterdaten sind standortabhängig, Zähler und Verbraucher gehören zu einem physischen Ort, und Auswertungen müssen nach Standort filterbar sein. Ohne eine saubere Standortverwaltung können Witterungskorrektur und CO₂-Bilanz nicht korrekt arbeiten.

Das System bildet eine **dreistufige Hierarchie** ab:

```
Standort (Site/Campus)
  └── Gebäude (Building)
        └── Nutzungseinheit (Usage Unit)
```

**Beispiele:**
- Firmencampus „Werk Nord" → Gebäude „Verwaltung" → Nutzungseinheiten „Büro 1. OG", „Kantine EG"
- Wohnanlage „Am Park 5" → Gebäude „Haus A" → Nutzungseinheiten „Wohnung 1", „Wohnung 2", „Gewerbe EG"
- Einzelgebäude „Hauptsitz" → (Gebäude = Standort) → Nutzungseinheiten „Produktion", „Büro", „Lager"

### 3.2 Datenmodell

```python
class Site(Base):
    """
    Standort / Liegenschaft / Campus.
    Oberste Ebene der Gebäudehierarchie.
    Ein Standort kann ein einzelnes Gebäude oder ein ganzer Campus sein.
    Der Standort bestimmt die Wetterdaten und den CO₂-Faktor-Bereich.
    """
    __tablename__ = "sites"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str]                          # z.B. "Firmencampus Nord", "Wohnanlage Am Park"
    code: Mapped[str | None]                   # Kurzbezeichnung, z.B. "FCN", "WAP"
    description: Mapped[str | None]

    # Adresse
    street: Mapped[str | None]
    postal_code: Mapped[str | None]
    city: Mapped[str | None]
    state: Mapped[str | None]                  # Bundesland
    country: Mapped[str] = mapped_column(default="DE")

    # Geokoordinaten (bestimmen Wetter und CO₂-Region)
    latitude: Mapped[float | None]
    longitude: Mapped[float | None]

    # Zuordnungen (werden automatisch aus Koordinaten abgeleitet)
    weather_station_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("weather_stations.id"))
    co2_region: Mapped[str] = mapped_column(default="DE")
    electricity_maps_zone: Mapped[str | None]
    timezone: Mapped[str] = mapped_column(default="Europe/Berlin")

    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]

    # Beziehungen
    buildings = relationship("Building", back_populates="site")
    weather_station = relationship("WeatherStation")


class Building(Base):
    """
    Gebäude innerhalb eines Standorts.
    Ein Standort kann mehrere Gebäude enthalten (z.B. Campus mit
    Verwaltungsgebäude, Produktionshalle und Lagerhalle).
    Das Gebäude enthält die physischen Gebäudedaten wie Fläche und Baujahr.
    """
    __tablename__ = "buildings"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    site_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sites.id"))
    name: Mapped[str]                          # z.B. "Verwaltungsgebäude", "Halle A", "Haus B"
    code: Mapped[str | None]                   # Kurzbezeichnung
    description: Mapped[str | None]
    building_type: Mapped[str | None]          # z.B. Büro, Produktion, Lager, Wohngebäude, Mischnutzung

    # Gebäudedaten
    gross_floor_area_m2: Mapped[Decimal | None]  # Bruttogrundfläche in m²
    net_floor_area_m2: Mapped[Decimal | None]    # Nettogrundfläche in m²
    heated_area_m2: Mapped[Decimal | None]       # Beheizte Fläche in m²
    cooled_area_m2: Mapped[Decimal | None]       # Gekühlte Fläche in m²
    building_year: Mapped[int | None]            # Baujahr
    floors_above_ground: Mapped[int | None]      # Anzahl Obergeschosse
    floors_below_ground: Mapped[int | None]      # Anzahl Untergeschosse
    energy_certificate_class: Mapped[str | None] # Energieausweis-Klasse (A+ bis H)
    energy_certificate_value: Mapped[Decimal | None]  # kWh/(m²·a) aus Energieausweis

    # Adresse (optional, falls abweichend vom Standort)
    street: Mapped[str | None]
    postal_code: Mapped[str | None]
    city: Mapped[str | None]

    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]

    # Beziehungen
    site = relationship("Site", back_populates="buildings")
    usage_units = relationship("UsageUnit", back_populates="building")


class UsageUnit(Base):
    """
    Nutzungseinheit innerhalb eines Gebäudes.
    Eine Nutzungseinheit ist ein abgrenzbarer Bereich mit eigenem
    Nutzungszweck — z.B. eine Mietwohnung, eine Büroetage, ein
    Ladengeschäft, eine Produktionslinie oder ein Serverraum.

    Jede Nutzungseinheit kann eigene Zähler, Verbraucher und
    Klimasensoren haben. Die Fläche der Nutzungseinheit wird für
    die EnPI-Berechnung (kWh/m²) herangezogen.

    Beispiele:
    - Wohnanlage: "Wohnung 1 EG", "Wohnung 2 OG", "Gewerbe EG"
    - Bürogebäude: "Büro 1. OG", "Kantine EG", "Serverraum KG"
    - Produktionshalle: "Fertigungslinie 1", "Lager", "Sozialräume"
    """
    __tablename__ = "usage_units"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    building_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("buildings.id"))
    name: Mapped[str]                          # z.B. "Wohnung 1 EG", "Büro 2. OG", "Produktion Halle A"
    code: Mapped[str | None]                   # Kurzbezeichnung oder Wohnungsnummer
    description: Mapped[str | None]

    # Nutzungsdaten
    usage_type: Mapped[str]                    # Enum: RESIDENTIAL, OFFICE, RETAIL, PRODUCTION,
                                               #        WAREHOUSE, SERVER_ROOM, COMMON_AREA,
                                               #        KITCHEN_CANTEEN, LABORATORY, OTHER
    floor: Mapped[str | None]                  # Stockwerk, z.B. "EG", "1. OG", "KG"
    area_m2: Mapped[Decimal | None]            # Nutzfläche in m²
    heated_area_m2: Mapped[Decimal | None]     # Beheizte Fläche (kann von area_m2 abweichen)
    occupants: Mapped[int | None]              # Anzahl Nutzer/Bewohner
    operating_hours_per_week: Mapped[Decimal | None]  # Betriebsstunden pro Woche

    # Mietinformationen (optional, für Nebenkostenabrechnung)
    tenant_name: Mapped[str | None]            # Mieter/Nutzer
    tenant_id: Mapped[str | None]              # Mieternummer oder Kostenstelle
    lease_start: Mapped[date | None]
    lease_end: Mapped[date | None]

    # Zielwerte für Benchmarking
    target_enpi_kwh_per_m2: Mapped[Decimal | None]   # Ziel kWh/m²·a
    target_co2_kg_per_m2: Mapped[Decimal | None]     # Ziel kg CO₂/m²·a

    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]

    # Beziehungen
    building = relationship("Building", back_populates="usage_units")
    meters = relationship("Meter", back_populates="usage_unit")
    consumers = relationship("Consumer", back_populates="usage_unit")
    climate_sensors = relationship("ClimateSensor", back_populates="usage_unit")
```

### 3.3 Verknüpfung mit Zählern und Verbrauchern

Jeder Zähler, Verbraucher und Klimasensor wird einer Nutzungseinheit zugeordnet. Der Standort und das Gebäude ergeben sich dann automatisch aus der Hierarchie:

```python
# Erweiterung des Meter-Modells:
class Meter(Base):
    ...
    usage_unit_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("usage_units.id"))
    usage_unit = relationship("UsageUnit", back_populates="meters")

    @property
    def building(self) -> Building | None:
        """Gebäude wird automatisch über die Nutzungseinheit aufgelöst."""
        return self.usage_unit.building if self.usage_unit else None

    @property
    def site(self) -> Site | None:
        """Standort wird automatisch über Gebäude → Standort aufgelöst."""
        return self.usage_unit.building.site if self.usage_unit else None
```

Auswertungen lassen sich auf jeder Hierarchieebene filtern und aggregieren:
- **Nutzungseinheit:** „Wie viel verbraucht Wohnung 3?"
- **Gebäude:** „Wie viel verbraucht das gesamte Verwaltungsgebäude?" (Summe aller Nutzungseinheiten)
- **Standort:** „Wie viel verbraucht der gesamte Campus?" (Summe aller Gebäude)
- **Übergreifend:** „Wie vergleichen sich die Standorte untereinander?"

### 3.4 Automatische Standort-Funktionen

- **Geo-Lookup:** Bei Eingabe einer PLZ oder Adresse werden Koordinaten automatisch via Nominatim (OpenStreetMap, kostenlos) oder über die HA-eigene Standortinformation aufgelöst
- **Wetterstations-Zuordnung:** Beim Anlegen eines Standorts wird automatisch die nächstgelegene DWD-Wetterstation zugewiesen (Haversine-Distanz)
- **CO₂-Faktor-Region:** Wird aus dem Länderkürzel abgeleitet, für Deutschland standardmäßig „DE" (UBA Strommix)
- **Electricity Maps Zone:** Wird automatisch aus den Koordinaten bestimmt
- **Gradtagszahlen:** Werden standortspezifisch berechnet — verschiedene Standorte können unterschiedliche Wetterstationen haben
- **EnPI-Normierung:** Fläche, Nutzer und Betriebsstunden der jeweiligen Nutzungseinheit fließen in die Kennzahlenberechnung ein (nicht Gesamtgebäude-Fläche für eine einzelne Wohnung)

### 3.5 Frontend

- **Standort-Übersicht:** Karten-Ansicht (OpenStreetMap via Leaflet) mit Pins für alle Standorte
- **Gebäude-/Nutzungseinheiten-Baum:** Aufklappbare Baumansicht: Standort → Gebäude → Nutzungseinheiten mit Icons je Nutzungstyp und Zähleranzahl
- **Standort-Formular:** Adresse, Koordinaten (mit Karten-Picker), automatische Wetterstations-Zuordnung
- **Gebäude-Formular:** Gebäudedaten, Flächen, Baujahr, Energieausweis
- **Nutzungseinheiten-Formular:** Nutzungstyp, Fläche, Stockwerk, Nutzer, optionale Mieterdaten
- **Standort-Dashboard:** KPIs pro Standort, Gebäude oder Nutzungseinheit (Verbrauch, Kosten, CO₂, EnPIs), Vergleich auf jeder Ebene
- **Zähler-Zuordnung:** Beim Erstellen eines Zählers wird zuerst der Standort gewählt, dann das Gebäude, dann die Nutzungseinheit (Kaskaden-Dropdown)

### 3.6 API-Endpunkte

```
# Standorte
GET    /api/v1/sites                                # Alle Standorte
POST   /api/v1/sites                                # Standort anlegen
GET    /api/v1/sites/{id}                           # Standort-Details
PUT    /api/v1/sites/{id}                           # Standort bearbeiten
DELETE /api/v1/sites/{id}                           # Standort deaktivieren
GET    /api/v1/sites/{id}/summary                   # Verbrauchszusammenfassung Standort-Ebene
POST   /api/v1/sites/geocode                        # PLZ/Adresse → Koordinaten

# Gebäude
GET    /api/v1/sites/{site_id}/buildings             # Gebäude eines Standorts
POST   /api/v1/sites/{site_id}/buildings             # Gebäude anlegen
GET    /api/v1/buildings/{id}                        # Gebäude-Details
PUT    /api/v1/buildings/{id}                        # Gebäude bearbeiten
DELETE /api/v1/buildings/{id}                        # Gebäude deaktivieren
GET    /api/v1/buildings/{id}/summary                # Verbrauchszusammenfassung Gebäude-Ebene

# Nutzungseinheiten
GET    /api/v1/buildings/{building_id}/units          # Nutzungseinheiten eines Gebäudes
POST   /api/v1/buildings/{building_id}/units          # Nutzungseinheit anlegen
GET    /api/v1/units/{id}                            # Einheit-Details
PUT    /api/v1/units/{id}                            # Einheit bearbeiten
DELETE /api/v1/units/{id}                            # Einheit deaktivieren
GET    /api/v1/units/{id}/meters                     # Zähler einer Nutzungseinheit
GET    /api/v1/units/{id}/summary                    # Verbrauchszusammenfassung Einheiten-Ebene

# Hierarchie
GET    /api/v1/locations/tree                        # Vollständige Baumstruktur (Standort → Gebäude → Einheiten)
GET    /api/v1/locations/comparison                   # Vergleich auf gleicher Ebene (Standorte, Gebäude oder Einheiten)
```

---

## 4. Datenquellen & Integrationen

### 3.1 Shelly-Integration
- Automatische Erkennung von Shelly-Geräten im Netzwerk via mDNS/CoAP
- Abruf über Shelly HTTP API (Gen1 + Gen2)
- Polling-Intervall konfigurierbar (Standard: 60 Sekunden)
- Unterstützte Metriken: Leistung (W), Energie (Wh), Spannung, Strom
- WebSocket-Verbindung für Echtzeit-Updates bei Gen2-Geräten

### 3.2 Modbus-Integration
- Modbus TCP und Modbus RTU (über Serial-Gateway)
- Konfigurierbare Register-Adressen, Datentypen (INT16, INT32, FLOAT32, FLOAT64), Byte-Order
- Unterstützung für Function Codes 03 (Holding Registers) und 04 (Input Registers)
- Skalierungsfaktoren und Offset konfigurierbar
- Bibliothek: pymodbus

### 3.3 KNX-Integration
- Anbindung über KNX/IP-Gateway (Tunneling und Routing)
- Konfiguration über ETS-Export (knxproj-Datei importierbar)
- Gruppen-Adressen für Zählerwerte konfigurierbar
- Bibliothek: xknx

### 3.4 Home Assistant Entities

#### Entity-Integration über Dropdown-Menü
- Direkte Anbindung an bestehende HA-Sensoren über die WebSocket API
- **Entity-Picker als Dropdown-Menü** im Frontend:
  - Abruf aller verfügbaren Entities über HA REST API (`/api/states`) beim Öffnen des Dialogs
  - Gruppierung nach Domain: `sensor.*`, `input_number.*`, `counter.*`
  - Filterung nach `device_class`: energy, gas, water, temperature, humidity, power, current, voltage, pressure
  - Suchfeld mit Autovervollständigung (Filterung nach Entity-ID, Friendly Name, Area)
  - Anzeige von: Entity-ID, Friendly Name, Aktueller Wert + Einheit, Area/Device, Icon
  - Multi-Select möglich für Batch-Zuordnung mehrerer Entities
  - Vorschau des aktuellen Wertes und der letzten 24h als Sparkline vor Bestätigung
- **Automatische Erkennung** passender Entities beim Erstellen eines Zählers:
  - Energiezähler: `device_class` in [energy, gas, water]
  - Klimasensoren: `device_class` in [temperature, humidity]
  - Leistungsmessung: `device_class` in [power, current, voltage]
  - Sortierung nach Relevanz basierend auf dem gewählten Zähler- oder Sensortyp
- **Übernahme der HA-History-Daten** beim Erstellen eines Zählers (Zeitraum wählbar)
- **Live-Synchronisation:** WebSocket-Subscription auf `state_changed`-Events für Echtzeit-Updates
- **Reconnect-Logik:** Automatische Wiederverbindung bei HA-Neustart mit Backoff

#### Unterstützte Entity-Typen

| HA device_class   | Verwendung im Add-on                          | Einheit        |
|-------------------|------------------------------------------------|----------------|
| energy            | Energiezähler (Strom)                          | kWh, Wh        |
| gas               | Gaszähler                                      | m³, ft³        |
| water             | Wasserzähler                                   | m³, L, gal     |
| power             | Leistungsmessung (Live)                        | W, kW          |
| current           | Strommessung                                   | A, mA          |
| voltage           | Spannungsmessung                               | V              |
| temperature       | Raumtemperatur / Außentemperatur                | °C, °F         |
| humidity          | Relative Luftfeuchtigkeit                      | %              |
| pressure          | Luftdruck (optional für erweiterte Korrektur)  | hPa, mbar      |

### 3.5 Manuelle Eingabe
- Formular im Frontend für Einzeleingabe: Datum, Zählerstand, optional Foto
- Monatliche Abrechnungseingabe: Tabelle mit Monatsfeldern für Zählerstand und Kosten
- Ableseturnus konfigurierbar (monatlich, quartalsweise, jährlich)
- Plausibilitätsprüfung: Warnung bei unplausiblen Sprüngen (> 3× Standardabweichung)

### 3.6 Datei-Import (laufend & historischer Bulk-Import)

Das Importsystem muss zwei Szenarien gleichermaßen unterstützen:

**Szenario A – Laufender Import:** Monatlich oder quartalsweise werden neue Zählerstände aus einer CSV/Excel-Datei importiert (z.B. von der Hausverwaltung, dem Versorger oder aus einer Ableseliste). Typisch: 10–50 Zeilen pro Import.

**Szenario B – Historischer Bulk-Import:** Beim Erstaufbau des Systems werden jahrelang gesammelte Zählerdaten importiert — teilweise mehrere Jahre, Dutzende Zähler, Hunderttausende Zeilen. Die Dateien kommen aus unterschiedlichen Quellen, haben verschiedene Formate und enthalten Lücken, Zählerwechsel und Formatänderungen.

#### Unterstützte Dateiformate
- **CSV:** Flexibler Spalten-Mapper mit Vorschau (Trennzeichen, Datumsformat, Dezimalzeichen, Zeichenkodierung konfigurierbar)
- **Excel (XLSX/XLS):** Blattauswahl, Header-Zeile konfigurierbar, mehrere Blätter in einem Durchlauf importierbar
- **JSON:** Schema-Validierung gegen vordefiniertes Format
- **MSCONS / OBIS:** Branchenübliche Energiedatenformate (EDI-basiert)
- **Multi-File-Upload:** Mehrere Dateien gleichzeitig hochladbar, werden als ein Batch verarbeitet

#### Import-Wizard (Frontend)

Der Import-Wizard führt den Benutzer in 6 Schritten durch den gesamten Prozess:

**Schritt 1 – Datei-Upload:**
- Drag & Drop oder Dateiauswahl-Dialog
- Multi-File-Upload für mehrere Dateien gleichzeitig
- Dateiformat wird automatisch erkannt (CSV vs. XLSX vs. JSON)
- Bei CSV: Automatische Erkennung von Trennzeichen (`;`, `,`, `\t`), Dezimalzeichen (`,` vs. `.`), Zeichenkodierung (UTF-8, ISO-8859-1, Windows-1252) und Datumsformat
- Vorschau der ersten 20 Zeilen zur visuellen Kontrolle

**Schritt 2 – Datenstruktur erkennen:**
- Automatische Erkennung ob die Datei im **Langformat** (eine Zeile pro Ablesung: Zähler, Datum, Wert) oder im **Breitformat** (Zähler als Spalten, Zeilen als Zeiträume) vorliegt
- Bei Breitformat: Automatisches Pivotieren in Langformat mit Zuordnung Spaltenname → Zähler
- Erkennung ob Absolutwerte (Zählerstand) oder Deltaverbrauchswerte (Verbrauch pro Periode) vorliegen
- Header-Zeile konfigurierbar (z.B. „Zeile 3 ist der Header, Zeilen 1–2 überspringen")

**Schritt 3 – Spalten-Mapping:**
- Drag & Drop oder Dropdown-Zuordnung: Welche Spalte enthält was?
  - **Pflicht:** Datum/Zeitstempel, Wert (Zählerstand oder Verbrauch)
  - **Optional:** Zählerbezeichnung, Zählernummer, Einheit, Standort, Kommentar
- Datumsformat-Auswahl mit Live-Vorschau (z.B. `DD.MM.YYYY`, `YYYY-MM-DD`, `MM/DD/YYYY`, `DD.MM.YY`)
- Dezimalformat-Auswahl: Komma oder Punkt als Dezimaltrennzeichen
- Einheiten-Zuordnung: kWh, MWh, m³, Liter — mit automatischer Umrechnung
- Werttyp: Absolutwert (Zählerstand, kumulativ) oder Deltawert (Verbrauch pro Periode)
- **Profil-Speicherung:** Das Mapping kann als benanntes Profil gespeichert werden (z.B. „Stadtwerke-Abrechnung", „Hausverwaltung-Excel") für wiederkehrende Imports

**Schritt 4 – Zähler-Zuordnung:**
- Jede eindeutige Zählerbezeichnung/Nummer in der Datei wird einem bestehenden Zähler im System zugeordnet
- Automatisches Matching: System versucht Zählerbezeichnungen gegen existierende Zähler zu matchen (Name, Zählernummer, Entity-ID)
- Manuelles Mapping per Dropdown für nicht automatisch erkannte Zähler
- Option: **Neue Zähler automatisch anlegen** für unbekannte Bezeichnungen (mit konfiguriertem Energietyp und Einheit)
- Bei Einzelzähler-Dateien: Fester Zähler für die gesamte Datei wählbar

**Schritt 5 – Validierung & Vorschau:**
- **Plausibilitätsprüfung:** Warnung bei unplausiblen Sprüngen (> 3× Standardabweichung vom Mittelwert der Zeitreihe)
- **Zählerwechsel-Erkennung:** Wenn ein Wert plötzlich stark sinkt (z.B. von 85.000 auf 120), wird ein Zählerwechsel vermutet → Benutzer kann bestätigen oder ablehnen
- **Duplikaterkennung:** Bereits vorhandene Zähler+Zeitstempel-Kombinationen werden markiert (überspringen, überschreiben oder als Fehler behandeln — konfigurierbar)
- **Lücken-Erkennung:** Fehlende Monate oder unregelmäßige Intervalle werden angezeigt
- **Chronologie-Prüfung:** Warnung wenn Zählerstände nicht monoton steigend sind (außer bei erkanntem Zählerwechsel)
- **Zusammenfassung:** Anzahl Datensätze, Zeitraum, betroffene Zähler, gefundene Probleme (Fehler/Warnungen/Hinweise)
- Tabellarische Vorschau mit Farbkodierung: Grün = OK, Gelb = Warnung, Rot = Fehler
- Der Benutzer kann einzelne Zeilen vor dem Import ausschließen

**Schritt 6 – Import & Nachbearbeitung:**
- Import als Hintergrund-Task (Celery) mit Fortschrittsbalken
- Bei großen Dateien (>10.000 Zeilen): Batch-Verarbeitung in Chunks von 1.000 Zeilen
- **Automatische Verbrauchsberechnung:** Aus den importierten Absolutwerten werden die Deltaverbrauchswerte berechnet (Differenz zum vorherigen Zählerstand)
- **Rückwirkende CO₂-Bilanzierung:** Importierte historische Verbräuche werden mit den im jeweiligen Jahr gültigen Emissionsfaktoren berechnet (z.B. 2020er Verbrauch × 2020er UBA-Faktor)
- **Rückwirkende Witterungskorrektur:** Für Heizungszähler werden die historischen Gradtagszahlen herangezogen (sofern Wetterdaten für den Zeitraum verfügbar sind)
- **Import-Protokoll:** Zusammenfassung mit: Anzahl importiert, Duplikate übersprungen, Warnungen, Fehler, Zählerwechsel
- **Rückgängig-Funktion:** Jeder Import erhält eine `import_batch_id` — der gesamte Batch kann mit einem Klick rückgängig gemacht werden (löscht alle Readings mit dieser Batch-ID)
- **Import-Historie:** Tabelle aller bisherigen Imports mit Datum, Dateiname, Anzahl Datensätze, Status — jeder einzelne kann rückgängig gemacht oder erneut geprüft werden

#### Datenmodell-Ergänzungen für historischen Import

```python
class ImportBatch(Base):
    __tablename__ = "import_batches"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    filename: Mapped[str]                          # Originaler Dateiname
    file_type: Mapped[str]                         # CSV, XLSX, JSON, MSCONS
    file_size_bytes: Mapped[int]
    mapping_profile: Mapped[str | None]            # Name des gespeicherten Mapping-Profils
    column_mapping: Mapped[dict]                   # JSON: Vollständiges Spalten-Mapping
    import_settings: Mapped[dict]                  # JSON: Datumsformat, Dezimalzeichen, Trennzeichen, Werttyp
    meter_mapping: Mapped[dict]                    # JSON: Datei-Bezeichnung → Zähler-ID
    total_rows: Mapped[int]                        # Zeilen in der Datei
    imported_count: Mapped[int] = mapped_column(default=0)
    skipped_count: Mapped[int] = mapped_column(default=0)   # Duplikate, ausgeschlossene Zeilen
    error_count: Mapped[int] = mapped_column(default=0)
    warning_count: Mapped[int] = mapped_column(default=0)
    meter_changes_detected: Mapped[int] = mapped_column(default=0)  # Erkannte Zählerwechsel
    period_start: Mapped[date | None]              # Frühester importierter Datensatz
    period_end: Mapped[date | None]                # Spätester importierter Datensatz
    affected_meter_ids: Mapped[list[uuid.UUID]]    # Alle betroffenen Zähler
    status: Mapped[str]                            # Enum: PENDING, VALIDATING, IMPORTING, COMPLETED, FAILED, ROLLED_BACK
    error_details: Mapped[list[dict] | None]       # JSON: Zeile, Fehlertyp, Details
    imported_by: Mapped[uuid.UUID]                 # User-ID
    created_at: Mapped[datetime]
    completed_at: Mapped[datetime | None]

class ImportMappingProfile(Base):
    """Gespeicherte Spalten-Mappings für wiederkehrende Imports"""
    __tablename__ = "import_mapping_profiles"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(unique=True)  # z.B. "Stadtwerke-Monatsabrechnung"
    description: Mapped[str | None]
    file_type: Mapped[str]                          # CSV, XLSX
    column_mapping: Mapped[dict]                    # JSON: Spalten-Zuordnung
    import_settings: Mapped[dict]                   # JSON: Format-Einstellungen
    meter_mapping: Mapped[dict | None]              # JSON: Optionale feste Zähler-Zuordnung
    created_by: Mapped[uuid.UUID]
    last_used: Mapped[datetime | None]
    use_count: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime]

class MeterChange(Base):
    """Dokumentation von Zählerwechseln"""
    __tablename__ = "meter_changes"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    meter_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("meters.id"))
    change_date: Mapped[date]                       # Datum des Wechsels
    old_meter_number: Mapped[str | None]            # Alte Zählernummer
    new_meter_number: Mapped[str | None]            # Neue Zählernummer
    final_reading_old: Mapped[Decimal | None]       # Letzter Zählerstand des alten Zählers
    initial_reading_new: Mapped[Decimal | None]     # Erster Zählerstand des neuen Zählers
    reason: Mapped[str | None]                      # z.B. "Defekt", "Eichfrist abgelaufen", "Modernisierung"
    detected_by: Mapped[str]                        # Enum: IMPORT_AUTO, MANUAL
    import_batch_id: Mapped[uuid.UUID | None]
    notes: Mapped[str | None]
    created_at: Mapped[datetime]
```

#### API-Endpunkte (Import)

```
POST   /api/v1/readings/import                      # Datei-Upload + Start der Verarbeitung
POST   /api/v1/readings/import/validate              # Nur Validierung ohne Import (Dry-Run)
GET    /api/v1/readings/import/{batch_id}            # Import-Status und Ergebnis
GET    /api/v1/readings/import/{batch_id}/errors      # Detaillierte Fehlerliste
DELETE /api/v1/readings/import/{batch_id}            # Import rückgängig machen (Batch-Rollback)
GET    /api/v1/readings/import/history                # Alle bisherigen Imports
POST   /api/v1/readings/import/detect-format         # Format-Erkennung (Trennzeichen, Datum, etc.)
POST   /api/v1/readings/import/detect-structure       # Struktur-Erkennung (Lang/Breit, Werttyp)
POST   /api/v1/readings/import/match-meters           # Auto-Matching der Zählerbezeichnungen

GET    /api/v1/import-profiles                        # Gespeicherte Mapping-Profile
POST   /api/v1/import-profiles                        # Profil speichern
PUT    /api/v1/import-profiles/{id}                   # Profil aktualisieren
DELETE /api/v1/import-profiles/{id}                   # Profil löschen

GET    /api/v1/meter-changes                          # Alle Zählerwechsel
POST   /api/v1/meter-changes                          # Zählerwechsel manuell dokumentieren
GET    /api/v1/meter-changes/{meter_id}               # Wechsel-Historie eines Zählers
```

#### Performance bei großen Imports

- **Batch-Verarbeitung:** Dateien mit >10.000 Zeilen werden in Chunks von 1.000 Zeilen verarbeitet
- **Celery-Task:** Import läuft asynchron, Frontend pollt den Status über `/import/{batch_id}`
- **Fortschrittsanzeige:** Prozent, aktuelle Zeile, geschätzte Restzeit
- **Datenbank-Optimierung:** Bulk-Insert über `session.execute(insert(MeterReading), batch)` statt Einzel-Inserts
- **Indizes:** Zusammengesetzter Index auf `(meter_id, timestamp)` für schnelle Duplikaterkennung
- **Memory-Management:** Streaming-Parser für große CSV-Dateien (keine vollständige Datei im RAM)
- **Ziel:** 100.000 Zeilen in < 60 Sekunden importierbar

### 3.7 Wetterdaten-Integration

#### Datenquellen (Prioritätsreihenfolge)

1. **Bright Sky API** (Primärquelle, empfohlen)
   - Kostenlose JSON-API auf Basis der DWD Open Data
   - Endpunkt: `https://api.brightsky.dev/weather?lat={lat}&lon={lon}&date={date}`
   - Liefert: Temperatur, Niederschlag, Sonnenscheindauer, Windgeschwindigkeit, Bewölkung
   - Kein API-Key erforderlich
   - Stündliche und tägliche Auflösung
   - Historische Daten ab 2010 verfügbar

2. **DWD Open Data** (Fallback / Bulk-Import)
   - FTP/HTTPS-Zugriff: `https://opendata.dwd.de/climate_environment/CDC/`
   - Monatliche Gradtagszahlen (VDI 3807) zum kostenlosen Download
   - Klimafaktoren für > 8.000 Postleitzahlen zur Witterungsbereinigung
   - Historische Zeitreihen (Temperatur, Sonnenscheindauer) für 76+ Stationen
   - Parsing-Bibliothek: `wetterdienst` (Python-Paket für DWD-Daten)

3. **Manueller Import**
   - CSV/Excel-Upload mit Spalten: Datum, Temperatur (min/avg/max), optional Gradtagszahlen
   - Für Standorte ohne DWD-Abdeckung oder eigene Messungen

#### Automatischer Sync
- Celery-Beat-Task: Täglicher Abruf der Vortageswerte über Bright Sky API
- Monatlicher Bulk-Sync der DWD-Gradtagszahlen
- Automatische Zuordnung der nächstgelegenen Wetterstation basierend auf Standort-Koordinaten (Haversine-Distanz)
- Caching: Wetterdaten lokal in der Datenbank, kein erneuter API-Aufruf bei vorhandenen Daten

### 3.8 Klimasensoren (Temperatur & Luftfeuchtigkeit)

#### Zweck im Energiemanagement
Innenraum-Klimadaten (Temperatur, Luftfeuchtigkeit) sind für ein ISO-50001-konformes Energiemanagement aus folgenden Gründen relevant:

1. **Präzise Witterungskorrektur:** Interne Raumtemperaturen zeigen die tatsächlichen Bedingungen vor Ort, nicht nur Annäherungen einer externen Wetterstation. Die Differenz zwischen Innen- und Außentemperatur bestimmt die Heiz-/Kühllast.

2. **Einflussfaktoren-Analyse (ISO 50001, Kap. 6.3):** Die Norm verlangt die Identifikation relevanter Variablen, die den Energieverbrauch wesentlich beeinflussen. Raumtemperatur und Feuchte sind für HVAC-dominierte Gebäude die wichtigsten Einflussfaktoren.

3. **Anlageneffizienz-Bewertung:** Korrelation von Klimadaten mit Energieverbrauch deckt ineffiziente Anlagen auf – z.B. eine Klimaanlage, die läuft, aber die Solltemperatur nicht erreicht, oder ein Heizsystem mit unnötig hoher Vorlauftemperatur.

4. **Behaglichkeits-KPIs:** Energieeinsparmaßnahmen dürfen die Nutzungsqualität nicht verschlechtern. Behaglichkeits-Kennzahlen (Temperatur im Sollbereich, Feuchte 40–60%) belegen, dass Einsparungen ohne Komfortverlust erreicht wurden.

5. **Taupunkt- und Schimmelprävention:** Aus Temperatur und relativer Feuchte kann der Taupunkt berechnet werden. In Kombination mit Wandoberflächentemperaturen ermöglicht dies Schimmelrisikoanalysen.

#### Datenmodell

```python
class ClimateSensor(Base):
    __tablename__ = "climate_sensors"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str]                          # z.B. "Temperatur Büro EG"
    sensor_type: Mapped[ClimateSensorType]     # Enum: TEMPERATURE, HUMIDITY, TEMPERATURE_HUMIDITY_COMBO
    location: Mapped[str | None]               # Gebäude / Stockwerk / Raum
    zone: Mapped[str | None]                   # Heizzone / Klimazone
    ha_entity_id_temp: Mapped[str | None]      # HA-Entity für Temperatur
    ha_entity_id_humidity: Mapped[str | None]   # HA-Entity für Luftfeuchtigkeit
    data_source: Mapped[DataSource]            # Enum: HOME_ASSISTANT_ENTITY, MODBUS, KNX, MANUAL, CSV_IMPORT
    source_config: Mapped[dict | None]         # JSON: Verbindungsparameter
    target_temp_min: Mapped[Decimal | None]    # Solltemperatur Untergrenze (°C)
    target_temp_max: Mapped[Decimal | None]    # Solltemperatur Obergrenze (°C)
    target_humidity_min: Mapped[Decimal | None] # Sollfeuchte Untergrenze (%)
    target_humidity_max: Mapped[Decimal | None] # Sollfeuchte Obergrenze (%)
    associated_meter_ids: Mapped[list[uuid.UUID] | None]  # Zugeordnete Heiz-/Kühlzähler
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime]

class ClimateReading(Base):
    __tablename__ = "climate_readings"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sensor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("climate_sensors.id"))
    timestamp: Mapped[datetime]
    temperature: Mapped[Decimal | None]        # °C
    humidity: Mapped[Decimal | None]           # % relative Luftfeuchtigkeit
    dew_point: Mapped[Decimal | None]          # °C (berechnet aus T + RH)
    source: Mapped[ReadingSource]              # Enum: AUTOMATIC, MANUAL, IMPORT
    quality: Mapped[DataQuality]               # Enum: MEASURED, ESTIMATED

class ClimateZoneSummary(Base):
    """Aggregierte Klimadaten pro Zone und Zeitraum für schnelle Auswertung"""
    __tablename__ = "climate_zone_summaries"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    zone: Mapped[str]
    period_start: Mapped[date]
    period_end: Mapped[date]
    avg_temperature: Mapped[Decimal]
    min_temperature: Mapped[Decimal]
    max_temperature: Mapped[Decimal]
    avg_humidity: Mapped[Decimal]
    min_humidity: Mapped[Decimal]
    max_humidity: Mapped[Decimal]
    hours_below_target_temp: Mapped[Decimal]   # Stunden unter Solltemperatur
    hours_above_target_temp: Mapped[Decimal]   # Stunden über Solltemperatur
    hours_outside_target_humidity: Mapped[Decimal]  # Stunden außerhalb Soll-Feuchtebereich
    comfort_score: Mapped[Decimal | None]      # 0–100 Behaglichkeits-Score
```

#### Taupunkt-Berechnung

```python
def calculate_dew_point(temperature_c: float, relative_humidity: float) -> float:
    """
    Taupunktberechnung nach Magnus-Formel.
    
    Parameter:
      temperature_c: Lufttemperatur in °C
      relative_humidity: Relative Luftfeuchtigkeit in % (0–100)
    
    Returns: Taupunkttemperatur in °C
    """
    a = 17.271
    b = 237.7
    gamma = (a * temperature_c / (b + temperature_c)) + math.log(relative_humidity / 100.0)
    return (b * gamma) / (a - gamma)
```

#### Behaglichkeits-Score

```python
def calculate_comfort_score(
    temperature: Decimal, humidity: Decimal,
    target_temp_min: Decimal, target_temp_max: Decimal,
    target_humidity_min: Decimal = Decimal("40"),
    target_humidity_max: Decimal = Decimal("60")
) -> Decimal:
    """
    Berechnet einen Behaglichkeits-Score von 0–100.
    100 = perfekt im Sollbereich, 0 = extrem außerhalb.
    
    Basiert auf der Abweichung von Temperatur und Feuchte
    vom jeweiligen Sollbereich, gewichtet 60:40 (Temp:Feuchte).
    """
```

#### Integration mit Witterungskorrektur
- Klimasensoren können optional als **interne Referenztemperatur** für die Witterungskorrektur dienen
- Statt der festen Annahme von 20°C Innentemperatur wird die tatsächliche gemessene Raumtemperatur verwendet
- Formel erweitert: `HDD_intern = max(0, T_raum_gemessen - T_außen)` statt `HDD = max(0, 20 - T_außen)`
- Identifikation von Überheizung: `T_raum > T_soll + 2°C` → Einsparempfehlung im Audit

#### API-Endpunkte

```
GET    /api/v1/climate/sensors                     # Alle Klimasensoren
POST   /api/v1/climate/sensors                     # Sensor anlegen
GET    /api/v1/climate/sensors/{id}                # Sensor-Details
PUT    /api/v1/climate/sensors/{id}                # Sensor bearbeiten
DELETE /api/v1/climate/sensors/{id}                # Sensor löschen
GET    /api/v1/climate/sensors/{id}/readings        # Messwerte (Zeitraum)
GET    /api/v1/climate/zones                        # Alle Klimazonen
GET    /api/v1/climate/zones/{zone}/summary         # Zonenzusammenfassung (Zeitraum)
GET    /api/v1/climate/comfort-score                # Behaglichkeits-Score (Zeitraum, Zone)
GET    /api/v1/climate/correlation/{meter_id}        # Korrelation Klima ↔ Energieverbrauch
```

#### Gradtagszahlen-Berechnung
- Berechnung nach VDI 3807 Blatt 1: `Gt20/15`
- Formel: `HDD = max(0, T_indoor - T_avg)` für Tage mit `T_avg < T_heating_limit`
- Konfigurierbare Innentemperatur (Standard: 20°C) und Heizgrenze (Standard: 15°C)
- Kühlgradtage analog: `CDD = max(0, T_avg - T_cooling_limit)` für `T_avg > T_cooling_limit`
- Monatliche Aggregation in `MonthlyDegreeDays`-Tabelle
- Langjähriges Mittel automatisch berechnet aus verfügbaren Daten (min. 10 Jahre, Fallback auf DWD-Referenzwerte)

### 3.8 CO₂-Emissionsfaktoren-Integration

#### Datenquellen (mehrstufig)

1. **BAFA CO₂-Faktoren** (Standard für stationäre Energieträger)
   - Jährlich veröffentlichte Emissionsfaktoren des Bundesamts für Wirtschaft und Ausfuhrkontrolle
   - Abgedeckte Energieträger und vorinstallierte Standardwerte:
     - Strom (Strommix DE): Jahresmittel vom UBA (z.B. 363 g CO₂/kWh für 2024)
     - Erdgas: 201 g CO₂/kWh
     - Heizöl: 266 g CO₂/kWh
     - Fernwärme: 175 g CO₂/kWh (Durchschnitt, standortabhängig konfigurierbar)
     - Flüssiggas: 234 g CO₂/kWh
     - Holzpellets: 22 g CO₂/kWh (biogen, nur Vorketten)
     - Braunkohle: 364 g CO₂/kWh
     - Steinkohle: 335 g CO₂/kWh
   - Datenquelle: BAFA-Informationsblatt CO₂-Faktoren (PDF-Download, jährlich aktualisiert)
   - Implementierung: Vorinstallierte Seed-Daten + manuelles Update über Admin-UI

2. **UBA Strommix-Emissionsfaktor** (für Strom-Jahresmittel)
   - Jährliche Veröffentlichung des Umweltbundesamtes
   - Zeitreihe ab 1990, inklusive Vorketten-Werte (CO₂-Äquivalente)
   - Datenquelle: UBA-Publikation „Entwicklung der spezifischen THG-Emissionen des deutschen Strommix"
   - Implementierung: Seed-Tabelle mit historischen Jahreswerten, jährliches manuelles Update oder Scraping der UBA-Seite

3. **Electricity Maps API** (für Echtzeit-CO₂-Intensität des Stromnetzes)
   - API: `https://api-access.electricitymaps.com/free-tier/carbon-intensity/latest?zone=DE`
   - Liefert: Echtzeit-CO₂-Intensität in g CO₂eq/kWh, Strommix-Zusammensetzung, Anteil Erneuerbare
   - Free Tier: 1 Zone, 50 Requests/Stunde (ausreichend bei 15-Minuten-Polling)
   - Bereits als Home-Assistant-Integration verfügbar → auch darüber nutzbar
   - Verwendung: Optionale stundengenaue CO₂-Bilanzierung für Strom statt Jahresmittel

4. **GEMIS / ProBas** (für erweiterte Emissionsfaktoren)
   - GEMIS: Globales Emissions-Modell Integrierter Systeme (IINAS)
   - ProBas: Prozessorientierte Basisdaten des UBA
   - Abgedeckt: Lebenszyklusemissionen für Energie, Transport, Materialien
   - Implementierung: Optionaler Import über heruntergeladene Datenbankdateien
   - Anwendung: Scope-3-Emissionen, Vorketten, detaillierte Lebenszyklusbetrachtung

5. **Manuelle Konfiguration**
   - Individueller CO₂-Faktor pro Zähler überschreibbar (z.B. für Ökostrom-Tarife mit Herkunftsnachweisen)
   - Fernwärme-Faktor pro Versorger einstellbar (variiert stark je nach Erzeugerpark)
   - Eigene Faktoren für Spezialfälle (Biogas, BHKW, Eigenerzeugung PV)

#### CO₂-Berechnungslogik

```python
class CO2CalculationService:
    """
    Berechnet CO₂-Emissionen für jeden Zähler basierend auf:
    1. Verbrauch im Zeitraum (aus MeterReading)
    2. Passender Emissionsfaktor (nach Energietyp, Zeitraum, Region)
    3. Umrechnung in kg CO₂
    """

    async def calculate(self, meter_id: UUID, period_start: date, period_end: date) -> CO2Calculation:
        meter = await self.get_meter(meter_id)
        consumption_kwh = await self.get_consumption_kwh(meter, period_start, period_end)

        # Emissionsfaktor-Auflösung (Priorität):
        # 1. Manueller Override am Zähler
        # 2. Electricity Maps (wenn Echtzeit aktiviert und Strom)
        # 3. Monatlicher/jährlicher Faktor aus emission_factors-Tabelle
        # 4. Fallback: BAFA-Standardwert für den Energietyp
        factor = await self.resolve_emission_factor(meter, period_start, period_end)

        co2_kg = consumption_kwh * factor.co2_g_per_kwh / 1000

        return CO2Calculation(
            meter_id=meter_id,
            period_start=period_start,
            period_end=period_end,
            consumption_kwh=consumption_kwh,
            emission_factor_id=factor.id,
            co2_kg=co2_kg,
            co2eq_kg=consumption_kwh * factor.co2eq_g_per_kwh / 1000 if factor.co2eq_g_per_kwh else None,
            calculation_method=self._determine_method(factor),
            calculated_at=datetime.utcnow()
        )

    async def get_consumption_kwh(self, meter: Meter, start: date, end: date) -> Decimal:
        """Konvertiert Verbrauch in kWh basierend auf Energietyp und Einheit."""
        raw = await self.get_raw_consumption(meter, start, end)
        match meter.energy_type:
            case EnergyType.GAS:
                # m³ → kWh über Brennwert (Standard: 10,3 kWh/m³ Erdgas)
                return raw * meter.tariff_info.get("conversion_factor", Decimal("10.3"))
            case EnergyType.HEAT | EnergyType.COOLING:
                # Ggf. MWh → kWh
                return raw * 1000 if meter.unit == "MWh" else raw
            case _:
                return raw  # Strom bereits in kWh
```

---

## 4. Witterungskorrektur-Modul

### 4.1 Berechnungsmethoden

#### Methode 1: Gradtagszahl-Verhältnis (VDI 3807) – Standard

```python
def weather_correct_vdi3807(
    raw_consumption: Decimal,
    actual_hdd: Decimal,          # Ist-Gradtagszahlen im Abrechnungszeitraum
    reference_hdd: Decimal,       # Referenz-Gradtagszahlen (langjähriges Mittel)
    base_load_percent: Decimal = Decimal("0")  # Witterungsunabhängiger Anteil
) -> tuple[Decimal, Decimal]:
    """
    Witterungsbereinigung nach VDI 3807.

    Formel:
      Q_korr = Q_base + Q_weather * (GTZ_ref / GTZ_ist)

    wobei:
      Q_base    = raw_consumption * base_load_percent / 100
      Q_weather = raw_consumption - Q_base
      GTZ_ref   = Langjähriges Mittel der Gradtagszahlen
      GTZ_ist   = Tatsächliche Gradtagszahlen im Zeitraum

    Returns: (corrected_consumption, correction_factor)
    """
    if actual_hdd == 0:
        return raw_consumption, Decimal("1.0")

    base_load = raw_consumption * base_load_percent / 100
    weather_dependent = raw_consumption - base_load
    correction_factor = reference_hdd / actual_hdd
    corrected = base_load + weather_dependent * correction_factor

    return corrected, correction_factor
```

#### Methode 2: Lineare Regression (optional, fortgeschritten)

```python
def weather_correct_regression(
    monthly_data: list[dict],     # [{"month": 1, "consumption": 1234, "hdd": 456}, ...]
    prediction_hdd: Decimal       # Referenz-HDD für Normierung
) -> Decimal:
    """
    Regressions-basierte Witterungsbereinigung.

    Erstellt eine lineare Regression: Verbrauch = a * HDD + b
    wobei b die Grundlast und a die Heizkennlinie darstellt.
    Dann wird der korrigierte Verbrauch für die Referenz-HDD berechnet.

    Bibliothek: numpy / scipy.stats.linregress
    """
```

### 4.2 Konfiguration im Frontend

- **Zuordnung Zähler → Wetterstation:** Automatisch via Geo-Koordinaten oder manuell per Dropdown
- **Parameter:**
  - Innentemperatur (Standard: 20°C)
  - Heizgrenze (Standard: 15°C)
  - Kühlgrenze (Standard: 24°C, für Kältezähler)
  - Grundlastanteil in % (0–100%, geschätzt oder berechnet aus Sommerlast)
  - Referenzjahr oder langjähriges Mittel
- **Methode:** VDI 3807 (Standard) oder Regression
- **Aktivierung:** Pro Zähler ein-/ausschaltbar (sinnvoll nur für Heizung/Kühlung, nicht für Strom/Wasser)

---

## 5. Rechtemanagement & Authentifizierung

### 5.1 Authentifizierung

Das Add-on betreibt ein **eigenes Login-System**, unabhängig von Home Assistant. Dies ermöglicht den Zugriff für Personen ohne HA-Account (externe Auditoren, Berater, Geschäftsführung) und erlaubt eine feinere Rechtevergabe als die HA-Benutzerverwaltung bietet.

#### Datenmodell

```python
class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(unique=True)         # Login-Name
    email: Mapped[str] = mapped_column(unique=True)
    display_name: Mapped[str]                                   # Anzeigename
    password_hash: Mapped[str]                                  # bcrypt-Hash
    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roles.id"))
    is_active: Mapped[bool] = mapped_column(default=True)
    is_locked: Mapped[bool] = mapped_column(default=False)     # Nach N Fehlversuchen
    failed_login_attempts: Mapped[int] = mapped_column(default=0)
    last_login: Mapped[datetime | None]
    password_changed_at: Mapped[datetime | None]
    must_change_password: Mapped[bool] = mapped_column(default=False)
    language: Mapped[str] = mapped_column(default="de")         # Bevorzugte Sprache
    allowed_locations: Mapped[list[str] | None]                 # Standort-Einschränkung (None = alle)
    created_by: Mapped[uuid.UUID | None]
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]

    role = relationship("Role", back_populates="users")
    permission_overrides = relationship("UserPermissionOverride", back_populates="user")
    sessions = relationship("UserSession", back_populates="user")

class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    token_hash: Mapped[str]                                     # SHA-256 des JWT
    ip_address: Mapped[str | None]
    user_agent: Mapped[str | None]
    created_at: Mapped[datetime]
    expires_at: Mapped[datetime]
    is_revoked: Mapped[bool] = mapped_column(default=False)

    user = relationship("User", back_populates="sessions")

class AuditLog(Base):
    """Vollständiges Audit-Log aller sicherheitsrelevanten Aktionen"""
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None]                           # None bei fehlgeschlagenem Login
    action: Mapped[str]                                         # z.B. LOGIN, LOGOUT, CREATE_METER, DELETE_READING, CHANGE_ROLE
    resource_type: Mapped[str | None]                           # z.B. "meter", "reading", "document", "user"
    resource_id: Mapped[uuid.UUID | None]
    details: Mapped[dict | None]                                # JSON mit Änderungsdetails
    ip_address: Mapped[str | None]
    timestamp: Mapped[datetime]
```

#### Auth-Mechanismus

- **Passwort-Hashing:** bcrypt mit Cost-Factor 12
- **Token-basierte Sessions:** JWT (JSON Web Token) mit kurzer Laufzeit
  - Access Token: 30 Minuten Gültigkeit
  - Refresh Token: 7 Tage Gültigkeit, in `user_sessions` gespeichert
  - Token enthält: `user_id`, `role`, `permissions` (kompakt), `exp`, `iat`
- **Login-Schutz:**
  - Account-Sperre nach 5 fehlgeschlagenen Versuchen (konfigurierbar)
  - Automatische Entsperrung nach 30 Minuten oder manuell durch Admin
  - Rate-Limiting: Max. 10 Login-Versuche pro Minute pro IP
- **Passwort-Richtlinien:**
  - Mindestlänge: 8 Zeichen (konfigurierbar)
  - Erzwungener Passwortwechsel beim ersten Login (`must_change_password`)
  - Optionaler Ablauf nach N Tagen (konfigurierbar, Standard: deaktiviert)
- **Session-Management:**
  - Übersicht aktiver Sessions pro Benutzer (IP, Zeitpunkt, User-Agent)
  - Einzelne Sessions oder alle Sessions eines Benutzers widerrufbar
  - Automatische Bereinigung abgelaufener Sessions (Celery-Task, täglich)
- **Ersteinrichtung:**
  - Beim allerersten Start des Add-ons wird ein Setup-Wizard angezeigt
  - Der erste Benutzer erhält automatisch die Administrator-Rolle
  - Standard-Passwort muss beim ersten Login geändert werden
- **Optionale HA-Integration:**
  - Falls gewünscht: HA-Ingress-Token kann als alternativer Auth-Mechanismus aktiviert werden
  - HA-Benutzer werden dann automatisch mit einer konfigurierbaren Standard-Rolle angelegt
  - Einstellung in den Add-on-Optionen: `ha_auth_enabled: true/false`, `ha_default_role: viewer`

### 5.2 Rollenbasiertes Berechtigungsmodell (RBAC + feingranulare Overrides)

#### Konzept

Das System verwendet ein zweistufiges Berechtigungsmodell:

1. **Rollen** definieren einen Basissatz an Berechtigungen für jedes Modul (Lesen, Erstellen, Bearbeiten, Löschen)
2. **Benutzer-spezifische Overrides** können einzelne Berechtigungen für einen Benutzer erweitern oder einschränken, unabhängig von seiner Rolle

Die effektive Berechtigung eines Benutzers ergibt sich aus: `Rollen-Berechtigung PLUS Grants MINUS Denials`

#### Datenmodell

```python
class Role(Base):
    __tablename__ = "roles"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(unique=True)             # z.B. "administrator", "energy_manager"
    display_name: Mapped[str]                                   # z.B. "Administrator", "Energiemanager"
    description: Mapped[str | None]
    is_system_role: Mapped[bool] = mapped_column(default=False) # Systemrollen nicht löschbar
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime]

    permissions = relationship("RolePermission", back_populates="role")
    users = relationship("User", back_populates="role")

class Permission(Base):
    """Definition aller verfügbaren Berechtigungen"""
    __tablename__ = "permissions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    module: Mapped[str]                                         # z.B. "meters", "readings", "co2", "iso_audit"
    action: Mapped[str]                                         # z.B. "view", "create", "edit", "delete", "export", "approve"
    resource_scope: Mapped[str] = mapped_column(default="all")  # "all", "own", "location" — Einschränkungsebene
    description: Mapped[str]                                    # Menschenlesbare Beschreibung
    category: Mapped[str]                                       # Gruppierung in der UI: "Energiedaten", "ISO 50001", "System"

class RolePermission(Base):
    """Zuordnung: Rolle ↔ Berechtigung"""
    __tablename__ = "role_permissions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roles.id"))
    permission_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("permissions.id"))

class UserPermissionOverride(Base):
    """Benutzer-spezifische Overrides (Grant oder Deny)"""
    __tablename__ = "user_permission_overrides"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    permission_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("permissions.id"))
    override_type: Mapped[str]                                  # Enum: GRANT, DENY
    reason: Mapped[str | None]                                  # Begründung für den Override
    granted_by: Mapped[uuid.UUID]                               # Wer hat den Override gesetzt
    valid_from: Mapped[date | None]                             # Optionaler Gültigkeitszeitraum
    valid_to: Mapped[date | None]
    created_at: Mapped[datetime]
```

#### Vordefinierte Rollen (Seed-Daten)

```
┌──────────────────────┬─────────────────────────────────────────────────────────────┐
│ Rolle                │ Beschreibung                                                │
├──────────────────────┼─────────────────────────────────────────────────────────────┤
│ Administrator        │ Voller Zugriff auf alle Module inkl. Benutzerverwaltung,    │
│                      │ Systemkonfiguration und Rollenverwaltung.                    │
│                      │ Systemrolle, nicht löschbar.                                 │
├──────────────────────┼─────────────────────────────────────────────────────────────┤
│ Energiemanager       │ Verwaltet Zähler, Verbraucher, Schemas. Erstellt und        │
│                      │ bearbeitet Auswertungen, Berichte, Energieziele,             │
│                      │ Aktionspläne. Pflegt CO₂-Faktoren und Klimadaten.           │
│                      │ Kann ISO-Dokumente und Energiepolitik bearbeiten.            │
│                      │ Kein Zugriff auf Benutzerverwaltung.                         │
├──────────────────────┼─────────────────────────────────────────────────────────────┤
│ Auditor              │ Lesezugriff auf alle Daten, Auswertungen und Berichte.      │
│                      │ Kann interne Audits durchführen, Befunde und Nicht-          │
│                      │ konformitäten anlegen. Kann Managementbewertungen einsehen.  │
│                      │ Kein Schreibzugriff auf Zähler, Konfiguration, Finanzdaten. │
├──────────────────────┼─────────────────────────────────────────────────────────────┤
│ Techniker            │ Verwaltet Zähler-Konfiguration, Sensoren, Datenquellen.     │
│                      │ Erfasst Zählerstände (manuell und Import).                   │
│                      │ Lesezugriff auf Dashboard und Auswertungen.                  │
│                      │ Kein Zugriff auf Finanzdaten, ISO-Dokumente oder Berichte.  │
├──────────────────────┼─────────────────────────────────────────────────────────────┤
│ Viewer               │ Reiner Lesezugriff auf Dashboard, Auswertungen und          │
│                      │ freigegebene Berichte. Kein Schreibzugriff auf irgendetwas.  │
│                      │ Ideal für Geschäftsführung oder externe Einsicht.            │
└──────────────────────┴─────────────────────────────────────────────────────────────┘
```

#### Berechtigungs-Matrix (Module × Aktionen × Rollen)

```
Legende: ● = erlaubt | ○ = verboten | ◐ = nur eigene / eingeschränkt

Modul                        │ Aktion   │ Admin │ E-Manager │ Auditor │ Techniker │ Viewer
─────────────────────────────┼──────────┼───────┼───────────┼─────────┼───────────┼────────
Zähler (meters)              │ view     │   ●   │     ●     │    ●    │     ●     │   ●
                             │ create   │   ●   │     ●     │    ○    │     ●     │   ○
                             │ edit     │   ●   │     ●     │    ○    │     ●     │   ○
                             │ delete   │   ●   │     ●     │    ○    │     ○     │   ○
─────────────────────────────┼──────────┼───────┼───────────┼─────────┼───────────┼────────
Zählerstände (readings)      │ view     │   ●   │     ●     │    ●    │     ●     │   ●
                             │ create   │   ●   │     ●     │    ○    │     ●     │   ○
                             │ import   │   ●   │     ●     │    ○    │     ●     │   ○
                             │ delete   │   ●   │     ●     │    ○    │     ○     │   ○
─────────────────────────────┼──────────┼───────┼───────────┼─────────┼───────────┼────────
Verbraucher (consumers)      │ view     │   ●   │     ●     │    ●    │     ●     │   ●
                             │ create   │   ●   │     ●     │    ○    │     ○     │   ○
                             │ edit     │   ●   │     ●     │    ○    │     ○     │   ○
                             │ delete   │   ●   │     ●     │    ○    │     ○     │   ○
─────────────────────────────┼──────────┼───────┼───────────┼─────────┼───────────┼────────
Schema-Editor                │ view     │   ●   │     ●     │    ●    │     ●     │   ●
                             │ edit     │   ●   │     ●     │    ○    │     ○     │   ○
─────────────────────────────┼──────────┼───────┼───────────┼─────────┼───────────┼────────
Auswertungen (analytics)     │ view     │   ●   │     ●     │    ●    │     ●     │   ●
                             │ export   │   ●   │     ●     │    ●    │     ○     │   ○
─────────────────────────────┼──────────┼───────┼───────────┼─────────┼───────────┼────────
Klimasensoren (climate)      │ view     │   ●   │     ●     │    ●    │     ●     │   ●
                             │ create   │   ●   │     ●     │    ○    │     ●     │   ○
                             │ edit     │   ●   │     ●     │    ○    │     ●     │   ○
─────────────────────────────┼──────────┼───────┼───────────┼─────────┼───────────┼────────
Wetterdaten (weather)        │ view     │   ●   │     ●     │    ●    │     ●     │   ●
                             │ configure│   ●   │     ●     │    ○    │     ●     │   ○
                             │ import   │   ●   │     ●     │    ○    │     ●     │   ○
─────────────────────────────┼──────────┼───────┼───────────┼─────────┼───────────┼────────
CO₂-Bilanz (co2)             │ view     │   ●   │     ●     │    ●    │     ○     │   ●
                             │ configure│   ●   │     ●     │    ○    │     ○     │   ○
                             │ export   │   ●   │     ●     │    ●    │     ○     │   ○
─────────────────────────────┼──────────┼───────┼───────────┼─────────┼───────────┼────────
Finanzdaten (tariffs, costs) │ view     │   ●   │     ●     │    ○    │     ○     │   ○
                             │ edit     │   ●   │     ●     │    ○    │     ○     │   ○
─────────────────────────────┼──────────┼───────┼───────────┼─────────┼───────────┼────────
Berichte (reports)           │ view     │   ●   │     ●     │    ●    │     ○     │   ●
                             │ generate │   ●   │     ●     │    ○    │     ○     │   ○
                             │ delete   │   ●   │     ●     │    ○    │     ○     │   ○
─────────────────────────────┼──────────┼───────┼───────────┼─────────┼───────────┼────────
ISO: Energiepolitik          │ view     │   ●   │     ●     │    ●    │     ○     │   ●
                             │ edit     │   ●   │     ●     │    ○    │     ○     │   ○
                             │ approve  │   ●   │     ○     │    ○    │     ○     │   ○
─────────────────────────────┼──────────┼───────┼───────────┼─────────┼───────────┼────────
ISO: Ziele & Aktionspläne    │ view     │   ●   │     ●     │    ●    │     ○     │   ●
                             │ create   │   ●   │     ●     │    ○    │     ○     │   ○
                             │ edit     │   ●   │     ●     │    ○    │     ○     │   ○
                             │ verify   │   ●   │     ●     │    ●    │     ○     │   ○
─────────────────────────────┼──────────┼───────┼───────────┼─────────┼───────────┼────────
ISO: Risiken & Chancen       │ view     │   ●   │     ●     │    ●    │     ○     │   ○
                             │ edit     │   ●   │     ●     │    ○    │     ○     │   ○
─────────────────────────────┼──────────┼───────┼───────────┼─────────┼───────────┼────────
ISO: Internes Audit          │ view     │   ●   │     ●     │    ●    │     ○     │   ○
                             │ conduct  │   ●   │     ○     │    ●    │     ○     │   ○
                             │ findings │   ●   │     ○     │    ●    │     ○     │   ○
─────────────────────────────┼──────────┼───────┼───────────┼─────────┼───────────┼────────
ISO: Management Review       │ view     │   ●   │     ●     │    ●    │     ○     │   ●
                             │ edit     │   ●   │     ●     │    ○    │     ○     │   ○
─────────────────────────────┼──────────┼───────┼───────────┼─────────┼───────────┼────────
ISO: CAPA                    │ view     │   ●   │     ●     │    ●    │     ○     │   ○
                             │ create   │   ●   │     ●     │    ●    │     ○     │   ○
                             │ edit     │   ●   │     ●     │    ◐    │     ○     │   ○
                             │ verify   │   ●   │     ●     │    ●    │     ○     │   ○
─────────────────────────────┼──────────┼───────┼───────────┼─────────┼───────────┼────────
ISO: Dokumente               │ view     │   ●   │     ●     │    ●    │     ○     │   ○
                             │ upload   │   ●   │     ●     │    ○    │     ○     │   ○
                             │ approve  │   ●   │     ●     │    ○    │     ○     │   ○
─────────────────────────────┼──────────┼───────┼───────────┼─────────┼───────────┼────────
ISO: Rechtskataster          │ view     │   ●   │     ●     │    ●    │     ○     │   ○
                             │ edit     │   ●   │     ●     │    ○    │     ○     │   ○
─────────────────────────────┼──────────┼───────┼───────────┼─────────┼───────────┼────────
Benutzerverwaltung (users)   │ view     │   ●   │     ○     │    ○    │     ○     │   ○
                             │ create   │   ●   │     ○     │    ○    │     ○     │   ○
                             │ edit     │   ●   │     ○     │    ○    │     ○     │   ○
                             │ delete   │   ●   │     ○     │    ○    │     ○     │   ○
─────────────────────────────┼──────────┼───────┼───────────┼─────────┼───────────┼────────
Rollen & Berechtigungen      │ view     │   ●   │     ○     │    ○    │     ○     │   ○
                             │ edit     │   ●   │     ○     │    ○    │     ○     │   ○
─────────────────────────────┼──────────┼───────┼───────────┼─────────┼───────────┼────────
Systemkonfiguration          │ view     │   ●   │     ◐     │    ○    │     ○     │   ○
                             │ edit     │   ●   │     ○     │    ○    │     ○     │   ○
─────────────────────────────┼──────────┼───────┼───────────┼─────────┼───────────┼────────
Audit-Log                    │ view     │   ●   │     ○     │    ●    │     ○     │   ○
```

#### Berechtigungs-Prüfung im Backend

```python
from functools import wraps
from fastapi import Depends, HTTPException, status

class PermissionService:
    """Zentrale Berechtigungsprüfung mit Caching"""

    async def check(self, user: User, module: str, action: str, resource_id: UUID | None = None) -> bool:
        """
        Prüft ob ein Benutzer eine Aktion auf einem Modul ausführen darf.
        
        Auflösungsreihenfolge:
        1. Benutzer-Override DENY → sofort abgelehnt
        2. Benutzer-Override GRANT → sofort erlaubt
        3. Rollen-Berechtigung → erlaubt/abgelehnt
        
        Optional: Standort-Einschränkung prüfen (allowed_locations)
        """
        # 1. Deny-Overrides haben höchste Priorität
        deny = await self.get_override(user.id, module, action, "DENY")
        if deny and self._is_valid(deny):
            return False

        # 2. Grant-Overrides überschreiben Rolle
        grant = await self.get_override(user.id, module, action, "GRANT")
        if grant and self._is_valid(grant):
            return True

        # 3. Rollen-Berechtigung prüfen
        return await self.role_has_permission(user.role_id, module, action)

    def _is_valid(self, override: UserPermissionOverride) -> bool:
        """Prüft ob ein Override zeitlich gültig ist."""
        today = date.today()
        if override.valid_from and today < override.valid_from:
            return False
        if override.valid_to and today > override.valid_to:
            return False
        return True


def require_permission(module: str, action: str):
    """FastAPI Dependency für Berechtigungsprüfung in API-Routen."""
    async def dependency(
        current_user: User = Depends(get_current_user),
        permission_service: PermissionService = Depends()
    ):
        allowed = await permission_service.check(current_user, module, action)
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Keine Berechtigung für {module}.{action}"
            )
        return current_user
    return Depends(dependency)


# Verwendung in API-Routen:
@router.post("/meters")
async def create_meter(
    meter_data: MeterCreate,
    current_user: User = require_permission("meters", "create"),
    meter_service: MeterService = Depends()
):
    return await meter_service.create(meter_data, created_by=current_user.id)
```

#### Standort-basierte Einschränkung

Benutzer können über `allowed_locations` auf bestimmte Standorte eingeschränkt werden. Ein Techniker, der nur für „Gebäude A" zuständig ist, sieht nur Zähler, Sensoren und Verbraucher an diesem Standort.

```python
async def filter_by_location(query, user: User, location_field: str = "location"):
    """Filtert Datenbankabfragen nach Benutzer-Standort-Einschränkung."""
    if user.allowed_locations is None:
        return query  # Keine Einschränkung → alle Standorte
    return query.where(
        getattr(Model, location_field).in_(user.allowed_locations)
    )
```

### 5.3 Frontend-Integration

#### Navigation & UI-Anpassung

Das Frontend blendet Module, Aktions-Buttons und Menüpunkte basierend auf den Berechtigungen des eingeloggten Benutzers aus:

- **Navigation:** Tabs werden nur angezeigt, wenn der Benutzer mindestens `view`-Berechtigung für das Modul hat
- **Aktions-Buttons:** „Neuer Zähler", „Bericht generieren", „Dokument hochladen" etc. nur sichtbar bei passender Berechtigung
- **Formularfelder:** Finanzdaten-Felder (Kosten, Tarife) werden für Benutzer ohne `tariffs.view` ausgeblendet
- **Tabellenspalten:** Kostenspalten werden ausgeblendet für Benutzer ohne Finanzdaten-Zugriff
- **Context-Menüs:** Bearbeiten/Löschen-Optionen nur bei passender Berechtigung

```typescript
// Frontend Permission Hook
function usePermission(module: string, action: string): boolean {
    const { user } = useAuth();
    return user.effectivePermissions.includes(`${module}.${action}`);
}

// Verwendung in Komponenten
function MeterListPage() {
    const canCreate = usePermission('meters', 'create');
    const canViewCosts = usePermission('tariffs', 'view');

    return (
        <div>
            {canCreate && <Button onClick={openCreateDialog}>Neuer Zähler</Button>}
            <MeterTable showCostColumn={canViewCosts} />
        </div>
    );
}
```

#### Login-Seite

- Schlichtes, zentriertes Login-Formular im Design-System des Add-ons
- Felder: Benutzername, Passwort
- „Passwort vergessen"-Link (sendet Reset-Link per E-Mail, falls SMTP konfiguriert)
- Fehlermeldung bei falschen Credentials (generisch: „Benutzername oder Passwort ungültig")
- Hinweis auf verbleibende Versuche bei fast gesperrtem Account
- Nach erfolgreicher Ersteinrichtung: Weiterleitung zum Passwort-Ändern-Dialog

#### Benutzerverwaltungs-UI (nur Admin)

- **Benutzerliste:** Tabelle mit Name, E-Mail, Rolle, Status (aktiv/gesperrt), letzter Login
- **Benutzer erstellen/bearbeiten:** Formular mit Stammdaten, Rollenzuordnung per Dropdown
- **Override-Editor:** Tabelle der Berechtigungen des Benutzers, Checkboxen für Grant/Deny-Overrides je Modul und Aktion, mit Begründungsfeld und optionalem Gültigkeitszeitraum
- **Rollen-Editor:** Tabelle aller Berechtigungen, gruppiert nach Modul-Kategorie, Checkboxen pro Rolle
- **Audit-Log-Viewer:** Filterable Tabelle aller sicherheitsrelevanten Aktionen (Login, Änderungen, Löschungen)

### 5.4 API-Endpunkte (Auth & Benutzerverwaltung)

```
# Authentifizierung
POST   /api/v1/auth/login                           # Login → Access + Refresh Token
POST   /api/v1/auth/refresh                          # Refresh Token → neues Access Token
POST   /api/v1/auth/logout                           # Session widerrufen
POST   /api/v1/auth/change-password                  # Eigenes Passwort ändern
POST   /api/v1/auth/setup                            # Ersteinrichtung (nur wenn noch kein User existiert)
GET    /api/v1/auth/me                               # Eigenes Profil + effektive Berechtigungen

# Benutzerverwaltung (nur Admin)
GET    /api/v1/users                                 # Alle Benutzer
POST   /api/v1/users                                 # Benutzer anlegen
GET    /api/v1/users/{id}                            # Benutzer-Details
PUT    /api/v1/users/{id}                            # Benutzer bearbeiten
DELETE /api/v1/users/{id}                            # Benutzer deaktivieren
POST   /api/v1/users/{id}/reset-password              # Passwort zurücksetzen
POST   /api/v1/users/{id}/unlock                      # Account entsperren
GET    /api/v1/users/{id}/sessions                    # Aktive Sessions
DELETE /api/v1/users/{id}/sessions/{session_id}        # Session widerrufen

# Rollen & Berechtigungen (nur Admin)
GET    /api/v1/roles                                 # Alle Rollen
POST   /api/v1/roles                                 # Neue Rolle anlegen
PUT    /api/v1/roles/{id}                            # Rolle bearbeiten
GET    /api/v1/roles/{id}/permissions                 # Berechtigungen einer Rolle
PUT    /api/v1/roles/{id}/permissions                 # Berechtigungen setzen
GET    /api/v1/permissions                            # Alle verfügbaren Berechtigungen

# Override-Management (nur Admin)
GET    /api/v1/users/{id}/overrides                   # Overrides eines Benutzers
POST   /api/v1/users/{id}/overrides                   # Override hinzufügen
DELETE /api/v1/users/{id}/overrides/{override_id}      # Override entfernen

# Audit-Log (nur Admin + Auditor)
GET    /api/v1/audit-log                             # Log-Einträge (Filter: Benutzer, Aktion, Zeitraum, Ressource)
GET    /api/v1/audit-log/export                      # CSV-Export
```

### 5.5 Sicherheitsmaßnahmen

- **CORS:** Nur der eigene Origin erlaubt (HA-Ingress-URL)
- **CSRF:** Double-Submit-Cookie für formularbasierte Aktionen
- **Rate-Limiting:** Globales Limit (100 Requests/Minute/User) + strenges Limit auf Auth-Endpunkten
- **Input-Validierung:** Pydantic V2 für alle Request-Bodies, Parametervalidierung auf allen Endpunkten
- **SQL-Injection:** Ausschließlich SQLAlchemy ORM, keine Raw-Queries
- **XSS:** React escaped standardmäßig, `dangerouslySetInnerHTML` verboten
- **Audit-Log:** Jede sicherheitsrelevante Aktion wird protokolliert (Login, Logout, CRUD auf sensiblen Daten, Rechteänderungen, fehlgeschlagene Zugriffsversuche)
- **Passwort-Speicherung:** Nur bcrypt-Hashes, niemals Klartext
- **Token-Sicherheit:** JWTs mit HMAC-SHA256 signiert, Secret aus HA-Secrets oder Environment

---

## 6. Frontend-Module

### 5.0 Design-System & UI-Richtlinien

#### Design-Philosophie

Das Frontend orientiert sich am Home-Assistant-Ökosystem: flach, sauber, modern mit viel Weißraum. Es soll sich nahtlos in die HA-Oberfläche via Ingress einfügen und gleichzeitig professionell genug wirken, um als eigenständiges Energiemanagement-Tool ernst genommen zu werden.

**Grundprinzipien:**
- Flaches Design: Keine Schatten, keine Verläufe, keine 3D-Effekte
- Subtile Rahmen: 1px `border` in hellen Grautönen, keine dicken Rahmen
- Großzügiger Weißraum: Elemente atmen lassen, nie überladen wirken
- Farbkodierung mit Bedeutung: Farben transportieren Information (Energietyp, Status), nie Dekoration
- Responsive: Nutzbar auf Desktop (Hauptzielgruppe), Tablet und Smartphone
- Dark Mode: Vollständige Unterstützung über Tailwind CSS `dark:`-Klassen, automatisch aus HA-Einstellung

#### Farbpalette

```
Primärfarbe:            #1B5E7B (Dunkles Petrol) – Navigation, aktive Elemente, Akzente
Primär hell:            #2A8CB5 (Mittleres Petrol) – Hover-Zustände
Primär Hintergrund:     #E8F4F8 (Helles Petrol) – Ausgewählte Karten, aktive Tabs

Energietyp-Farben (konsistent in Frontend, Schema-Editor und PDF):
  Strom:                #F59E0B (Amber/Gelb)
  Gas:                  #EF6C00 (Orange)
  Wasser:               #2196F3 (Blau)
  Wärme:                #E53935 (Rot)
  Kälte:                #00BCD4 (Cyan)
  Druckluft:            #8E24AA (Violett)
  Dampf:                #78909C (Blaugrau)

Status-Ampel:
  Positiv / Einsparung:    #16A34A (Grün)
  Warnung / Aufmerksamkeit: #D97706 (Amber)
  Negativ / Überschreitung: #DC2626 (Rot)
  Information:              #2563EB (Blau)

Neutral:
  Text primär:          #1F2937
  Text sekundär:        #6B7280
  Text tertiär:         #9CA3AF
  Rahmen:               #E5E7EB
  Hintergrund Karten:   #FFFFFF
  Hintergrund Seite:    #F9FAFB
  Hintergrund KPI:      #F3F4F6
```

#### Typografie

```
Schriftfamilie:         Inter (über Google Fonts oder lokal gebündelt)
                        Fallback: system-ui, -apple-system, sans-serif
Monospace:              JetBrains Mono (für Zählernummern, Entity-IDs, Code)
                        Fallback: ui-monospace, monospace

Größen:
  Seitentitel (h1):     24px, Gewicht 600
  Abschnittstitel (h2): 18px, Gewicht 600
  Kartentitel (h3):     15px, Gewicht 500
  Fließtext:            14px, Gewicht 400
  Labels/Beschriftungen: 12px, Gewicht 500
  Kleine Hinweise:      11px, Gewicht 400
  KPI-Werte:            28px, Gewicht 600 (große Zahlen auf dem Dashboard)
  KPI-Einheiten:        14px, Gewicht 400

Zeilenhöhe:             1.5 für Fließtext, 1.3 für Überschriften, 1.4 für Tabellen
```

#### Komponentenbibliothek (Shadcn/ui + Custom)

**KPI-Kacheln:**
- Hintergrund: `bg-gray-50` (leicht grauer Hintergrund, abgehoben von Kartenweiß)
- Oberkante: 3px farbige Linie je Energietyp (z.B. Amber für Strom)
- Inhalt vertikal: Label (11px, grau) → Wert + Einheit (28px + 14px) → Trend-Badge
- Trend-Badge: Abgerundete Pille, grüner Hintergrund bei Verbesserung (↓ -3,2%), roter bei Verschlechterung (↑ +1,1%)
- Grid: 6 Kacheln in einer Zeile auf Desktop, 3×2 auf Tablet, 2×3 auf Smartphone

**Karten (Cards):**
- Weißer Hintergrund, 1px `border-gray-200`, `rounded-xl` (12px Radius)
- Padding: 16px 18px innen
- Kartentitel: 13–15px, Gewicht 500, optional rechts ein Badge oder Zeitraum-Auswahl
- Keine Schatten, keine Hover-Effekte auf Karten selbst

**Tabellen:**
- Kopfzeile: Hintergrund `bg-gray-50`, Text 11px Gewicht 500, Farbe sekundär
- Zeilen: Alternierend `bg-white` / `bg-gray-50` (subtil)
- Zahlen: Rechtsbündig, `font-variant-numeric: tabular-nums`, Monospace-Font
- Summenzeile: Fettdruck, obere Trennlinie 2px in Primärfarbe
- Hover auf Zeilen: `bg-blue-50` (dezentes Highlight)

**Buttons:**
- Primär: Hintergrund Primärfarbe, weißer Text, `rounded-lg`, Hover etwas dunkler
- Sekundär: Weißer Hintergrund, 1px Rahmen, Text in Primärfarbe
- Destruktiv: Roter Hintergrund für Lösch-Aktionen
- Alle: 36px Höhe, 14px Schrift, 12px horizontales Padding

**Formulare:**
- Input-Felder: 36px Höhe, 1px Rahmen `border-gray-300`, `rounded-lg`, Focus-Ring in Primärfarbe
- Labels: 12px, Gewicht 500, über dem Feld (nicht inline)
- Dropdowns: Gleicher Stil wie Inputs, mit Chevron rechts
- Fehler: Roter Rahmen + rote Fehlermeldung unter dem Feld (11px)

**Entity-Picker (Custom-Komponente):**
- Dropdown-Trigger: Input-Feld-Stil mit Suchfunktion
- Geöffneter Dropdown: Absolute Positionierung, weißer Hintergrund, 1px Rahmen, maximale Höhe 280px mit Scroll
- Suchfeld: Oben fixiert mit `border-bottom`, Platzhalter „Entity suchen..."
- Gruppierung: Gruppen-Header in Großbuchstaben, 10px, hellgrau, mit Abstand
- Entity-Zeile: Icon links (20×20px, farbiger Hintergrund je device_class), Entity-ID als Monospace, Friendly Name fett, aktueller Wert rechtsbündig, Area/Device als kleine graue Zeile darunter
- Ausgewählte Entity: Blauer Hintergrund `bg-blue-50`
- Vorschau nach Auswahl: Karte unterhalb des Dropdowns mit: Name, aktueller Wert groß, Sparkline der letzten 24h als vertikale Balken

**Navigation:**
- Horizontale Tab-Leiste am oberen Rand (unterhalb des HA-Ingress-Headers)
- Tabs: Pillen-Stil, aktiver Tab mit `bg-white` + 1px Rahmen + Gewicht 500, inaktiv transparent + grauer Text
- Reihenfolge: Dashboard | Zähler | Verbraucher | Schema-Editor | Auswertungen | Klimadaten | CO₂-Bilanz | ISO 50001 | Berichte
- Auf kleinen Bildschirmen: Horizontal scrollbar mit ausgeblendetem Scrollbalken

**Diagramme (Recharts / Apache ECharts):**
- Gleiche Farbpalette wie Rest des Design-Systems (keine Bibliotheks-Defaults)
- Hintergrund: Transparent (Karte liefert den weißen Hintergrund)
- Rasterlinien: Dezent, gestrichelt, nur Y-Achse, Farbe `#E5E7EB`
- Achsenbeschriftung: 11px, Farbe `#6B7280`
- Legende: Unterhalb des Diagramms, horizontal, keine Box
- Tooltips: Weißer Hintergrund, 1px Rahmen, dezenter Schatten (einzige erlaubte Schatten-Ausnahme), 12px Schrift
- Interaktion: Hover-Highlights, Klick für Drill-Down, Zoom-Range-Slider für Zeitreihen

**Wizard-Schritte:**
- Horizontale Schrittleiste am oberen Rand des Formulars
- Jeder Schritt: Nummer + Titel, verbunden durch horizontale Linie
- Zustände: Abgeschlossen (grüne Linie), Aktiv (blaue Linie + fetter Text), Ausstehend (graue Linie + grauer Text)
- Zähler-Wizard: 6 Schritte (Grunddaten → Datenquelle → Hierarchie → Tarif → Witterung → CO₂)

**Ampel-Indikatoren:**
- Kleine Kreise (7–8px Durchmesser) in Grün/Gelb/Rot
- Verwendet für: Compliance-Status, Ziel-Erreichung, Anomalie-Schwere, Risiko-Bewertung
- Immer zusammen mit Textlabel (nie nur Farbe als Information)

**Kanban-Board (Aktionspläne):**
- 3 Spalten: Geplant | In Umsetzung | Abgeschlossen
- Spalten-Hintergrund: `bg-gray-50`, abgerundete Ecken
- Karten: Weiß, 1px Rahmen, `rounded-md`, draggable
- In-Umsetzung-Karten: Farbiger linker Rand (3px, Primärfarbe)
- Abgeschlossene Karten: Leicht gedimmt (`opacity-70`)
- Drag & Drop: Visuelles Feedback mit blauem Schattenwurf während des Ziehens

**Risikomatrix:**
- 5×5 Grid mit farbkodierten Zellen
- Achsen: Wahrscheinlichkeit (Y, 1–5) × Auswirkung (X, 1–5)
- Farbschema: Grün (1–4 Score), Gelb (5–9), Orange (10–14), Rot (15–25)
- Risiken als Zähler in den Zellen, Hover zeigt Risiko-Details
- Achsenbeschriftung: 10px, grau

**Toast-Benachrichtigungen:**
- Oben rechts, temporär (5 Sekunden)
- Erfolg: Grüner linker Rand, grünes Icon
- Fehler: Roter linker Rand, rotes Icon
- Info: Blauer linker Rand
- Weißer Hintergrund, dezenter Schatten (erlaubte Ausnahme)

#### Layout-Struktur

```
┌─────────────────────────────────────────────────────────┐
│  Home Assistant Ingress Header (vom HA bereitgestellt)   │
├─────────────────────────────────────────────────────────┤
│  Navigation: [Dashboard] [Zähler] [Verbraucher] [...]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Seiteninhalt (max-width: 1280px, zentriert)            │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Breadcrumb / Seitentitel + Aktions-Buttons     │    │
│  ├─────────────────────────────────────────────────┤    │
│  │                                                 │    │
│  │  Hauptinhalt (Grid-basiert, responsive)         │    │
│  │                                                 │    │
│  │  Dashboard: 6-Spalten-KPI → 2-Spalten-Charts    │    │
│  │  Listen: Tabelle mit Filter-Sidebar             │    │
│  │  Detail: 2-Spalten (Info links, Charts rechts)  │    │
│  │  Formulare: Zentriert, max-width 640px          │    │
│  │  Schema-Editor: Volle Breite, Toolbox links     │    │
│  │                                                 │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

#### Responsive Breakpoints

```
Desktop:    ≥ 1024px  – Volle Darstellung, Multi-Spalten-Layouts
Tablet:     768–1023px – KPI-Grid 3×2, Charts untereinander, Tabellen horizontal scrollbar
Smartphone: < 768px   – KPI-Grid 2×3, alles einspaltig, Navigation als Hamburger-Menü
```

### 5.1 Dashboard (Startseite)
- **KPI-Kacheln** oben: Gesamtverbrauch aktueller Monat (je Energietyp), Trend vs. Vormonat (%), Kosten, CO₂-Emissionen
- **CO₂-Zusammenfassung:** Gesamtemissionen in t CO₂, Veränderung zum Vorjahr, Ampel-Indikator
- **Aktuelle CO₂-Intensität:** Live-Anzeige der Stromnetz-CO₂-Intensität (Electricity Maps)
- **Sankey-Diagramm:** Energiefluss vom Hauptzähler zu den Unterzählern/Verbrauchern
- **Zeitreihen-Chart:** Letzten 7/30/365 Tage, Auswahl je Zähler oder Gruppe, Vergleich mit Vorjahreszeitraum
- **Top-5-Verbraucher:** Balkendiagramm der größten Energieverbraucher
- **Warnungen / Anomalien:** Liste mit auffälligen Abweichungen

### 5.2 Zähler-Verwaltung
- **Listenansicht:** Tabelle aller Zähler mit Filter (Energietyp, Quelle, Standort, Status)
- **Detailansicht:** Stammdaten, Konfiguration, letzte Ablesungen, Verbrauchsverlauf als Chart
- **Erstellen/Bearbeiten:** Wizard mit Schritten:
  1. Grunddaten (Name, Typ, Einheit)
  2. Datenquelle (Auswahl + Konfiguration)
  3. Hierarchie (Übergeordneter Zähler)
  4. Tarif (Preis, Grundgebühr)
  5. Witterungskorrektur (Wetterstation, Methode, Parameter) – nur bei Heizung/Kühlung
  6. CO₂-Faktor (Automatisch oder manueller Override)
- **Baumansicht:** Hierarchische Darstellung der Zählerstruktur (Haupt- → Unterzähler)

### 5.3 Verbraucher-Verwaltung
- CRUD-Oberfläche für Verbraucher
- Zähler-Zuordnung per Drag & Drop oder Multi-Select
- Kategorisierung und Tagging
- Verbrauchsschätzung basierend auf Nennleistung × Betriebsstunden

### 5.4 Schema-Editor (Drag & Drop)
- **Canvas-basierter Editor** mit Zoom und Pan (Bibliothek: React Flow oder eigene Implementierung mit dnd-kit + SVG)
- **Toolbox-Sidebar:** Liste aller Zähler und Verbraucher als draggable Items
- **Auf dem Canvas:**
  - Zähler als Karten mit Live-Wert und Sparkline
  - Verbraucher als Symbole (konfigurierbare Icons je Kategorie)
  - Verbindungslinien (Kanten) zwischen Zählern und Verbrauchern, die den Energiefluss darstellen
  - Farbkodierung nach Energietyp (Strom=gelb, Wasser=blau, Gas=orange, Wärme=rot, Kälte=cyan)
- **Interaktionen:**
  - Drag & Drop aus Toolbox auf Canvas zum Hinzufügen
  - Drag zum Verschieben auf dem Canvas
  - Doppelklick öffnet Detailansicht
  - Rechtsklick-Kontextmenü (Bearbeiten, Entfernen, Verbinden)
  - Verbindungen durch Ziehen von Anschlusspunkten
- **Mehrere Schemas speicherbar** (z.B. je Gebäude oder je Energietyp)
- **Export als SVG/PNG** für Dokumentation

### 5.5 Manuelle Dateneingabe
- **Einzelablesung:** Zähler auswählen → Datum + Wert eingeben → Plausibilitätsprüfung → Speichern
- **Monatsabrechnung:** Tabellenansicht mit einer Zeile pro Zähler, Spalten für die Monate → Bulk-Eingabe
- **Import-Wizard:** Datei hochladen → Vorschau → Spalten-Mapping → Validierung → Import bestätigen
- **Ableseplan:** Kalenderansicht mit fälligen Ablesungen und Erinnerungen

### 5.6 Wetterdaten-Verwaltung
- **Stations-Übersicht:** Karte mit aktiven Wetterstationen, Zuordnung zu Standorten
- **Datenansicht:** Tägliche/monatliche Wetterdaten je Station (Tabelle + Temperatur-Chart)
- **Gradtagszahlen-Dashboard:** Monatsübersicht HDD/CDD, Vergleich mit Langzeitmittel, Heiz-/Kühlperioden
- **Import:** Manueller CSV-Upload für Wetterdaten oder Gradtagszahlen
- **Konfiguration:** API-Einstellungen (Bright Sky, DWD), Sync-Intervall, Station-Zuordnung

### 5.7 CO₂-Dashboard
- **Gesamtbilanz:** Jahres- und Monatsansicht der CO₂-Emissionen nach Energieträger
- **Zeitreihe:** Verlauf der monatlichen CO₂-Emissionen, Trend, Vergleich mit Vorjahr und Baseline
- **Verteilung:** Kreisdiagramm der CO₂-Emissionen nach Energietyp, nach Standort, nach Kostenstelle
- **Echtzeit-Indikator:** Aktuelle CO₂-Intensität des Stromnetzes (via Electricity Maps) + Empfehlung „günstiger Zeitpunkt für hohen Verbrauch"
- **Scope-Übersicht:** Aufschlüsselung nach Scope 1 (direkte Emissionen), Scope 2 (Strom, Fernwärme), optional Scope 3
- **Faktor-Verwaltung:** Tabelle aller Emissionsfaktoren, Quellen, manuelle Überschreibungen, Changelog
- **Export:** CSV-Export der CO₂-Bilanz für externe Berichterstattung (GHG Protocol, EMAS, DNK)

### 5.8 Auswertungen & Diagramme
- **Zeitreihen-Diagramm (Line/Area):** Verbrauchsverlauf über Zeit, mehrere Zähler überlagert, Zoom-fähig
- **Balkendiagramm (Bar):** Monatsvergleich, Jahresvergleich, Zählervergleich
- **Kreisdiagramm (Pie/Donut):** Anteil je Energietyp am Gesamtverbrauch
- **Sankey-Diagramm:** Energieflüsse vom Eingang bis zu den Verbrauchern
- **Heatmap:** Verbrauch nach Wochentag × Stunde (wo verfügbar)
- **Wasserfall-Diagramm:** Aufschlüsselung der Veränderungen zwischen Perioden
- **Benchmarking:** Verbrauch pro m², pro Mitarbeiter, pro Produktionseinheit (konfigurierbar)
- **Witterungsbereinigter Vergleich:** Darstellung von Roh- vs. korrigiertem Verbrauch über die Zeit
- **CO₂-Emissionsverlauf:** Emissionen über Zeit, gestapelt nach Energietyp
- **Filter:** Zeitraum, Energietyp, Standort, Kostenstelle, Zählergruppe
- **Alle Diagramme:**
  - Interaktiv (Hover-Tooltips, Klick für Drill-Down)
  - Exportierbar als PNG
  - Zeitraum per Datepicker wählbar
  - Vergleichszeitraum zuschaltbar (z.B. aktueller Monat vs. Vorjahresmonat)

### 5.9 Energieaudit (ISO 50001)
- **Automatische Generierung** basierend auf aktuellen Zählerständen und historischen Daten
- **Audit-Inhalte:**
  - Energiebilanz: Gesamtverbrauch und -kosten nach Energieträger
  - CO₂-Bilanz: Gesamtemissionen nach Energieträger, Scope-Aufschlüsselung, Trend
  - Witterungsbereinigter Verbrauch: Roh vs. korrigiert für alle heizungsbezogenen Zähler
  - Lastprofile: Grund-, Mittel- und Spitzenlast
  - Wesentliche Energieverbraucher (Significant Energy Uses – SEU): Automatisch identifiziert anhand Pareto-Analyse (80/20)
  - Energieleistungskennzahlen (EnPI): kWh/m², kWh/Stück, kWh/Mitarbeiter, kg CO₂/m² usw. – konfigurierbar
  - Trendanalyse: Verbrauchsentwicklung über 12/24/36 Monate (witterungsbereinigt)
  - Abweichungsanalyse: Soll-Ist-Vergleich gegen Baseline (witterungsbereinigt)
  - CO₂-Reduktionspfad: Ist-Emissionen vs. Ziel-Emissionen (konfigurierbare Ziele)
  - Maßnahmenvorschläge: Basierend auf erkannten Anomalien und Best Practices
  - Einsparungspotenziale: Hochrechnung basierend auf identifizierten Optimierungen (kWh + kg CO₂ + €)
- **Baseline-Management:**
  - Definition von Referenzjahren und -perioden
  - Normalisierung nach Witterung (Gradtagszahlen), Auslastung, Fläche
  - Automatische Neuberechnung bei geänderten Rahmenbedingungen
- **Online-Ansicht:** Vollständiger Bericht als interaktive Webseite mit Navigation
- **PDF-Export:**
  - Professionelles Layout mit Deckblatt, Inhaltsverzeichnis, Seitennummern
  - Eingebettete Diagramme als hochauflösende Grafiken
  - Tabellarische Zusammenfassungen
  - Anhang mit Rohdaten-Auszügen
  - Generierung als Hintergrund-Task mit Fortschrittsanzeige

### 5.10 ISO 50001 Management-Modul (Kap. 4–10 Normkonformität)

Die ISO 50001:2018 ist nicht nur ein technisches Monitoring-System, sondern ein Managementsystem mit Anforderungen an Dokumentation, Prozesse, Rollen und kontinuierliche Verbesserung. Die folgenden Funktionen bilden die organisatorischen Normkapitel ab, die über die rein technische Energiedatenerfassung hinausgehen.

#### 5.10.1 Kontext & Anwendungsbereich (Kap. 4)

Datenmodell:

```python
class OrganizationContext(Base):
    __tablename__ = "organization_context"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    scope_description: Mapped[str]             # Anwendungsbereich des EnMS (Text)
    scope_boundaries: Mapped[dict | None]      # JSON: Standorte, Gebäude, Prozesse im Scope
    internal_issues: Mapped[list[dict]]         # Interne Themen (z.B. Altersstruktur Anlagen, Auslastung)
    external_issues: Mapped[list[dict]]         # Externe Themen (z.B. Energiepreise, Regulierung, Klima)
    interested_parties: Mapped[list[dict]]      # Interessierte Parteien + deren Anforderungen
    # JSON-Struktur je Party: {"name": "...", "requirements": ["..."], "relevance": "high/medium/low"}
    energy_types_excluded: Mapped[list[str] | None]  # Ausgeschlossene Energiearten mit Begründung
    last_reviewed: Mapped[date]
    version: Mapped[int] = mapped_column(default=1)
```

Frontend:
- Formular für Anwendungsbereich mit Rich-Text-Editor
- Tabelle für interessierte Parteien (Name, Anforderungen, Relevanz)
- Tabelle für interne/externe Themen mit Kategorisierung
- Versionierung: Jede Änderung erzeugt eine neue Version mit Zeitstempel

#### 5.10.2 Energiepolitik & Führung (Kap. 5)

Datenmodell:

```python
class EnergyPolicy(Base):
    __tablename__ = "energy_policies"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str]                         # z.B. "Energiepolitik 2025"
    content: Mapped[str]                       # Volltext der Energiepolitik (Markdown/HTML)
    approved_by: Mapped[str]                   # Name des Verantwortlichen (Top-Management)
    approved_date: Mapped[date]
    valid_from: Mapped[date]
    valid_to: Mapped[date | None]
    is_current: Mapped[bool] = mapped_column(default=True)
    pdf_path: Mapped[str | None]               # Hochgeladenes signiertes Dokument
    version: Mapped[int] = mapped_column(default=1)

class EnMSRole(Base):
    __tablename__ = "enms_roles"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    role_name: Mapped[str]                     # z.B. "Energiemanagementbeauftragter", "Energieteam-Leiter"
    person_name: Mapped[str]
    department: Mapped[str | None]
    responsibilities: Mapped[list[str]]        # Liste der Verantwortlichkeiten
    authorities: Mapped[list[str]]             # Liste der Befugnisse
    appointed_date: Mapped[date]
    appointed_by: Mapped[str]                  # Wer hat die Rolle zugewiesen
    is_active: Mapped[bool] = mapped_column(default=True)
```

Frontend:
- Energiepolitik: Rich-Text-Editor mit Vorlagen, Versionierung, PDF-Upload für signierte Version
- Rollen-Matrix: Tabelle mit Rollen, Personen, Verantwortlichkeiten → Organigramm-Ansicht
- Statusanzeige: Ist die aktuelle Energiepolitik noch gültig? Wann war die letzte Überprüfung?

#### 5.10.3 Energieziele & Aktionspläne (Kap. 6.1, 6.2)

Datenmodell:

```python
class EnergyObjective(Base):
    """Übergeordnete Energieziele"""
    __tablename__ = "energy_objectives"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str]                         # z.B. "Stromverbrauch um 10% senken bis 2026"
    description: Mapped[str | None]
    target_type: Mapped[str]                   # Enum: ABSOLUTE_REDUCTION, RELATIVE_REDUCTION, ENPI_TARGET, CO2_TARGET
    target_value: Mapped[Decimal]              # Zielwert
    target_unit: Mapped[str]                   # kWh, %, kWh/m², kg CO₂
    baseline_value: Mapped[Decimal]            # Ausgangswert
    baseline_period: Mapped[str]               # z.B. "2024"
    target_date: Mapped[date]
    responsible_person: Mapped[str]
    status: Mapped[str]                        # Enum: PLANNED, IN_PROGRESS, ACHIEVED, NOT_ACHIEVED, CANCELLED
    related_meter_ids: Mapped[list[uuid.UUID] | None]
    current_value: Mapped[Decimal | None]      # Automatisch berechnet aus Zählerständen
    progress_percent: Mapped[Decimal | None]   # Automatisch berechnet
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]

class ActionPlan(Base):
    """Aktionspläne zur Erreichung der Energieziele"""
    __tablename__ = "action_plans"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    objective_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("energy_objectives.id"))
    title: Mapped[str]                         # z.B. "LED-Umrüstung Beleuchtung EG"
    description: Mapped[str | None]
    responsible_person: Mapped[str]
    resources_required: Mapped[str | None]     # Benötigte Ressourcen (Text)
    investment_cost: Mapped[Decimal | None]    # € Investition
    expected_savings_kwh: Mapped[Decimal | None]
    expected_savings_eur: Mapped[Decimal | None]
    expected_savings_co2_kg: Mapped[Decimal | None]
    start_date: Mapped[date]
    target_date: Mapped[date]
    completion_date: Mapped[date | None]
    status: Mapped[str]                        # Enum: PLANNED, IN_PROGRESS, COMPLETED, CANCELLED
    verification_method: Mapped[str | None]    # Wie wird die Wirksamkeit gemessen?
    actual_savings_kwh: Mapped[Decimal | None] # Tatsächlich erreichte Einsparung
    notes: Mapped[str | None]
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]

class RiskOpportunity(Base):
    """Risiken und Chancen (Kap. 6.1)"""
    __tablename__ = "risks_opportunities"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    type: Mapped[str]                          # Enum: RISK, OPPORTUNITY
    title: Mapped[str]
    description: Mapped[str]
    category: Mapped[str]                      # z.B. Technisch, Regulatorisch, Finanziell, Organisatorisch
    likelihood: Mapped[int]                    # 1–5 (Eintrittswahrscheinlichkeit)
    impact: Mapped[int]                        # 1–5 (Auswirkung)
    risk_score: Mapped[int]                    # likelihood × impact (auto-berechnet)
    mitigation_action: Mapped[str | None]      # Geplante Maßnahme
    responsible_person: Mapped[str | None]
    status: Mapped[str]                        # Enum: OPEN, IN_PROGRESS, MITIGATED, CLOSED, ACCEPTED
    review_date: Mapped[date | None]
    created_at: Mapped[datetime]
```

Frontend:
- **Ziele-Dashboard:** Kacheln pro Ziel mit Fortschrittsbalken, Status-Ampel, automatisch berechnetem Zielerreichungsgrad
- **Aktionspläne:** Kanban-Board (Geplant → In Umsetzung → Abgeschlossen) oder Tabelle mit Gantt-Ansicht
- **Risiko-Matrix:** 5×5-Heatmap (Wahrscheinlichkeit × Auswirkung), Risiken als positionierte Punkte
- **Automatische Zielüberwachung:** EnPI-Werte und Verbrauchsdaten werden gegen Ziele geprüft → Warnungen bei Zielgefährdung

#### 5.10.4 Dokumentierte Information (Kap. 7.5)

Datenmodell:

```python
class Document(Base):
    """Dokumentenlenkung für alle EnMS-relevanten Dokumente"""
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str]
    document_type: Mapped[str]                 # Enum: POLICY, PROCEDURE, WORK_INSTRUCTION, RECORD, FORM, REPORT, EXTERNAL
    category: Mapped[str]                      # z.B. Energiepolitik, Verfahrensanweisung, Auditbericht, Schulungsnachweis
    description: Mapped[str | None]
    file_path: Mapped[str | None]              # Pfad zur hochgeladenen Datei
    file_type: Mapped[str | None]              # PDF, DOCX, XLSX etc.
    version: Mapped[str]                       # z.B. "1.0", "2.1"
    status: Mapped[str]                        # Enum: DRAFT, IN_REVIEW, APPROVED, ARCHIVED, SUPERSEDED
    author: Mapped[str]
    approved_by: Mapped[str | None]
    approved_date: Mapped[date | None]
    review_due_date: Mapped[date | None]       # Nächster Überprüfungstermin
    retention_period_months: Mapped[int | None] # Aufbewahrungsfrist
    iso_clause_reference: Mapped[str | None]   # z.B. "6.3", "9.2" – Zuordnung zum Normkapitel
    tags: Mapped[list[str] | None]
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]

class DocumentRevision(Base):
    """Revisionshistorie"""
    __tablename__ = "document_revisions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id"))
    version: Mapped[str]
    change_description: Mapped[str]
    changed_by: Mapped[str]
    changed_at: Mapped[datetime]
    file_path: Mapped[str | None]              # Archivierte Vorgängerversion
```

Frontend:
- Dokumenten-Bibliothek: Tabelle mit Filter (Typ, Kategorie, Status, Normkapitel), Suche
- Upload-Funktion mit automatischer Versionierung
- Überprüfungserinnerungen: Dashboard-Widget zeigt fällige Überprüfungen
- Zuordnung zu Normkapiteln: Jedes Dokument referenziert das zugehörige ISO-50001-Kapitel

#### 5.10.5 Rechtliche Anforderungen (Kap. 6.2, 9.1.2)

Datenmodell:

```python
class LegalRequirement(Base):
    """Rechtskataster für energierelevante Gesetze und Vorschriften"""
    __tablename__ = "legal_requirements"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str]                         # z.B. "Energieeffizienzgesetz (EnEfG)"
    category: Mapped[str]                      # Enum: LAW, REGULATION, PERMIT, CONTRACT, VOLUNTARY
    jurisdiction: Mapped[str]                  # z.B. "DE", "EU", "Bundesland"
    description: Mapped[str]
    relevance: Mapped[str]                     # Wie betrifft es die Organisation?
    compliance_status: Mapped[str]             # Enum: COMPLIANT, PARTIALLY_COMPLIANT, NON_COMPLIANT, NOT_ASSESSED
    responsible_person: Mapped[str | None]
    last_assessment_date: Mapped[date | None]
    next_review_date: Mapped[date | None]
    source_url: Mapped[str | None]             # Link zum Gesetzestext
    notes: Mapped[str | None]
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime]
```

Frontend:
- Rechtskataster-Tabelle mit Compliance-Ampel (konform/teilweise/nicht konform)
- Erinnerungen für fällige Überprüfungen
- Zuordnung zu Energiezielen und Maßnahmen

#### 5.10.6 Internes Audit des EnMS (Kap. 9.2)

Datenmodell:

```python
class InternalAudit(Base):
    """Planung und Durchführung interner EnMS-Audits"""
    __tablename__ = "internal_audits"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str]                         # z.B. "Internes Audit Q3/2025"
    audit_type: Mapped[str]                    # Enum: FULL, PARTIAL, FOLLOW_UP
    scope: Mapped[str]                         # Welche Normkapitel / Bereiche werden geprüft
    planned_date: Mapped[date]
    actual_date: Mapped[date | None]
    lead_auditor: Mapped[str]
    audit_team: Mapped[list[str] | None]
    status: Mapped[str]                        # Enum: PLANNED, IN_PROGRESS, COMPLETED, CANCELLED
    overall_result: Mapped[str | None]         # Zusammenfassung
    created_at: Mapped[datetime]

class AuditFinding(Base):
    """Einzelbefunde aus internen Audits"""
    __tablename__ = "audit_findings"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    audit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("internal_audits.id"))
    finding_type: Mapped[str]                  # Enum: NONCONFORMITY_MAJOR, NONCONFORMITY_MINOR, OBSERVATION, OPPORTUNITY, POSITIVE
    iso_clause: Mapped[str]                    # z.B. "6.3" – betroffenes Normkapitel
    description: Mapped[str]
    evidence: Mapped[str | None]               # Objektiver Nachweis
    corrective_action: Mapped[str | None]      # Korrekturmaßnahme
    responsible_person: Mapped[str | None]
    due_date: Mapped[date | None]
    completion_date: Mapped[date | None]
    verification_result: Mapped[str | None]    # Wirksamkeitsprüfung
    status: Mapped[str]                        # Enum: OPEN, IN_PROGRESS, CLOSED, VERIFIED
```

Frontend:
- **Audit-Kalender:** Jahresplanung mit geplanten Audits, Normkapitel-Zuordnung
- **Audit-Durchführung:** Checkliste pro Normkapitel mit Bewertung (konform/Abweichung/Beobachtung)
- **Befunde-Tracker:** Tabelle aller offenen Befunde mit Fälligkeitsdaten, Ampel-Status
- **Maßnahmen-Verknüpfung:** Befunde können direkt Korrekturmaßnahmen / Aktionspläne auslösen

#### 5.10.7 Managementbewertung (Kap. 9.3)

Datenmodell:

```python
class ManagementReview(Base):
    """Managementbewertung (Management Review)"""
    __tablename__ = "management_reviews"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str]                         # z.B. "Managementbewertung 2025"
    review_date: Mapped[date]
    participants: Mapped[list[str]]            # Teilnehmer
    period_start: Mapped[date]                 # Bewerteter Zeitraum
    period_end: Mapped[date]

    # Eingaben (Inputs gemäß Kap. 9.3)
    previous_review_actions: Mapped[str | None]       # Status Maßnahmen aus letzter Bewertung
    energy_policy_adequacy: Mapped[str | None]        # Ist die Energiepolitik noch angemessen?
    enpi_performance: Mapped[str | None]              # EnPI-Entwicklung (auto-generierbar aus Daten)
    compliance_status: Mapped[str | None]             # Status rechtliche Anforderungen
    audit_results_summary: Mapped[str | None]         # Zusammenfassung interner Audit-Ergebnisse
    nonconformities_summary: Mapped[str | None]       # Offene Nichtkonformitäten
    external_changes: Mapped[str | None]              # Änderungen im Kontext (Gesetze, Markt, Technik)
    resource_adequacy: Mapped[str | None]             # Sind Ressourcen ausreichend?
    improvement_opportunities: Mapped[str | None]     # Verbesserungsmöglichkeiten

    # Ergebnisse (Outputs gemäß Kap. 9.3)
    decisions: Mapped[list[dict] | None]       # Getroffene Entscheidungen
    action_items: Mapped[list[dict] | None]    # Maßnahmen mit Verantwortlichen und Fristen
    policy_changes_needed: Mapped[bool] = mapped_column(default=False)
    resource_changes_needed: Mapped[str | None]
    next_review_date: Mapped[date | None]

    status: Mapped[str]                        # Enum: PLANNED, COMPLETED
    protocol_document_id: Mapped[uuid.UUID | None]  # Verknüpfung zum gespeicherten Protokoll
    created_at: Mapped[datetime]
```

Frontend:
- **Vorbereitung:** Automatisch generierter Entwurf mit vorausgefüllten Daten (EnPI-Trends, Audit-Ergebnisse, Zielstatus, offene Maßnahmen) → Der Benutzer ergänzt nur die qualitativen Bewertungen
- **Durchführung:** Formular mit allen Input/Output-Feldern gemäß Kap. 9.3
- **Maßnahmen-Tracking:** Action Items fließen direkt in die Aktionspläne ein
- **Protokoll:** Export als PDF, automatisch in Dokumentenbibliothek abgelegt
- **Historie:** Liste aller bisherigen Managementbewertungen mit Vergleichsmöglichkeit

#### 5.10.8 Nichtkonformitäten & Korrekturmaßnahmen (Kap. 10.1)

Datenmodell:

```python
class Nonconformity(Base):
    """Nichtkonformitäten und Korrekturmaßnahmen"""
    __tablename__ = "nonconformities"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str]
    source: Mapped[str]                        # Enum: INTERNAL_AUDIT, MANAGEMENT_REVIEW, MONITORING, EXTERNAL_AUDIT, OTHER
    source_reference_id: Mapped[uuid.UUID | None]  # Verknüpfung zum Audit-Befund, etc.
    description: Mapped[str]                   # Beschreibung der Nichtkonformität
    root_cause: Mapped[str | None]             # Ursachenanalyse
    immediate_action: Mapped[str | None]       # Sofortmaßnahme (Korrektur)
    corrective_action: Mapped[str | None]      # Korrekturmaßnahme (verhindert Wiederholung)
    responsible_person: Mapped[str]
    due_date: Mapped[date]
    completion_date: Mapped[date | None]
    effectiveness_verified: Mapped[bool] = mapped_column(default=False)
    verification_date: Mapped[date | None]
    verification_notes: Mapped[str | None]
    status: Mapped[str]                        # Enum: OPEN, IN_PROGRESS, CORRECTED, VERIFIED, CLOSED
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]
```

Frontend:
- CAPA-Tracker (Corrective and Preventive Actions): Tabelle mit Filter nach Status, Quelle, Fälligkeit
- Ursachenanalyse: Formularfelder für 5-Why oder Ishikawa-Kategorien
- Wirksamkeitsprüfung: Erinnerung nach Abschluss der Maßnahme, Bewertungsformular
- Verknüpfung: Automatische Verlinkung zu Audit-Befunden, Managementbewertungen, Energiezielen

#### Zusammenfassung: ISO-50001-Normkapitel-Abdeckung

| Normkapitel | Thema                           | Modul im Add-on                        |
|------------|----------------------------------|-----------------------------------------|
| 4.1        | Kontext der Organisation         | Organisation & Kontext                   |
| 4.2        | Interessierte Parteien           | Organisation & Kontext                   |
| 4.3        | Anwendungsbereich EnMS           | Organisation & Kontext                   |
| 5.1        | Führung und Verpflichtung        | Energiepolitik & Rollen                  |
| 5.2        | Energiepolitik                   | Energiepolitik & Rollen                  |
| 5.3        | Rollen & Verantwortlichkeiten    | Energiepolitik & Rollen                  |
| 6.1        | Risiken und Chancen              | Risiko-Register                          |
| 6.2        | Ziele & Aktionspläne             | Energieziele & Aktionspläne              |
| 6.3        | Energetische Bewertung           | Energieaudit (SEU, Pareto)               |
| 6.4        | EnPIs                            | EnPI-Dashboard                           |
| 6.5        | Energetische Ausgangsbasis       | Baseline-Management                      |
| 6.6        | Energiedatensammlung             | Zähler-Verwaltung + Datensammlungsplan   |
| 7.1–7.4    | Ressourcen, Kompetenz, Komm.     | Rollen + Dokumentenbibliothek            |
| 7.5        | Dokumentierte Information        | Dokumentenlenkung                        |
| 8.1        | Betriebliche Steuerung           | Verbraucher + Betriebsdaten              |
| 8.2        | Auslegung                        | Dokumentierte Information (Beschaffung)  |
| 8.3        | Beschaffung                      | Dokumentierte Information (Beschaffung)  |
| 9.1        | Überwachung & Messung            | Dashboard, Diagramme, Anomalien          |
| 9.1.2      | Rechtliche Anforderungen         | Rechtskataster                           |
| 9.2        | Internes Audit                   | Audit-Planung & Befunde-Tracker          |
| 9.3        | Managementbewertung              | Management Review                        |
| 10.1       | Nichtkonformitäten & CAPA        | CAPA-Tracker                             |
| 10.2       | Fortlaufende Verbesserung        | Ziele + Maßnahmen + KVP-Nachweis         |

---

## 6. API-Design & Backend-Architektur

### 6.0 Backend-Design-Richtlinien

#### API-Konventionen

**RESTful-Prinzipien:**
- Versionierung: Alle Endpunkte unter `/api/v1/`
- Ressourcen-Orientierung: Substantive im Plural (`/meters`, `/readings`, `/consumers`)
- HTTP-Methoden: GET (Lesen), POST (Erstellen), PUT (Vollständig aktualisieren), PATCH (Teilaktualisierung), DELETE (Löschen)
- Statuscode-Verwendung: 200 (OK), 201 (Created), 204 (No Content), 400 (Bad Request), 404 (Not Found), 409 (Conflict), 422 (Unprocessable Entity), 500 (Internal Server Error)

**Request/Response-Format:**
- Content-Type: `application/json` für alle Endpunkte (außer Datei-Upload: `multipart/form-data`)
- Datumsformat: ISO 8601 (`2025-03-16T14:30:00Z`)
- Dezimalzahlen: Als String übertragen um Präzisionsverlust zu vermeiden (`"1245.7"` statt `1245.7`)
- Locale-unabhängig: Punkt als Dezimaltrennzeichen, keine Tausendertrennzeichen in der API
- Alle Zeitstempel in UTC, Frontend konvertiert in lokale Zeit

**Pagination:**
```json
GET /api/v1/meters?page=1&per_page=25&sort=name&order=asc

{
  "items": [...],
  "total": 142,
  "page": 1,
  "per_page": 25,
  "pages": 6
}
```

**Filterung:**
```
GET /api/v1/meters?energy_type=ELECTRICITY&location=EG&is_active=true
GET /api/v1/readings?meter_id=uuid&from=2025-01-01&to=2025-12-31
GET /api/v1/co2/balance?period_start=2025-01-01&period_end=2025-12-31&group_by=energy_type
```

**Fehler-Responses:**
```json
{
  "detail": "Zählerstand ist unplausibel: Wert 50.000 kWh liegt > 3σ über dem Mittelwert.",
  "error_code": "READING_IMPLAUSIBLE",
  "field": "value",
  "context": {
    "mean": 1200,
    "std_dev": 150,
    "threshold": 1650
  }
}
```

**WebSocket-Nachrichten:**
```json
{
  "type": "meter_update",
  "meter_id": "uuid",
  "data": {
    "value": 1245.7,
    "unit": "kWh",
    "power_w": 4820,
    "timestamp": "2025-03-16T14:30:00Z"
  }
}
```

#### Backend-Architektur-Muster

**Service-Layer-Pattern:**
```
API-Router (dünn, nur Validierung + Response-Mapping)
    ↓
Service (Business-Logik, Orchestrierung)
    ↓
Repository / ORM (Datenzugriff)
```

- Router-Funktionen: Maximal 10–15 Zeilen, delegieren sofort an Services
- Services: Enthält die gesamte Business-Logik, ist unabhängig von HTTP-Kontexten testbar
- Dependency Injection: Über FastAPI `Depends()` für DB-Sessions, Services, Auth

**Async-First:**
- Alle Datenbankzugriffe über `async/await` mit SQLAlchemy 2.x AsyncSession
- Alle externen API-Aufrufe über `httpx.AsyncClient`
- Keine blockierenden I/O-Aufrufe im Hauptthread
- Hintergrund-Tasks (PDF-Generierung, Bulk-Imports, Wetterdaten-Sync) über Celery

**Datenbank-Konventionen:**
- UUIDs als Primärschlüssel (kein Auto-Increment)
- `created_at` und `updated_at` auf allen Tabellen (automatisch via SQLAlchemy-Events)
- Soft-Delete über `is_active`-Flag, kein physisches Löschen von Zählern/Verbrauchern
- Indizes auf: `meter_id + timestamp` (Readings), `energy_type` (Meters), `period_start + period_end` (Summaries)
- JSON-Felder für flexible Konfigurationen (`source_config`, `tariff_info`, `style_config`)

**Seed-Daten:**
- Beim ersten Start des Add-ons automatisch geladen aus `backend/seed_data/`
- BAFA CO₂-Faktoren, UBA Strommix-Zeitreihe, DWD-Wetterstationen
- Idempotent: Wiederholtes Laden überschreibt nicht, aktualisiert nur fehlende Einträge

**Logging:**
```python
# Strukturiertes JSON-Logging
import structlog
logger = structlog.get_logger()

logger.info("meter_reading_created",
    meter_id=str(meter.id),
    value=reading.value,
    source=reading.source,
    quality=reading.quality
)
```

**Fehlerbehandlung:**
- Custom Exceptions: `MeterNotFoundException`, `ReadingImplausibleError`, `ImportDuplicateError`
- Zentraler Exception-Handler in FastAPI: Konvertiert Exceptions in einheitliche Error-Responses
- Externe API-Fehler (Bright Sky, Electricity Maps): Graceful Degradation mit Fallback auf gecachte Daten

### 6.1 API-Endpunkte

#### Zähler
```
GET    /api/v1/meters                    # Liste aller Zähler (Filter, Pagination)
POST   /api/v1/meters                    # Neuen Zähler anlegen
GET    /api/v1/meters/{id}               # Zähler-Details
PUT    /api/v1/meters/{id}               # Zähler bearbeiten
DELETE /api/v1/meters/{id}               # Zähler löschen
GET    /api/v1/meters/{id}/readings      # Ablesungen eines Zählers
GET    /api/v1/meters/{id}/consumption   # Berechneter Verbrauch (Zeitraum)
GET    /api/v1/meters/tree               # Hierarchische Baumstruktur
```

#### Zählerstände
```
POST   /api/v1/readings                  # Einzelnen Zählerstand erfassen
POST   /api/v1/readings/bulk             # Mehrere Zählerstände (Monatsabrechnung)
POST   /api/v1/readings/import           # Datei-Import (CSV/XLSX/JSON)
GET    /api/v1/readings/import/{batch_id} # Import-Status
DELETE /api/v1/readings/import/{batch_id} # Import rückgängig machen
```

#### Verbraucher
```
GET    /api/v1/consumers                 # Liste aller Verbraucher
POST   /api/v1/consumers                 # Verbraucher anlegen
PUT    /api/v1/consumers/{id}            # Verbraucher bearbeiten
DELETE /api/v1/consumers/{id}            # Verbraucher löschen
POST   /api/v1/consumers/{id}/meters     # Zähler zuordnen
```

#### Schema
```
GET    /api/v1/schemas                   # Alle Schemas
POST   /api/v1/schemas                   # Neues Schema
GET    /api/v1/schemas/{id}              # Schema mit Positionen
PUT    /api/v1/schemas/{id}              # Schema aktualisieren
PUT    /api/v1/schemas/{id}/positions    # Positionen aktualisieren (Drag & Drop Speichern)
POST   /api/v1/schemas/{id}/export       # Export als SVG/PNG
```

#### Home Assistant Entities
```
GET    /api/v1/ha/entities                          # Alle verfügbaren HA-Entities
GET    /api/v1/ha/entities?device_class=energy       # Gefiltert nach device_class
GET    /api/v1/ha/entities?search=büro               # Suche nach Name/ID/Area
GET    /api/v1/ha/entities/{entity_id}/history        # History-Daten einer Entity
POST   /api/v1/ha/entities/{entity_id}/subscribe      # WebSocket-Subscription starten
```

#### Wetterdaten
```
GET    /api/v1/weather/stations                     # Alle Wetterstationen
POST   /api/v1/weather/stations                     # Station hinzufügen
GET    /api/v1/weather/stations/{id}/data            # Wetterdaten einer Station (Zeitraum)
GET    /api/v1/weather/stations/{id}/degree-days     # Gradtagszahlen (monatlich)
POST   /api/v1/weather/stations/{id}/sync            # Manuellen Sync auslösen
POST   /api/v1/weather/import                        # Manueller Wetterdaten-Import
GET    /api/v1/weather/correction/{meter_id}         # Witterungskorrigierte Werte eines Zählers
PUT    /api/v1/weather/correction/{meter_id}/config   # Korrektur-Konfiguration ändern
GET    /api/v1/weather/nearest?lat={lat}&lon={lon}   # Nächste Wetterstation finden
```

#### CO₂-Emissionen
```
GET    /api/v1/co2/factors                          # Alle Emissionsfaktoren (Filter: Energietyp, Jahr, Quelle)
POST   /api/v1/co2/factors                          # Faktor manuell anlegen
PUT    /api/v1/co2/factors/{id}                     # Faktor bearbeiten
GET    /api/v1/co2/factors/current/{energy_type}     # Aktuell gültiger Faktor für Energietyp
GET    /api/v1/co2/balance                           # CO₂-Gesamtbilanz (Zeitraum, gruppiert nach Energietyp)
GET    /api/v1/co2/balance/{meter_id}                # CO₂-Bilanz eines Zählers
GET    /api/v1/co2/timeseries                        # CO₂-Emissionen als Zeitreihe
GET    /api/v1/co2/realtime                          # Aktuelle CO₂-Intensität des Stromnetzes (Electricity Maps)
POST   /api/v1/co2/recalculate                       # Neuberechnung aller CO₂-Werte (z.B. nach Faktor-Update)
GET    /api/v1/co2/export                            # CSV-Export der CO₂-Bilanz
```

#### Klimasensoren

#### Auswertungen
```
GET    /api/v1/analytics/timeseries      # Zeitreihendaten (params: meter_ids, from, to, resolution)
GET    /api/v1/analytics/comparison      # Periodenvergleich
GET    /api/v1/analytics/distribution    # Verteilung nach Typ/Standort
GET    /api/v1/analytics/sankey          # Sankey-Daten (Flüsse)
GET    /api/v1/analytics/heatmap         # Heatmap-Daten
GET    /api/v1/analytics/benchmarks      # Benchmarking-KPIs
GET    /api/v1/analytics/anomalies       # Erkannte Anomalien
GET    /api/v1/analytics/weather-corrected  # Witterungsbereinigter Verbrauchsvergleich
GET    /api/v1/analytics/co2-reduction-path # CO₂-Ist vs. Ziel-Pfad
```

#### ISO 50001 Management
```
# Kontext & Anwendungsbereich (Kap. 4)
GET    /api/v1/iso/context                          # Aktueller Organisationskontext
PUT    /api/v1/iso/context                          # Kontext aktualisieren
GET    /api/v1/iso/context/history                   # Versionshistorie

# Energiepolitik (Kap. 5)
GET    /api/v1/iso/policy                            # Aktuelle Energiepolitik
POST   /api/v1/iso/policy                            # Neue Version erstellen
GET    /api/v1/iso/policy/history                     # Alle Versionen

# Rollen (Kap. 5.3)
GET    /api/v1/iso/roles                             # Alle EnMS-Rollen
POST   /api/v1/iso/roles                             # Rolle zuweisen
PUT    /api/v1/iso/roles/{id}                        # Rolle aktualisieren
DELETE /api/v1/iso/roles/{id}                        # Rolle entfernen

# Energieziele & Aktionspläne (Kap. 6.2)
GET    /api/v1/iso/objectives                        # Alle Energieziele
POST   /api/v1/iso/objectives                        # Ziel anlegen
PUT    /api/v1/iso/objectives/{id}                   # Ziel aktualisieren
GET    /api/v1/iso/objectives/{id}/progress           # Automatisch berechneter Fortschritt
GET    /api/v1/iso/action-plans                      # Alle Aktionspläne
POST   /api/v1/iso/action-plans                      # Aktionsplan anlegen
PUT    /api/v1/iso/action-plans/{id}                 # Plan aktualisieren (inkl. Status-Wechsel)
PUT    /api/v1/iso/action-plans/{id}/verify           # Wirksamkeitsprüfung

# Risiken & Chancen (Kap. 6.1)
GET    /api/v1/iso/risks                             # Alle Risiken und Chancen
POST   /api/v1/iso/risks                             # Risiko/Chance anlegen
PUT    /api/v1/iso/risks/{id}                        # Aktualisieren
GET    /api/v1/iso/risks/matrix                      # 5×5-Matrix-Daten

# Rechtliche Anforderungen (Kap. 9.1.2)
GET    /api/v1/iso/legal                             # Rechtskataster
POST   /api/v1/iso/legal                             # Anforderung hinzufügen
PUT    /api/v1/iso/legal/{id}                        # Aktualisieren

# Internes Audit (Kap. 9.2)
GET    /api/v1/iso/audits                            # Alle internen Audits
POST   /api/v1/iso/audits                            # Audit planen
PUT    /api/v1/iso/audits/{id}                       # Audit aktualisieren
GET    /api/v1/iso/audits/{id}/findings               # Befunde eines Audits
POST   /api/v1/iso/audits/{id}/findings               # Befund hinzufügen

# Managementbewertung (Kap. 9.3)
GET    /api/v1/iso/reviews                           # Alle Management Reviews
POST   /api/v1/iso/reviews                           # Review erstellen
GET    /api/v1/iso/reviews/{id}                      # Review-Details
PUT    /api/v1/iso/reviews/{id}                      # Review aktualisieren
GET    /api/v1/iso/reviews/draft                     # Auto-generierter Entwurf mit aktuellen Daten

# Nichtkonformitäten & CAPA (Kap. 10.1)
GET    /api/v1/iso/nonconformities                   # Alle Nichtkonformitäten
POST   /api/v1/iso/nonconformities                   # Nichtkonformität anlegen
PUT    /api/v1/iso/nonconformities/{id}              # Aktualisieren
PUT    /api/v1/iso/nonconformities/{id}/verify        # Wirksamkeitsprüfung

# Dokumentenlenkung (Kap. 7.5)
GET    /api/v1/iso/documents                         # Dokumentenbibliothek (Filter: Typ, Kapitel, Status)
POST   /api/v1/iso/documents                         # Dokument hochladen
PUT    /api/v1/iso/documents/{id}                    # Metadaten aktualisieren
POST   /api/v1/iso/documents/{id}/revision            # Neue Version hochladen
GET    /api/v1/iso/documents/{id}/revisions           # Revisionshistorie
GET    /api/v1/iso/documents/review-due               # Fällige Überprüfungen
```

##### Audit-Berichte
```
POST   /api/v1/reports                   # Bericht generieren (async)
GET    /api/v1/reports                    # Liste aller Berichte
GET    /api/v1/reports/{id}              # Bericht-Details (Online-Ansicht)
GET    /api/v1/reports/{id}/pdf          # PDF herunterladen
DELETE /api/v1/reports/{id}              # Bericht löschen
GET    /api/v1/reports/{id}/status       # Generierungsstatus (Polling)
```

#### Echtzeit
```
WS     /api/v1/ws/live                   # WebSocket für Live-Updates aller aktiven Zähler
WS     /api/v1/ws/meter/{id}            # WebSocket für einzelnen Zähler
```

---

## 7. Projektgedächtnis & Claude Code Konventionen

### 7.1 CLAUDE.md (Projektgedächtnis)

Claude Code liest bei jedem Aufruf automatisch die Datei `CLAUDE.md` im Projektroot. Diese Datei dient als persistentes Gedächtnis und muss von Claude Code bei jedem bedeutsamen Arbeitsschritt aktualisiert werden. So wird vermieden, dass Claude Code bei jeder Session den gesamten Kontext neu aufbauen muss.

**Regel: Nach jedem abgeschlossenen Arbeitsschritt (Feature, Bugfix, Refactoring, Konfigurationsänderung) muss Claude Code die `CLAUDE.md` aktualisieren.**

Die `CLAUDE.md` hat folgende Struktur:

```markdown
# Energy Management Add-on – Projektgedächtnis

## Projektstatus
- **Aktuelle Phase:** Phase 1 – Grundgerüst
- **Letzter Meilenstein:** [Beschreibung + Datum]
- **Nächster Schritt:** [Konkreter nächster Task]
- **Bekannte Blocker:** [Falls vorhanden]

## Architektur-Entscheidungen
<!-- Hier dokumentiert Claude Code getroffene Architektur-Entscheidungen mit Begründung -->
- [Datum] Entscheidung: SQLite statt PostgreSQL für v1.0, weil ...
- [Datum] Entscheidung: React Flow für Schema-Editor statt dnd-kit, weil ...

## Abgeschlossene Features
<!-- Chronologische Liste aller implementierten Features mit Kurzstatus -->
- [ ] HA Add-on Boilerplate (Dockerfile, config.yaml, run.sh)
- [ ] FastAPI Backend mit DB-Anbindung
- [ ] Alembic Migrationen Setup
- [ ] Datenmodelle: Meter, MeterReading, Consumer
- [ ] CRUD-API Zähler
- [ ] CRUD-API Verbraucher
- [ ] React Frontend Grundstruktur
- [ ] Zähler-Verwaltung UI
- [ ] Seed-Daten (BAFA, UBA, DWD)
- [ ] Manuelle Zählerstandeingabe
- [ ] CSV/XLSX-Import
- [ ] HA Entity-Integration
- [ ] Shelly-Integration
- [ ] Modbus-Integration
- [ ] KNX-Integration
- [ ] Bright Sky API Client
- [ ] DWD Open Data Parser
- [ ] Gradtagszahlen-Berechnung
- [ ] Wetterdaten Auto-Sync
- [ ] Witterungskorrektur-Service
- [ ] Wetterdaten-Frontend
- [ ] CO₂-Faktoren-Verwaltung
- [ ] CO₂-Berechnungs-Service
- [ ] Electricity Maps Integration
- [ ] CO₂-Dashboard
- [ ] Dashboard mit KPIs
- [ ] Zeitreihen/Balken/Kreis-Diagramme
- [ ] Sankey-Diagramm
- [ ] Heatmap & Wasserfall
- [ ] Witterungsbereinigter Vergleich
- [ ] CO₂-Diagramme
- [ ] Schema-Editor Drag & Drop
- [ ] WebSocket Echtzeit
- [ ] Baseline & EnPI
- [ ] Anomalie-Erkennung
- [ ] Audit-Report-Generator
- [ ] PDF-Template-System
- [ ] Online-Berichtsansicht
- [ ] PDF-Generierung (WeasyPrint)
- [ ] Report-Verwaltung
- [ ] Benchmarking
- [ ] CO₂-Export (GHG Protocol)
- [ ] Mehrsprachigkeit (DE/EN)
- [ ] Tests
- [ ] Dokumentation

## Datenbankschema-Version
- **Aktuelle Alembic-Revision:** [Hash]
- **Letzte Migration:** [Beschreibung]

## API-Endpunkte-Status
<!-- Welche Endpunkte sind implementiert und getestet? -->
| Bereich      | Implementiert | Getestet |
|-------------|--------------|----------|
| /meters      | ❌           | ❌       |
| /readings    | ❌           | ❌       |
| /consumers   | ❌           | ❌       |
| /schemas     | ❌           | ❌       |
| /weather     | ❌           | ❌       |
| /co2         | ❌           | ❌       |
| /analytics   | ❌           | ❌       |
| /reports     | ❌           | ❌       |
| /ws          | ❌           | ❌       |

## Frontend-Seiten-Status
| Seite          | Layout | Datenanbindung | Fertig |
|---------------|--------|---------------|--------|
| Dashboard      | ❌     | ❌            | ❌     |
| Meters         | ❌     | ❌            | ❌     |
| Consumers      | ❌     | ❌            | ❌     |
| SchemaEditor   | ❌     | ❌            | ❌     |
| Analytics      | ❌     | ❌            | ❌     |
| WeatherData    | ❌     | ❌            | ❌     |
| CO2Dashboard   | ❌     | ❌            | ❌     |
| Import         | ❌     | ❌            | ❌     |
| ManualEntry    | ❌     | ❌            | ❌     |
| Reports        | ❌     | ❌            | ❌     |

## Abhängigkeiten & Versionen
<!-- Installierte Pakete und Versionen, die relevant für Kompatibilität sind -->
- Python: 3.12.x
- Node: 20.x
- FastAPI: x.x.x
- SQLAlchemy: x.x.x
- React: 18.x
- WeasyPrint: x.x.x

## Offene Probleme & TODOs
<!-- Bekannte Bugs, technische Schulden, offene Fragen -->
- [ ] TODO: ...

## Konventionen
- Backend: Python, FastAPI, async/await, SQLAlchemy 2.x, Pydantic v2
- Frontend: React 18, TypeScript strict, Shadcn/ui, Tailwind CSS
- Tests: pytest (Backend), Vitest (Frontend)
- API: RESTful, Versionierung unter /api/v1/
- Commit-Stil: Conventional Commits (feat:, fix:, docs:, refactor:, test:)
- Dateinamen: snake_case (Python), PascalCase (React-Komponenten)

## Kommentar-Richtlinie (WICHTIG)
Alle Kommentare im Quelltext müssen **anfängerfreundlich** geschrieben sein.
Claude Code soll so kommentieren, als würde ein erfahrener Entwickler einem
Einsteiger den Code erklären. Konkret bedeutet das:

### Python (Backend):
- Jede Datei beginnt mit einem Docstring, der erklärt, WOFÜR die Datei
  zuständig ist und WIE sie im Gesamtsystem verwendet wird
- Jede Klasse hat einen Docstring mit: Was macht sie? Warum gibt es sie?
  Wie wird sie verwendet? Beispiele wo sinnvoll
- Jede Methode/Funktion hat einen Docstring mit: Was tut sie? Welche
  Parameter erwartet sie (mit Erklärung)? Was gibt sie zurück?
- Komplexe Logik (z.B. Gradtagszahlen-Formel, CO₂-Berechnung,
  Berechtigungsauflösung) erhält Schritt-für-Schritt-Kommentare, die
  die Formel oder den Algorithmus in Alltagssprache erklären
- Keine selbstverständlichen Kommentare wie "# Erstelle einen User"
  über `create_user()` — stattdessen erklären WARUM oder WAS BESONDERES

Beispiel:
```python
"""
weather_correction_service.py – Witterungsbereinigung von Heizenergieverbrauch

Dieses Modul korrigiert den gemessenen Heizenergieverbrauch, damit man
Jahre mit unterschiedlich kalten Wintern fair vergleichen kann.

Hintergrund: Ein kalter Winter braucht mehr Heizenergie als ein milder.
Ohne Witterungskorrektur würde ein milder Winter so aussehen, als hätte
man Energie gespart — obwohl der Rückgang nur am Wetter liegt.

Die Korrektur funktioniert über "Gradtagszahlen" (VDI 3807):
- Für jeden Tag wird berechnet, wie viel geheizt werden muss
- Die Summe aller Tage ergibt die Gradtagszahl des Zeitraums
- Ein Referenzwert (langjähriges Mittel) dient als Vergleichsmaßstab
- Der Korrekturfaktor = Referenz-Gradtagszahl / Ist-Gradtagszahl

Wird verwendet von: audit_service.py, analytics_service.py, pdf_service.py
"""

def weather_correct_vdi3807(
    raw_consumption: Decimal,
    actual_hdd: Decimal,
    reference_hdd: Decimal,
    base_load_percent: Decimal = Decimal("0")
) -> tuple[Decimal, Decimal]:
    """
    Berechnet den witterungsbereinigten Verbrauch nach VDI 3807.

    Stell dir vor: Du heizt ein Haus. Im milden Winter (wenig Gradtagszahlen)
    brauchst du wenig Energie. Im kalten Winter (viele Gradtagszahlen) viel.
    Diese Funktion rechnet den Verbrauch so um, als ob jedes Jahr gleich
    kalt gewesen wäre — nämlich so kalt wie im Referenzzeitraum.

    Args:
        raw_consumption: Der tatsächlich gemessene Verbrauch (z.B. 10.000 kWh)
        actual_hdd: Die Gradtagszahlen im Messzeitraum (z.B. 2.800 Gt)
            → Niedrig = milder Winter, Hoch = kalter Winter
        reference_hdd: Die Referenz-Gradtagszahlen (z.B. 3.200 Gt)
            → Langjähriges Mittel, damit alle Jahre vergleichbar werden
        base_load_percent: Anteil des Verbrauchs, der NICHT vom Wetter
            abhängt, in Prozent (z.B. 10% für Warmwasserbereitung)

    Returns:
        Tuple aus (korrigierter_verbrauch, korrekturfaktor)
        → Korrekturfaktor > 1 = milder Winter → korrigierter Verbrauch höher
        → Korrekturfaktor < 1 = kalter Winter → korrigierter Verbrauch niedriger

    Beispiel:
        Milder Winter: 10.000 kWh × (3.200/2.800) = 11.429 kWh (korrigiert höher)
        Kalter Winter: 10.000 kWh × (3.200/3.600) = 8.889 kWh (korrigiert niedriger)
    """
    # Sicherheit: Wenn keine Heizgradtage vorhanden sind (z.B. Sommer),
    # kann nicht korrigiert werden → Rohwert zurückgeben
    if actual_hdd == 0:
        return raw_consumption, Decimal("1.0")

    # Schritt 1: Grundlast abtrennen
    # Grundlast ist der Teil, der immer gleich bleibt (z.B. Warmwasser)
    base_load = raw_consumption * base_load_percent / 100

    # Schritt 2: Witterungsabhängigen Anteil berechnen
    # Das ist der Teil, der vom Wetter beeinflusst wird (Heizung)
    weather_dependent = raw_consumption - base_load

    # Schritt 3: Korrekturfaktor berechnen
    # Referenz geteilt durch Ist = wie viel wärmer/kälter als normal
    correction_factor = reference_hdd / actual_hdd

    # Schritt 4: Korrigierten Verbrauch zusammensetzen
    # Grundlast bleibt gleich + witterungsabhängiger Teil wird korrigiert
    corrected = base_load + weather_dependent * correction_factor

    return corrected, correction_factor
```

### TypeScript (Frontend):
- Jede Komponente beginnt mit einem JSDoc-Kommentar: Was zeigt sie an?
  Wo wird sie verwendet? Welche Props erwartet sie?
- Komplexe Hooks erklären den Zweck und das Zusammenspiel mit dem Backend
- State-Variablen bekommen einen kurzen Kommentar, wenn der Name
  allein nicht aussagekräftig genug ist
- Event-Handler erklären, was bei Benutzerinteraktion passiert

Beispiel:
```tsx
/**
 * EntityDropdown – Auswahl von Home Assistant Entities per Dropdown.
 *
 * Zeigt alle verfügbaren HA-Sensoren gruppiert nach Typ (Energie, Temperatur,
 * Leistung etc.) an. Der Benutzer kann nach Name oder Entity-ID suchen.
 * Nach der Auswahl wird eine Vorschau mit dem aktuellen Wert und einer
 * 24-Stunden-Sparkline angezeigt.
 *
 * Wird verwendet im Zähler-Wizard (Schritt 2: Datenquelle) und im
 * Klimasensor-Formular.
 */
```

### SQL/Alembic-Migrationen:
- Jede Migration erhält einen Kommentar, der die Änderung in
  Alltagssprache beschreibt und den Grund für die Änderung erklärt

### CSS/Tailwind:
- Komplexe Layout-Entscheidungen kommentieren (z.B. warum ein
  bestimmtes Grid-Setup gewählt wurde)
```

### 7.2 Unterverzeichnis-Gedächtnisse

Zusätzlich zur Root-`CLAUDE.md` sollen in komplexen Unterverzeichnissen lokale `CLAUDE.md`-Dateien angelegt werden, die verzeichnisspezifischen Kontext liefern:

```
energy-management-addon/
├── CLAUDE.md                            # Haupt-Projektgedächtnis (siehe oben)
├── backend/
│   └── CLAUDE.md                        # Backend-spezifisch: DB-Schema, Service-Logik, API-Patterns
├── backend/app/integrations/
│   └── CLAUDE.md                        # Integrations-spezifisch: Protokoll-Details, Polling-Logik
├── backend/app/audit/
│   └── CLAUDE.md                        # Audit-spezifisch: Template-Struktur, PDF-Rendering-Hinweise
├── frontend/
│   └── CLAUDE.md                        # Frontend-spezifisch: Komponentenstruktur, State-Management
└── frontend/src/components/schema-editor/
    └── CLAUDE.md                        # Schema-Editor: Canvas-Logik, dnd-kit-Patterns
```

**Inhalt der Unterverzeichnis-`CLAUDE.md`:**
- Verantwortlichkeit des Verzeichnisses
- Wichtige Patterns und Konventionen (z.B. „Alle Services nutzen async/await mit Dependency Injection über FastAPI Depends")
- Zusammenhänge mit anderen Modulen (z.B. „Der CO₂-Service wird vom Audit-Generator und vom Analytics-Service aufgerufen")
- Bekannte Einschränkungen oder Workarounds
- Testabdeckung und -status

### 7.3 Update-Regeln für Claude Code

Claude Code muss die `CLAUDE.md` in folgenden Situationen aktualisieren:

1. **Feature abgeschlossen:** Checkbox auf `[x]` setzen, Datum ergänzen
2. **Neue Architektur-Entscheidung:** Unter „Architektur-Entscheidungen" dokumentieren mit Begründung
3. **Datenbank-Migration:** Alembic-Revision und Beschreibung aktualisieren
4. **API-Endpunkt implementiert:** Tabelle aktualisieren (Implementiert ✅, Getestet ✅)
5. **Frontend-Seite fertig:** Tabelle aktualisieren
6. **Neues Problem entdeckt:** Unter „Offene Probleme" eintragen
7. **Abhängigkeit installiert/aktualisiert:** Version in der Abhängigkeitsliste ergänzen
8. **Phase gewechselt:** Projektstatus aktualisieren, nächsten Schritt definieren

### 7.4 Session-Kontext

Zu Beginn jeder Claude-Code-Session soll Claude Code folgende Schritte ausführen:

1. `CLAUDE.md` im Projektroot lesen
2. Relevante Unterverzeichnis-`CLAUDE.md` lesen (je nach Aufgabe)
3. Aktuellen Projektstatus und nächsten Schritt identifizieren
4. Nahtlos dort weitermachen, wo die letzte Session aufgehört hat
5. Am Ende der Session alle `CLAUDE.md`-Dateien aktualisieren

### 7.5 Projekteinstellungen (.claude/settings.json)

Die Datei `.claude/settings.json` wird ins Repository committed und definiert Berechtigungen, Hooks, Umgebungsvariablen und Tool-Konfigurationen für alle Teammitglieder. Persönliche Abweichungen gehören in `.claude/settings.local.json` (auto-gitignored).

```json
{
  "permissions": {
    "allow": [
      "Read",
      "Edit",
      "MultiEdit",
      "Write",
      "Glob",
      "Grep",
      "LS",
      "Task",
      "WebFetch",
      "WebSearch",

      "Bash(python:*)",
      "Bash(pip:*)",
      "Bash(uv:*)",
      "Bash(poetry:*)",
      "Bash(alembic:*)",
      "Bash(pytest:*)",
      "Bash(mypy:*)",
      "Bash(ruff:*)",
      "Bash(black:*)",

      "Bash(node:*)",
      "Bash(npm:*)",
      "Bash(npx:*)",
      "Bash(pnpm:*)",
      "Bash(vite:*)",
      "Bash(tsc:*)",
      "Bash(vitest:*)",
      "Bash(eslint:*)",

      "Bash(git:*)",
      "Bash(docker:*)",
      "Bash(docker-compose:*)",
      "Bash(cat:*)",
      "Bash(head:*)",
      "Bash(tail:*)",
      "Bash(wc:*)",
      "Bash(find:*)",
      "Bash(sort:*)",
      "Bash(jq:*)",
      "Bash(curl:*)",
      "Bash(wget:*)",
      "Bash(mkdir:*)",
      "Bash(cp:*)",
      "Bash(mv:*)",
      "Bash(chmod:*)"
    ],
    "deny": [
      "Read(**/.env)",
      "Read(**/.env.*)",
      "Read(**/secrets/**)",
      "Read(**/*.key)",
      "Read(**/*.pem)",
      "Read(**/*.p12)",
      "Write(**/.env)",
      "Write(**/.env.*)",
      "Write(**/secrets/**)",

      "Bash(rm -rf:*)",
      "Bash(sudo:*)",
      "Bash(su:*)",
      "Bash(ssh:*)",
      "Bash(scp:*)",
      "Bash(shutdown:*)",
      "Bash(reboot:*)",
      "Bash(systemctl:*)",
      "Bash(kill -9:*)"
    ]
  },
  "hooks": [
    {
      "event": "PostToolUse",
      "matcher": "Edit|Write|MultiEdit",
      "hooks": [
        {
          "type": "command",
          "command": "if [[ \"$CLAUDE_FILE_PATHS\" =~ \\.(py)$ ]]; then ruff check --fix \"$CLAUDE_FILE_PATHS\" 2>/dev/null && ruff format \"$CLAUDE_FILE_PATHS\" 2>/dev/null && echo '{\"feedback\": \"Python-Linting und Formatierung angewendet.\", \"suppressOutput\": true}'; fi"
        },
        {
          "type": "command",
          "command": "if [[ \"$CLAUDE_FILE_PATHS\" =~ \\.(ts|tsx)$ ]]; then npx prettier --write \"$CLAUDE_FILE_PATHS\" 2>/dev/null && echo '{\"feedback\": \"TypeScript-Formatierung angewendet.\", \"suppressOutput\": true}'; fi"
        }
      ]
    },
    {
      "event": "PostToolUse",
      "matcher": "Edit|Write|MultiEdit",
      "hooks": [
        {
          "type": "command",
          "command": "if [[ \"$CLAUDE_FILE_PATHS\" =~ \\.(ts|tsx)$ ]]; then npx tsc --noEmit --skipLibCheck 2>&1 | head -20 || echo '{\"feedback\": \"⚠️ TypeScript-Fehler erkannt – bitte prüfen.\"}'; fi"
        }
      ]
    },
    {
      "event": "PreToolUse",
      "matcher": "Bash",
      "hooks": [
        {
          "type": "command",
          "command": "input=$(cat); cmd=$(echo \"$input\" | jq -r '.tool_input.command // empty'); if echo \"$cmd\" | grep -qE 'rm\\s+-rf\\s+/'; then echo '{\"error\": \"Destruktiver Befehl auf Root blockiert. Nutze spezifischere Pfade.\"}'; exit 2; fi"
        }
      ]
    },
    {
      "event": "Stop",
      "hooks": [
        {
          "type": "command",
          "command": "echo '{\"feedback\": \"Vergiss nicht, die CLAUDE.md zu aktualisieren, falls du Features abgeschlossen oder Architektur-Entscheidungen getroffen hast.\"}'"
        }
      ]
    }
  ],
  "env": {
    "BASH_DEFAULT_TIMEOUT_MS": "30000",
    "CLAUDE_CODE_MAX_OUTPUT_TOKENS": "16384",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONUNBUFFERED": "1"
  }
}
```

**Erklärung der Konfigurationsbereiche:**

**Permissions (allow/deny):** Definiert, welche Tools und Bash-Befehle Claude Code ohne Rückfrage ausführen darf. Erlaubt sind alle Standard-Entwicklungswerkzeuge (Python, Node, Git, Docker, Linting, Testing). Blockiert sind destruktive Systembefehle (`rm -rf`, `sudo`, `shutdown`) sowie der Zugriff auf `.env`-Dateien, Secrets und private Schlüssel. Die Deny-Regeln haben Vorrang vor Allow-Regeln.

**Hooks:** Automatisierte Skripte, die vor oder nach Tool-Ausführungen laufen:
- `PostToolUse` nach Dateiänderungen: Python-Dateien werden automatisch mit `ruff` gelinted und formatiert, TypeScript-Dateien mit `prettier` formatiert und mit `tsc` typgeprüft.
- `PreToolUse` vor Bash-Befehlen: Blockiert destruktive `rm -rf /`-Befehle bevor sie ausgeführt werden.
- `Stop` am Ende einer Antwort: Erinnert Claude Code daran, die `CLAUDE.md` zu aktualisieren.

**Environment-Variablen (env):** Bash-Timeout auf 30 Sekunden, maximale Ausgabe-Token auf 16384, Python-Bytecode-Generierung deaktiviert für sauberes Arbeitsverzeichnis.

### 7.6 Lokale Einstellungen (.claude/settings.local.json)

Für persönliche API-Keys und maschinenspezifische Konfigurationen, die **nicht** committed werden:

```json
{
  "env": {
    "ELECTRICITY_MAPS_API_KEY": "em_live_xxxxxxxxxxxxxxxxxxxxxxxx",
    "BRIGHT_SKY_CUSTOM_ENDPOINT": ""
  }
}
```

### 7.7 Custom Slash Commands (.claude/commands/)

Wiederverwendbare Befehle für häufige Aufgaben, als Markdown-Dateien im Verzeichnis `.claude/commands/`:

```
.claude/commands/
├── new-feature.md        # /new-feature – Feature-Entwicklung mit Tests
├── add-meter-type.md     # /add-meter-type – Neuen Zählertyp hinzufügen
├── add-api-endpoint.md   # /add-api-endpoint – Neuen API-Endpunkt erstellen
├── run-tests.md          # /run-tests – Tests ausführen und Ergebnisse zusammenfassen
├── db-migration.md       # /db-migration – Neue Alembic-Migration erstellen
├── update-memory.md      # /update-memory – CLAUDE.md manuell aktualisieren
└── generate-report.md    # /generate-report – PDF-Test-Report generieren
```

**Beispiel `.claude/commands/new-feature.md`:**

```markdown
Implementiere das folgende Feature: $ARGUMENTS

Gehe dabei wie folgt vor:
1. Lies die CLAUDE.md und identifiziere den aktuellen Projektstatus
2. Erstelle oder aktualisiere die nötigen Datenmodelle in backend/app/models/
3. Erstelle die Pydantic-Schemas in backend/app/schemas/
4. Implementiere den Service in backend/app/services/
5. Erstelle den API-Router in backend/app/api/v1/
6. Schreibe Tests in backend/tests/
7. Führe die Tests aus: pytest backend/tests/ -v
8. Erstelle die Frontend-Komponenten in frontend/src/components/
9. Binde die API im Frontend an über frontend/src/api/
10. Aktualisiere die CLAUDE.md: Feature-Checkbox abhaken, API-Status aktualisieren
```

**Beispiel `.claude/commands/db-migration.md`:**

```markdown
Erstelle eine neue Alembic-Migration für: $ARGUMENTS

1. Lies die aktuelle Alembic-Revision aus CLAUDE.md
2. Erstelle die Migration: cd backend && alembic revision --autogenerate -m "$ARGUMENTS"
3. Prüfe die generierte Migration auf Korrektheit
4. Führe die Migration aus: alembic upgrade head
5. Aktualisiere die CLAUDE.md mit der neuen Revision
```

### 7.8 MCP-Server-Konfiguration (.mcp.json)

Optionale MCP-Server für erweiterte Funktionalität, im Projektroot committed:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "./"]
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "POSTGRES_CONNECTION_STRING": "postgresql://energy:energy@localhost:5432/energy_management"
      }
    }
  }
}
```

---

## 8. Projektstruktur

```
energy-management-addon/
├── CLAUDE.md                            # Projektgedächtnis (Hauptdatei)
├── .mcp.json                            # MCP-Server-Konfiguration (committed)
├── config.yaml                          # HA Add-on Konfiguration
├── Dockerfile                           # Multi-stage Build
├── docker-compose.dev.yml               # Lokale Entwicklungsumgebung
├── run.sh                               # Entrypoint-Script
├── .claude/
│   ├── settings.json                    # Projekteinstellungen (committed)
│   ├── settings.local.json              # Lokale Einstellungen (gitignored)
│   ├── commands/                        # Custom Slash Commands
│   │   ├── new-feature.md
│   │   ├── add-meter-type.md
│   │   ├── add-api-endpoint.md
│   │   ├── run-tests.md
│   │   ├── db-migration.md
│   │   ├── update-memory.md
│   │   └── generate-report.md
│   └── agents/                          # Custom Subagents (optional)
│       ├── backend-dev.md               # Spezialisiert auf Backend-Entwicklung
│       └── frontend-dev.md              # Spezialisiert auf Frontend-Entwicklung
│
├── backend/
│   ├── CLAUDE.md                        # Backend-Gedächtnis: DB-Schema, Services, API-Patterns
│   ├── pyproject.toml                   # Python-Abhängigkeiten (Poetry/uv)
│   ├── alembic/                         # Datenbank-Migrationen
│   │   ├── env.py
│   │   └── versions/
│   ├── seed_data/                       # Vorinstallierte Stammdaten
│   │   ├── roles_permissions.json       # Vordefinierte Rollen + Berechtigungsmatrix
│   │   ├── emission_factors_bafa.json   # BAFA CO₂-Faktoren
│   │   ├── emission_factors_uba.json    # UBA Strommix-Zeitreihe 1990–2024
│   │   ├── dwd_stations.json            # DWD-Wetterstationen mit Koordinaten
│   │   └── reference_degree_days.json   # Langjährige Mittelwerte GTZ für DE-Regionen
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                      # FastAPI App-Factory
│   │   ├── config.py                    # Pydantic Settings
│   │   ├── models/                      # SQLAlchemy Models
│   │   │   ├── user.py                  # User, UserSession, AuditLog
│   │   │   ├── role.py                  # Role, Permission, RolePermission, UserPermissionOverride
│   │   │   ├── meter.py
│   │   │   ├── reading.py
│   │   │   ├── consumer.py
│   │   │   ├── schema.py
│   │   │   ├── weather.py               # WeatherStation, WeatherRecord, MonthlyDegreeDays
│   │   │   ├── emission.py              # EmissionFactorSource, EmissionFactor, CO2Calculation
│   │   │   ├── correction.py            # WeatherCorrectionConfig, WeatherCorrectedConsumption
│   │   │   └── report.py
│   │   ├── schemas/                     # Pydantic Request/Response Schemas
│   │   │   ├── meter.py
│   │   │   ├── reading.py
│   │   │   ├── weather.py
│   │   │   ├── emission.py
│   │   │   └── ...
│   │   ├── api/                         # API Router
│   │   │   ├── v1/
│   │   │   │   ├── auth.py              # Login, Logout, Token-Refresh, Passwort
│   │   │   │   ├── users.py             # Benutzerverwaltung (nur Admin)
│   │   │   │   ├── roles.py             # Rollen- und Berechtigungsverwaltung
│   │   │   │   ├── meters.py
│   │   │   │   ├── readings.py
│   │   │   │   ├── consumers.py
│   │   │   │   ├── schemas.py
│   │   │   │   ├── weather.py           # Wetterdaten & Gradtagszahlen
│   │   │   │   ├── co2.py               # CO₂-Faktoren & Bilanz
│   │   │   │   ├── analytics.py
│   │   │   │   ├── reports.py
│   │   │   │   └── websocket.py
│   │   │   └── deps.py                  # Dependency Injection
│   │   ├── services/                    # Business Logic
│   │   │   ├── auth_service.py          # Login, Token-Generierung, Session-Management
│   │   │   ├── permission_service.py    # Berechtigungsprüfung mit Override-Auflösung
│   │   │   ├── user_service.py          # Benutzerverwaltung, Passwort-Management
│   │   │   ├── meter_service.py
│   │   │   ├── reading_service.py
│   │   │   ├── import_service.py
│   │   │   ├── weather_service.py       # Wetterdaten-Abruf & Gradtagszahlen-Berechnung
│   │   │   ├── weather_correction_service.py  # Witterungskorrektur-Berechnungen
│   │   │   ├── co2_service.py           # CO₂-Faktor-Auflösung & Emissions-Berechnung
│   │   │   ├── analytics_service.py
│   │   │   ├── audit_service.py
│   │   │   └── pdf_service.py
│   │   ├── integrations/                # Datenquellen
│   │   │   ├── CLAUDE.md                # Integrations-Gedächtnis: Protokoll-Details, Polling
│   │   │   ├── base.py                  # Abstract Base Class
│   │   │   ├── shelly.py
│   │   │   ├── modbus.py
│   │   │   ├── knx.py
│   │   │   ├── ha_entity.py
│   │   │   ├── bright_sky.py            # Bright Sky API Client
│   │   │   ├── dwd_opendata.py          # DWD Open Data Parser
│   │   │   ├── electricity_maps.py      # Electricity Maps API Client
│   │   │   └── polling_manager.py       # Scheduler für Datenabfragen
│   │   ├── audit/                       # ISO 50001 Audit-Logik
│   │   │   ├── CLAUDE.md                # Audit-Gedächtnis: Template-Struktur, PDF-Rendering
│   │   │   ├── generator.py             # Report-Generator
│   │   │   ├── analysis.py              # Statistische Analysen
│   │   │   ├── baseline.py              # Baseline-Berechnung
│   │   │   ├── enpi.py                  # Energieleistungskennzahlen
│   │   │   ├── co2_report.py            # CO₂-Bilanz für Audit
│   │   │   ├── weather_report.py        # Witterungskorrektur für Audit
│   │   │   └── templates/               # Jinja2-Templates für PDF
│   │   │       ├── base.html
│   │   │       ├── cover.html
│   │   │       ├── toc.html
│   │   │       ├── sections/
│   │   │       │   ├── executive_summary.html
│   │   │       │   ├── energy_balance.html
│   │   │       │   ├── co2_balance.html
│   │   │       │   ├── consumption_analysis.html
│   │   │       │   ├── weather_correction.html
│   │   │       │   ├── seu_analysis.html
│   │   │       │   ├── enpi_dashboard.html
│   │   │       │   ├── trend_analysis.html
│   │   │       │   ├── deviation_analysis.html
│   │   │       │   ├── co2_reduction_path.html
│   │   │       │   ├── measures.html
│   │   │       │   └── appendix.html
│   │   │       ├── components/
│   │   │       │   ├── kpi_card.html
│   │   │       │   ├── chart_container.html
│   │   │       │   ├── data_table.html
│   │   │       │   ├── traffic_light.html
│   │   │       │   ├── comparison_badge.html
│   │   │       │   └── info_box.html
│   │   │       └── styles/
│   │   │           ├── base.css
│   │   │           ├── typography.css
│   │   │           ├── tables.css
│   │   │           ├── charts.css
│   │   │           ├── components.css
│   │   │           └── print.css
│   │   └── core/
│   │       ├── database.py              # DB Session Management
│   │       ├── security.py              # JWT-Handling, Passwort-Hashing, Token-Validierung
│   │       ├── dependencies.py          # get_current_user, require_permission
│   │       ├── exceptions.py
│   │       ├── seed.py                  # Seed-Daten laden (BAFA, UBA, DWD)
│   │       └── utils.py
│   └── tests/
│       ├── conftest.py
│       ├── test_auth.py                 # Login, Token, Session, Passwort-Richtlinien
│       ├── test_permissions.py          # Berechtigungsprüfung, Overrides, Standort-Filter
│       ├── test_users.py                # Benutzerverwaltung CRUD
│       ├── test_meters.py
│       ├── test_readings.py
│       ├── test_imports.py
│       ├── test_weather.py              # Wetterdaten & Gradtagszahlen
│       ├── test_weather_correction.py   # Witterungskorrektur-Berechnung
│       ├── test_co2.py                  # CO₂-Faktoren & Bilanzierung
│       ├── test_analytics.py
│       └── test_audit.py
│
├── frontend/
│   ├── CLAUDE.md                        # Frontend-Gedächtnis: Komponenten, State, Routing
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── api/                         # API Client (axios/fetch wrapper)
│   │   │   ├── client.ts
│   │   │   ├── meters.ts
│   │   │   ├── readings.ts
│   │   │   ├── weather.ts
│   │   │   ├── co2.ts
│   │   │   └── ...
│   │   ├── components/
│   │   │   ├── ui/                      # Shadcn-Basiskomponenten
│   │   │   ├── layout/                  # Header, Sidebar, Navigation
│   │   │   ├── auth/                    # Authentifizierung
│   │   │   │   ├── LoginForm.tsx        # Login-Seite
│   │   │   │   ├── ChangePasswordForm.tsx
│   │   │   │   ├── SetupWizard.tsx      # Ersteinrichtung
│   │   │   │   └── AuthProvider.tsx     # React Context für Auth-State
│   │   │   ├── admin/                   # Benutzerverwaltung (nur Admin)
│   │   │   │   ├── UserList.tsx
│   │   │   │   ├── UserForm.tsx
│   │   │   │   ├── RoleEditor.tsx       # Berechtigungsmatrix-Editor
│   │   │   │   ├── OverrideEditor.tsx   # Grant/Deny-Overrides pro User
│   │   │   │   ├── SessionManager.tsx   # Aktive Sessions
│   │   │   │   └── AuditLogViewer.tsx   # Audit-Log mit Filtern
│   │   │   ├── meters/
│   │   │   │   ├── MeterList.tsx
│   │   │   │   ├── MeterForm.tsx
│   │   │   │   ├── MeterTree.tsx
│   │   │   │   └── MeterDetail.tsx
│   │   │   ├── consumers/
│   │   │   ├── schema-editor/
│   │   │   │   ├── CLAUDE.md            # Schema-Editor-Gedächtnis: Canvas-Logik, dnd-kit
│   │   │   │   ├── Canvas.tsx
│   │   │   │   ├── Toolbox.tsx
│   │   │   │   ├── MeterNode.tsx
│   │   │   │   ├── ConsumerNode.tsx
│   │   │   │   ├── ConnectionLine.tsx
│   │   │   │   └── SchemaEditor.tsx
│   │   │   ├── charts/
│   │   │   │   ├── TimeSeriesChart.tsx
│   │   │   │   ├── BarComparisonChart.tsx
│   │   │   │   ├── PieChart.tsx
│   │   │   │   ├── SankeyDiagram.tsx
│   │   │   │   ├── HeatmapChart.tsx
│   │   │   │   ├── WaterfallChart.tsx
│   │   │   │   └── CO2TimelineChart.tsx
│   │   │   ├── weather/                 # Wetterdaten-Verwaltung
│   │   │   │   ├── StationMap.tsx
│   │   │   │   ├── DegreeDaysChart.tsx
│   │   │   │   ├── WeatherDataTable.tsx
│   │   │   │   └── CorrectionConfig.tsx
│   │   │   ├── co2/                     # CO₂-Dashboard
│   │   │   │   ├── CO2Summary.tsx
│   │   │   │   ├── CO2Timeline.tsx
│   │   │   │   ├── CO2Distribution.tsx
│   │   │   │   ├── RealtimeIntensity.tsx
│   │   │   │   ├── ScopeBreakdown.tsx
│   │   │   │   └── FactorManager.tsx
│   │   │   ├── climate/                 # Klimasensoren
│   │   │   │   ├── ClimateSensorList.tsx
│   │   │   │   ├── ClimateSensorForm.tsx
│   │   │   │   ├── ComfortScoreGauge.tsx
│   │   │   │   ├── TemperatureHumidityChart.tsx
│   │   │   │   └── CorrelationChart.tsx
│   │   │   ├── ha-entity-picker/        # HA-Entity-Dropdown-Komponente
│   │   │   │   ├── EntityDropdown.tsx   # Dropdown mit Suche, Filter, Gruppierung
│   │   │   │   ├── EntitySearch.tsx     # Autovervollständigung mit Debounce
│   │   │   │   ├── EntityPreview.tsx    # Vorschau: Wert, Sparkline, Area
│   │   │   │   └── EntityPicker.tsx     # Wrapper: Dropdown + Vorschau + Bestätigung
│   │   │   ├── import/
│   │   │   │   ├── FileUpload.tsx
│   │   │   │   ├── ColumnMapper.tsx
│   │   │   │   ├── PreviewTable.tsx
│   │   │   │   └── ImportWizard.tsx
│   │   │   ├── readings/
│   │   │   │   ├── SingleReading.tsx
│   │   │   │   ├── MonthlyBilling.tsx
│   │   │   │   └── ReadingSchedule.tsx
│   │   │   └── reports/
│   │   │       ├── ReportList.tsx
│   │   │       ├── ReportViewer.tsx
│   │   │       └── ReportGenerator.tsx
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Meters.tsx
│   │   │   ├── Consumers.tsx
│   │   │   ├── SchemaPage.tsx
│   │   │   ├── Analytics.tsx
│   │   │   ├── WeatherData.tsx
│   │   │   ├── CO2Dashboard.tsx
│   │   │   ├── ClimateSensors.tsx
│   │   │   ├── Import.tsx
│   │   │   ├── ManualEntry.tsx
│   │   │   └── Reports.tsx
│   │   ├── hooks/
│   │   │   ├── useMeterData.ts
│   │   │   ├── useWebSocket.ts
│   │   │   ├── useWeather.ts
│   │   │   ├── useCO2.ts
│   │   │   └── useAnalytics.ts
│   │   ├── store/
│   │   │   ├── meterStore.ts
│   │   │   ├── schemaStore.ts
│   │   │   ├── weatherStore.ts
│   │   │   ├── co2Store.ts
│   │   │   └── uiStore.ts
│   │   ├── types/
│   │   │   ├── meter.ts
│   │   │   ├── reading.ts
│   │   │   ├── consumer.ts
│   │   │   ├── weather.ts
│   │   │   ├── emission.ts
│   │   │   └── api.ts
│   │   └── utils/
│   │       ├── formatters.ts            # Zahlen, Daten, Einheiten
│   │       └── constants.ts
│   └── public/
│       └── icons/                       # Energietyp-Icons
│
└── docs/
    ├── ARCHITECTURE.md
    ├── API.md
    ├── DEVELOPMENT.md
    └── USER_GUIDE.md
```

---

## 8. PDF-Template-Design

### 9.1 Technologie-Basis
- **Rendering:** WeasyPrint (HTML/CSS → PDF)
- **Templating:** Jinja2 mit Template-Inheritance (`{% extends %}`, `{% block %}`, `{% include %}`)
- **Diagramme:** Matplotlib/Plotly → SVG inline oder Base64-PNG eingebettet
- **Seitenformat:** DIN A4 Hochformat (210 × 297 mm), Querformat optional für breite Diagramme

### 9.2 Design-System

#### Farbpalette

```css
:root {
  /* Primärfarben */
  --color-primary:        #1B5E7B;   /* Dunkles Petrol */
  --color-primary-light:  #2A8CB5;
  --color-primary-bg:     #E8F4F8;

  /* Energietyp-Farben */
  --color-electricity:    #F59E0B;   /* Amber/Gelb */
  --color-gas:            #EF6C00;   /* Orange */
  --color-water:          #2196F3;   /* Blau */
  --color-heat:           #E53935;   /* Rot */
  --color-cooling:        #00BCD4;   /* Cyan */
  --color-compressed-air: #8E24AA;   /* Violett */
  --color-steam:          #78909C;   /* Blaugrau */

  /* Bewertungs-Ampel */
  --color-positive:       #16A34A;   /* Grün */
  --color-warning:        #D97706;   /* Amber */
  --color-negative:       #DC2626;   /* Rot */

  /* Neutraltöne */
  --color-text:           #1F2937;
  --color-text-secondary: #6B7280;
  --color-border:         #D1D5DB;
  --color-bg-light:       #F9FAFB;
}
```

#### Typografie

```css
--font-heading:  'Inter', 'Helvetica Neue', Arial, sans-serif;
--font-body:     'Inter', 'Helvetica Neue', Arial, sans-serif;
--font-mono:     'JetBrains Mono', 'Fira Code', monospace;

--fs-cover-title:    28pt;
--fs-cover-subtitle: 16pt;
--fs-h1:             18pt;
--fs-h2:             14pt;
--fs-h3:             12pt;
--fs-body:           10pt;
--fs-small:           8pt;
--fs-table:           9pt;
--fs-kpi-value:      24pt;
--fs-kpi-label:       9pt;
```

#### Seitenränder & Kopf-/Fußzeilen

```css
@page {
  size: A4;
  margin: 25mm 20mm 30mm 25mm;   /* Oben, Rechts, Unten, Links (Binderand) */

  @top-right { content: string(chapter-title); font-size: 8pt; color: var(--color-text-secondary); }
  @bottom-left { content: "Vertraulich – {{ report.company_name }}"; font-size: 7pt; }
  @bottom-center { content: "Energiebericht {{ report.period }}"; font-size: 7pt; }
  @bottom-right { content: "Seite " counter(page) " von " counter(pages); font-size: 7pt; }
}

@page cover { margin: 0; /* Deckblatt ohne Kopf-/Fußzeile */ }
@page landscape { size: A4 landscape; }
```

### 9.3 Seitenreihenfolge im Dokument

```
1.  Deckblatt
2.  Inhaltsverzeichnis
3.  Management-Zusammenfassung (KPI-Kacheln: Verbrauch, Kosten, CO₂ je Energietyp + Trends)
4.  Energiebilanz (Sankey + Tabelle + Kreis-/Balkendiagramm)
5.  CO₂-Bilanz (Emissionen nach Energieträger, Scope-Aufschlüsselung, Trend, Reduktionspfad)
6.  Witterungskorrektur (Gradtagszahlen-Vergleich, Roh vs. korrigierter Verbrauch, Methodik-Erklärung)
7.  Verbrauchsanalyse (Zeitliche Entwicklung, Standortvergleich)
8.  Wesentliche Energieverbraucher – SEU (Pareto-Analyse 80/20)
9.  Energieleistungskennzahlen – EnPI (kWh/m², kg CO₂/m², kWh/Stück, Gauge-Diagramme)
10. Trendanalyse (36-Monats-Verlauf witterungsbereinigt + Baseline)
11. Abweichungsanalyse Soll/Ist (witterungsbereinigt)
12. CO₂-Reduktionspfad (Ist vs. Ziel, Meilensteine, Prognose)
13. Maßnahmen & Einsparpotenziale (Tabelle mit Ampel-ROI, Wasserfall-Diagramm)
14. Anhang (Rohdaten, Emissionsfaktor-Quellen, Gradtagszahlen-Tabellen, Methodik)
```

### 9.4 Wiederverwendbare Jinja2-Komponenten

- **kpi_card.html:** KPI-Kachel mit Wert, Einheit, Energietyp-Farbe, Trend-Badge
- **chart_container.html:** Diagramm-Wrapper mit Rahmen, Bildunterschrift (`Abb. X.X`)
- **data_table.html:** Tabelle mit Kopfzeile (Primärfarbe), alternierenden Zeilen, Summen-Fußzeile, `font-variant-numeric: tabular-nums` für Zahlen
- **traffic_light.html:** Ampel-Indikator (grün/gelb/rot)
- **comparison_badge.html:** Trend-Badge (↑ +5% / ↓ -3%) mit Farbkodierung
- **info_box.html:** Hinweis-/Warnbox mit farbigem linken Rand (info/warning/success/critical)

### 9.5 Diagramm-Rendering

- **Format:** SVG bevorzugt (Vektorgrafik), PNG als Fallback (min. 300 DPI)
- **Schriftart:** Identisch mit Report-Typografie (Inter)
- **Farben:** Nur aus dem Design-System, keine Bibliotheks-Defaults
- **Rasterlinien:** Dezent, gestrichelt, nur Y-Achse
- **Legende:** Unterhalb des Diagramms, horizontal

**Matplotlib-Stilvorlage:**
```python
REPORT_STYLE = {
    "figure.facecolor": "none", "axes.facecolor": "none",
    "axes.edgecolor": "#D1D5DB", "axes.labelcolor": "#6B7280",
    "axes.grid": True, "axes.grid.axis": "y",
    "grid.color": "#E5E7EB", "grid.linestyle": "--", "grid.linewidth": 0.5,
    "font.family": "sans-serif", "font.sans-serif": ["Inter", "Helvetica Neue", "Arial"],
    "figure.dpi": 300, "savefig.transparent": True,
}
```

### 9.6 Druckregeln

```css
h1 { page-break-before: always; }              /* Kapitel auf neuer Seite */
.chart-container, .kpi-row, figure { page-break-inside: avoid; }
thead { display: table-header-group; }          /* Tabellenköpfe wiederholen */
p { orphans: 3; widows: 3; }
h2, h3 { page-break-after: avoid; }
```

### 9.7 Konfigurierbare Elemente

| Element                  | Konfigurierbar über       |
|--------------------------|---------------------------|
| Firmenlogo               | Bildupload in Settings     |
| Firmenname & Adresse     | Settings                   |
| Primärfarbe              | Color-Picker               |
| Berichtszeitraum         | Report-Generator-Dialog    |
| Enthaltene Kapitel       | Checkbox-Liste             |
| Sprache (DE/EN)          | Dropdown                   |
| Vertraulichkeitsstufe    | Dropdown                   |
| EnPI-Kennzahlen          | Add-on-Konfiguration       |
| Baseline-Referenzjahr    | Add-on-Konfiguration       |
| CO₂-Emissionsfaktor-Quelle | Dropdown pro Energietyp |
| Witterungskorrektur-Methode | Dropdown pro Zähler     |
| Zahlenformat             | Settings                   |

### 9.8 Qualitätskriterien
- Pixel-perfekt: Professionelles Layout, keine generische HTML-Ausgabe
- Konsistenz: Gleiche Abstände, Farben, Schriften auf jeder Seite
- Barrierefreiheit: Alt-Texte für Diagramme, semantisches HTML
- Dateigröße: < 5 MB pro Report (SVG bevorzugen)
- Performance: PDF-Rendering < 30 Sekunden für Jahresbericht mit 50 Zählern

---

## 10. Implementierungsreihenfolge

### Phase 1: Grundgerüst & Authentifizierung (Meilenstein 1)
1. Home Assistant Add-on Boilerplate (Dockerfile, config.yaml, run.sh)
2. FastAPI-Backend mit Datenbankanbindung und Alembic-Setup
3. **Authentifizierung:** User-Model, bcrypt-Hashing, JWT-Token, Login/Logout-API
4. **Ersteinrichtungs-Wizard:** Erster Benutzer wird Admin, erzwungener Passwortwechsel
5. **Rollenbasiertes Rechtemanagement:** Role, Permission, RolePermission, Seed-Daten für 5 Standard-Rollen
6. **Permission-Service:** Berechtigungsprüfung mit Override-Auflösung, `require_permission`-Dependency
7. **Login-Frontend:** Login-Seite, AuthProvider, Token-Management, geschützte Routen
8. Datenmodelle: Meter, MeterReading, Consumer
9. CRUD-API für Zähler und Verbraucher (mit Berechtigungsprüfung)
10. React-Frontend Grundstruktur mit Routing, Layout und rollenbasierter Navigation
11. Zähler-Verwaltung (Liste, Erstellen, Bearbeiten, Löschen)
12. Seed-Daten laden (Rollen, BAFA CO₂-Faktoren, UBA Strommix, DWD-Stationen)
13. **Benutzerverwaltungs-UI** (nur Admin): Benutzerliste, Erstellen, Rollen zuweisen, Override-Editor
14. **Audit-Log:** Protokollierung aller sicherheitsrelevanten Aktionen

### Phase 2: Datenerfassung (Meilenstein 2)
8. Manuelle Zählerstandeingabe (Einzelwert + Monatsabrechnung)
9. CSV/XLSX-Import mit Spalten-Mapper und Vorschau
10. Home Assistant Entity-Integration (Entity-Picker, Live-Daten)
11. Shelly-Integration (Erkennung, Konfiguration, Polling)
12. Modbus-Integration
13. KNX-Integration

### Phase 3: Wetter, Klima & CO₂ (Meilenstein 3)
14. Wetterdaten-Integration: Bright Sky API Client + DWD Open Data Parser
15. Gradtagszahlen-Berechnung (VDI 3807) und monatliche Aggregation
16. Automatischer täglicher Wetterdaten-Sync (Celery-Beat)
17. Witterungskorrektur-Service (VDI 3807 + Regression)
18. Wetterdaten-Frontend: Stations-Verwaltung, Gradtagszahlen-Dashboard
19. Klimasensoren-Modul: Datenmodell, CRUD-API, HA-Entity-Anbindung (Dropdown)
20. Klimasensor-Frontend: Sensorliste, Behaglichkeits-Score, Temperatur-/Feuchte-Charts
21. Korrelationsanalyse: Klima ↔ Energieverbrauch
22. CO₂-Emissionsfaktoren-Verwaltung (CRUD, Seed-Daten, Quellen-Management)
23. CO₂-Berechnungs-Service (Faktor-Auflösung, Verbrauch→Emissionen)
24. Electricity Maps-Integration (Echtzeit-CO₂-Intensität)
25. CO₂-Dashboard: Gesamtbilanz, Zeitreihe, Verteilung, Scope-Aufschlüsselung

### Phase 4: Visualisierung (Meilenstein 4)
23. Dashboard mit KPI-Kacheln (inkl. CO₂) und Übersichtsdiagrammen
24. Zeitreihen-Diagramm und Balkenvergleich
25. Sankey-Diagramm für Energieflüsse
26. Kreisdiagramm, Heatmap, Wasserfall
27. Witterungsbereinigter Verbrauchsvergleich (Roh vs. korrigiert)
28. CO₂-Emissionsverlauf und Reduktionspfad-Chart
29. Schema-Editor mit Drag & Drop (Canvas, Toolbox, Verbindungen)
30. WebSocket-Integration für Echtzeit-Updates

### Phase 5: Audit & Reporting (Meilenstein 5)
31. Baseline-Management und EnPI-Berechnung
32. Automatische Anomalie-Erkennung
33. Audit-Report-Generator (alle Sektionen inkl. CO₂-Bilanz und Witterungskorrektur)
34. PDF-Template-System: base.html + Sektionen + Komponenten + CSS
35. Online-Berichtsansicht (interaktive Webseite)
36. PDF-Generierung mit WeasyPrint (Hintergrund-Task, Fortschrittsanzeige)
37. Report-Verwaltung (Liste, Status, Download, Löschen)

### Phase 6: ISO 50001 – Kontext, Führung & Planung (Meilenstein 6)
38. Organisationskontext (Kap. 4): Anwendungsbereich, interessierte Parteien, interne/externe Themen
39. Energiepolitik (Kap. 5): Dokumentenerstellung, Versionierung, Genehmigungsprozess
40. Rollen & Verantwortlichkeiten (Kap. 5.3): Rollen-Matrix, Organigramm-Ansicht
41. Risiken & Chancen (Kap. 6.1): Risiko-Register, 5×5-Bewertungsmatrix
42. Energieziele & Aktionspläne (Kap. 6.2): Zielmanagement mit automatischer Fortschrittsberechnung, Kanban-Board
43. Rechtliche Anforderungen (Kap. 9.1.2): Rechtskataster mit Compliance-Ampel

### Phase 7: ISO 50001 – Betrieb, Bewertung & Verbesserung (Meilenstein 7)
44. Dokumentenlenkung (Kap. 7.5): Dokumentenbibliothek, Versionierung, Überprüfungserinnerungen
45. Internes Audit (Kap. 9.2): Audit-Planung, Checklisten, Befunde-Tracker
46. Managementbewertung (Kap. 9.3): Automatisch vorausgefüllter Entwurf, Input/Output-Formular
47. Nichtkonformitäten & CAPA (Kap. 10.1): CAPA-Tracker, Ursachenanalyse, Wirksamkeitsprüfung
48. Verknüpfungen: Befunde → Korrekturmaßnahmen → Aktionspläne → Energieziele (durchgängiger Maßnahmen-Workflow)

### Phase 8: Feinschliff & Qualitätssicherung (Meilenstein 8)
49. Benchmarking-Funktionen
50. CO₂-Export für externe Berichterstattung (GHG Protocol, EMAS)
51. Benutzereinstellungen und Konfiguration
52. Mehrsprachigkeit (DE/EN)
53. Umfassende Tests (Unit, Integration, E2E)
54. Dokumentation (Benutzerhandbuch, API-Doku, Architektur)
55. Performance-Optimierung und Caching
56. Barrierefreiheit und responsives Design-Feinschliff

---

## 11. Teststrategie & Selbstüberprüfung

### 11.1 Grundprinzip

**Für jede implementierte Funktion muss ein zugehöriger Test existieren.** Claude Code erstellt Tests nicht nachgelagert, sondern als festen Bestandteil jedes Features (Test-Driven oder Test-Alongside). Kein Feature gilt als abgeschlossen, bevor die Tests grün durchlaufen.

### 11.2 Backend-Tests (pytest)

#### Teststruktur

```
backend/tests/
├── conftest.py                          # Fixtures: DB-Session, TestClient, Mock-HA-API
├── factories.py                         # Factory-Boy-Factories für Testdaten
│
├── unit/                                # Reine Unit-Tests (kein I/O, keine DB)
│   ├── test_weather_correction.py       # Gradtagszahlen-Berechnung, VDI-3807-Formel
│   ├── test_co2_calculation.py          # Emissionsfaktor-Auflösung, kWh→kg CO₂
│   ├── test_degree_days.py              # HDD/CDD-Berechnung aus Temperaturdaten
│   ├── test_dew_point.py                # Taupunktberechnung (Magnus-Formel)
│   ├── test_comfort_score.py            # Behaglichkeits-Score-Berechnung
│   ├── test_consumption_calculation.py  # Verbrauchsberechnung aus Zählerständen
│   ├── test_unit_conversion.py          # m³→kWh (Gas), MWh→kWh, Einheitenumrechnung
│   ├── test_anomaly_detection.py        # Statistische Ausreißer-Erkennung
│   ├── test_pareto_analysis.py          # 80/20-SEU-Identifikation
│   ├── test_enpi_calculation.py         # EnPI-Berechnung (kWh/m², kg CO₂/m²)
│   └── test_plausibility_check.py       # Plausibilitätsprüfung bei manueller Eingabe
│
├── integration/                         # Tests mit DB und Services
│   ├── test_meter_crud.py               # Zähler: Erstellen, Lesen, Aktualisieren, Löschen
│   ├── test_reading_crud.py             # Zählerstände: CRUD + Verbrauchsberechnung
│   ├── test_consumer_crud.py            # Verbraucher: CRUD + Zähler-Zuordnung
│   ├── test_schema_crud.py              # Schema: CRUD + Positionierung
│   ├── test_climate_sensor_crud.py      # Klimasensoren: CRUD + Readings
│   ├── test_weather_service.py          # Wetterdaten: Abruf, Speicherung, Aggregation
│   ├── test_weather_correction_service.py # Witterungskorrektur: End-to-End
│   ├── test_co2_service.py              # CO₂-Bilanz: Faktor-Auflösung, Berechnung, Neuberechnung
│   ├── test_import_service.py           # CSV/XLSX-Import: Parsing, Mapping, Duplikaterkennung
│   ├── test_analytics_service.py        # Auswertungen: Zeitreihen, Vergleiche, Sankey-Daten
│   ├── test_audit_service.py            # Audit-Generierung: Datenaufbereitung, Snapshot
│   └── test_pdf_service.py              # PDF-Rendering: Template-Rendering, WeasyPrint-Ausgabe
│
├── api/                                 # API-Endpunkt-Tests (HTTP-Level)
│   ├── test_api_meters.py               # GET/POST/PUT/DELETE /api/v1/meters
│   ├── test_api_readings.py             # POST /readings, POST /readings/bulk, POST /readings/import
│   ├── test_api_consumers.py
│   ├── test_api_schemas.py
│   ├── test_api_weather.py              # Wetterdaten-Endpunkte
│   ├── test_api_climate.py              # Klimasensor-Endpunkte
│   ├── test_api_co2.py                  # CO₂-Endpunkte
│   ├── test_api_analytics.py
│   ├── test_api_reports.py
│   └── test_api_auth.py                 # HA-Ingress-Token-Validierung
│
├── integration_external/                # Tests gegen externe APIs (mit Mocks)
│   ├── test_bright_sky_client.py        # Bright Sky API: Abruf, Parsing, Fehlerbehandlung
│   ├── test_dwd_parser.py               # DWD Open Data: Datei-Parsing, Gradtagszahlen
│   ├── test_electricity_maps_client.py  # Electricity Maps: API-Abruf, Fehler, Rate-Limiting
│   ├── test_shelly_integration.py       # Shelly: Erkennung, Abruf, Gen1/Gen2
│   ├── test_modbus_integration.py       # Modbus: Register-Lesen, Datentypen, Fehler
│   ├── test_knx_integration.py          # KNX: Gruppenadresse, Wertinterpretation
│   └── test_ha_entity_integration.py    # HA: Entity-Abruf, WebSocket-Subscription, Reconnect
│
└── fixtures/                            # Testdaten-Dateien
    ├── sample_readings.csv
    ├── sample_readings.xlsx
    ├── sample_weather_data.json
    ├── sample_dwd_gradtagszahlen.txt
    ├── sample_ha_states.json            # Mock-Antwort der HA REST API
    ├── sample_bright_sky_response.json
    ├── sample_electricity_maps_response.json
    └── sample_shelly_response.json
```

#### Fixture-Beispiele (conftest.py)

```python
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from app.main import create_app
from app.core.database import Base

@pytest.fixture
async def db_session():
    """In-Memory-SQLite für isolierte Tests."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with AsyncSession(engine) as session:
        yield session
    await engine.dispose()

@pytest.fixture
async def client(db_session):
    """FastAPI TestClient mit Test-DB."""
    app = create_app(db_session_override=db_session)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

@pytest.fixture
def mock_ha_api(httpx_mock):
    """Mock für Home Assistant REST API."""
    httpx_mock.add_response(
        url="http://supervisor/core/api/states",
        json=json.load(open("tests/fixtures/sample_ha_states.json"))
    )
    return httpx_mock

@pytest.fixture
def sample_meter(db_session):
    """Erstellt einen Test-Stromzähler."""
    return MeterFactory(energy_type=EnergyType.ELECTRICITY, unit="kWh")

@pytest.fixture
def sample_climate_sensor(db_session):
    """Erstellt einen Test-Klimasensor."""
    return ClimateSensorFactory(
        sensor_type=ClimateSensorType.TEMPERATURE_HUMIDITY_COMBO,
        target_temp_min=20, target_temp_max=24,
        target_humidity_min=40, target_humidity_max=60
    )
```

#### Beispiel-Tests

```python
# --- Unit-Test: Gradtagszahlen ---
class TestDegreeDayCalculation:
    def test_heating_degree_days_cold_day(self):
        """Kalter Tag: HDD = 20 - 5 = 15"""
        hdd = calculate_heating_degree_days(temp_avg=5.0, indoor_temp=20.0, heating_limit=15.0)
        assert hdd == 15.0

    def test_heating_degree_days_warm_day(self):
        """Warmer Tag über Heizgrenze: HDD = 0"""
        hdd = calculate_heating_degree_days(temp_avg=18.0, indoor_temp=20.0, heating_limit=15.0)
        assert hdd == 0.0

    def test_cooling_degree_days(self):
        """Heißer Tag: CDD = 32 - 24 = 8"""
        cdd = calculate_cooling_degree_days(temp_avg=32.0, cooling_limit=24.0)
        assert cdd == 8.0

# --- Unit-Test: CO₂-Berechnung ---
class TestCO2Calculation:
    def test_electricity_co2(self):
        """1000 kWh Strom × 363 g/kWh = 363 kg CO₂"""
        result = calculate_co2(consumption_kwh=1000, factor_g_per_kwh=363)
        assert result == pytest.approx(363.0, rel=1e-2)

    def test_gas_m3_to_co2(self):
        """100 m³ Gas × 10.3 kWh/m³ × 201 g/kWh = 207.03 kg CO₂"""
        kwh = convert_gas_m3_to_kwh(100, conversion_factor=10.3)
        co2 = calculate_co2(consumption_kwh=kwh, factor_g_per_kwh=201)
        assert co2 == pytest.approx(207.03, rel=1e-2)

    def test_manual_override_factor(self):
        """Manueller Ökostrom-Faktor: 0 g/kWh → 0 kg CO₂"""
        result = calculate_co2(consumption_kwh=5000, factor_g_per_kwh=0)
        assert result == 0.0

# --- Unit-Test: Witterungskorrektur ---
class TestWeatherCorrection:
    def test_vdi3807_mild_winter(self):
        """Milder Winter (weniger HDD) → korrigierter Verbrauch höher als Rohwert."""
        corrected, factor = weather_correct_vdi3807(
            raw_consumption=10000, actual_hdd=2800,
            reference_hdd=3200, base_load_percent=10
        )
        assert corrected > 10000
        assert factor == pytest.approx(3200 / 2800, rel=1e-3)

    def test_vdi3807_harsh_winter(self):
        """Harter Winter (mehr HDD) → korrigierter Verbrauch niedriger."""
        corrected, _ = weather_correct_vdi3807(
            raw_consumption=10000, actual_hdd=3600,
            reference_hdd=3200, base_load_percent=10
        )
        assert corrected < 10000

    def test_vdi3807_zero_hdd(self):
        """Keine Heizgradtage (Sommer) → Rohwert zurück."""
        corrected, factor = weather_correct_vdi3807(
            raw_consumption=500, actual_hdd=0,
            reference_hdd=3200, base_load_percent=10
        )
        assert corrected == 500
        assert factor == 1.0

# --- Unit-Test: Taupunkt ---
class TestDewPoint:
    def test_standard_conditions(self):
        """20°C, 50% RH → Taupunkt ca. 9.3°C"""
        dp = calculate_dew_point(20.0, 50.0)
        assert dp == pytest.approx(9.3, abs=0.2)

    def test_high_humidity(self):
        """25°C, 90% RH → Taupunkt ca. 23.2°C"""
        dp = calculate_dew_point(25.0, 90.0)
        assert dp == pytest.approx(23.2, abs=0.3)

    def test_dew_point_always_below_temperature(self):
        """Taupunkt ist immer ≤ Temperatur."""
        for t in range(-10, 40):
            for rh in range(10, 100, 10):
                dp = calculate_dew_point(float(t), float(rh))
                assert dp <= t

# --- Unit-Test: Behaglichkeits-Score ---
class TestComfortScore:
    def test_perfect_comfort(self):
        """Exakt in der Mitte des Sollbereichs = 100."""
        score = calculate_comfort_score(22.0, 50.0, 20.0, 24.0, 40.0, 60.0)
        assert score == 100

    def test_outside_range(self):
        """Deutlich außerhalb = Score nahe 0."""
        score = calculate_comfort_score(35.0, 90.0, 20.0, 24.0, 40.0, 60.0)
        assert score < 20

# --- Integration-Test: CSV-Import ---
class TestCSVImport:
    async def test_import_valid_csv(self, client, sample_meter):
        """Gültige CSV-Datei wird korrekt importiert."""
        with open("tests/fixtures/sample_readings.csv", "rb") as f:
            response = await client.post(
                "/api/v1/readings/import",
                files={"file": ("readings.csv", f, "text/csv")},
                data={"meter_id": str(sample_meter.id), "date_column": "Datum", "value_column": "Zählerstand"}
            )
        assert response.status_code == 200
        result = response.json()
        assert result["imported_count"] > 0
        assert result["duplicate_count"] == 0

    async def test_import_duplicate_detection(self, client, sample_meter):
        """Doppelter Import erkennt Duplikate."""
        # Erster Import
        # ... (wie oben)
        # Zweiter Import derselben Datei
        # ... assert result["duplicate_count"] > 0

# --- Integration-Test: HA-Entity-Dropdown ---
class TestHAEntityPicker:
    async def test_list_energy_entities(self, client, mock_ha_api):
        """Liefert nur Entities mit passender device_class."""
        response = await client.get("/api/v1/ha/entities?device_class=energy")
        assert response.status_code == 200
        entities = response.json()
        assert all(e["device_class"] == "energy" for e in entities)

    async def test_list_climate_entities(self, client, mock_ha_api):
        """Liefert Temperatur- und Feuchtigkeitssensoren."""
        response = await client.get("/api/v1/ha/entities?device_class=temperature,humidity")
        assert response.status_code == 200
        entities = response.json()
        assert all(e["device_class"] in ["temperature", "humidity"] for e in entities)

    async def test_entity_search(self, client, mock_ha_api):
        """Suchfeld filtert nach Name und Entity-ID."""
        response = await client.get("/api/v1/ha/entities?search=büro")
        assert response.status_code == 200

# --- API-Test: CO₂-Bilanz ---
class TestCO2API:
    async def test_co2_balance(self, client, sample_meter):
        """CO₂-Bilanz enthält berechnete Emissionen."""
        response = await client.get("/api/v1/co2/balance?period_start=2025-01-01&period_end=2025-12-31")
        assert response.status_code == 200
        data = response.json()
        assert "total_co2_kg" in data
        assert "by_energy_type" in data

    async def test_co2_recalculate(self, client):
        """Neuberechnung nach Faktor-Update funktioniert."""
        response = await client.post("/api/v1/co2/recalculate")
        assert response.status_code == 200
```

#### Test-Abdeckungsziele

| Bereich                         | Mindest-Coverage |
|---------------------------------|-----------------|
| Berechnungslogik (Unit)         | 95%             |
| Services (Integration)          | 85%             |
| API-Endpunkte                   | 90%             |
| Externe Integrationen (Mocks)   | 80%             |
| PDF-Generierung                 | 70%             |

### 11.3 Frontend-Tests (Vitest + React Testing Library)

```
frontend/src/__tests__/
├── components/
│   ├── meters/
│   │   ├── MeterList.test.tsx           # Rendering, Filter, Sortierung
│   │   ├── MeterForm.test.tsx           # Validierung, Wizard-Schritte
│   │   └── MeterTree.test.tsx           # Hierarchie-Darstellung
│   ├── ha-entity-picker/
│   │   ├── EntityDropdown.test.tsx       # Dropdown: Laden, Filtern, Auswählen
│   │   ├── EntitySearch.test.tsx         # Autovervollständigung, Debounce
│   │   └── EntityPreview.test.tsx        # Sparkline, aktueller Wert
│   ├── charts/
│   │   ├── TimeSeriesChart.test.tsx      # Rendering mit Testdaten
│   │   ├── SankeyDiagram.test.tsx
│   │   └── CO2TimelineChart.test.tsx
│   ├── weather/
│   │   ├── DegreeDaysChart.test.tsx
│   │   └── CorrectionConfig.test.tsx     # Formular-Validierung
│   ├── co2/
│   │   ├── CO2Summary.test.tsx
│   │   ├── FactorManager.test.tsx        # CRUD, Quellenwechsel
│   │   └── RealtimeIntensity.test.tsx    # Live-Update-Anzeige
│   ├── climate/
│   │   ├── ClimateSensorList.test.tsx
│   │   ├── ComfortScoreGauge.test.tsx
│   │   └── CorrelationChart.test.tsx
│   └── import/
│       ├── ImportWizard.test.tsx          # Wizard-Flow: Upload → Mapping → Vorschau → Import
│       └── ColumnMapper.test.tsx          # Spalten-Zuordnung, Datumsformat-Erkennung
├── hooks/
│   ├── useMeterData.test.ts
│   ├── useWebSocket.test.ts             # Verbindung, Reconnect, Nachrichten
│   └── useCO2.test.ts
└── utils/
    ├── formatters.test.ts               # Zahlenformatierung, Einheitenumrechnung
    └── constants.test.ts
```

### 11.4 E2E-Tests (Playwright, optional Phase 6)

```
e2e/
├── meter-lifecycle.spec.ts              # Zähler anlegen → Werte eingeben → Auswertung
├── csv-import-flow.spec.ts              # Datei hochladen → Mapping → Import → Prüfung
├── report-generation.spec.ts            # Audit konfigurieren → Generieren → PDF-Download
├── ha-entity-binding.spec.ts            # Entity-Dropdown → Auswahl → Live-Wert prüfen
└── schema-editor.spec.ts               # Drag & Drop → Verbinden → Speichern → Neuladen
```

### 11.5 Test-Ausführung & CI

**Befehle (in CLAUDE.md und Slash Commands dokumentiert):**

```bash
# Backend Unit-Tests
cd backend && pytest tests/unit/ -v --tb=short

# Backend Integration-Tests
cd backend && pytest tests/integration/ -v --tb=short

# Backend API-Tests
cd backend && pytest tests/api/ -v --tb=short

# Backend alle Tests mit Coverage
cd backend && pytest --cov=app --cov-report=term-missing --cov-fail-under=85

# Frontend Tests
cd frontend && npx vitest run

# Frontend mit Coverage
cd frontend && npx vitest run --coverage
```

**Claude Code muss nach jedem implementierten Feature die zugehörigen Tests ausführen und das Ergebnis in der CLAUDE.md dokumentieren.**

---

## 12. Wichtige Nicht-Funktionale Anforderungen

- **Responsives Design:** Vollständig nutzbar auf Desktop, Tablet und Smartphone
- **Performance:** Dashboard-Ladezeit < 2 Sekunden, Diagramme < 1 Sekunde bei bis zu 100 Zählern
- **Datensicherheit:** Alle Daten lokal auf dem HA-Host, keine Cloud-Abhängigkeit (externe APIs optional)
- **Offline-Fähigkeit:** System funktioniert vollständig ohne Bright Sky/Electricity Maps (mit manuellen Daten)
- **Backup:** Datenbank-Export/Import über die Add-on-Konfiguration
- **Logging:** Strukturiertes Logging (JSON) für Debugging
- **Fehlertoleranz:** Graceful Degradation bei Verbindungsabbruch zu Datenquellen oder externen APIs
- **ISO 50001 Konformität:** Struktur orientiert sich an ISO 50001:2018 (Kap. 6.3 Energetische Bewertung, 6.4 EnPIs, 6.5 Energetische Ausgangsbasis)
- **API-Schlüssel-Management:** Sichere Speicherung von Electricity Maps API-Keys und anderen Credentials über HA Secrets
