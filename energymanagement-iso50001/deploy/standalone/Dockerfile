# ===========================================================================
# Dockerfile – Standalone Energy Management ISO 50001
# ===========================================================================
# Verwendet das vorgebaute Frontend aus frontend/dist/.
# Frontend wird auf der Entwicklungsmaschine gebaut (npm run build)
# und ins Repository committed.
#
# Externe Dienste (TimescaleDB, Redis) werden via docker-compose bereitgestellt.
# ===========================================================================

FROM python:3.12-alpine

# System-Abhängigkeiten
RUN apk add --no-cache \
    # Build-Tools für Python C-Extensions:
    gcc \
    g++ \
    musl-dev \
    libffi-dev \
    # PostgreSQL-Client (für asyncpg):
    postgresql16-dev \
    postgresql16-client \
    # WeasyPrint (PDF):
    pango \
    cairo \
    cairo-dev \
    gdk-pixbuf \
    shared-mime-info \
    fontconfig \
    ttf-freefont \
    font-noto \
    # Git (für Update-System):
    git \
    # Sonstiges:
    curl \
    bash

WORKDIR /app

# Python-Abhängigkeiten installieren
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Backend-Code kopieren
COPY backend/ ./backend/

# Vorgebautes Frontend kopieren
COPY frontend/dist ./frontend/dist

# VERSION-Datei kopieren
COPY VERSION ./VERSION

# Startskript
COPY deploy/standalone/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Upload-Verzeichnis
RUN mkdir -p /data/uploads

WORKDIR /app/backend

EXPOSE 8099

ENTRYPOINT ["/app/entrypoint.sh"]
