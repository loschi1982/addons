# ===========================================================================
# Dockerfile – Standalone Energy Management ISO 50001
# ===========================================================================
# Mehrstufiger Build:
#   Stage 1: React-Frontend mit Node.js bauen
#   Stage 2: Python-Backend mit allen Abhängigkeiten
#
# Externe Dienste (TimescaleDB, Redis) werden via docker-compose bereitgestellt.
# ===========================================================================

# ── Stage 1: Frontend bauen ──
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build


# ── Stage 2: Python-Backend ──
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

# Frontend-Build aus Stage 1 kopieren
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

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
