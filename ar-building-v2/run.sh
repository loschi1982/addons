#!/bin/sh

# Persistente Verzeichnisse anlegen.
# /data ist der HA-Standard für Add-on-Daten, die Add-on-Updates überleben.
# -p verhindert Fehler, wenn das Verzeichnis bereits existiert.
mkdir -p /data/uploads
mkdir -p /data/db
mkdir -p /data/ssl

# LAN-IP des Hosts ermitteln.
# "scope global" filtert lokale Adressen (127.0.0.1, ::1) heraus.
# Wir nehmen die erste gefundene globale IPv4-Adresse – das ist die LAN-IP.
# awk extrahiert die IP mit Prefix (z.B. "192.168.1.100/24"), cut entfernt "/24".
HOST_IP=$(ip -4 addr show scope global | grep inet | head -1 | awk '{print $2}' | cut -d/ -f1)
echo "INFO: Host-IP: ${HOST_IP}"

# SSL-Zertifikat erstellen – nur beim ersten Start.
# Das Zertifikat ist selbstsigniert und gilt für die ermittelte LAN-IP.
# -nodes = kein Passwort auf dem privaten Schlüssel (nötig für automatischen Start).
# subjectAltName = damit moderne Browser die IP im Zertifikat akzeptieren.
if [ ! -f /data/ssl/cert.pem ]; then
    echo "INFO: Erstelle selbstsigniertes SSL-Zertifikat..."
    openssl req -x509 -newkey rsa:4096 \
        -keyout /data/ssl/key.pem \
        -out /data/ssl/cert.pem \
        -days 3650 -nodes \
        -subj "/CN=${HOST_IP}" \
        -addext "subjectAltName=IP:${HOST_IP}"
fi

# Standard-Einstellungen anlegen – nur beim ersten Start.
# jwt_secret wird zufällig generiert (32 Byte = 64 Hex-Zeichen).
# Die Datei bleibt bei Updates erhalten (liegt in /data).
if [ ! -f /data/settings.json ]; then
    echo "INFO: Erstelle Standard-Einstellungen..."
    JWT_SECRET=$(openssl rand -hex 32)
    cat > /data/settings.json << EOF
{
  "ha_url": "",
  "ha_token": "",
  "planradar_token": "",
  "jwt_secret": "${JWT_SECRET}",
  "jwt_expire_hours": 12
}
EOF
fi

# Ports freigeben falls noch von vorheriger Instanz belegt.
# Nötig bei schnellem Neustart mit host_network: true (OS-Socket noch aktiv).
# ss gibt "pid=X" aus – wir lesen die PID und senden SIGKILL.
for PORT in 8099 8443; do
    PIDS=$(ss -Hlntp "sport = :${PORT}" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2)
    for PID in $PIDS; do
        echo "INFO: Beende alten Prozess PID ${PID} auf Port ${PORT}..."
        kill -9 "$PID" 2>/dev/null || true
    done
done

# Uvicorn starten.
# --workers 1 = ein Prozess (SQLite ist nicht für mehrere Prozesse geeignet).
cd /app

# HTTP-Server auf Port 8099 für HA Ingress (Seitenleiste).
# HA übernimmt die HTTPS-Terminierung – der Add-on selbst spricht HTTP.
echo "INFO: Starte Ingress-Server auf Port 8099 (HTTP)..."
python3 -m uvicorn backend.main:app \
    --host 0.0.0.0 \
    --port 8099 \
    --workers 1 &

# HTTPS-Server auf Port 8443 für direkten Zugriff (PWA + Admin).
# exec ersetzt den Shell-Prozess – uvicorn wird PID 1 und empfängt SIGTERM korrekt.
echo "INFO: Starte HTTPS-Server auf Port 8443..."
exec python3 -m uvicorn backend.main:app \
    --host 0.0.0.0 \
    --port 8443 \
    --ssl-keyfile /data/ssl/key.pem \
    --ssl-certfile /data/ssl/cert.pem \
    --workers 1