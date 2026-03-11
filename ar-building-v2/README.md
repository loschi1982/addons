# AR Building v2

## 1. Was ist AR Building v2?

AR Building v2 ist eine **Augmented-Reality-Führungs-App** für historische Konzerthäuser und ähnliche Gebäude. Besucher scannen mit ihrem Smartphone QR-Codes an Räumen und Exponaten – die App zeigt dann automatisch Infotexte, Audio, Video und Sensordaten direkt in der Kameraansicht an.

Das System besteht aus drei Teilen:
- **PWA Frontend** (Browser-App auf dem Besuchergerät)
- **Admin-Oberfläche** (Verwaltung von Räumen, Objekten und Benutzern)
- **Backend-API** (FastAPI, läuft als Home Assistant Add-on)

---

## 2. Installation

### Schritt 1: Projektdateien bereitstellen

Öffne den **Studio Code Server** in Home Assistant und stelle sicher, dass das Projektverzeichnis unter folgendem Pfad liegt:

```
/addons/ar-building-v2/
```

Falls du das Projekt per Git klonst:
```bash
cd /addons
git clone <repository-url> ar-building-v2
```

### Schritt 2: Add-on in Home Assistant registrieren

1. Öffne die HA-Oberfläche im Browser
2. Gehe zu **Einstellungen → Add-ons → Add-on-Store**
3. Klicke oben rechts auf das **Drei-Punkte-Menü (⋮)**
4. Wähle **Eigene Repositories**
5. Trage den Pfad `/addons` ein und bestätige
6. Lade die Add-on-Liste neu (Seite aktualisieren)
7. Suche nach **„AR Building v2"** und klicke auf **Installieren**

### Schritt 3: Add-on starten

Nach der Installation klicke auf **Starten**. Das Add-on baut beim ersten Start automatisch:
- Ein selbstsigniertes SSL-Zertifikat
- Eine leere Datenbank
- Eine Standard-`settings.json`

---

## 3. Erster Aufruf

### IP-Adresse des HA-Hosts ermitteln

1. Gehe zu **Einstellungen → System → Netzwerk**
2. Notiere die angezeigte IP-Adresse (z. B. `192.168.1.100`)

### App im Browser öffnen

```
https://192.168.1.100:8443
```

> **Hinweis:** Ersetze `192.168.1.100` durch die tatsächliche IP-Adresse deines HA-Hosts.

### SSL-Warnung bestätigen

Beim ersten Aufruf zeigt der Browser eine Sicherheitswarnung, weil das Zertifikat selbstsigniert ist. Das ist **normal und erwartet**. Gehe so vor:

- **Chrome/Edge**: Klicke auf „Erweitert" → „Weiter zu 192.168.1.x (unsicher)"
- **Firefox**: Klicke auf „Risiko akzeptieren und fortfahren"
- **Safari (iOS)**: Tippe auf „Details anzeigen" → „Diese Website trotzdem besuchen"

Diese Bestätigung muss nur **einmalig pro Gerät** durchgeführt werden.

### Erster Admin-Login

Öffne die Admin-Oberfläche unter:
```
https://192.168.1.100:8443/admin
```

Melde dich mit den Standard-Zugangsdaten an:
- **Benutzername**: `admin`
- **PIN**: `4711`

> ⚠️ **Ändere den Standard-PIN sofort nach dem ersten Login!**
> Gehe dazu in der Admin-Oberfläche zu **Benutzer → admin → Bearbeiten**.

---

## 4. Persistente Daten

Die folgenden Verzeichnisse und Dateien bleiben bei Add-on-Updates und Container-Neustarts **vollständig erhalten**:

| Pfad | Inhalt |
|---|---|
| `/data/db/ar_building.db` | SQLite-Datenbank (Räume, Objekte, Benutzer, Statistiken) |
| `/data/uploads/` | Hochgeladene Dateien (ONNX-Modelle, Audiodateien, Videos) |
| `/data/ssl/cert.pem` | SSL-Zertifikat |
| `/data/ssl/key.pem` | Privater SSL-Schlüssel |
| `/data/settings.json` | Konfiguration (HA-URL, Tokens, JWT-Secret) |

---

## 5. Entwicklung mit Studio Code Server

### Typischer Entwicklungs-Workflow

1. Datei im Studio Code Server bearbeiten und speichern (`Strg+S`)
2. In der HA-Oberfläche zum Add-on navigieren
3. Auf **Neu starten** klicken
4. Im **Log-Tab** prüfen, ob das Add-on fehlerfrei gestartet ist
5. Änderungen im Browser testen

### API testen mit Swagger UI

FastAPI stellt automatisch eine interaktive API-Dokumentation bereit:

```
https://192.168.1.100:8443/docs
```

Hier kannst du alle Endpunkte direkt im Browser ausprobieren – inklusive Login, um einen JWT-Token zu erhalten.

### Logs anzeigen

Gehe in der HA-Oberfläche zu **Einstellungen → Add-ons → AR Building v2 → Log**.
Alle `bashio::log.info`-Meldungen aus `run.sh` sowie uvicorn-Ausgaben erscheinen hier in Echtzeit.

---

## 6. Häufige Probleme

### SSL-Warnung erscheint immer wieder
Die einmalige Bestätigung gilt nur für den jeweiligen Browser auf dem jeweiligen Gerät. Jedes neue Gerät muss die Warnung einmalig bestätigen.

### Falsche IP-Adresse im Zertifikat
Das Zertifikat enthält die IP-Adresse, die beim **ersten Start** des Add-ons aktiv war. Wenn sich die Host-IP geändert hat:

1. Lösche den Zertifikatsordner über das Studio Code Server Terminal:
   ```bash
   rm -rf /data/ssl/
   ```
2. Starte das Add-on neu – es erstellt automatisch ein neues Zertifikat mit der aktuellen IP.
3. Bestätige die SSL-Warnung auf allen Geräten erneut.

### Add-on startet nicht
Prüfe das Log unter **Einstellungen → Add-ons → AR Building v2 → Log**. Häufige Ursachen:
- Syntaxfehler in einer Python-Datei
- Fehlende Abhängigkeiten in `requirements.txt`
- Portkonflikt auf Port 8443 (anderer Dienst läuft bereits)

### ONNX-Objekterkennung funktioniert nicht
Die ONNX Runtime läuft **ausschließlich im Browser** (über CDN geladen). Sie ist **nicht** im Docker-Container installiert und wird dort auch nicht benötigt. Wenn die Erkennung nicht klappt:
- Prüfe, ob das ONNX-Modell korrekt hochgeladen wurde (Admin → Räume → Raum bearbeiten)
- Öffne die Browser-Entwicklerkonsole (`F12`) und prüfe auf Fehlermeldungen
- Stelle sicher, dass der Browser WebAssembly unterstützt (alle modernen Browser tun das)

### Kamera wird nicht angezeigt
Die Kamera-API (`getUserMedia`) funktioniert im Browser nur über **HTTPS**. Da das Add-on selbstsigniertes HTTPS verwendet, muss die SSL-Warnung zuvor bestätigt worden sein. Über `http://` oder nach einem verworfenen Zertifikat verweigert der Browser den Kamerazugriff.

### Admin-Oberfläche zeigt leere Seite
Prüfe, ob der Ordner `admin/` im Projektverzeichnis existiert und eine `index.html` enthält. Der Pfad im Container ist `/app/admin/index.html`.