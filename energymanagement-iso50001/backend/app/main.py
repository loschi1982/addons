"""
main.py – FastAPI App-Factory für das Energy Management System.

Diese Datei ist der Einstiegspunkt des Backends. Die Funktion create_app()
erstellt und konfiguriert die FastAPI-Anwendung:

1. API-Router einbinden (alle Endpunkte unter /api/v1/)
2. Middleware konfigurieren (CORS, Fehlerbehandlung)
3. In der Produktion: React-Frontend als statische Dateien ausliefern
4. Beim Start: Datenbankverbindung herstellen und Seed-Daten laden

Wird aufgerufen von Uvicorn:
  uvicorn backend.app.main:create_app --factory
"""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.core.database import init_db, close_db
from app.core.exceptions import register_exception_handlers


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifecycle-Handler: Wird beim Start und Beenden der App ausgeführt.

    Beim Start:
      - Datenbankverbindung herstellen
      - Tabellen erstellen (falls nicht vorhanden)
      - Seed-Daten laden (Rollen, CO₂-Faktoren, Wetterstationen)

    Beim Beenden:
      - Datenbankverbindung sauber schließen
    """
    settings = get_settings()
    print(f"→ Starte {settings.app_name} v{settings.app_version}")

    # Datenbank initialisieren (optional – startet auch ohne DB)
    db_available = False
    try:
        await init_db()
        db_available = True
        print("✓ Datenbankverbindung hergestellt")
    except Exception as e:
        print(f"⚠ Datenbank nicht verfügbar: {e}")
        print("⚠ App startet ohne DB – nur Health-Check verfügbar")

    # Seed-Daten laden (nur wenn DB verfügbar)
    if db_available:
        try:
            from app.core.seed import run_all_seeds
            await run_all_seeds()
            print("✓ Seed-Daten geladen")
        except Exception as e:
            print(f"⚠ Seed-Daten konnten nicht geladen werden: {e}")

    yield  # ← Hier läuft die App

    # Aufräumen beim Beenden
    if db_available:
        await close_db()
        print("✓ Datenbankverbindung geschlossen")


def create_app() -> FastAPI:
    """
    Erstellt und konfiguriert die FastAPI-Anwendung.

    Returns:
        Konfigurierte FastAPI-Instanz, bereit zum Starten
    """
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="Energiemanagementsystem nach ISO 50001",
        docs_url="/api/docs" if settings.debug else None,
        redoc_url="/api/redoc" if settings.debug else None,
        lifespan=lifespan,
    )

    # ── CORS-Middleware ──
    # Erlaubt dem Frontend (z.B. auf Port 5173 in der Entwicklung)
    # auf die API zuzugreifen, ohne vom Browser blockiert zu werden.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # In Produktion einschränken
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Fehlerbehandlung registrieren ──
    register_exception_handlers(app)

    # ── Health-Check-Endpunkt ──
    @app.get("/api/v1/health", tags=["System"])
    async def health_check():
        """Einfacher Gesundheitscheck – antwortet mit OK wenn der Server läuft."""
        return {"status": "ok", "version": settings.app_version}

    # ── API-Router einbinden ──
    # Alle API-Endpunkte leben unter /api/v1/
    try:
        from app.api.v1 import api_router
        app.include_router(api_router, prefix="/api/v1")
    except ImportError as e:
        print(f"⚠ API-Router konnten nicht geladen werden: {e}")

    # ── WebSocket-Router einbinden ──
    try:
        from app.api.v1.websocket import router as ws_router
        app.include_router(ws_router, prefix="/api/v1/ws", tags=["WebSocket"])
    except ImportError as e:
        print(f"⚠ WebSocket-Router konnte nicht geladen werden: {e}")

    # ── React-Frontend als statische Dateien ausliefern ──
    # In der Produktion liegen die gebauten Frontend-Dateien in frontend/dist/
    # FastAPI liefert sie direkt aus – kein separater Webserver nötig.
    frontend_dir = Path(__file__).parent.parent.parent / "frontend" / "dist"
    if frontend_dir.exists():
        # Statische Assets (JS, CSS, Bilder, Fonts)
        assets_dir = frontend_dir / "assets"
        if assets_dir.exists():
            app.mount(
                "/assets",
                StaticFiles(directory=str(assets_dir)),
                name="assets",
            )

        # SPA-Fallback: Alle nicht-API-Routen → index.html
        # React Router übernimmt dann das Routing im Browser.
        @app.get("/{full_path:path}")
        async def serve_spa(request: Request, full_path: str):
            """
            Liefert das React-Frontend aus. Wenn die angeforderte Datei
            existiert (z.B. favicon.ico), wird sie direkt zurückgegeben.
            Alles andere → index.html (React Router entscheidet dann).
            """
            # Nicht für API-Anfragen
            if full_path.startswith("api/"):
                return JSONResponse(
                    status_code=404,
                    content={"detail": "API-Endpunkt nicht gefunden"},
                )

            file_path = frontend_dir / full_path
            if file_path.exists() and file_path.is_file():
                return FileResponse(str(file_path))
            return FileResponse(str(frontend_dir / "index.html"))

    return app
