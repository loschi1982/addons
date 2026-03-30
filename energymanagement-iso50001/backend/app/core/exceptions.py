"""
exceptions.py – Eigene Fehlerklassen und zentrale Fehlerbehandlung.

Warum eigene Exceptions? FastAPI gibt standardmäßig generische Fehlermeldungen
zurück. Mit eigenen Exceptions können wir:
- Aussagekräftige Fehlermeldungen für das Frontend liefern
- Fehler-Codes für programmatische Auswertung mitgeben
- Fehler zentral an einer Stelle behandeln statt in jedem Endpunkt
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


# ── Basis-Exception ──
class EnergyManagementError(Exception):
    """Basisklasse für alle Fehler des Energy Management Systems."""
    def __init__(self, detail: str, error_code: str = "UNKNOWN_ERROR", status_code: int = 500):
        self.detail = detail
        self.error_code = error_code
        self.status_code = status_code
        super().__init__(detail)


# ── Authentifizierung & Autorisierung ──
class AuthenticationError(EnergyManagementError):
    """Benutzer ist nicht angemeldet oder Token ist ungültig."""
    def __init__(self, detail: str = "Nicht authentifiziert"):
        super().__init__(detail=detail, error_code="AUTH_ERROR", status_code=401)


class PermissionDeniedError(EnergyManagementError):
    """Benutzer hat keine Berechtigung für diese Aktion."""
    def __init__(self, detail: str = "Keine Berechtigung"):
        super().__init__(detail=detail, error_code="PERMISSION_DENIED", status_code=403)


class AccountLockedError(EnergyManagementError):
    """Benutzerkonto ist nach zu vielen Fehlversuchen gesperrt."""
    def __init__(self, detail: str = "Konto gesperrt – bitte Administrator kontaktieren"):
        super().__init__(detail=detail, error_code="ACCOUNT_LOCKED", status_code=423)


# ── Ressourcen nicht gefunden ──
class MeterNotFoundException(EnergyManagementError):
    """Der angeforderte Zähler existiert nicht."""
    def __init__(self, meter_id: str = ""):
        detail = f"Zähler nicht gefunden: {meter_id}" if meter_id else "Zähler nicht gefunden"
        super().__init__(detail=detail, error_code="METER_NOT_FOUND", status_code=404)


class UserNotFoundException(EnergyManagementError):
    """Der angeforderte Benutzer existiert nicht."""
    def __init__(self, user_id: str = ""):
        detail = f"Benutzer nicht gefunden: {user_id}" if user_id else "Benutzer nicht gefunden"
        super().__init__(detail=detail, error_code="USER_NOT_FOUND", status_code=404)


class SiteNotFoundException(EnergyManagementError):
    """Der angeforderte Standort existiert nicht."""
    def __init__(self, site_id: str = ""):
        detail = f"Standort nicht gefunden: {site_id}" if site_id else "Standort nicht gefunden"
        super().__init__(detail=detail, error_code="SITE_NOT_FOUND", status_code=404)


class AllocationNotFoundException(EnergyManagementError):
    """Die angeforderte Zuordnung existiert nicht."""
    def __init__(self, allocation_id: str = ""):
        detail = f"Zuordnung nicht gefunden: {allocation_id}" if allocation_id else "Zuordnung nicht gefunden"
        super().__init__(detail=detail, error_code="ALLOCATION_NOT_FOUND", status_code=404)


class AllocationDuplicateError(EnergyManagementError):
    """Diese Zähler-Einheit-Kombination existiert bereits."""
    def __init__(self, detail: str = "Zuordnung existiert bereits"):
        super().__init__(detail=detail, error_code="ALLOCATION_DUPLICATE", status_code=409)


class ReportNotFoundException(EnergyManagementError):
    """Der angeforderte Bericht existiert nicht."""
    def __init__(self, report_id: str = ""):
        detail = f"Bericht nicht gefunden: {report_id}" if report_id else "Bericht nicht gefunden"
        super().__init__(detail=detail, error_code="REPORT_NOT_FOUND", status_code=404)


# ── Datenvalidierung ──
class ReadingImplausibleError(EnergyManagementError):
    """Der eingegebene Zählerstand ist unplausibel."""
    def __init__(self, detail: str = "Zählerstand ist unplausibel"):
        super().__init__(detail=detail, error_code="READING_IMPLAUSIBLE", status_code=422)


class ImportDuplicateError(EnergyManagementError):
    """Der Import enthält bereits vorhandene Datensätze."""
    def __init__(self, detail: str = "Duplikate im Import erkannt"):
        super().__init__(detail=detail, error_code="IMPORT_DUPLICATE", status_code=409)


class ImportFormatError(EnergyManagementError):
    """Das Dateiformat des Imports ist ungültig oder nicht erkennbar."""
    def __init__(self, detail: str = "Dateiformat nicht erkannt"):
        super().__init__(detail=detail, error_code="IMPORT_FORMAT_ERROR", status_code=422)


class ImportValidationError(EnergyManagementError):
    """Die Import-Validierung hat Fehler ergeben."""
    def __init__(self, detail: str = "Import-Validierung fehlgeschlagen", errors: list | None = None):
        super().__init__(detail=detail, error_code="IMPORT_VALIDATION_ERROR", status_code=422)
        self.errors = errors or []


# ── Externe Dienste ──
class ExternalServiceError(EnergyManagementError):
    """Ein externer Dienst (Bright Sky, Electricity Maps, HA) ist nicht erreichbar."""
    def __init__(self, service: str, detail: str = ""):
        message = f"Externer Dienst nicht erreichbar: {service}"
        if detail:
            message += f" – {detail}"
        super().__init__(detail=message, error_code="EXTERNAL_SERVICE_ERROR", status_code=502)


def register_exception_handlers(app: FastAPI):
    """
    Registriert die zentrale Fehlerbehandlung für die FastAPI-App.

    Wandelt alle eigenen Exceptions in einheitliche JSON-Antworten um:
    {
        "detail": "Fehlerbeschreibung für den Benutzer",
        "error_code": "MASCHINENLESBARER_CODE"
    }
    """

    @app.exception_handler(EnergyManagementError)
    async def energy_management_error_handler(request: Request, exc: EnergyManagementError):
        # Fehler ≥ 500 in den Log-Puffer schreiben
        if exc.status_code >= 500:
            from app.core import log_buffer
            log_buffer.write(
                level="ERROR",
                source=request.url.path,
                message=exc.detail,
                details={"error_code": exc.error_code},
            )
        content = {
            "detail": exc.detail,
            "error_code": exc.error_code,
        }
        if hasattr(exc, "errors") and exc.errors:
            content["errors"] = exc.errors
        return JSONResponse(status_code=exc.status_code, content=content)

    @app.exception_handler(Exception)
    async def general_error_handler(request: Request, exc: Exception):
        """Fängt alle unerwarteten Fehler ab und gibt eine generische Meldung zurück."""
        import traceback
        import structlog
        from app.core import log_buffer
        logger = structlog.get_logger()
        logger.error("unhandled_exception", error=str(exc), path=request.url.path)
        log_buffer.write(
            level="ERROR",
            source=request.url.path,
            message=str(exc),
            details={"traceback": traceback.format_exc()[-2000:]},
        )
        return JSONResponse(
            status_code=500,
            content={
                "detail": "Ein interner Fehler ist aufgetreten",
                "error_code": "INTERNAL_ERROR",
            },
        )
