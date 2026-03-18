# ===========================================================================
# Dockerfile für das Energy Management ISO 50001 Add-on
# ===========================================================================
# Stage 1: React-Frontend mit Node.js bauen
# Stage 2: HA-Base-Image (Alpine) + Python-Backend + Frontend-Build
# ===========================================================================

# ── Stage 1: Frontend bauen ──
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# package.json zuerst → Docker-Cache-Optimierung
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund

# Frontend-Code kopieren und bauen
COPY frontend/ ./
RUN npm run build


# ── Stage 2: HA-Base-Image + Backend ──
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-python:3.12-alpine3.19
FROM $BUILD_FROM

# System-Abhängigkeiten (Alpine: apk statt apt-get)
RUN apk add --no-cache \
    # Build-Tools für Python-Pakete mit C-Extensions:
    gcc \
    g++ \
    musl-dev \
    libffi-dev \
    # PostgreSQL-Client:
    postgresql-dev \
    # WeasyPrint-Abhängigkeiten:
    pango \
    cairo \
    gdk-pixbuf \
    shared-mime-info \
    fontconfig \
    ttf-freefont \
    # Für Gesundheitschecks:
    curl \
    # bash für run.sh und bashio:
    bash

WORKDIR /app

# Python-Abhängigkeiten installieren
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Backend-Code kopieren
COPY backend/ ./backend/

# Frontend-Build aus Stage 1 kopieren
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Seed-Daten und Alembic
WORKDIR /app/backend

# Startskript kopieren
COPY run.sh /app/run.sh
RUN chmod +x /app/run.sh

# Port für die Web-Oberfläche
EXPOSE 8099

# Gesundheitscheck
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8099/api/v1/health || exit 1

# Startbefehl
CMD ["/app/run.sh"]
