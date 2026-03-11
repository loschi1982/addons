FROM alpine:3.19

# Python 3, pip, openssl (für SSL-Zertifikat in run.sh) und curl installieren.
# --no-cache verhindert, dass der apk-Index im Image gespeichert wird (kleineres Image).
RUN apk add --no-cache python3 py3-pip openssl curl

# Arbeitsverzeichnis im Container setzen.
# Alle folgenden COPY- und RUN-Befehle beziehen sich auf /app.
WORKDIR /app

# Zuerst nur requirements.txt kopieren – Docker-Cache-Optimierung:
# Wenn sich nur der Code ändert (nicht die Abhängigkeiten), wird pip nicht neu ausgeführt.
COPY backend/requirements.txt /app/requirements.txt

# Cache-Buster: Diesen Wert hochzählen erzwingt eine pip-Neuinstallation,
# auch wenn requirements.txt byte-identisch geblieben ist.
# Wann hochzählen: immer wenn neue Pakete nicht im Container ankommen.
# Aktuell: 3
ARG CACHE_BUST=3

# Python-Pakete installieren.
# --break-system-packages ist bei Alpine Linux nötig (kein venv).
# --no-cache-dir spart Speicher im Image.
RUN pip3 install --break-system-packages --no-cache-dir -r /app/requirements.txt

# Backend-, Frontend- und Admin-Dateien in den Container kopieren.
# Pfade sind relativ zum Build-Kontext (= /addons/ar-building-v2/).
COPY backend/ /app/backend/
COPY frontend/ /app/frontend/
COPY admin/ /app/admin/

# Startskript kopieren und ausführbar machen.
# run.sh liegt im Projekt-Root, nicht in einem Unterordner.
COPY run.sh /run.sh
RUN chmod +x /run.sh

# run.sh als PID 1 starten – kein s6-overlay, kein bashio.
CMD ["/run.sh"]