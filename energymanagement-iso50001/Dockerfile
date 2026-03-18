# ===========================================================================
# Dockerfile für das Energy Management ISO 50001 Add-on
# ===========================================================================
# Stage 1: React-Frontend mit Node.js bauen
# Stage 2: Alpine + Python Backend + Frontend-Build
# ===========================================================================

# ── Stage 1: Frontend bauen ──
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build


# ── Stage 2: Alpine-Base mit Python ──
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM ${BUILD_FROM}

# System-Abhängigkeiten
RUN apk add --no-cache \
    # Python + pip:
    python3 \
    py3-pip \
    # Build-Tools für Python C-Extensions:
    gcc \
    g++ \
    musl-dev \
    python3-dev \
    libffi-dev \
    # PostgreSQL:
    postgresql-dev \
    postgresql-client \
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
    bash \
    redis

WORKDIR /app

# Python-Abhängigkeiten installieren
COPY backend/requirements.txt ./backend/
RUN pip3 install --break-system-packages --no-cache-dir -r backend/requirements.txt

# Backend-Code kopieren
COPY backend/ ./backend/

# Frontend-Build aus Stage 1 kopieren
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

WORKDIR /app/backend

# Startskript
COPY run.sh /app/run.sh
RUN chmod +x /app/run.sh

EXPOSE 8099

CMD ["/app/run.sh"]
