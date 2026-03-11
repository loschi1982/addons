# AR Building v2

## 1. Was ist AR Building v2?

AR Building v2 ist eine **Augmented-Reality-Führungs-App** für historische Konzerthäuser und ähnliche Gebäude. Besucher scannen mit ihrem Smartphone QR-Codes an Räumen und Exponaten – die App zeigt dann automatisch Infotexte, Audio, Video und Sensordaten direkt in der Kameraansicht an.

Das System besteht aus drei Teilen:
- **PWA Frontend** (Browser-App auf dem Besuchergerät)
- **Admin-Oberfläche** (Verwaltung von Räumen, Objekten und Benutzern – auch als HA-Seitenleistenpanel)
- **Backend-API** (FastAPI, läuft als Home Assistant Add-on)

---

## 2. Installation

### Schritt 1: Repository in Home Assistant einbinden

1. Öffne die HA-Oberfläche im Browser
2. Gehe zu **Einstellungen → Add-ons → Add-on-Store**
3. Klicke oben rechts auf das **Drei-Punkte-Menü (⋮)**
4. Wähle **Eigene Repositories**
5. Trage folgende URL ein und bestätige:
   ```
   https://github.com/loschi1982/addons
   ```
6. Lade die Add-on-Liste neu (Seite aktualisieren)
7. Suche nach **„AR Building v2"** und klicke auf **Installieren**

### Schritt 2: Add-on starten

Nach der Installation klicke auf **Starten**. Das Add-on richtet beim ersten Start automatisch ein:
- Ein selbstsigniertes SSL-Zertifikat für den konfigurierten HTTPS-Port
- Eine leere SQLite-Datenbank
- Eine `settings.json` mit zufällig generiertem JWT-Secret
- Einen Admin-Benutzer mit zufälligem 4-stelligem PIN

> **Hinweis:** Der Standard-HTTPS-Port ist **8444**. Falls dieser Port auf deinem System bereits belegt ist (z.B. durch ein anderes Add-on), kannst du ihn unter **Einstellungen → Add-ons → AR Building v2 → Konfiguration** anpassen.

---

## 3. Erster Login

### Initialen Admin-PIN herausfinden

Der PIN wird beim **allerersten Start** im Add-on-Log angezeigt. Gehe zu:

**Einstellungen → Add-ons → AR Building v2 → Log**

Suche nach der Zeile:
```
INFO: *** INITIALER ADMIN-PIN: XXXX — bitte sofort ändern! ***
```

> ⚠️ **Ändere den PIN sofort nach dem ersten Login!**
> Admin-Oberfläche → Benutzer → admin → Bearbeiten

### Admin-Oberfläche aufrufen

**Option A – Seitenleiste (empfohlen):**
Nach der Installation erscheint automatisch ein **„AR Building Admin"**-Eintrag in der HA-Seitenleiste (Zahnrad-Icon). Ein Klick darauf öffnet die Admin-UI direkt in Home Assistant.

**Option B – Direkter HTTPS-Zugriff:**
```
https://<HA-IP>:8444/admin
```
(Port 8444 ist der Standard – ggf. angepassten Port verwenden)
Beim ersten Aufruf erscheint eine SSL-Warnung (selbstsigniertes Zertifikat – einmalig bestätigen).

---

## 4. PWA (Besucher-App)

Die PWA läuft ausschließlich über direkten HTTPS-Zugriff:
```
https://<HA-IP>:8444
```
(Standard-Port – ggf. angepassten Port verwenden)

- Ersetze `<HA-IP>` durch die IP-Adresse deines Home Assistant Hosts
- Die SSL-Warnung muss **einmalig pro Gerät** bestätigt werden
- Die App benötigt Kamerazugriff (nur über HTTPS möglich)

---

## 5. Ports

| Port | Protokoll | Zweck |
|------|-----------|-------|
| 8444 | HTTPS     | PWA (Besucher), Admin-UI (direkt) – konfigurierbar |
| 8099 | HTTP      | HA Ingress (Seitenleiste Admin-UI) |

Der HTTPS-Port ist unter **Einstellungen → Add-ons → AR Building v2 → Konfiguration** anpassbar (Standard: 8444).

---

## 6. Persistente Daten

Die folgenden Daten bleiben bei Add-on-Updates und Neustarts erhalten:

| Pfad | Inhalt |
|------|--------|
| `/data/db/ar_building.db`   | SQLite-Datenbank (Räume, Objekte, Benutzer, Statistiken) |
| `/data/uploads/`            | Hochgeladene Dateien (ONNX-Modelle, Audio, Video) |
| `/data/ssl/cert.pem`        | SSL-Zertifikat |
| `/data/ssl/key.pem`         | Privater SSL-Schlüssel |
| `/data/settings.json`       | Konfiguration (HA-URL, Tokens, JWT-Secret) |

---

## 7. Einstellungen konfigurieren

Gehe in der Admin-Oberfläche zu **Einstellungen**:

| Einstellung | Beschreibung |
|-------------|--------------|
| HA URL | Home Assistant URL (z.B. `http://homeassistant:8123`) |
| HA Token | Long-Lived Access Token für Sensordaten |
| PlanRadar Token | API-Key für PlanRadar-Integration |
| PlanRadar Customer-ID | Customer-ID aus dem PlanRadar-Account |

---

## 8. API-Dokumentation

FastAPI stellt automatisch eine interaktive Swagger-Dokumentation bereit:
```
https://<HA-IP>:8444/docs
```

Den vollständigen API-Vertrag findest du unter:
```
ar-building-v2/shared/api-contract.json
```

---

## 9. Häufige Probleme

### SSL-Warnung erscheint immer wieder
Die einmalige Bestätigung gilt pro Browser und Gerät. Jedes neue Gerät muss sie einmalig bestätigen.

### Falscher PIN nach Neuinstallation
Der initiale PIN wird nur beim **allerersten Start** (leere Datenbank) generiert und im Log angezeigt. Nach einem Update bleibt die bestehende Datenbank mit dem gesetzten PIN erhalten.

### Falsche IP im SSL-Zertifikat
Das Zertifikat enthält die IP vom ersten Start. Bei IP-Änderung:
```bash
rm -rf /data/ssl/
```
Add-on neu starten → neues Zertifikat mit aktueller IP.

### Add-on startet nicht
Log prüfen: **Einstellungen → Add-ons → AR Building v2 → Log**
Häufige Ursachen: Syntaxfehler in Python-Dateien, Portkonflikt auf dem konfigurierten HTTPS-Port oder 8099.

### Admin-UI in der Seitenleiste zeigt leere Seite
Der Ingress-Server auf Port 8099 muss laufen. Im Log nach `Starte Ingress-Server auf Port 8099` suchen. Falls nicht vorhanden, Add-on neu starten.

### Kamera wird nicht angezeigt
Die Kamera-API funktioniert nur über HTTPS. SSL-Warnung muss zuvor bestätigt worden sein.

### ONNX-Objekterkennung funktioniert nicht
Die ONNX Runtime läuft vollständig im Browser (WebAssembly, via CDN). Prüfe:
- ONNX-Modell korrekt hochgeladen (Admin → Räume → Raum bearbeiten)
- Browser-Konsole (`F12`) auf Fehlermeldungen prüfen
- Browser unterstützt WebAssembly (alle modernen Browser)
