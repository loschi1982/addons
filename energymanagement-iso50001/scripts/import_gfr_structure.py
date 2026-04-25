#!/usr/bin/env python3
"""
GFR Webencon → Energiemanagementsystem Import-Skript
Importiert Zählerstruktur (Sites, Buildings, Meters) aus der GFR-Backup-CSV.

Verwendung:
  python3 import_gfr_structure.py --dry-run   # Nur anzeigen, nichts anlegen
  python3 import_gfr_structure.py             # Echten Import durchführen
"""

import csv
import json
import sys
import argparse
import requests
from collections import defaultdict

API_BASE = "http://localhost:8099/api/v1"
ADMIN_USER = "admin"
ADMIN_PASS = "4711lolo"
CSV_FILE = "/opt/gfr-backup/verbrauchsstellen.csv"

# Mapping GFR Verbrauchsstelle-Typ → Energiemanagementsystem energy_type
TYP_TO_ENERGY = {
    1: "Wärme",
    2: "Kälte",
    3: "Wasser",
    4: "Strom",    # ELZ
    5: "Strom",    # KNX/Elektro
}

# Mapping GFR Einheit → unser System
EINHEIT_MAP = {
    "MWh": "MWh",
    "kWh": "kWh",
    "m³":  "m³",
}

# Mapping z_Nummer-Präfix → Energietyp (für Fälle ohne FK_Energiedaten_ID)
BEZEICHNUNG_ENERGY = {
    "WMZ": "Wärme",
    "KMZ": "Kälte",
    "KWZ": "Wasser",
    "ELZ": "Strom",
}


def get_token():
    r = requests.post(f"{API_BASE}/auth/login", json={
        "username": ADMIN_USER, "password": ADMIN_PASS
    })
    r.raise_for_status()
    return r.json()["access_token"]


def api_get(token, path):
    r = requests.get(f"{API_BASE}{path}",
                     headers={"Authorization": f"Bearer {token}"})
    r.raise_for_status()
    return r.json()


def api_post(token, path, data, dry_run=False):
    if dry_run:
        print(f"  [DRY-RUN] POST {path}: {json.dumps(data, ensure_ascii=False)[:120]}")
        return {"id": f"dry-{hash(str(data)) % 100000}"}
    r = requests.post(f"{API_BASE}{path}",
                      headers={"Authorization": f"Bearer {token}"},
                      json=data)
    if not r.ok:
        print(f"  FEHLER {r.status_code}: {r.text[:200]}")
        return None
    return r.json()


def guess_energy_type(bezeichnung, einheit, typ):
    # Aus Bezeichnung (z.B. "A07011-ZAE001LST018WMZ074")
    for code, etype in BEZEICHNUNG_ENERGY.items():
        if code in bezeichnung:
            return etype
    # Aus Typ-Code
    if typ and int(typ) in TYP_TO_ENERGY:
        return TYP_TO_ENERGY[int(typ)]
    # Aus Einheit als Fallback
    if einheit == "m³":
        return "Wasser"
    return "Strom"


