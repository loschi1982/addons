#!/usr/bin/env python3
"""
enrich_spie_meters.py – SPIE-Stammdaten für alle SPIE-Zähler abrufen und speichern.

Für jeden Zähler mit data_source='spie':
  1. name auf ' - ' splitten → display_name = Klarname-Teil
  2. SPIE legacystammdaten/getstammdatendata aufrufen
  3. Felder befüllen: serial_number, installation_date, removal_date, calibration_date

Aufruf:
  python enrich_spie_meters.py

Umgebungsvariablen (oder Defaults aus source_config):
  SPIE_BASE_URL   – z.B. https://energy-as-a-service.spie-es.de
  SPIE_USERNAME   – SPIE-Benutzername
  SPIE_PASSWORD   – SPIE-Passwort
  DATABASE_URL    – PostgreSQL-URL, z.B. postgresql://energy:energy@192.168.178.142:5432/energy_management
"""

import os
import sys
import json
import urllib.parse
from datetime import date, datetime, timezone

import psycopg2
import psycopg2.extras
import requests

# ── Konfiguration ───────────────────────────────────────────────────────────
SPIE_BASE = os.environ.get("SPIE_BASE_URL", "https://energy-as-a-service.spie-es.de")
SPIE_USER = os.environ.get("SPIE_USERNAME", "LoschwitzR")
SPIE_PASS = os.environ.get("SPIE_PASSWORD", "Energie3003!")

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://energy:energy@192.168.178.142:5432/energy_management"
)

DRY_RUN = "--dry-run" in sys.argv


