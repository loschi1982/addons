# Architektur – Energy Management ISO 50001

## Systemübersicht

```
┌─────────────────────────────────────────────────────────────┐
│                    Home Assistant Host                       │
│                                                             │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │   HA Core    │  │  Energy Mgmt     │  │  TimescaleDB  │  │
│  │              │◄─┤  Add-on          ├─►│  (PostgreSQL)  │  │
│  │  Supervisor  │  │                  │  │               │  │
│  │  API         │  │  FastAPI :8099   │  │  :5432        │  │
│  └──────────────┘  │  React SPA       │  └──────────────┘  │
│                    │  Celery Worker   │  ┌──────────────┐  │
│                    │                  ├─►│    Redis      │  │
│                    └──────────────────┘  │    :6379      │  │
│                                         └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Technologie-Stack

| Schicht      | Technologie                        |
|--------------|-------------------------------------|
| Frontend     | React 18 + TypeScript + Tailwind    |
| State        | Redux Toolkit                       |
| Charts       | Recharts                            |
| API          | FastAPI (async Python 3.12)          |
| ORM          | SQLAlchemy 2.x (Mapped[] Syntax)    |
| Datenbank    | TimescaleDB (PostgreSQL + Hypertables) |
| Task Queue   | Celery + Redis                      |
| PDF          | WeasyPrint + Jinja2                 |
| Auth         | JWT (python-jose) + bcrypt          |
| Caching      | Redis (TTL-basiert)                 |

## Schichtenarchitektur

```
Frontend (React SPA)
    │
    ▼ HTTP/JSON
API Router (app/api/v1/*.py)
    │  - Validierung via Pydantic Schemas
    │  - Auth via JWT Dependency
    ▼
Service Layer (app/services/*.py)
    │  - Business-Logik
    │  - Caching (@cached Decorator)
    ▼
Data Layer (app/models/*.py + SQLAlchemy)
    │  - Mapped[] Typ-Syntax
    │  - UUIDs als Primary Keys
    ▼
TimescaleDB
    - Stammdaten: normale Tabellen
    - Zeitreihen: Hypertables
```

## Datenbankschema (Übersicht)

### Stammdaten
- **sites** → **buildings** → **usage_units** (3-stufige Hierarchie)
- **meters** (Zähler, zugeordnet zu usage_units)
- **consumers** (Verbraucher, n:m mit meters)
- **users**, **roles**, **permissions** (RBAC)

### Zeitreihen (Hypertables)
- **meter_readings** (Zählerstände + Verbrauch)
- **weather_records** (Wetterdaten)
- **climate_readings** (Raumklima)
- **co2_calculations** (CO₂-Berechnungen)

### ISO 50001
- **organization_contexts** (Kap. 4)
- **energy_policies** (Kap. 5)
- **enms_roles** (Kap. 5.3)
- **energy_objectives** → **action_plans** (Kap. 6.2)
- **risks_opportunities** (Kap. 6.1)
- **documents** → **document_revisions** (Kap. 7.5)
- **legal_requirements** (Kap. 6.1.3)
- **internal_audits** → **audit_findings** (Kap. 9.2)
- **management_reviews** (Kap. 9.3)
- **nonconformities** (Kap. 10.1)

### Weitere
- **emission_factor_sources** → **emission_factors** (CO₂)
- **energy_schemas** → **schema_positions** (Energiefluss)
- **audit_reports** (PDF-Berichte)
- **app_settings** (Key-Value-Konfiguration)

## Modulstruktur

### Backend (app/)

```
app/
├── main.py                     # FastAPI App + Lifespan
├── config.py                   # Pydantic Settings (Env-Vars)
├── tasks.py                    # Celery Beat + Tasks
├── core/
│   ├── database.py             # SQLAlchemy Engine + Session
│   ├── security.py             # JWT + bcrypt
│   ├── dependencies.py         # FastAPI Depends (Auth, Permissions)
│   ├── cache.py                # Redis-Cache (@cached Decorator)
│   └── utils.py                # Hilfsfunktionen
├── models/                     # SQLAlchemy Modelle (16 Dateien)
├── schemas/                    # Pydantic Schemas (Request/Response)
├── api/v1/                     # REST-Endpunkte (15 Router)
├── services/                   # Business-Logik (14 Services)
└── integrations/               # Externe Systeme
    ├── bright_sky.py           # Wetter-API
    ├── electricity_maps.py     # CO₂-Intensität
    ├── shelly.py               # Shelly Smart Plugs
    ├── modbus.py               # Modbus TCP/RTU
    ├── knx.py                  # KNX/IP
    └── ha_entity.py            # HA Entity-Abruf
```

### Frontend (src/)

```
src/
├── App.tsx                     # Routing + ProtectedRoute
├── main.tsx                    # React + Redux + i18n Bootstrap
├── i18n/                       # Internationalisierung (DE/EN)
│   ├── index.ts                # i18next Konfiguration
│   └── locales/                # Übersetzungsdateien
├── components/
│   └── layout/                 # MainLayout, Sidebar, Header
├── pages/                      # 18 Seiten-Komponenten
├── store/
│   ├── store.ts                # Redux Store
│   └── slices/                 # Redux Toolkit Slices
├── hooks/                      # Custom Hooks
├── utils/                      # apiClient (Axios + JWT)
└── types/                      # TypeScript Interfaces
```

## Authentifizierung

```
Login → POST /api/v1/auth/login → JWT Access Token (30min)
                                 + Refresh Token (7 Tage)

Request → Authorization: Bearer <token> → Dependency validates
                                        → get_current_user

Permission Check → require_permission("module", "action")
                 → Role → RolePermissions
                 → UserPermissionOverrides (optional)
```

## Caching-Strategie

```
Redis Cache mit TTL:
  - Dashboard:     5 Min (300s)
  - CO₂-Dashboard: 10 Min (600s)
  - Benchmarks:    10 Min (600s)

Cache-Invalidierung:
  - POST /api/v1/settings/cache/clear (manuell)
  - Automatisch bei Redis-Ausfall: Fallback auf DB
```

## Celery Tasks

| Task                        | Schedule        | Beschreibung                    |
|-----------------------------|----------------|---------------------------------|
| poll_meter_readings         | Alle 5 Min      | Zählerstände von Shelly/Modbus  |
| sync_weather_data           | Stündlich        | Wetterdaten von Bright Sky      |
| calculate_degree_days       | Täglich 01:00    | Gradtagszahlen berechnen        |
| calculate_co2               | Täglich 02:00    | CO₂-Emissionen neuberechnen     |
| generate_monthly_report     | 1. des Monats    | PDF-Monatsbericht               |

## Deployment

Das Add-on läuft als Docker-Container unter Home Assistant Supervisor:

```
Dockerfile → Python 3.12 + Node.js Build
run.sh     → Setzt Env-Vars aus HA Add-on Config
             → Startet Uvicorn + Celery Worker
config.yaml → HA Add-on Konfiguration (Ports, Optionen)
```

Ports:
- **8099** (HTTP): FastAPI Backend + React SPA (HA Ingress)
- TimescaleDB und Redis laufen als separate HA Add-ons
