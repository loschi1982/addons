// qr-scanner.js – jsQR-Loop auf Video-Element.
// Kein import/export – schreibt auf window.AR.qr.
//
// Optimierungen:
// - Scan läuft max. alle SCAN_INTERVAL ms (nicht jeden RAF-Frame)
// - Mehrere QR-Codes pro Frame via Übermalen
// - Leere/ungültige Werte werden sofort verworfen

(function () {
  'use strict';

  var rafId       = null;
  var lastScanTime = 0;
  var SCAN_INTERVAL = 120; // ms zwischen zwei Scan-Durchläufen

  // Cooldown pro QR-Wert
  var cooldownMap = {};
  var COOLDOWN_MS = 2000;

  // Positions-Callbacks pro QR-Wert: value → callback(box)
  var positionCallbacks = {};

  function setPositionCallback(value, cb)  { positionCallbacks[value] = cb; }
  function clearPositionCallback(value)    { delete positionCallbacks[value]; }
  function clearAllPositionCallbacks()     { positionCallbacks = {}; }

  function startQrScanner(videoEl, canvas, onResult) {
    stopQrScanner();
    canvas.style.pointerEvents = 'none';

    var ctx = canvas.getContext('2d', { willReadFrequently: true });

    function loop(timestamp) {
      rafId = requestAnimationFrame(loop);
      if (videoEl.readyState < videoEl.HAVE_ENOUGH_DATA) return;

      // Scan drosseln: nicht jeden Frame, nur alle SCAN_INTERVAL ms
      if (timestamp - lastScanTime < SCAN_INTERVAL) return;
      lastScanTime = timestamp;

      var vw = videoEl.videoWidth  || 320;
      var vh = videoEl.videoHeight || 240;

      if (canvas.width !== vw || canvas.height !== vh) {
        canvas.width  = vw;
        canvas.height = vh;
      }

      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

      var found = scanAll(ctx, canvas.width, canvas.height);

      var rect   = canvas.getBoundingClientRect();
      var scaleX = rect.width  / (canvas.width  || 1);
      var scaleY = rect.height / (canvas.height || 1);

      var now = Date.now();

      found.forEach(function (code) {
        // Leere oder rein-whitespace Werte ignorieren
        var val = (code.data || '').trim();
        if (!val) return;

        drawQrBox(ctx, code.location);

        var box = locationToBox(code.location, scaleX, scaleY);

        // Positions-Callback für bereits bekannte Overlays
        if (positionCallbacks[val]) {
          positionCallbacks[val](box);
        }

        var entry = cooldownMap[val];
        var isNew = !entry || (now - entry.lastTime) > COOLDOWN_MS;
        if (isNew) {
          cooldownMap[val] = { lastTime: now };
          onResult(val, box);
        }
      });
    }

    loop(0);
  }

  // Mehrere QR-Codes pro Frame: erkannten Bereich übermalen, nochmal scannen
  function scanAll(ctx, w, h) {
    var found     = [];
    var maxPasses = 10;

    for (var i = 0; i < maxPasses; i++) {
      var imgData = ctx.getImageData(0, 0, w, h);
      var code    = jsQR(imgData.data, w, h, { inversionAttempts: 'dontInvert' });
      if (!code) break;

      // Leere Codes nicht sammeln, aber übermalen damit die Loop weiterläuft
      var val = (code.data || '').trim();
      if (val) found.push(code);

      var loc  = code.location;
      var xs   = [loc.topLeftCorner.x, loc.topRightCorner.x, loc.bottomRightCorner.x, loc.bottomLeftCorner.x];
      var ys   = [loc.topLeftCorner.y, loc.topRightCorner.y, loc.bottomRightCorner.y, loc.bottomLeftCorner.y];
      var minX = Math.max(0, Math.min.apply(null, xs) - 10);
      var minY = Math.max(0, Math.min.apply(null, ys) - 10);
      var maxX = Math.min(w, Math.max.apply(null, xs) + 10);
      var maxY = Math.min(h, Math.max.apply(null, ys) + 10);

      ctx.fillStyle = '#000';
      ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
    }

    return found;
  }

  function locationToBox(loc, scaleX, scaleY) {
    var xs  = [loc.topLeftCorner.x, loc.topRightCorner.x, loc.bottomRightCorner.x, loc.bottomLeftCorner.x];
    var ys  = [loc.topLeftCorner.y, loc.topRightCorner.y, loc.bottomRightCorner.y, loc.bottomLeftCorner.y];
    var minX = Math.min.apply(null, xs);
    var minY = Math.min.apply(null, ys);
    var maxX = Math.max.apply(null, xs);
    var maxY = Math.max.apply(null, ys);
    return {
      x: minX * scaleX,
      y: minY * scaleY,
      w: (maxX - minX) * scaleX,
      h: (maxY - minY) * scaleY,
    };
  }

  function stopQrScanner() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    clearAllPositionCallbacks();
  }

  function resetCooldown() { cooldownMap = {}; }

  function drawQrBox(ctx, loc) {
    ctx.strokeStyle = '#4a9eff';
    ctx.lineWidth   = 3;
    ctx.beginPath();
    ctx.moveTo(loc.topLeftCorner.x,     loc.topLeftCorner.y);
    ctx.lineTo(loc.topRightCorner.x,    loc.topRightCorner.y);
    ctx.lineTo(loc.bottomRightCorner.x, loc.bottomRightCorner.y);
    ctx.lineTo(loc.bottomLeftCorner.x,  loc.bottomLeftCorner.y);
    ctx.closePath();
    ctx.stroke();
  }

  window.AR = window.AR || {};
  window.AR.qr = {
    startQrScanner:        startQrScanner,
    stopQrScanner:         stopQrScanner,
    resetCooldown:         resetCooldown,
    setPositionCallback:   setPositionCallback,
    clearPositionCallback: clearPositionCallback,
  };
})();