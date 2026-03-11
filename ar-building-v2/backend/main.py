# Hauptdatei der FastAPI-Anwendung.
# Hier werden alle Router eingebunden, die Datenbank initialisiert
# und statische Dateien bereitgestellt.

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.database import engine, Base, get_db

# Alle Modelle importieren damit SQLAlchemy die Tabellen kennt.
import backend.models  # noqa: F401 – Seiteneffekt: registriert alle Tabellen

from backend.models.user import User
from backend.routers import (
    auth, rooms, objects, object_types, users, statistics, settings, ha, planradar,
)


# ─── Startup / Shutdown ───────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Wird beim Start und Stop der Anwendung ausgeführt.
    Beim Start: Tabellen anlegen + Standard-Admin erstellen falls noch nicht vorhanden."""

    # Alle Tabellen in der SQLite-DB anlegen (falls sie noch nicht existieren).
    async with engine.begin() as conn:
        import sqlalchemy as _sa

        # Aufräumen: falls ein vorheriger Migration-Versuch users_new hinterlassen hat,
        # zuerst prüfen ob users existiert. Falls nicht, users_new → users umbenennen.
        try:
            tables_result = await conn.execute(
                _sa.text("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'users_new')")
            )
            existing_tables = {row[0] for row in tables_result.fetchall()}
            print(f"INFO:     DB-Status beim Start: Tabellen={existing_tables}")

            if "users_new" in existing_tables and "users" not in existing_tables:
                # Halbfertige Migration: users wurde gelöscht, Umbenennung fehlgeschlagen.
                await conn.execute(_sa.text("ALTER TABLE users_new RENAME TO users"))
                print("INFO:     DB-Wiederherstellung: users_new → users umbenannt.")
            elif "users_new" in existing_tables and "users" in existing_tables:
                # Verwaiste users_new aus fehlgeschlagener Migration – löschen.
                await conn.execute(_sa.text("DROP TABLE users_new"))
                print("INFO:     DB-Bereinigung: verwaiste users_new gelöscht.")
        except Exception as e:
            print(f"WARNUNG:  DB-Vorprüfung fehlgeschlagen: {e}")

        await conn.run_sync(Base.metadata.create_all)

        # Migration: pin_hash auf nullable setzen falls die Spalte noch NOT NULL ist.
        # SQLite unterstützt kein ALTER COLUMN – daher über PRAGMA-Prüfung + Tabellen-Rebuild.
        try:
            # Prüfen ob pin_hash notnull=1 hat (alte DB ohne nullable).
            result = await conn.execute(_sa.text("PRAGMA table_info(users)"))
            rows = result.fetchall()
            needs_migration = any(
                row[1] == "pin_hash" and row[3] == 1  # index 3 = notnull
                for row in rows
            )
            if needs_migration:
                print("INFO:     DB-Migration: pin_hash NOT NULL → nullable wird durchgeführt.")
                # Tabelle neu aufbauen ohne NOT NULL auf pin_hash.
                await conn.execute(_sa.text(
                    "CREATE TABLE users_new ("
                    "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
                    "  username VARCHAR(255) NOT NULL UNIQUE,"
                    "  pin_hash VARCHAR(255),"
                    "  role VARCHAR(50) NOT NULL DEFAULT 'staff'"
                    ")"
                ))
                await conn.execute(_sa.text(
                    "INSERT INTO users_new SELECT id, username, pin_hash, role FROM users"
                ))
                await conn.execute(_sa.text("DROP TABLE users"))
                await conn.execute(_sa.text("ALTER TABLE users_new RENAME TO users"))
                print("INFO:     DB-Migration: users.pin_hash auf nullable umgestellt.")
            else:
                print("INFO:     DB-Migration: nicht erforderlich.")
        except Exception as e:
            print(f"FEHLER:   DB-Migration fehlgeschlagen: {e}")

    # Add-on-Optionen lesen (geschrieben von HA nach /data/options.json).
    options: dict = {}
    try:
        with open("/data/options.json", encoding="utf-8") as f:
            options = __import__("json").load(f)
    except Exception:
        pass
    reset_admin = options.get("reset_admin", False)

    # Standard-Admin anlegen (erster Start) oder PIN zurücksetzen (reset_admin=true).
    # pin_hash=None bedeutet: noch kein PIN gesetzt → Login ohne PIN-Prüfung möglich,
    # Benutzer wird nach dem ersten Login aufgefordert einen PIN zu setzen.
    async with AsyncSession(engine) as db:
        result = await db.execute(select(User).where(User.username == "admin"))
        admin = result.scalar_one_or_none()
        if admin is None:
            default_admin = User(username="admin", pin_hash=None, role="admin")
            db.add(default_admin)
            await db.commit()
            print("INFO:     Admin-Konto neu angelegt. Beim ersten Login PIN setzen.")
        elif reset_admin:
            admin.pin_hash = None
            await db.commit()
            print("INFO:     Admin-PIN zurückgesetzt. Beim nächsten Login neuen PIN setzen.")
        else:
            pin_status = "kein PIN gesetzt" if admin.pin_hash is None else "PIN gesetzt"
            print(f"INFO:     Admin-Konto vorhanden ({pin_status}).")

    yield  # Hier läuft die Anwendung.
    # Beim Stopp: Datenbankverbindung sauber schließen.
    await engine.dispose()


# ─── App erstellen ────────────────────────────────────────────────────────────

app = FastAPI(
    title="AR Building v2",
    description="AR-Guided Tour API für historische Konzerthäuser",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS erlaubt dem Browser, API-Anfragen von anderen Ursprüngen zu stellen.
# allow_credentials=True ist inkompatibel mit allow_origins=["*"] (Browser lehnen ab).
# Da JWT als Bearer-Token im Authorization-Header übertragen wird (kein Cookie),
# wird allow_credentials nicht benötigt.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


# API-Router einbinden – Reihenfolge ist wichtig!
# Spezifische Routen (by-marker, types) müssen vor generischen ({id}) registriert sein.

app.include_router(auth.router,         prefix="/api/auth",         tags=["auth"])
app.include_router(rooms.router,        prefix="/api/rooms",        tags=["rooms"])
app.include_router(object_types.router, prefix="/api/object-types", tags=["object-types"])
app.include_router(objects.router,      prefix="/api/objects",      tags=["objects"])
app.include_router(users.router,        prefix="/api/users",        tags=["users"])
app.include_router(statistics.router,   prefix="/api/stats",        tags=["statistics"])
app.include_router(settings.router,     prefix="/api/settings",     tags=["settings"])
app.include_router(ha.router,           prefix="/api/ha",           tags=["ha"])
app.include_router(planradar.router,    prefix="/api/planradar",    tags=["planradar"])


# ─── Statische Dateien ────────────────────────────────────────────────────────

# Hochgeladene Raumdateien ausliefern (ONNX-Modelle, Audio, Video).
# Diese Dateien liegen im persistenten HA-Speicher unter /data/uploads/.
os.makedirs("/data/uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="/data/uploads"), name="uploads")

# Admin-UI: statische Assets (JS, CSS, Bilder).
# ./admin ist relativ zum WORKDIR /app im Container.
if os.path.isdir("./admin"):
    app.mount("/admin-static", StaticFiles(directory="./admin"), name="admin-static")

# Frontend-Assets (JS, CSS, Bilder der PWA).
if os.path.isdir("./frontend"):
    app.mount("/assets", StaticFiles(directory="./frontend/assets"), name="frontend-assets")
    app.mount("/css", StaticFiles(directory="./frontend/css"), name="frontend-css")
    app.mount("/js", StaticFiles(directory="./frontend/js"), name="frontend-js")


# ─── HTML-Routen ──────────────────────────────────────────────────────────────

@app.get("/admin")
async def serve_admin(request: Request):
    """Liefert die Admin-UI (index.html).
    Wenn HA Ingress den Request weiterleitet, wird der X-Ingress-Path-Header
    verwendet, um apiBase und <base href> dynamisch zu setzen – damit alle
    Asset-URLs und API-Calls durch den Ingress-Proxy laufen."""
    admin_index = "./admin/index.html"
    if not os.path.exists(admin_index):
        return {"detail": "Admin UI not found"}

    # X-Ingress-Path enthält den Pfad-Präfix, den HA vor alle URLs stellt.
    # z.B. "/api/hassio_ingress/abc123" – HA leitet dann /abc123/api/rooms → /api/rooms weiter.
    ingress_path = request.headers.get("X-Ingress-Path", "").rstrip("/")

    with open(admin_index, encoding="utf-8") as f:
        html = f.read()

    if ingress_path:
        # Ingress-Modus: <base href> setzen damit relative Asset-URLs korrekt aufgelöst werden.
        # apiBase = Ingress-Präfix, damit API-Calls durch den Proxy gehen.
        base_tag = f'<base href="{ingress_path}/">'
        api_base = ingress_path
    else:
        # Direktzugriff über HTTPS: host-Header enthält bereits Host:Port.
        host = request.headers.get("host", "localhost:8444")
        base_tag = ""
        api_base = f"https://{host}"

    if base_tag:
        html = html.replace("<head>", f"<head>\n  {base_tag}", 1)

    html = html.replace(
        "apiBase: window.location.origin",
        f'apiBase: "{api_base}"',
    )

    # PWA-URL für den "PWA öffnen"-Link in der Sidebar.
    pwa_url = f"{ingress_path}/" if ingress_path else f"https://{request.headers.get('host', 'localhost:8444')}/"
    # pwaUrl: im Ingress-Modus eigene /pwa-Route, damit der Link nicht wieder zu /admin umgeleitet wird.
    pwa_url = f"{ingress_path}/pwa" if ingress_path else f"https://{request.headers.get('host', 'localhost:8444')}/"
    html = html.replace('pwaUrl: "/"', f'pwaUrl: "{pwa_url}"')

    return HTMLResponse(content=html)


@app.get("/")
async def serve_frontend(request: Request):
    """Liefert die PWA-Frontend-Startseite (index.html).
    Bei Ingress-Zugriff (X-Ingress-Path vorhanden) → Redirect zum Admin-Panel."""
    if request.headers.get("X-Ingress-Path"):
        ingress_path = request.headers.get("X-Ingress-Path", "").rstrip("/")
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=f"{ingress_path}/admin")

    frontend_index = "./frontend/index.html"
    if not os.path.exists(frontend_index):
        return {"detail": "Frontend not found", "docs": "/docs"}
    return FileResponse(frontend_index)


@app.get("/pwa")
async def serve_pwa():
    """Dedizierte Route für die PWA – wird vom 'PWA öffnen'-Link im Admin-Panel genutzt.
    Kein Ingress-Redirect hier, damit der Link immer das Frontend öffnet."""
    frontend_index = "./frontend/index.html"
    if not os.path.exists(frontend_index):
        return {"detail": "Frontend not found"}
    return FileResponse(frontend_index)


@app.get("/manifest.json")
async def serve_manifest():
    """Liefert das PWA-Manifest."""
    return FileResponse("./frontend/manifest.json")


@app.get("/service-worker.js")
async def serve_sw():
    """Liefert den Service Worker der PWA."""
    return FileResponse("./frontend/service-worker.js")
