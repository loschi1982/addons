// video-overlay.js – Video das einem QR-Code folgt und sich proportional skaliert.
// Kein import/export – schreibt auf window.AR.videoOverlay.

(function () {
  'use strict';

  var videoEl    = null;
  var hideTimer  = null;

  // Seitenverhältnis des Videos (Breite/Höhe).
  // Wird beim ersten Metadaten-Load gesetzt.
  // Standard: 9/16 (Hochformat, typisch für Personen-Videos).
  var aspectRatio = 9 / 16;

  // Skalierungsfaktor: wie viel größer soll das Video gegenüber der QR-Box sein?
  // 3.0 = Video ist 3× so hoch wie der QR-Code breit ist – gut für eine Person.
  var SCALE_FACTOR = 3.0;

  // Millisekunden nach denen das Video ausgeblendet wird wenn kein QR-Frame kommt.
  var HIDE_DELAY = 600;

  function el() {
    if (!videoEl) videoEl = document.getElementById('video-overlay');
    return videoEl;
  }

  // Zeigt das Video an und startet die Wiedergabe einmalig (kein Loop).
  // path:    Pfad der Videodatei (relativ zur API-Basis)
  // opacity: Transparenz 0.0–1.0
  function showVideoOverlay(path, opacity) {
    var v = el();
    if (!v) return;

    var fullUrl = window.APP_CONFIG.apiBase + path;
    if (v.getAttribute('data-src') !== fullUrl) {
      v.setAttribute('data-src', fullUrl);
      v.src  = fullUrl;
      v.loop = false;

      // Seitenverhältnis aus den Video-Metadaten lesen sobald verfügbar.
      v.onloadedmetadata = function () {
        if (v.videoWidth && v.videoHeight) {
          aspectRatio = v.videoWidth / v.videoHeight;
        }
      };
    }

    v.style.opacity  = String(Math.max(0, Math.min(1, opacity != null ? opacity : 0.8)));
    v.style.position = 'absolute';
    v.style.zIndex   = '5'; // Über Canvas (1) und unter Overlays (10)
    v.classList.remove('hidden');
    v.play().catch(function () {});
  }

  // Wird vom QR-Positions-Callback auf jedem Frame aufgerufen.
  // box: { x, y, w, h } in CSS-Pixel (bereits auf Viewport skaliert)
  // Die Größe des Videos wird proportional zur QR-Box berechnet:
  //   Höhe = QR-Breite × SCALE_FACTOR
  //   Breite = Höhe × Seitenverhältnis des Videos
  // Das Video wird mittig über dem QR-Code positioniert.
  function updatePosition(box) {
    var v = el();
    if (!v || v.classList.contains('hidden')) return;

    // Höhe basierend auf QR-Box-Breite × Skalierungsfaktor
    var h = box.w * SCALE_FACTOR;
    var w = h * aspectRatio;

    // Horizontal: mittig über dem QR-Code
    var left = box.x + (box.w / 2) - (w / 2);
    // Vertikal: Video endet am unteren Rand der QR-Box (Person "steht" auf dem Marker)
    var top  = box.y + box.h - h;

    // Innerhalb des Viewports halten
    left = Math.max(0, Math.min(window.innerWidth  - w, left));
    top  = Math.max(0, Math.min(window.innerHeight - h, top));

    v.style.left   = left + 'px';
    v.style.top    = top  + 'px';
    v.style.width  = w    + 'px';
    v.style.height = h    + 'px';

    // Versteck-Timer zurücksetzen – solange QR sichtbar bleibt, läuft das Video
    resetHideTimer();
  }

  // Startet/verlängert den Timer der das Video ausblendet wenn der QR-Code
  // nicht mehr im Bild ist (kein updatePosition-Aufruf für HIDE_DELAY ms).
  function resetHideTimer() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      hideVideoOverlay();
    }, HIDE_DELAY);
  }

  function hideVideoOverlay() {
    var v = el();
    if (!v) return;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    v.pause();
    v.classList.add('hidden');
  }

  window.AR = window.AR || {};
  window.AR.videoOverlay = {
    showVideoOverlay:  showVideoOverlay,
    hideVideoOverlay:  hideVideoOverlay,
    updatePosition:    updatePosition,
  };
})();