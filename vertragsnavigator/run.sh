#!/usr/bin/env sh
# Startet den Vertragsnavigator (FastAPI via uvicorn).
# Liest die HA-Add-on-Optionen aus /data/options.json und reicht sie als
# Umgebungsvariablen weiter.
set -e

leseoption() {
    python3 - "$1" <<'PY'
import json, sys
try:
    with open("/data/options.json") as fh:
        daten = json.load(fh)
    print(daten.get(sys.argv[1], ""))
except Exception:
    print("")
PY
}

PAPERLESS_URL="$(leseoption paperless_url)"
PAPERLESS_TOKEN="$(leseoption paperless_token)"
export PAPERLESS_URL
export PAPERLESS_TOKEN
export VN_DB_PATH="/data/vertragsnavigator.db"

echo "[Vertragsnavigator] Paperless-URL: ${PAPERLESS_URL:-<nicht gesetzt>}"
echo "[Vertragsnavigator] Datenbank: ${VN_DB_PATH}"

cd /app
exec python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8099
