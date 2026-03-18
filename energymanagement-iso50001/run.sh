#!/usr/bin/with-contenv bashio
# ===========================================================================
# Startskript für das Energy Management Add-on
# ===========================================================================

echo "============================================"
echo "  Energy Management ISO 50001 - Starting"
echo "============================================"

# ── Konfiguration aus HA Add-on-Optionen lesen ──
DB_PASSWORD=$(bashio::config 'db_password')
HA_AUTH_ENABLED=$(bashio::config 'ha_auth_enabled')
HA_DEFAULT_ROLE=$(bashio::config 'ha_default_role')
ELECTRICITY_MAPS_API_KEY=$(bashio::config 'electricity_maps_api_key')
BRIGHT_SKY_ENABLED=$(bashio::config 'bright_sky_enabled')
LANGUAGE=$(bashio::config 'language')
LOG_LEVEL=$(bashio::config 'log_level')

# ── Umgebungsvariablen setzen ──
export DATABASE_URL="${DATABASE_URL:-postgresql+asyncpg://energy:${DB_PASSWORD:-energy}@timescaledb:5432/energy_management}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export SECRET_KEY="${SECRET_KEY:-$(python3 -c 'import secrets; print(secrets.token_hex(32))')}"
export HA_AUTH_ENABLED="${HA_AUTH_ENABLED:-false}"
export HA_DEFAULT_ROLE="${HA_DEFAULT_ROLE:-viewer}"
export ELECTRICITY_MAPS_API_KEY="${ELECTRICITY_MAPS_API_KEY:-}"
export BRIGHT_SKY_ENABLED="${BRIGHT_SKY_ENABLED:-true}"
export LANGUAGE="${LANGUAGE:-de}"
export LOG_LEVEL="${LOG_LEVEL:-info}"
export HA_SUPERVISOR_TOKEN="${SUPERVISOR_TOKEN:-}"
export HA_BASE_URL="${HA_BASE_URL:-http://supervisor/core}"

bashio::log.info "Datenbank-URL: ${DATABASE_URL//:*@//:***@}"
bashio::log.info "Sprache: ${LANGUAGE}"
bashio::log.info "Log-Level: ${LOG_LEVEL}"

# ── Redis im Container starten (eingebettet) ──
bashio::log.info "Starte Redis..."
redis-server --daemonize yes --loglevel warning
bashio::log.info "Redis gestartet."

# ── Auf Datenbank warten (optional – nur wenn konfiguriert) ──
if [ -n "${DB_PASSWORD}" ]; then
    bashio::log.info "Warte auf TimescaleDB..."
    MAX_RETRIES=30
    RETRY=0
    until python3 -c "
import asyncio, asyncpg
async def check():
    url = '${DATABASE_URL}'.replace('postgresql+asyncpg://', 'postgresql://')
    conn = await asyncpg.connect(url)
    await conn.close()
asyncio.run(check())
" 2>/dev/null; do
        RETRY=$((RETRY + 1))
        if [ $RETRY -ge $MAX_RETRIES ]; then
            bashio::log.warning "TimescaleDB nicht erreichbar – starte ohne DB."
            break
        fi
        bashio::log.info "  DB-Verbindung Versuch ${RETRY}/${MAX_RETRIES}..."
        sleep 2
    done
    if [ $RETRY -lt $MAX_RETRIES ]; then
        bashio::log.info "TimescaleDB erreichbar."

        # Datenbank-Migrationen ausführen
        bashio::log.info "Führe Datenbank-Migrationen aus..."
        cd /app/backend
        python3 -m alembic upgrade head || bashio::log.warning "Migrationen fehlgeschlagen."
        bashio::log.info "Migrationen abgeschlossen."
    fi
else
    bashio::log.info "Kein DB-Passwort konfiguriert – überspringe DB-Verbindung."
    bashio::log.info "Bitte db_password in den Add-on-Optionen setzen."
fi

# ── Celery Worker starten (Hintergrund-Tasks) ──
bashio::log.info "Starte Celery Worker..."
cd /app/backend
celery -A app.tasks worker \
    --loglevel="${LOG_LEVEL}" \
    --concurrency=2 \
    --pool=prefork \
    -Q default,imports,reports,sync \
    &
CELERY_WORKER_PID=$!

# ── Celery Beat starten (Geplante Tasks) ──
bashio::log.info "Starte Celery Beat..."
celery -A app.tasks beat \
    --loglevel="${LOG_LEVEL}" \
    --schedule=/tmp/celerybeat-schedule \
    &
CELERY_BEAT_PID=$!

# ── Aufräumen bei Beendigung ──
cleanup() {
    bashio::log.info "Beende Dienste..."
    kill $CELERY_WORKER_PID 2>/dev/null || true
    kill $CELERY_BEAT_PID 2>/dev/null || true
    redis-cli shutdown 2>/dev/null || true
    bashio::log.info "Alle Dienste beendet."
}
trap cleanup EXIT SIGTERM SIGINT

# ── Uvicorn starten (Hauptprozess) ──
echo "============================================"
echo "  ✓ Energy Management gestartet!"
echo "  → Web-Oberfläche: http://0.0.0.0:8099"
echo "============================================"

cd /app/backend
exec uvicorn app.main:create_app \
    --host 0.0.0.0 \
    --port 8099 \
    --factory \
    --log-level "${LOG_LEVEL}" \
    --access-log
