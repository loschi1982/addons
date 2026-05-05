"""
spie.py – Playwright-basierter Client für das SPIE Energy-as-a-Service-Portal.

Hintergrund:
  Der SPIE-Endpoint POST /api/legacyanalysis/postdata validiert serverseitigen
  Zustand, der durch Browser-Navigation initialisiert wird. Direkter HTTP-Aufruf
  schlägt mit HTTP 500 fehl. Nur Browser-Requests in derselben Session mit
  initialisiertem Zustand funktionieren.

Strategie pro Zähler:
  1. freieAuswertung-Seite öffnen → initialisiert Server-Zustand
  2. AngularJS-Scope direkt setzen (fromTo UTC + resolution=zi1h)
  3. "Ansicht aktualisieren" klicken → Browser schickt validen postdata-Request
  4. Response via page.route() intercepten → diagramData.x/y extrahieren
"""

import asyncio
import json
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo


import structlog

logger = structlog.get_logger()

BASE_URL = "https://energy-as-a-service.spie-es.de"

# Sekunden die nach dem Klick auf "Ansicht aktualisieren" gewartet werden
# bevor die Response als fehlend gilt.
POSTDATA_WAIT_SECONDS = 12


class SpieAuthError(Exception):
    """Login fehlgeschlagen."""


