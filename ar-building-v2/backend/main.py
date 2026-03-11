# Hauptdatei der FastAPI-Anwendung.
# Hier werden alle Router eingebunden, die Datenbank initialisiert
# und statische Dateien bereitgestellt.

import os
import random
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.database import engine, Base, get_db
from backend.auth import hash_pin

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
        await conn.run_sync(Base.metadata.create_all)

    # Standard-Admin anlegen falls die DB noch leer ist.
    async with AsyncSession(engine) as db:
        result = await db.execute(select(User).where(User.username == "admin"))
        admin = result.scalar_one_or_none()
        if admin is None:
            # Zufälligen 4-stelligen PIN generieren und im Log ausgeben.
            # Der PIN wird beim ersten Start angezeigt und sollte danach geändert werden.
            initial_pin = str(random.randint(1000, 9999))
            print(f"INFO:     *** INITIALER ADMIN-PIN: {initial_pin} — bitte sofort ändern! ***")
            default_admin = User(
                username="admin",
                pin_hash=hash_pin(initial_pin),
                role="admin",
            )
            db.add(default_admin)
            await db.commit()

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
async def serve_admin():
    """Liefert die Admin-UI (index.html).
    Explizite Route nötig – StaticFiles würde /admin nicht als index.html auflösen."""
    admin_index = "./admin/index.html"
    if not os.path.exists(admin_index):
        return {"detail": "Admin UI not found"}
    return FileResponse(admin_index)


@app.get("/")
async def serve_frontend():
    """Liefert die PWA-Frontend-Startseite (index.html)."""
    frontend_index = "./frontend/index.html"
    if not os.path.exists(frontend_index):
        return {"detail": "Frontend not found", "docs": "/docs"}
    return FileResponse(frontend_index)


@app.get("/manifest.json")
async def serve_manifest():
    """Liefert das PWA-Manifest."""
    return FileResponse("./frontend/manifest.json")


@app.get("/service-worker.js")
async def serve_sw():
    """Liefert den Service Worker der PWA."""
    return FileResponse("./frontend/service-worker.js")
