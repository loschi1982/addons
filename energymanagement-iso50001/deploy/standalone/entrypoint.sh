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

# Redis-Check entfällt: docker-compose wartet via depends_on + healthcheck
echo "Redis bereit (via Docker Healthcheck)."

# ── Datenbank-Migrationen ──
echo "Führe Datenbank-Migrationen aus..."
cd /app/backend
python3 -m alembic upgrade head 2>&1 || echo "WARNUNG: Migrationen fehlgeschlagen."
echo "Migrationen abgeschlossen."

# ── Redis: Alte Task-Queue und Task-Ergebnisse bereinigen ──
echo "Bereinige Redis-Queue..."
python3 -c "
import redis, os
r = redis.from_url(os.environ.get('REDIS_URL', 'redis://redis:6379/0'))
purged = r.delete('celery')
# Alte Task-Meta-Ergebnisse löschen
meta_keys = r.keys('celery-task-meta-*')
if meta_keys:
    r.delete(*meta_keys)
    print(f'  {len(meta_keys)} alte Task-Ergebnisse gelöscht')
print(f'  Queue bereinigt (purged={purged})')
" 2>&1 || echo "WARNUNG: Redis-Bereinigung fehlgeschlagen."

# ── Celery Worker starten ──
echo "Starte Celery Worker..."
celery -A app.tasks worker \
    --loglevel="${LOG_LEVEL:-info}" \
    --concurrency=1 \
    --pool=prefork \
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
