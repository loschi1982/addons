# Energiemanagement ISO 50001 – CLAUDE.md

## Projektübersicht
Home Assistant Add-on für ein ISO 50001 konformes Energiemanagementsystem.
Verwaltet Energieverbräuche, CO₂-Emissionen, Witterungskorrektur und
das komplette ISO 50001 Managementsystem (Audits, Ziele, Dokumente).

## Tech-Stack
- **Backend**: Python 3.12, FastAPI (async), SQLAlchemy 2.x (Mapped[] Syntax), Alembic
- **Datenbank**: TimescaleDB (PostgreSQL + Zeitreihen)
- **Task Queue**: Celery + Redis
- **Frontend**: React 18, TypeScript (strict), Redux Toolkit, Tailwind CSS, Recharts
- **PDF**: WeasyPrint + Jinja2 Templates
- **Deployment**: Docker, Home Assistant Add-on

## Projektstruktur
```
energymanagement-iso50001/
├── config.yaml, build.yaml, Dockerfile, run.sh    # HA Add-on
├── docker-compose.dev.yml                          # Dev-Umgebung
├── backend/
│   ├── app/
│   │   ├── main.py                                 # FastAPI App
│   │   ├── config.py                               # Settings
│   │   ├── tasks.py                                # Celery Tasks
│   │   ├── core/                                   # DB, Auth, Dependencies
│   │   ├── models/                                 # SQLAlchemy Modelle
│   │   ├── schemas/                                # Pydantic Schemas
│   │   ├── api/v1/                                 # REST-Endpunkte
│   │   ├── services/                               # Business Logic
│   │   └── integrations/                           # Externe Systeme
│   ├── seed_data/                                  # JSON Seed-Daten
│   ├── alembic/                                    # DB-Migrationen
│   └── tests/                                      # pytest Tests
└── frontend/
    └── src/
        ├── components/                              # React-Komponenten
        ├── pages/                                   # Seiten
        ├── store/                                   # Redux Store
        ├── hooks/                                   # Custom Hooks
        ├── utils/                                   # Hilfsfunktionen
        └── types/                                   # TypeScript-Typen
```

## Konventionen
- **Sprache**: Code-Kommentare und Docstrings auf Deutsch
- **API**: REST unter `/api/v1/`, Pagination via `page` + `page_size`
- **Modelle**: UUIDs als Primary Keys, `TimestampMixin` für created_at/updated_at
- **Services**: Alle Business-Logik in Services, Router nur als Thin Layer
- **Design**: Primärfarbe #1B5E7B (Petrol), Inter Font, Flat Design

## Befehle
```bash
# Backend (Dev)
cd backend && uvicorn app.main:create_app --factory --reload --port 8099

# Frontend (Dev)
cd frontend && npm run dev

# Tests
cd backend && pytest

# Docker Dev-Umgebung
docker-compose -f docker-compose.dev.yml up
```

## Status
- [x] Projektstruktur angelegt
- [x] Datenmodelle (16 Model-Dateien)
- [x] Pydantic Schemas
- [x] API Router (14 Module)
- [x] Service Stubs
- [x] Integration Stubs (Shelly, Modbus, KNX, HA, BrightSky, Electricity Maps)
- [x] Frontend Scaffolding (React + Redux + Tailwind)
- [x] Seed-Daten (Rollen, Emissionsfaktoren, DWD-Stationen)
- [x] Service-Implementierungen (17/17 Services implementiert)
- [x] Alembic-Migrationen (initiale Migration für alle 40+ Tabellen)
- [x] Backend-Tests (291 Tests, 285 grün, 6 API-Fixture-Konflikte)
- [x] Docker-Build verifiziert (Dockerfile, docker-compose, run.sh)
- [x] Frontend-Komponenten implementieren (17/17 Seiten, TypeScript fehlerfrei, Production-Build OK)
- [x] E2E-Tests (11 Tests: Auth, Sites, Meters, Consumers, ISO 50001)
- [x] Integration-Tests (Shelly, Modbus, BrightSky, HomeAssistant, Electricity Maps)
- [x] Zähler-Zuordnungen (MeterUnitAllocation: Add/Subtract-Semantik, anteilige Faktoren)
- [x] Service-Tests (Dashboard, Weather, Climate, Report, Import, Permission, Schema)
