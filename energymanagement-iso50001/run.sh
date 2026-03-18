#!/usr/bin/with-contenv bashio
# ===========================================================================
# Startskript für das Energy Management Add-on
# ===========================================================================
# Startet alle eingebetteten Dienste:
#   1. PostgreSQL (TimescaleDB-Daten in /data/postgresql)
#   2. Redis (In-Memory, für Celery)
#   3. Celery Worker + Beat
#   4. Uvicorn (FastAPI Backend + Frontend)
# ===========================================================================

echo "============================================"
echo "  Energy Management ISO 50001 - Starting"
echo "============================================"

# ── Konfiguration aus HA Add-on-Optionen lesen ──
HA_AUTH_ENABLED=$(bashio::config 'ha_auth_enabled')
HA_DEFAULT_ROLE=$(bashio::config 'ha_default_role')
ELECTRICITY_MAPS_API_KEY=$(bashio::config 'electricity_maps_api_key')
BRIGHT_SKY_ENABLED=$(bashio::config 'bright_sky_enabled')
LANGUAGE=$(bashio::config 'language')
LOG_LEVEL=$(bashio::config 'log_level')

# ── Umgebungsvariablen setzen ──
export DATABASE_URL="postgresql+asyncpg://energy:energy@localhost:5432/energy_management"
export REDIS_URL="redis://localhost:6379/0"
export SECRET_KEY="${SECRET_KEY:-$(python3 -c 'import secrets; print(secrets.token_hex(32))')}"
export HA_AUTH_ENABLED="${HA_AUTH_ENABLED:-false}"
export HA_DEFAULT_ROLE="${HA_DEFAULT_ROLE:-viewer}"
export ELECTRICITY_MAPS_API_KEY="${ELECTRICITY_MAPS_API_KEY:-}"
export BRIGHT_SKY_ENABLED="${BRIGHT_SKY_ENABLED:-true}"
export LANGUAGE="${LANGUAGE:-de}"
export LOG_LEVEL="${LOG_LEVEL:-info}"
export HA_SUPERVISOR_TOKEN="${SUPERVISOR_TOKEN:-}"
export HA_BASE_URL="${HA_BASE_URL:-http://supervisor/core}"

bashio::log.info "Sprache: ${LANGUAGE}"
bashio::log.info "Log-Level: ${LOG_LEVEL}"

# ── PostgreSQL starten (eingebettet im Container) ──
PG_DATA="/data/postgresql"
PG_RUN="/run/postgresql"

# Verzeichnisse sicherstellen
mkdir -p "${PG_DATA}" "${PG_RUN}"
chown -R postgres:postgres "${PG_DATA}" "${PG_RUN}"

# Beim ersten Start: Datenbank-Cluster initialisieren
if [ ! -f "${PG_DATA}/PG_VERSION" ]; then
    bashio::log.info "Erster Start – initialisiere PostgreSQL-Cluster..."
    su-exec postgres initdb -D "${PG_DATA}" --encoding=UTF8 --locale=C

    # pg_hba.conf: Lokale Verbindungen ohne Passwort erlauben
    cat > "${PG_DATA}/pg_hba.conf" <<PGEOF
local   all   all                 trust
host    all   all   127.0.0.1/32  trust
host    all   all   ::1/128       trust
PGEOF

    # postgresql.conf: Anpassungen für Container-Betrieb
    cat >> "${PG_DATA}/postgresql.conf" <<PGEOF

# Container-Optimierungen
listen_addresses = 'localhost'
port = 5432
max_connections = 50
shared_buffers = 64MB
work_mem = 4MB
maintenance_work_mem = 32MB
unix_socket_directories = '${PG_RUN}'
logging_collector = off
log_destination = 'stderr'
PGEOF

    bashio::log.info "PostgreSQL-Cluster initialisiert."
fi

# PostgreSQL-Server starten
bashio::log.info "Starte PostgreSQL..."
su-exec postgres pg_ctl -D "${PG_DATA}" -l /dev/null start -w -t 30

# Warten bis PostgreSQL bereit ist
bashio::log.info "Warte auf PostgreSQL..."
RETRY=0
MAX_RETRIES=15
until su-exec postgres pg_isready -q 2>/dev/null; do
    RETRY=$((RETRY + 1))
    if [ $RETRY -ge $MAX_RETRIES ]; then
        bashio::log.error "PostgreSQL nicht gestartet nach ${MAX_RETRIES} Versuchen!"
        exit 1
    fi
    sleep 1
done
bashio::log.info "PostgreSQL bereit."

# Beim ersten Start: Benutzer und Datenbank anlegen
if ! su-exec postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='energy'" | grep -q 1; then
    bashio::log.info "Erstelle Datenbankbenutzer 'energy'..."
    su-exec postgres psql -c "CREATE ROLE energy WITH LOGIN PASSWORD 'energy';"
fi

if ! su-exec postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='energy_management'" | grep -q 1; then
    bashio::log.info "Erstelle Datenbank 'energy_management'..."
    su-exec postgres psql -c "CREATE DATABASE energy_management OWNER energy;"
fi

bashio::log.info "PostgreSQL läuft auf localhost:5432"

# ── Redis starten (eingebettet im Container) ──
bashio::log.info "Starte Redis..."
redis-server --daemonize yes --loglevel warning
bashio::log.info "Redis gestartet."

# ── Datenbank-Migrationen ausführen ──
bashio::log.info "Führe Datenbank-Migrationen aus..."
cd /app/backend
python3 -m alembic upgrade head 2>&1 || bashio::log.warning "Migrationen fehlgeschlagen (werden beim ersten Start übersprungen)."
bashio::log.info "Migrationen abgeschlossen."

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
    su-exec postgres pg_ctl -D "${PG_DATA}" stop -m fast 2>/dev/null || true
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
