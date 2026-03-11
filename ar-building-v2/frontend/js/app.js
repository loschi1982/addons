// app.js – Einstiegspunkt. Koordiniert alle Module über window.AR.*.

(function () {
  'use strict';

  var appEl       = document.getElementById('app');
  var cameraVideo = document.getElementById('camera-video');
  var arCanvas    = document.getElementById('ar-canvas');

  var lastDetectTime  = 0;
  var DETECT_INTERVAL = 200;

  // ONNX-Cache
  var detectedObjects = {}; // objectId → { obj, box, lastSeen }
  var OVERLAY_TIMEOUT = 800;

  // QR-Overlays: marker_id → { el, obj, timer }
  // Mehrere gleichzeitig möglich – jedes hat sein eigenes DOM-Element und Timer
  var qrOverlays = {};

  // Marker-Cache: marker_id → { type: 'room'|'object', data: obj }
  // Verhindert wiederholte API-Calls für denselben Marker
  var markerCache = {};

  // ----------------------------------------------------------------
  // SSL-Hinweis
  // ----------------------------------------------------------------

  function showSslNoticeIfNeeded() {
    if (sessionStorage.getItem('ar_ssl_ok')) return;
    var notice = document.getElementById('ssl-notice');
    notice.classList.remove('hidden');
    document.getElementById('ssl-notice-ok').addEventListener('click', function () {
      sessionStorage.setItem('ar_ssl_ok', '1');
      notice.classList.add('hidden');
    });
  }

  // ----------------------------------------------------------------
  // App starten
  // ----------------------------------------------------------------

  async function startApp(role) {
    appEl.classList.remove('hidden');
    window.AR.arOverlay.initCanvas(arCanvas);
    window.AR.stats.startTracking(role);

    arCanvas.style.pointerEvents = 'none';
    document.getElementById('object-overlays').style.pointerEvents = 'none';

    // Raum-Overlay explizit klickbar machen – Inline-Style hat höhere Priorität
    // als CSS-Klassen und stellt sicher dass kein überlagerndes Element Klicks blockt.
    document.getElementById('room-overlay').style.pointerEvents = 'auto';

    try {
      await window.AR.camera.startCamera(cameraVideo);
    } catch (e) {
      alert('Kamerazugriff verweigert. Bitte Erlaubnis in den Browser-Einstellungen erteilen.');
      return;
    }

    window.AR.camera.resizeCanvas(cameraVideo, arCanvas);
    window.addEventListener('resize', function () {
      window.AR.camera.resizeCanvas(cameraVideo, arCanvas);
    });

    window.AR.qr.resetCooldown();
    window.AR.qr.startQrScanner(cameraVideo, arCanvas, handleQrResult);

    requestAnimationFrame(mainLoop);
  }

  // ----------------------------------------------------------------
  // QR-Ergebnis verarbeiten
  // ----------------------------------------------------------------

  function handleQrResult(qrValue, box) {
    var sessionId = window.AR.stats.getSessionId();

    if (!qrValue || qrValue.startsWith('login:')) return;

    // Cache-Treffer: kein API-Call nötig
    var cached = markerCache[qrValue];
    if (cached) {
      if (cached.type === 'room')   window.AR.roomView.activateRoom(qrValue, sessionId);
      if (cached.type === 'object') showQrObjectOverlay(qrValue, cached.data, box, sessionId);
      return;
    }

    // Erst als Raum probieren, dann als Objekt
    window.AR.api.getRoomByMarker(qrValue)
      .then(function (room) {
        markerCache[qrValue] = { type: 'room', data: room };
        window.AR.roomView.activateRoom(qrValue, sessionId);
      })
      .catch(function () {
        window.AR.api.getObjectByMarker(qrValue)
          .then(function (obj) {
            markerCache[qrValue] = { type: 'object', data: obj };
            showQrObjectOverlay(qrValue, obj, box, sessionId);
          })
          .catch(function () { console.warn('[App] Kein Raum/Objekt für Marker:', qrValue); });
      });
  }

  // ----------------------------------------------------------------
  // QR-Objekt-Overlays – mehrere gleichzeitig, jedes folgt seinem Code
  // ----------------------------------------------------------------

  function showQrObjectOverlay(markerValue, obj, box, sessionId) {
    var existing = qrOverlays[markerValue];

    if (existing) {
      // Overlay existiert bereits → nur Timer zurücksetzen, Position wird
      // über setPositionCallback auf jedem Frame aktualisiert
      resetOverlayTimer(markerValue);
      return;
    }

    // Neues Overlay erstellen
    var el = document.createElement('div');
    el.className = 'object-overlay';
    el.innerHTML =
      '<div class="object-overlay__name">' + esc(obj.name)             + '</div>' +
      '<div class="object-overlay__desc">' + esc(obj.short_desc || '') + '</div>' +
      '<div class="object-overlay__hint">Tippen für Details</div>';

    document.getElementById('object-overlays').appendChild(el);

    qrOverlays[markerValue] = { el: el, obj: obj, timer: null };

    // Initiale Position
    positionQrOverlay(el, box);

    // QR-Scanner ruft diesen Callback auf jedem Frame auf solange der Code sichtbar ist
    window.AR.qr.setPositionCallback(markerValue, function (newBox) {
      positionQrOverlay(el, newBox);
      resetOverlayTimer(markerValue);
    });

    // Click → Detailansicht
    setTimeout(function () {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        removeQrObjectOverlay(markerValue);
        window.AR.objectView.openDetailPanel(obj, sessionId);
      });
    }, 0);

    resetOverlayTimer(markerValue);
  }

  function positionQrOverlay(el, box) {
    if (!el || !box) return;
    var canvasRect = arCanvas.getBoundingClientRect();

    var left = canvasRect.left + box.x + box.w + 8;
    var top  = canvasRect.top  + box.y;

    if (left + 188 > window.innerWidth)  left = canvasRect.left + box.x - 188;
    if (top  + 80  > window.innerHeight) top  = window.innerHeight - 90;
    if (top < 4) top = 4;

    el.style.position = 'absolute';
    el.style.left = left + 'px';
    el.style.top  = top  + 'px';
  }

  // 5s kein QR-Frame → Overlay entfernen
  function resetOverlayTimer(markerValue) {
    var entry = qrOverlays[markerValue];
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(function () {
      removeQrObjectOverlay(markerValue);
    }, 5000);
  }

  function removeQrObjectOverlay(markerValue) {
    var entry = qrOverlays[markerValue];
    if (!entry) return;
    window.AR.qr.clearPositionCallback(markerValue);
    if (entry.timer) clearTimeout(entry.timer);
    entry.el.remove();
    delete qrOverlays[markerValue];
  }

  function removeAllQrOverlays() {
    Object.keys(qrOverlays).forEach(removeQrObjectOverlay);
  }

  // ----------------------------------------------------------------
  // Haupt-Loop: ONNX
  // ----------------------------------------------------------------

  async function mainLoop(timestamp) {
    requestAnimationFrame(mainLoop);

    if (window.AR.objectView.isDetailOpen()) return;

    window.AR.arOverlay.clearCanvas();

    if (timestamp - lastDetectTime < DETECT_INTERVAL) {
      redrawCachedOverlays();
      return;
    }
    lastDetectTime = timestamp;

    if (!window.AR.onnx.isModelLoaded()) return;

    var detections = await window.AR.onnx.detect(cameraVideo);
    var classMap   = window.AR.roomView.getClassIdMap();
    var room       = window.AR.roomView.getCurrentRoom();
    var sessionId  = window.AR.stats.getSessionId();
    var now        = Date.now();
    var canvasRect = arCanvas.getBoundingClientRect();

    detections.forEach(function (det) {
      var obj = classMap[det.classId];
      if (!obj) return;

      var isNew = !detectedObjects[obj.id];
      detectedObjects[obj.id] = { obj: obj, box: det.box, lastSeen: now };

      if (isNew) window.AR.stats.trackObjectDetected(obj.id, room ? room.id : null);

      var scaledBox = scaleBox(det.box, canvasRect);
      window.AR.arOverlay.drawBoundingBox(scaledBox, obj.name);
      window.AR.arOverlay.upsertObjectOverlay(obj, scaledBox, canvasRect, function (o) {
        window.AR.objectView.openDetailPanel(o, sessionId);
      });
    });

    var activeIds = {};
    Object.keys(detectedObjects).forEach(function (id) {
      if (now - detectedObjects[id].lastSeen > OVERLAY_TIMEOUT) {
        delete detectedObjects[id];
      } else {
        activeIds[parseInt(id, 10)] = true;
      }
    });
    window.AR.arOverlay.removeStaleOverlays(activeIds);
  }

  function redrawCachedOverlays() {
    var canvasRect = arCanvas.getBoundingClientRect();
    Object.keys(detectedObjects).forEach(function (id) {
      var entry = detectedObjects[id];
      window.AR.arOverlay.drawBoundingBox(scaleBox(entry.box, canvasRect), entry.obj.name);
    });
  }

  function scaleBox(box, canvasRect) {
    var vw = cameraVideo.videoWidth  || 1;
    var vh = cameraVideo.videoHeight || 1;
    return {
      x: box.x * canvasRect.width  / vw,
      y: box.y * canvasRect.height / vh,
      w: box.w * canvasRect.width  / vw,
      h: box.h * canvasRect.height / vh,
    };
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ----------------------------------------------------------------
  // Logout
  // ----------------------------------------------------------------

  document.getElementById('logout-btn').addEventListener('click', function () {
    window.AR.stats.stopTracking();
    window.AR.qr.stopQrScanner();
    window.AR.qr.resetCooldown();
    window.AR.camera.stopCamera();
    window.AR.audio.stopAllAudio();
    window.AR.arOverlay.clearAllOverlays();
    window.AR.arOverlay.hideRoomOverlay();
    window.AR.roomView.deactivateRoom();
    window.AR.auth.clearSession();
    removeAllQrOverlays();

    appEl.classList.add('hidden');
    window.AR.auth.initLoginScreen(function (role) { startApp(role); });
  });

  // ----------------------------------------------------------------
  // Detail-Panel schließen
  // ----------------------------------------------------------------

  document.getElementById('detail-close').addEventListener('click', function () {
    window.AR.objectView.closeDetailPanel();
  });

  // ----------------------------------------------------------------
  // Init
  // ----------------------------------------------------------------

  showSslNoticeIfNeeded();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(function () {});
  }

  if (window.AR.auth.isLoggedIn()) {
    startApp(window.AR.auth.getRole());
  } else {
    window.AR.auth.initLoginScreen(function (role) { startApp(role); });
  }

})();