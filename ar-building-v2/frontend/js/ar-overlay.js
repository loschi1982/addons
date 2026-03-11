// ar-overlay.js – Canvas-Zeichnungen + schwebende HTML-Overlays.
// Kein import/export – schreibt auf window.AR.arOverlay.

(function () {
  'use strict';

  var ctx            = null;
  var canvasEl       = null;
  var activeOverlays = {}; // objectId → DOM-Element

  // Aktueller Raum + Session – werden von updateRoomOverlay gesetzt
  // damit der Click-Handler darauf zugreifen kann.
  var currentRoom      = null;
  var currentSessionId = null;

  function initCanvas(canvas) {
    canvasEl = canvas;
    ctx = canvas.getContext('2d');
  }

  function clearCanvas() {
    if (ctx && canvasEl) ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  }

  function drawBoundingBox(box, label) {
    if (!ctx) return;
    ctx.strokeStyle = 'rgba(74,158,255,0.85)';
    ctx.lineWidth   = 2;
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    if (label) {
      ctx.fillStyle = 'rgba(74,158,255,0.75)';
      var tw = ctx.measureText(label).width + 10;
      ctx.fillRect(box.x, box.y - 20, tw, 20);
      ctx.fillStyle = '#fff';
      ctx.font = '12px sans-serif';
      ctx.fillText(label, box.x + 5, box.y - 5);
    }
  }

  // Erstellt oder aktualisiert ein schwebendes Objekt-Overlay neben einer Bounding-Box.
  // box enthält bereits auf Canvas-CSS-Pixel skalierte Koordinaten (von scaleBox in app.js).
  // Da #object-overlays position:absolute mit inset:0 innerhalb von .app (position:fixed inset:0)
  // ist, entsprechen Canvas-CSS-Koordinaten direkt den Koordinaten im Container –
  // kein window.scrollX/Y addieren (die App ist fixed, kein Scroll möglich).
  function upsertObjectOverlay(object, box, canvasRect, onDetailClick) {
    var container = document.getElementById('object-overlays');
    var id  = 'obj-overlay-' + object.id;
    var el  = document.getElementById(id);

    if (!el) {
      el = document.createElement('div');
      el.id        = id;
      el.className = 'object-overlay';
      el.innerHTML =
        '<div class="object-overlay__name">'  + esc(object.name)               + '</div>' +
        '<div class="object-overlay__desc">'  + esc(object.short_desc || '')   + '</div>';

      container.appendChild(el);
      activeOverlays[object.id] = el;

      // Click-Handler erst im nächsten Tick registrieren.
      // Verhindert dass ein noch laufendes Touch-Event (z.B. QR-Scan-Tippen)
      // das soeben eingefügte Overlay sofort auslöst.
      setTimeout(function () {
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          onDetailClick(object);
        });
      }, 0);
    }

    // Position: rechts neben der Bounding-Box.
    // KEIN window.scrollX/Y – die App scrollt nicht.
    var left = canvasRect.left + box.x + box.w + 8;
    var top  = canvasRect.top  + box.y;

    if (left + 188 > window.innerWidth)  left = canvasRect.left + box.x - 188;
    if (top  + 80  > window.innerHeight) top  = window.innerHeight - 90;
    if (top < 4) top = 4;

    el.style.left     = left + 'px';
    el.style.top      = top  + 'px';
    el.style.position = 'absolute';
  }

  // Entfernt Overlays deren Objekt-ID nicht mehr in activeIds ist.
  function removeStaleOverlays(activeIds) {
    Object.keys(activeOverlays).forEach(function (idStr) {
      var id = parseInt(idStr, 10);
      if (!activeIds[id]) {
        activeOverlays[idStr].remove();
        delete activeOverlays[idStr];
      }
    });
  }

  // Entfernt alle Objekt-Overlays (z.B. beim Raumwechsel).
  function clearAllOverlays() {
    Object.keys(activeOverlays).forEach(function (id) { activeOverlays[id].remove(); });
    activeOverlays = {};
  }

  // Aktualisiert das Raum-Overlay (rechts oben) und registriert den Click-Handler.
  // room und sessionId werden als Modul-Variablen gespeichert damit der Handler
  // bei jedem Klick immer den aktuell aktiven Raum öffnet.
  function updateRoomOverlay(room, sensors, sessionId) {
    currentRoom      = room;
    currentSessionId = sessionId;

    var overlay = document.getElementById('room-overlay');
    overlay.classList.remove('hidden');
    document.getElementById('room-overlay-name').textContent = room.name;
    document.getElementById('room-overlay-desc').textContent = room.short_desc || '';

    var sc = document.getElementById('room-overlay-sensors');
    sc.innerHTML = (sensors || []).map(function (s) {
      return '<span class="sensor-chip">' + esc(s.friendly_name || s.entity_id) +
             ': ' + esc(s.state) + (s.unit ? ' ' + esc(s.unit) : '') + '</span>';
    }).join('');

    // Click-Handler nur einmalig registrieren.
    // data-click-bound verhindert dass bei jedem Raumwechsel ein weiterer
    // Handler angehängt wird – currentRoom/currentSessionId sind immer aktuell.
    if (!overlay.dataset.clickBound) {
      overlay.dataset.clickBound = '1';
      overlay.style.cursor = 'pointer';
      overlay.addEventListener('click', function () {
        if (!currentRoom) return;
        window.AR.objectView.openRoomDetailPanel(currentRoom, currentSessionId);
      });
    }
  }

  function hideRoomOverlay() {
    var overlay = document.getElementById('room-overlay');
    overlay.classList.add('hidden');
    currentRoom      = null;
    currentSessionId = null;
  }

  // XSS-Schutz: wandelt gefährliche HTML-Zeichen in harmlose Entities um.
  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  window.AR = window.AR || {};
  window.AR.arOverlay = {
    initCanvas:          initCanvas,
    clearCanvas:         clearCanvas,
    drawBoundingBox:     drawBoundingBox,
    upsertObjectOverlay: upsertObjectOverlay,
    removeStaleOverlays: removeStaleOverlays,
    clearAllOverlays:    clearAllOverlays,
    updateRoomOverlay:   updateRoomOverlay,
    hideRoomOverlay:     hideRoomOverlay,
  };
})();