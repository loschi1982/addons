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

# Ports freigeben und auf echte Verfügbarkeit warten.
# Strategie: Bind-Test in Schleife – erst wenn der Bind klappt, ist der Port wirklich frei.
# Das fängt auch Fälle ab, bei denen der Vorprozess in einem anderen PID-Namespace
# läuft und über /proc nicht sichtbar ist (passiert bei --workers mit HA-Restart).
python3 - << 'PYEOF'
import os, socket, time

def ensure_port_free(port, timeout=20):
    hex_port = format(port, '04X')
    deadline = time.time() + timeout
    while time.time() < deadline:
        # Tatsächlich versuchen zu binden – erst dann ist der Port wirklich frei.
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind(('0.0.0.0', port))
            s.close()
            print(f'INFO: Port {port} ist frei.')
            return
        except OSError:
            pass

        # Port belegt – Halter via /proc/net/tcp suchen und beenden.
        for netfile in ('/proc/net/tcp', '/proc/net/tcp6'):
            try:
                for line in open(netfile).readlines()[1:]:
                    parts = line.split()
                    if len(parts) <= 9:
                        continue
                    local = parts[1].upper()
                    state = parts[3]
                    inode = parts[9]
                    if not local.endswith(':' + hex_port) or state != '0A':
                        continue
                    for pid in os.listdir('/proc'):
                        if not pid.isdigit():
                            continue
                        try:
                            for fd in os.listdir(f'/proc/{pid}/fd'):
                                try:
                                    if f'socket:[{inode}]' in os.readlink(f'/proc/{pid}/fd/{fd}'):
                                        print(f'INFO: Beende PID {pid} auf Port {port}')
                                        os.kill(int(pid), 9)
                                except OSError:
                                    pass
                        except OSError:
                            pass
            except OSError:
                pass

        time.sleep(0.5)

    print(f'WARNUNG: Port {port} nach {timeout}s nicht freigegeben – starte trotzdem.')

for p in [8099, 8443]:
    ensure_port_free(p)
PYEOF

# Uvicorn starten – OHNE --workers, d.h. Single-Process-Modus.
# Grund: Mit --workers 1 forkt Uvicorn einen Worker-Prozess. Wenn HA PID 1 beendet,
# läuft der Worker als Waise weiter und hält den Socket – Port-Konflikt beim Neustart.
# Im Single-Process-Modus ist Uvicorn selbst der Server; beim Tod von PID 1 wird der
# Socket sofort freigegeben. SQLite-Kompatibilität bleibt gewahrt (ein Prozess).
cd /app

# HTTP-Server auf Port 8099 für HA Ingress (Seitenleiste).
echo "INFO: Starte Ingress-Server auf Port 8099 (HTTP)..."
python3 -m uvicorn backend.main:app \
    --host 0.0.0.0 \
    --port 8099 &

# HTTPS-Server auf Port 8443 für direkten Zugriff (PWA + Admin).
# exec ersetzt den Shell-Prozess – uvicorn wird PID 1 und empfängt SIGTERM korrekt.
echo "INFO: Starte HTTPS-Server auf Port 8443..."
exec python3 -m uvicorn backend.main:app \
    --host 0.0.0.0 \
    --port 8443 \
    --ssl-keyfile /data/ssl/key.pem \
    --ssl-certfile /data/ssl/cert.pem