# ── SPIE Auth ────────────────────────────────────────────────────────────────
def login() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
        "Referer":    f"{SPIE_BASE}/",
        "Origin":     SPIE_BASE,
    })
    r = s.post(
        f"{SPIE_BASE}/api/data",
        data={"UserName": SPIE_USER, "Password": SPIE_PASS, "RememberMe": "false"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30,
    )
    r.raise_for_status()
    if "SessionKeyEnMon2014" not in s.cookies:
        raise RuntimeError(f"Login fehlgeschlagen: HTTP {r.status_code}")
    return s


def _xsrf_headers(s: requests.Session) -> dict:
    raw = s.cookies.get("XSRF-TOKEN", "")
    decoded = urllib.parse.unquote(raw)
    return {
        "X-XSRF-TOKEN": decoded,
        "Referer":      f"{SPIE_BASE}/",
        "Content-Type": "application/json",
    }


# ── SPIE Stammdaten ──────────────────────────────────────────────────────────
def get_stammdaten(s: requests.Session, nav_id: str) -> dict | None:
    """
    legacystammdaten/getstammdatendata → zData-Objekt mit Stammdaten.

    Rückgabe-Felder:
      aktZaehlerNr    – aktuelle Seriennummer / Zählernummer
      einbau          – {"dateTimeUtc": "..." | null, ...}  Einbaudatum
      ausbau          – {"dateTimeUtc": "..." | null, ...}  Ausbaudatum
      eichbeglaubigung– {"dateTimeUtc": "..." | null, ...}  Eichfrist
      bezeichnung     – "AKS - Klarname" (voller Name)
    """
    payload = {
        "routeParams":       {"elementType": "z", "elementId": nav_id, "task": "stammdaten"},
        "targetRouteParams": {"elementType": "z", "elementId": nav_id, "task": "stammdaten"},
        "silentErrorHandling": True,
    }
    r = s.post(
        f"{SPIE_BASE}/legacystammdaten/getstammdatendata",
        json=payload,
        headers=_xsrf_headers(s),
        timeout=30,
    )
    if not r.ok:
        return None
    data = r.json().get("data", {})
    return data.get("zData")


# ── Datum parsen ─────────────────────────────────────────────────────────────
def _parse_date(dt_utc: str | None) -> date | None:
    """ISO-8601 UTC-String → date (lokale Datumskomponente)."""
    if not dt_utc:
        return None
    try:
        dt = datetime.fromisoformat(dt_utc.replace("Z", "+00:00"))
        return dt.date()
    except (ValueError, AttributeError):
        return None


# ── Datenbankverbindung ──────────────────────────────────────────────────────
def _pg_connect():
    url = DATABASE_URL
    # einfaches Parsen: postgresql://user:pass@host:port/dbname
    if url.startswith("postgresql://") or url.startswith("postgres://"):
        url = url.split("://", 1)[1]
        creds, rest = url.split("@", 1)
        user, password = creds.split(":", 1)
        hostport, dbname = rest.split("/", 1)
        if ":" in hostport:
            host, port = hostport.split(":", 1)
        else:
            host, port = hostport, "5432"
        return psycopg2.connect(host=host, port=int(port), dbname=dbname,
                                user=user, password=password)
    raise ValueError(f"Unbekanntes DATABASE_URL-Format: {DATABASE_URL}")


# ── Hauptprogramm ─────────────────────────────────────────────────────────────
def main():
    print("Datenbankverbindung herstellen …")
    conn = _pg_connect()
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    # Alle Zähler mit SPIE-Verknüpfung laden (spie + bacnet mit spie_nav_id)
    cur.execute("""
        SELECT id, name, display_name, source_config
        FROM meters
        WHERE is_active = TRUE
          AND (
            data_source = 'spie'
            OR source_config->>'spie_nav_id' IS NOT NULL
          )
        ORDER BY name
    """)
    meters = cur.fetchall()
    print(f"{len(meters)} SPIE-Zähler gefunden.\n")

    if not meters:
        print("Keine SPIE-Zähler gefunden – Abbruch.")
        conn.close()
        return

    print("SPIE Login …")
    s = login()
    print("Login OK\n")

    updated = 0
    skipped = 0
    errors  = []

    for i, m in enumerate(meters, 1):
        meter_id   = str(m["id"])
        name       = m["name"] or ""
        src_cfg    = m["source_config"] or {}
        nav_id     = src_cfg.get("spie_nav_id") or src_cfg.get("nav_id")
        label      = name[:60]

        print(f"[{i:3d}/{len(meters)}] {label:<60}", end=" ", flush=True)

        # Session alle 25 Zähler erneuern
        if i > 1 and (i - 1) % 25 == 0:
            print("\n  ↻ Session-Erneuerung …", end=" ", flush=True)
            try:
                s = login()
                print("OK")
            except Exception as e:
                print(f"FEHLER: {e}")

        # AKS/Klarname aus name splitten
        display_name_from_name: str | None = None
        if " - " in name:
            _, klarname = name.split(" - ", 1)
            display_name_from_name = klarname.strip() or None

        # SPIE-Stammdaten abrufen (nur wenn nav_id bekannt)
        stammdaten_serial:   str | None = None
        stammdaten_install:  date | None = None
        stammdaten_removal:  date | None = None
        stammdaten_calibr:   date | None = None

        if nav_id:
            try:
                zdata = get_stammdaten(s, nav_id)
                if zdata:
                    raw_serial = zdata.get("aktZaehlerNr")
                    stammdaten_serial  = raw_serial.strip() if raw_serial and raw_serial.strip() else None
                    stammdaten_install = _parse_date(
                        (zdata.get("einbau") or {}).get("dateTimeUtc")
                    )
                    stammdaten_removal = _parse_date(
                        (zdata.get("ausbau") or {}).get("dateTimeUtc")
                    )
                    stammdaten_calibr  = _parse_date(
                        (zdata.get("eichbeglaubigung") or {}).get("dateTimeUtc")
                    )
                    # Klarname aus bezeichnung: "AKS - Klarname" → Klarname
                    bezeichnung = (zdata.get("bezeichnung") or "").strip()
                    if " - " in bezeichnung:
                        _, klarname_from_api = bezeichnung.split(" - ", 1)
                        klarname_from_api = klarname_from_api.strip() or None
                        if klarname_from_api:
                            # API-Klarname hat Vorrang vor dem aus dem DB-Namen
                            display_name_from_name = klarname_from_api
            except Exception as e:
                print(f"WARN Stammdaten: {e}", end=" ")
        else:
            print("(kein nav_id)", end=" ")

        if DRY_RUN:
            print(f"DRY | display={display_name_from_name!r} location={display_name_from_name!r} "
                  f"serial={stammdaten_serial!r} "
                  f"install={stammdaten_install} removal={stammdaten_removal} calibr={stammdaten_calibr}")
            skipped += 1
            continue

        # Felder schreiben:
        #   display_name: nur wenn noch nicht gesetzt (COALESCE)
        #   location:     immer überschreiben mit Klarname aus SPIE-Zählernamen
        #   serial/dates: nur wenn noch nicht gesetzt
        try:
            cur.execute("""
                UPDATE meters SET
                    display_name      = COALESCE(display_name, %s),
                    location          = %s,
                    serial_number     = COALESCE(serial_number, %s),
                    installation_date = COALESCE(installation_date, %s),
                    removal_date      = COALESCE(removal_date, %s),
                    calibration_date  = COALESCE(calibration_date, %s),
                    updated_at        = NOW()
                WHERE id = %s
            """, (
                display_name_from_name,
                display_name_from_name,  # location = Klarname (Standort Freitext), immer setzen
                stammdaten_serial,
                stammdaten_install,
                stammdaten_removal,
                stammdaten_calibr,
                meter_id,
            ))
            conn.commit()
            updated += 1
            parts = []
            if display_name_from_name: parts.append(f"name='{display_name_from_name[:30]}'")
            if stammdaten_serial:      parts.append(f"serial='{stammdaten_serial}'")
            if stammdaten_install:     parts.append(f"install={stammdaten_install}")
            if stammdaten_calibr:      parts.append(f"calibr={stammdaten_calibr}")
            print("OK" + (f" [{', '.join(parts)}]" if parts else " [keine Stammdaten]"))
        except Exception as e:
            conn.rollback()
            print(f"DB-FEHLER: {e}")
            errors.append((meter_id, name, str(e)))

    conn.close()

    print(f"\n{'='*60}")
    print(f"Aktualisiert : {updated}")
    print(f"Übersprungen : {skipped}")
    if errors:
        print(f"Fehler       : {len(errors)}")
        for mid, nm, msg in errors:
            print(f"  {nm[:50]}: {msg}")


if __name__ == "__main__":
    main()
