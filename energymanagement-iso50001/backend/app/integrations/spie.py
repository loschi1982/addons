"""
spie.py – HTTP-Client für das SPIE Energy-as-a-Service-Portal.

Authentifizierung und Datenabruf für die SPIE-Energiemonitoring-Plattform
(https://energy-as-a-service.spie-es.de).

Auth-Flow (identisch zu enrich_spie_meters.py):
  1. POST /api/data mit Zugangsdaten → Session-Cookie + XSRF-Token
  2. X-XSRF-TOKEN-Header + Cookie in allen Folge-Requests

Zählerstand-Abruf:
  POST /legacyfreieauswertung/getfreieauswertungdata mit nav_id + Datumsbereich
  Falls dieser Endpunkt nicht funktioniert: raw_probe() liefert die Rohantwort
  für manuelle Diagnose.
"""

import urllib.parse
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx
import structlog

logger = structlog.get_logger()

BASE_URL = "https://energy-as-a-service.spie-es.de"


class SpieAuthError(Exception):
    """Login fehlgeschlagen."""


class SpieClient:
    """
    Asynchroner HTTP-Client für SPIE Energy-as-a-Service.

    Nutzung:
        async with SpieClient() as client:
            await client.login(username, password)
            readings = await client.get_readings(nav_id, date_from, date_to)
    """

    def __init__(self):
        self._client: httpx.AsyncClient | None = None
        self._logged_in = False

    async def __aenter__(self):
        self._client = httpx.AsyncClient(
            base_url=BASE_URL,
            headers={
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
                "Referer": f"{BASE_URL}/",
                "Origin": BASE_URL,
            },
            timeout=30.0,
            follow_redirects=True,
        )
        return self

    async def __aexit__(self, *args):
        if self._client:
            await self._client.aclose()

    def _xsrf_headers(self) -> dict:
        """X-XSRF-TOKEN-Header aus Session-Cookie zusammenbauen."""
        raw = self._client.cookies.get("XSRF-TOKEN", "")
        decoded = urllib.parse.unquote(raw)
        return {
            "X-XSRF-TOKEN": decoded,
            "Referer": f"{BASE_URL}/",
            "Content-Type": "application/json",
        }

    async def login(self, username: str, password: str) -> None:
        """
        Authentifizierung via POST /api/data (form-encoded).
        Setzt SessionKeyEnMon2014 + XSRF-TOKEN Cookies.
        """
        r = await self._client.post(
            "/api/data",
            data={"UserName": username, "Password": password, "RememberMe": "false"},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        r.raise_for_status()
        if "SessionKeyEnMon2014" not in self._client.cookies:
            raise SpieAuthError(f"Login fehlgeschlagen: HTTP {r.status_code}, kein Session-Cookie")
        self._logged_in = True
        logger.info("spie_login_ok", username=username)

    async def test_connection(self, username: str, password: str) -> bool:
        """Login-Test – gibt True zurück wenn erfolgreich, False bei falschen Credentials."""
        try:
            await self.login(username, password)
            return True
        except (SpieAuthError, httpx.HTTPError):
            return False

    async def get_readings(
        self,
        nav_id: str,
        date_from: date,
        date_to: date,
    ) -> list[dict]:
        """
        Messwerte für einen Zähler im Zeitraum [date_from, date_to] abrufen.

        Versucht mehrere bekannte SPIE-Endpunkte und gibt die erste
        erfolgreich geparste Antwort zurück.

        Rückgabe: Liste von {"timestamp": datetime, "value": float}
        """
        # Versuche 1: Freie Auswertung (primärer Endpunkt)
        result = await self._try_freie_auswertung(nav_id, date_from, date_to)
        if result is not None:
            return result

        # Versuche 2: Legacy Verbrauchsverlauf
        result = await self._try_verbrauchsverlauf(nav_id, date_from, date_to)
        if result is not None:
            return result

        # Kein Endpunkt hat funktioniert – leere Liste + Warnung
        logger.warning(
            "spie_readings_no_data",
            nav_id=nav_id,
            date_from=str(date_from),
            date_to=str(date_to),
            hint="Endpunkt-Payload könnte angepasst werden müssen – raw_probe() für Diagnose",
        )
        return []

    async def _try_freie_auswertung(
        self, nav_id: str, date_from: date, date_to: date
    ) -> list[dict] | None:
        """
        POST /legacyfreieauswertung/getfreieauswertungdata

        Bekanntes Payload-Muster aus SPIE-Stammdaten-Endpoint:
          routeParams + targetRouteParams mit task='freieauswertung'
          + Datumsbereich als ISO-8601.
        """
        payload = {
            "routeParams": {
                "elementType": "z",
                "elementId": nav_id,
                "task": "freieauswertung",
            },
            "targetRouteParams": {
                "elementType": "z",
                "elementId": nav_id,
                "task": "freieauswertung",
            },
            "dateFrom": date_from.isoformat(),
            "dateTo": date_to.isoformat(),
            "silentErrorHandling": True,
        }
        try:
            r = await self._client.post(
                "/legacyfreieauswertung/getfreieauswertungdata",
                json=payload,
                headers=self._xsrf_headers(),
            )
            if not r.is_success:
                logger.debug("spie_freieauswertung_failed", status=r.status_code, nav_id=nav_id)
                return None
            data = r.json()
            logger.debug("spie_freieauswertung_raw", nav_id=nav_id, keys=list(data.keys()) if isinstance(data, dict) else type(data).__name__)
            return self._parse_readings_response(data)
        except Exception as e:
            logger.debug("spie_freieauswertung_error", nav_id=nav_id, error=str(e))
            return None

    async def _try_verbrauchsverlauf(
        self, nav_id: str, date_from: date, date_to: date
    ) -> list[dict] | None:
        """
        POST /legacyverbrauchsverlauf/getverbrauchsverlaufdata

        Alternative Endpunkt für Verbrauchsdaten.
        """
        payload = {
            "routeParams": {
                "elementType": "z",
                "elementId": nav_id,
                "task": "verbrauchsverlauf",
            },
            "targetRouteParams": {
                "elementType": "z",
                "elementId": nav_id,
                "task": "verbrauchsverlauf",
            },
            "dateFrom": date_from.isoformat(),
            "dateTo": date_to.isoformat(),
            "silentErrorHandling": True,
        }
        try:
            r = await self._client.post(
                "/legacyverbrauchsverlauf/getverbrauchsverlaufdata",
                json=payload,
                headers=self._xsrf_headers(),
            )
            if not r.is_success:
                return None
            data = r.json()
            logger.debug("spie_verbrauchsverlauf_raw", nav_id=nav_id, keys=list(data.keys()) if isinstance(data, dict) else type(data).__name__)
            return self._parse_readings_response(data)
        except Exception as e:
            logger.debug("spie_verbrauchsverlauf_error", nav_id=nav_id, error=str(e))
            return None

    async def raw_probe(self, nav_id: str, endpoint: str, payload: dict) -> Any:
        """
        Rohaufruf eines SPIE-Endpunkts für Diagnose/Debugging.

        Beispiel:
            data = await client.raw_probe(nav_id, "/legacyfreieauswertung/...", {...})
        """
        r = await self._client.post(
            endpoint,
            json=payload,
            headers=self._xsrf_headers(),
        )
        logger.info(
            "spie_raw_probe",
            endpoint=endpoint,
            nav_id=nav_id,
            status=r.status_code,
            response_preview=r.text[:500],
        )
        return {"status": r.status_code, "body": r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text}

    def _parse_readings_response(self, data: Any) -> list[dict] | None:
        """
        Versucht, Messwerte aus einer SPIE-API-Antwort zu parsen.

        Bekannte Response-Strukturen:
          {"data": {"values": [{"timestamp": "...", "value": 123.4}, ...]}}
          {"data": [{"dateTime": "...", "value": 123.4}]}
          {"values": [...]}
          Direkte Liste [...] mit Datum+Wert-Einträgen

        Gibt None zurück wenn die Struktur nicht erkannt wird.
        """
        readings = []

        # Verschiedene bekannte Strukturen durchprobieren
        candidates = []
        if isinstance(data, list):
            candidates = [data]
        elif isinstance(data, dict):
            # Häufige Wrapper-Strukturen
            for key in ("values", "data", "messwerte", "readings", "items"):
                val = data.get(key)
                if isinstance(val, list):
                    candidates.append(val)
                elif isinstance(val, dict):
                    for sub_key in ("values", "data", "messwerte", "items"):
                        sub = val.get(sub_key)
                        if isinstance(sub, list):
                            candidates.append(sub)

        if not candidates:
            return None

        # Erstes nicht-leeres Kandidaten-Array parsen
        for candidate in candidates:
            if not candidate:
                continue
            parsed = self._parse_reading_list(candidate)
            if parsed is not None:
                return parsed

        return None

    def _parse_reading_list(self, items: list) -> list[dict] | None:
        """Parst eine Liste von Messwert-Einträgen in einheitliches Format."""
        result = []
        timestamp_keys = ("timestamp", "dateTime", "date", "datum", "zeit", "ts")
        value_keys = ("value", "wert", "reading", "messwert", "stand", "zaehlerstand")

        for item in items:
            if not isinstance(item, dict):
                continue

            # Timestamp suchen
            ts = None
            for k in timestamp_keys:
                if k in item:
                    ts = self._parse_datetime(str(item[k]))
                    if ts:
                        break

            # Wert suchen
            val = None
            for k in value_keys:
                if k in item and item[k] is not None:
                    try:
                        val = float(item[k])
                        break
                    except (TypeError, ValueError):
                        pass

            if ts and val is not None:
                result.append({"timestamp": ts, "value": val})

        if not result:
            return None

        return sorted(result, key=lambda x: x["timestamp"])

    @staticmethod
    def _parse_datetime(s: str) -> datetime | None:
        """Parst ISO-8601 oder deutsches Datum → datetime (UTC-aware)."""
        if not s:
            return None
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except (ValueError, AttributeError):
            pass
        # Deutsches Format: DD.MM.YYYY HH:MM
        for fmt in ("%d.%m.%Y %H:%M", "%d.%m.%Y", "%Y-%m-%d %H:%M:%S"):
            try:
                dt = datetime.strptime(s, fmt)
                return dt.replace(tzinfo=timezone.utc)
            except ValueError:
                pass
        return None
