#!/bin/bash
# ===========================================================================
# Entrypoint – Standalone Energy Management ISO 50001
# ===========================================================================
# Wartet auf PostgreSQL + Redis, führt Migrationen aus, startet alle Dienste.
# ===========================================================================

set -e

echo "============================================"
echo "  Energy Management ISO 50001 - Starting"
echo "============================================"

# ── Auf PostgreSQL warten ──
echo "Warte auf PostgreSQL (${DATABASE_URL})..."
RETRY=0
MAX_RETRIES=30
until pg_isready -h "${DB_HOST:-timescaledb}" -p "${DB_PORT:-5432}" -U "${DB_USER:-energy}" -q 2>/dev/null; do
    RETRY=$((RETRY + 1))
    if [ $RETRY -ge $MAX_RETRIES ]; then
        echo "FEHLER: PostgreSQL nicht erreichbar nach ${MAX_RETRIES} Versuchen!"
        exit 1
    fi
    sleep 1
done
echo "PostgreSQL bereit."

# ── Auf Redis warten (TCP-Check, kein redis-cli nötig) ──
echo "Warte auf Redis..."
RETRY=0
REDIS_H="${REDIS_HOST:-redis}"
REDIS_P="${REDIS_PORT:-6379}"
until python3 -c "import socket; s=socket.create_connection(('${REDIS_H}', ${REDIS_P}), 2); s.send(b'PING\r\n'); assert b'PONG' in s.recv(64); s.close()" 2>/dev/null; do
    RETRY=$((RETRY + 1))
    if [ $RETRY -ge $MAX_RETRIES ]; then
        echo "FEHLER: Redis nicht erreichbar nach ${MAX_RETRIES} Versuchen!"
        exit 1
    fi
    sleep 1
done
echo "Redis bereit."

# ── Datenbank-Migrationen ──
echo "Führe Datenbank-Migrationen aus..."
cd /app/backend
python3 -m alembic upgrade head 2>&1 || echo "WARNUNG: Migrationen fehlgeschlagen."
echo "Migrationen abgeschlossen."

# ── Celery Worker starten ──
echo "Starte Celery Worker..."
celery -A app.tasks worker \
    --loglevel="${LOG_LEVEL:-info}" \
    --concurrency=2 \
    --pool=prefork \
    -Q default,imports,reports,sync \
    &
CELERY_WORKER_PID=$!

# ── Celery Beat starten ──
echo "Starte Celery Beat..."
celery -A app.tasks beat \
    --loglevel="${LOG_LEVEL:-info}" \
    --schedule=/tmp/celerybeat-schedule \
    &
CELERY_BEAT_PID=$!

# ── Aufräumen bei Beendigung ──
cleanup() {
    echo "Beende Dienste..."
    kill $CELERY_WORKER_PID 2>/dev/null || true
    kill $CELERY_BEAT_PID 2>/dev/null || true
    echo "Alle Dienste beendet."
}
trap cleanup EXIT SIGTERM SIGINT

# ── Uvicorn starten (Hauptprozess) ──
echo "============================================"
echo "  Energy Management gestartet!"
echo "  Web-Oberflaeche: http://0.0.0.0:8099"
echo "============================================"

exec uvicorn app.main:create_app \
    --host 0.0.0.0 \
    --port 8099 \
    --factory \
    --log-level "${LOG_LEVEL:-info}" \
    --access-log
