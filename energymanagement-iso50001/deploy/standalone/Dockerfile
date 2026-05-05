# ===========================================================================
# Dockerfile – Standalone Energy Management ISO 50001
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
FROM python:3.12-slim

# System-Abhängigkeiten
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Build-Tools für Python C-Extensions:
    gcc \
    g++ \
    libffi-dev \
    # PostgreSQL-Client (für asyncpg):
    libpq-dev \
    postgresql-client \
    # WeasyPrint (PDF):
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libcairo2 \
    libgdk-pixbuf-2.0-0 \
    shared-mime-info \
    fontconfig \
    fonts-freefont-ttf \
    fonts-noto \
    # Playwright/Chromium (SPIE-Import):
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    # Git (für Update-System):
    git \
    # Sonstiges:
    curl \
    bash \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python-Abhängigkeiten installieren
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Playwright-Browser (Chromium) installieren
RUN playwright install chromium --with-deps 2>/dev/null || \
    python -m playwright install chromium --with-deps

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
