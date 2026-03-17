#!/usr/bin/env bash
# ===========================================================================
# Startskript für das Energy Management Add-on
# ===========================================================================
# Dieses Skript wird beim Start des Docker-Containers ausgeführt.
# Es liest die Konfiguration aus den HA Add-on-Optionen,
# wartet auf die Datenbank und Redis, führt Migrationen durch
# und startet dann alle benötigten Dienste.
# ===========================================================================

set -e

echo "============================================"
echo "  Energy Management ISO 50001 - Starting"
echo "============================================"

# ── Konfiguration aus HA Add-on-Optionen lesen ──
# Falls bashio verfügbar ist (innerhalb von HA), werden die Werte
# aus der Add-on-Konfiguration gelesen. Ansonsten aus Umgebungsvariablen.
if command -v bashio &> /dev/null; then
    DB_PASSWORD=$(bashio::config 'db_password')
    HA_AUTH_ENABLED=$(bashio::config 'ha_auth_enabled')
    HA_DEFAULT_ROLE=$(bashio::config 'ha_default_role')
    ELECTRICITY_MAPS_API_KEY=$(bashio::config 'electricity_maps_api_key')
    BRIGHT_SKY_ENABLED=$(bashio::config 'bright_sky_enabled')
    LANGUAGE=$(bashio::config 'language')
    LOG_LEVEL=$(bashio::config 'log_level')
    SUPERVISOR_TOKEN="${SUPERVISOR_TOKEN}"
fi

# ── Umgebungsvariablen setzen ──
export DATABASE_URL="${DATABASE_URL:-postgresql+asyncpg://energy:${DB_PASSWORD:-energy}@timescaledb:5432/energy_management}"
export REDIS_URL="${REDIS_URL:-redis://redis:6379/0}"
export SECRET_KEY="${SECRET_KEY:-$(python3 -c 'import secrets; print(secrets.token_hex(32))')}"
export HA_AUTH_ENABLED="${HA_AUTH_ENABLED:-false}"
export HA_DEFAULT_ROLE="${HA_DEFAULT_ROLE:-viewer}"
export ELECTRICITY_MAPS_API_KEY="${ELECTRICITY_MAPS_API_KEY:-}"
export BRIGHT_SKY_ENABLED="${BRIGHT_SKY_ENABLED:-true}"
export LANGUAGE="${LANGUAGE:-de}"
export LOG_LEVEL="${LOG_LEVEL:-info}"
export HA_SUPERVISOR_TOKEN="${SUPERVISOR_TOKEN:-}"
export HA_BASE_URL="${HA_BASE_URL:-http://supervisor/core}"

echo "→ Datenbank-URL: ${DATABASE_URL//:*@//:***@}"
echo "→ Redis-URL: ${REDIS_URL}"
echo "→ Sprache: ${LANGUAGE}"
echo "→ Log-Level: ${LOG_LEVEL}"

# ── Auf Datenbank warten ──
echo "→ Warte auf TimescaleDB..."
MAX_RETRIES=30
RETRY=0
until python3 -c "
import asyncio, asyncpg
async def check():
    conn = await asyncpg.connect('${DATABASE_URL}'.replace('+asyncpg', '').replace('postgresql', 'postgresql'))
    await conn.close()
asyncio.run(check())
" 2>/dev/null; do
    RETRY=$((RETRY + 1))
    if [ $RETRY -ge $MAX_RETRIES ]; then
        echo "✗ TimescaleDB nicht erreichbar nach ${MAX_RETRIES} Versuchen."
        exit 1
    fi
    echo "  Versuch ${RETRY}/${MAX_RETRIES}..."
    sleep 2
done
echo "✓ TimescaleDB erreichbar."

# ── Auf Redis warten ──
echo "→ Warte auf Redis..."
RETRY=0
until python3 -c "
import redis
r = redis.from_url('${REDIS_URL}')
r.ping()
" 2>/dev/null; do
    RETRY=$((RETRY + 1))
    if [ $RETRY -ge $MAX_RETRIES ]; then
        echo "✗ Redis nicht erreichbar nach ${MAX_RETRIES} Versuchen."
        exit 1
    fi
    echo "  Versuch ${RETRY}/${MAX_RETRIES}..."
    sleep 2
done
echo "✓ Redis erreichbar."

# ── Datenbank-Migrationen ausführen ──
echo "→ Führe Datenbank-Migrationen aus..."
cd /app/backend
python3 -m alembic upgrade head
echo "✓ Migrationen abgeschlossen."

# ── Seed-Daten laden (falls noch nicht vorhanden) ──
echo "→ Lade Seed-Daten..."
python3 -c "
import asyncio
from app.core.seed import run_all_seeds
asyncio.run(run_all_seeds())
" 2>/dev/null || echo "⚠ Seed-Daten konnten nicht geladen werden (wird beim nächsten Start erneut versucht)."

# ── Celery Worker starten (Hintergrund-Tasks) ──
echo "→ Starte Celery Worker..."
celery -A app.celery_app worker \
    --loglevel="${LOG_LEVEL}" \
    --concurrency=2 \
    --pool=prefork \
    -Q default,imports,reports,sync \
    &
CELERY_WORKER_PID=$!

# ── Celery Beat starten (Geplante Tasks) ──
echo "→ Starte Celery Beat..."
celery -A app.celery_app beat \
    --loglevel="${LOG_LEVEL}" \
    --schedule=/tmp/celerybeat-schedule \
    &
CELERY_BEAT_PID=$!

# ── Aufräumen bei Beendigung ──
cleanup() {
    echo "→ Beende Dienste..."
    kill $CELERY_WORKER_PID 2>/dev/null || true
    kill $CELERY_BEAT_PID 2>/dev/null || true
    echo "✓ Alle Dienste beendet."
}
trap cleanup EXIT SIGTERM SIGINT

# ── Uvicorn starten (Hauptprozess) ──
echo "============================================"
echo "  ✓ Energy Management gestartet!"
echo "  → Web-Oberfläche: http://0.0.0.0:8099"
echo "============================================"

cd /app
exec uvicorn backend.app.main:create_app \
    --host 0.0.0.0 \
    --port 8099 \
    --factory \
    --log-level "${LOG_LEVEL}" \
    --access-log