class SpieClient:
    """
    Playwright-basierter SPIE-Client.

    Nutzung:
        async with SpieClient() as client:
            await client.login(username, password)
            readings = await client.get_readings(nav_id, date_from, date_to)
    """

    def __init__(self):
        self._playwright = None
        self._browser = None
        self._context = None
        self._page = None

    async def __aenter__(self):
        from playwright.async_api import async_playwright

        self._playwright = await async_playwright().start()
        self._browser = await self._playwright.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        self._context = await self._browser.new_context(
            user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
        )
        self._page = await self._context.new_page()
        return self

    async def __aexit__(self, *args):
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()

    async def login(self, username: str, password: str) -> None:
        """
        Login bei SPIE via Browser-Formular.
        Setzt Session-Cookies für alle nachfolgenden Requests.
        """
        await self._page.goto(BASE_URL + "/", wait_until="domcontentloaded")

        try:
            await self._page.wait_for_selector('input[type="password"]', timeout=10000)
        except Exception:
            # Schon eingeloggt?
            if "login" not in self._page.url:
                logger.debug("spie_already_logged_in", url=self._page.url)
                return
            raise SpieAuthError("Login-Formular nicht gefunden")

        await self._page.fill('input[name="username"]', username)
        await self._page.fill('input[name="password"]', password)
        await self._page.click('input[type="submit"]')
        await self._page.wait_for_load_state("networkidle", timeout=30000)

        if "/login" in self._page.url:
            raise SpieAuthError(f"Login fehlgeschlagen (Redirect zurück zu Login)")

        logger.info("spie_login_ok", username=username)

    async def test_connection(self, username: str, password: str) -> bool:
        """Login-Test."""
        try:
            await self.login(username, password)
            return True
        except (SpieAuthError, Exception):
            return False

    async def get_readings(
        self,
        nav_id: str,
        date_from: date,
        date_to: date,
    ) -> list[dict]:
        """
        Messwerte für einen Zähler im Zeitraum [date_from, date_to] abrufen.

        Strategie:
          1. freieAuswertung-Seite öffnen (initialisiert Server-Zustand)
          2. AngularJS-Scope: fromTo (UTC) + resolution=zi1h setzen
          3. "Ansicht aktualisieren" klicken → postdata-Request
          4. Response via page.route() intercepten

        Rückgabe: Liste von {"timestamp": datetime (UTC), "value": float}
        """
        from_utc = _berlin_midnight_utc(date_from)
        to_utc = _berlin_midnight_utc(date_to + timedelta(days=1))

        captured: dict = {}

        async def intercept_postdata(route, request):
            response = await route.fetch()
            body = await response.body()
            try:
                captured["response"] = json.loads(body)
            except json.JSONDecodeError:
                captured["error"] = body[:200].decode(errors="replace")
            await route.fulfill(response=response, body=body)

        await self._page.route("**/api/legacyanalysis/postdata**", intercept_postdata)

        url = f"{BASE_URL}/element/z/id/{nav_id}/task/freieAuswertung"
        try:
            await self._page.goto(url, wait_until="networkidle", timeout=90000)
        except Exception as e:
            await self._page.unroute("**/api/legacyanalysis/postdata**")
            logger.warning("spie_navigation_failed", nav_id=nav_id, error=str(e))
            return []

        if "/login" in self._page.url:
            await self._page.unroute("**/api/legacyanalysis/postdata**")
            logger.warning("spie_session_expired", nav_id=nav_id)
            return []

        await self._page.unroute("**/api/legacyanalysis/postdata**")
        captured.clear()

        # Route für den Update-Request
        async def intercept_update(route, request):
            response = await route.fetch()
            body = await response.body()
            try:
                captured["response"] = json.loads(body)
            except json.JSONDecodeError:
                captured["error"] = body[:200].decode(errors="replace")
            await route.fulfill(response=response, body=body)

        await self._page.route("**/api/legacyanalysis/postdata**", intercept_update)

        # AngularJS-Scope setzen (Frame 1 = Legacy-Iframe)
        frame = self._page.frames[1] if len(self._page.frames) > 1 else self._page

        # ZEITRAUM-Tab aktivieren (damit Refresh-Button sichtbar wird)
        try:
            zeitraum = frame.locator('li.ribbon-title').filter(has_text="ZEITRAUM")
            if await zeitraum.count() > 0:
                await zeitraum.first.click()
                await asyncio.sleep(0.3)
        except Exception:
            pass

        scope_ok = await frame.evaluate(f"""
            () => {{
                const ctrl = document.querySelector('[ng-controller="analysis.AuswertungController"]');
                if (!ctrl) return false;
                const scope = angular.element(ctrl).scope();
                if (!scope || !scope.selectedSettings || !scope.selectedSettings.fromTo) return false;
                scope.selectedSettings.fromTo.from.dateTimeUtc = '{from_utc}';
                scope.selectedSettings.fromTo.to.dateTimeUtc = '{to_utc}';
                scope.selectedSettings.resolution = 'zi1h';
                scope.$apply();
                return true;
            }}
        """)

        if not scope_ok:
            await self._page.unroute("**/api/legacyanalysis/postdata**")
            logger.debug("spie_scope_not_found", nav_id=nav_id)
            return []

        # Ersten sichtbaren "Ansicht aktualisieren"-Button klicken
        btns = await frame.query_selector_all("button.button--highlight")
        clicked = False
        for btn in btns:
            if await btn.is_visible():
                await btn.click()
                clicked = True
                break

        if not clicked:
            await self._page.unroute("**/api/legacyanalysis/postdata**")
            logger.debug("spie_no_refresh_button", nav_id=nav_id)
            return []

        await asyncio.sleep(POSTDATA_WAIT_SECONDS)
        await self._page.unroute("**/api/legacyanalysis/postdata**")

        if not captured:
            logger.debug("spie_postdata_no_response", nav_id=nav_id)
            return []

        if "error" in captured:
            logger.warning("spie_postdata_decode_error", nav_id=nav_id, error=captured["error"])
            return []

        resp = captured["response"]
        api_err = resp.get("error")
        if api_err:
            logger.warning("spie_postdata_api_error", nav_id=nav_id, error=str(api_err))
            return []

        dd = (resp.get("data") or {}).get("diagramData") or {}
        x_outer = dd.get("x") or []
        y_outer = dd.get("y") or []

        if not x_outer or not y_outer:
            logger.debug("spie_postdata_empty", nav_id=nav_id,
                         date_from=str(date_from), date_to=str(date_to))
            return []

        readings = []
        for ts, val in zip(x_outer[0], y_outer[0]):
            if val is None or not isinstance(val, (int, float)):
                continue
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
            readings.append({"timestamp": dt, "value": float(val)})

        logger.debug(
            "spie_readings_fetched",
            nav_id=nav_id,
            date_from=str(date_from),
            date_to=str(date_to),
            count=len(readings),
        )
        return sorted(readings, key=lambda r: r["timestamp"])

    async def raw_probe(self, nav_id: str, endpoint: str, payload: dict) -> Any:
        """Rohaufruf eines SPIE-Endpunkts für Diagnose/Debugging."""
        if not self._page:
            return {"error": "Kein Browser initialisiert"}
        result = await self._page.evaluate("""
            async ([endpoint, payload, xsrfToken]) => {
                try {
                    const resp = await fetch(endpoint, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json', 'X-XSRF-TOKEN': xsrfToken},
                        body: JSON.stringify(payload)
                    });
                    const isJson = resp.headers.get('content-type')?.includes('application/json');
                    return {status: resp.status, body: isJson ? await resp.json() : (await resp.text()).substring(0, 1000)};
                } catch(e) {
                    return {status: 0, error: String(e)};
                }
            }
        """, [endpoint, payload, await self._get_xsrf_decoded()])
        logger.info("spie_raw_probe", endpoint=endpoint, nav_id=nav_id,
                    status=result.get("status"))
        return result

    async def _get_xsrf_decoded(self) -> str:
        """URL-decodierten XSRF-TOKEN aus Session-Cookies."""
        cookies = await self._context.cookies()
        raw = next((c["value"] for c in cookies if c["name"] == "XSRF-TOKEN"), "")
        return urllib.parse.unquote(raw)


def _berlin_midnight_utc(d: date) -> str:
    """
    Gibt den UTC-Zeitstempel für Mitternacht (00:00) Berlin-Zeit zurück.

    Berücksichtigt Sommer- (CEST, UTC+2) und Winterzeit (CET, UTC+1).
    """
    try:
        berlin = ZoneInfo("Europe/Berlin")
        midnight_berlin = datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=berlin)
        return midnight_berlin.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        offset_h = 2 if 3 < d.month < 11 else 1
        utc_dt = datetime(d.year, d.month, d.day, 0, 0, 0) - timedelta(hours=offset_h)
        return utc_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
