# Backend – CLAUDE.md

## Architektur
Service-Layer-Pattern: Router → Service → Repository (via SQLAlchemy Session).

## Wichtige Dateien
- `app/main.py` – FastAPI App-Factory mit Lifespan
- `app/config.py` – Pydantic Settings (Env-Vars)
- `app/core/database.py` – Async SQLAlchemy Engine + Session
- `app/core/security.py` – JWT (python-jose) + bcrypt (passlib)
- `app/core/dependencies.py` – FastAPI Depends (Auth, Permissions)
- `app/tasks.py` – Celery Beat-Schedule + Task-Definitionen

## Modell-Konventionen
- Alle Modelle erben von `Base, UUIDMixin` (uuid4 PK)
- `TimestampMixin` für created_at/updated_at
- SQLAlchemy 2.x `Mapped[]` Typ-Syntax
- JSON-Felder für flexible Konfiguration (source_config, tariff_info)

## API-Konventionen
- Prefix: `/api/v1/`
- CRUD: GET (list) → POST (create) → GET/{id} → PUT/{id} → DELETE/{id}
- Pagination: `PaginatedResponse[T]` mit page, page_size, total
- Auth: `Depends(get_current_user)` für alle geschützten Endpunkte
- Permissions: `Depends(require_permission("module", "action"))`

## Tests ausführen
```bash
pytest                    # Alle Tests
pytest tests/unit/        # Nur Unit-Tests
pytest -x                 # Stopp beim ersten Fehler
```
