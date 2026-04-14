# ===========================================================================
# Dockerfile – Energy Management ISO 50001
# ===========================================================================
# Multi-Stage Build:
#   1. Frontend mit Node.js bauen (npm run build)
#   2. Backend + fertiges Frontend in schlankes Python-Image kopieren
#
# Externe Dienste (TimescaleDB, Redis) werden via docker-compose bereitgestellt.
# ===========================================================================

# ── Stage 1: Frontend bauen ──
FROM node:20-alpine AS frontend-builder

WORKDIR /build

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ── Stage 2: Backend + Frontend zusammenführen ──
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
    # Sonstiges:
    curl \
    bash

WORKDIR /app

# Python-Abhängigkeiten installieren
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Backend-Code kopieren
COPY backend/ ./backend/

# Frontend aus Stage 1 kopieren
COPY --from=frontend-builder /build/dist ./frontend/dist

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
