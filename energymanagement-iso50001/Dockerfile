# ===========================================================================
# Multi-Stage Dockerfile für das Energy Management Add-on
# ===========================================================================
# Stage 1: React-Frontend wird mit Node.js gebaut (nur zum Bauen nötig)
# Stage 2: Python-Backend + fertige Frontend-Dateien = fertiges Image
#
# Warum Multi-Stage? Das finale Image enthält kein Node.js, nur Python.
# Das spart ~500 MB Speicherplatz im fertigen Container.
# ===========================================================================

# ── Stage 1: Frontend bauen ──
# Node.js wird nur benötigt, um React/TypeScript in statische HTML/JS/CSS
# Dateien zu kompilieren. Diese Dateien werden dann ins Python-Image kopiert.
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Zuerst nur package.json kopieren → Docker-Cache-Optimierung:
# Wenn sich nur Code ändert, aber nicht die Abhängigkeiten,
# muss npm ci nicht erneut laufen (spart Build-Zeit)
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund

# Jetzt den Rest des Frontend-Codes kopieren und bauen
COPY frontend/ ./
RUN npm run build


# ── Stage 2: Python-Backend + Frontend-Dateien ──
FROM python:3.12-slim AS production

# System-Abhängigkeiten für WeasyPrint (PDF-Generierung)
# und PostgreSQL-Client (Datenbank-Verbindung)
RUN apt-get update && apt-get install -y --no-install-recommends \
    # WeasyPrint benötigt diese Bibliotheken für HTML→PDF:
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libcairo2 \
    libgdk-pixbuf-2.0-0 \
    libffi-dev \
    shared-mime-info \
    # PostgreSQL-Client für DB-Verbindung und Migrationen:
    libpq-dev \
    gcc \
    # Für Gesundheitschecks und Netzwerk-Debugging:
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python-Abhängigkeiten installieren
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Backend-Code kopieren
COPY backend/ ./backend/

# Frontend-Build aus Stage 1 kopieren
# Nur die fertigen statischen Dateien (HTML, JS, CSS), kein Node.js
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Arbeitsverzeichnis für Backend-Imports (from app.xxx)
WORKDIR /app/backend

# Startskript kopieren und ausführbar machen
COPY run.sh /app/run.sh
RUN chmod +x /app/run.sh

# Port für die Web-Oberfläche
EXPOSE 8099

# Gesundheitscheck: Prüft ob der Server antwortet
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8099/api/v1/health || exit 1

# Startbefehl
CMD ["/app/run.sh"]