def run_import(dry_run=False):
    print(f"{'[DRY-RUN] ' if dry_run else ''}GFR Webencon Import gestartet\n")

    token = get_token()
    print("Anmeldung OK")

    # CSV laden
    rows = []
    with open(CSV_FILE, encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="|")
        for row in reader:
            vid = row.get("Verbrauchsstelle_ID", "")
            # Trennzeilen und SQL-Footer überspringen
            if not vid or vid.startswith("-") or not vid.strip().lstrip("-").isdigit():
                continue
            # Zeilen ohne Gebäude/Liegenschaft überspringen
            if not row.get("Liegenschaft_ID") or not row.get("Gebaeude_ID"):
                continue
            rows.append(row)
    print(f"{len(rows)} Verbrauchsstellen aus CSV geladen\n")

    # Liegenschaften → Sites
    liegenschaften = {}
    for row in rows:
        lid = row["Liegenschaft_ID"]
        liegenschaften[lid] = row["Liegenschaft"]

    site_ids = {}
    print("=== 1. Sites anlegen ===")
    for lid, lname in sorted(liegenschaften.items(), key=lambda x: x[0]):
        result = api_post(token, "/sites", {
            "name": lname,
            "description": f"Importiert aus GFR Webencon (Liegenschaft {lid})",
            "address": "Platz der Deutschen Einheit 1, 20457 Hamburg",
            "city": "Hamburg",
            "country": "DE",
        }, dry_run)
        if result:
            site_ids[lid] = result.get("id")
            print(f"  Site '{lname}' → {site_ids[lid]}")

    # Gebäude → Buildings
    gebaeude = {}
    for row in rows:
        gid = row["Gebaeude_ID"]
        lid = row["Liegenschaft_ID"]
        gebaeude[gid] = (row["Gebaeude"], lid)

    building_ids = {}
    print("\n=== 2. Gebäude anlegen ===")
    for gid, (gname, lid) in sorted(gebaeude.items(), key=lambda x: int(x[0])):
        site_id = site_ids.get(lid)
        if not site_id:
            continue
        result = api_post(token, f"/sites/{site_id}/buildings", {
            "name": gname,
            "site_id": site_id,
        }, dry_run)
        if result:
            building_ids[gid] = result.get("id")
            print(f"  Gebäude '{gname}' (Liegenschaft {lid}) → {building_ids[gid]}")

    # Zähler anlegen
    print("\n=== 3. Zähler anlegen ===")
    meter_ids = {}
    skipped = 0
    created = 0

    for row in rows:
        vid = row["Verbrauchsstelle_ID"]
        bezeichnung = row["v_Bezeichnung"].strip()
        z_nummer = row["z_Nummer"].strip() if row["z_Nummer"] else ""
        einheit = row["Einheit"].strip() if row["Einheit"] else "kWh"
        typ = row["Typ"].strip() if row["Typ"] else ""
        standort = row["z_Standort"].strip() if row["z_Standort"] else ""
        gid = row["Gebaeude_ID"]
        lid = row["Liegenschaft_ID"]
        typenbezeichnung = row["z_Typenbezeichnung"].strip() if row["z_Typenbezeichnung"] else ""

        energy_type = guess_energy_type(bezeichnung, einheit, typ)
        unit = EINHEIT_MAP.get(einheit, einheit)

        building_id = building_ids.get(gid)
        site_id = site_ids.get(lid)

        meter_data = {
            "name": bezeichnung,
            "meter_number": z_nummer if z_nummer else None,
            "energy_type": energy_type,
            "unit": unit,
            "data_source": "manual",
            "location": standort if standort else None,
            "site_id": site_id,
            "building_id": building_id,
            "notes": f"GFR VS-ID: {vid}, Typ: {typenbezeichnung}",
        }

        result = api_post(token, "/meters", meter_data, dry_run)
        if result:
            meter_ids[vid] = result.get("id")
            created += 1
            if created % 25 == 0:
                print(f"  {created} Zähler angelegt...")
        else:
            skipped += 1

    print(f"\nFertig: {created} Zähler angelegt, {skipped} übersprungen")
    print(f"Sites: {len(site_ids)}, Gebäude: {len(building_ids)}, Zähler: {created}")

    # Mapping speichern für späteren Messwerte-Import
    mapping_file = "/opt/gfr-backup/vs_to_meter_mapping.json"
    if not dry_run:
        with open(mapping_file, "w") as f:
            json.dump({
                "site_ids": site_ids,
                "building_ids": building_ids,
                "meter_ids": meter_ids,
            }, f, indent=2)
        print(f"\nMapping gespeichert: {mapping_file}")
    else:
        print(f"\n[DRY-RUN] Mapping würde gespeichert werden: {mapping_file}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true",
                        help="Nur anzeigen, nichts anlegen")
    args = parser.parse_args()
    run_import(dry_run=args.dry_run)
