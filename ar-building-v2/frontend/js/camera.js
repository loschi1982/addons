// camera.js – Kamera-Stream + Screen Wake Lock.
// Kein import/export – schreibt auf window.AR.camera.

(function () {
  'use strict';

  var activeStream = null;
  var wakeLock     = null;

  async function startCamera(videoEl) {
    stopCamera();
    var stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    videoEl.srcObject = stream;
    activeStream = stream;

    await new Promise(function (resolve) {
      videoEl.onloadedmetadata = function () { videoEl.play().then(resolve).catch(resolve); };
    });

    await acquireWakeLock();
    return stream;
  }

  function stopCamera() {
    if (activeStream) { activeStream.getTracks().forEach(function (t) { t.stop(); }); activeStream = null; }
    releaseWakeLock();
  }

  async function acquireWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', function () { if (activeStream) acquireWakeLock(); });
    } catch (e) { /* nicht unterstützt – kein Fehler */ }
  }

  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
  }

  function resizeCanvas(videoEl, canvas) {
    var rect = videoEl.getBoundingClientRect();
    canvas.width  = rect.width;
    canvas.height = rect.height;
  }

  window.AR = window.AR || {};
  window.AR.camera = { startCamera: startCamera, stopCamera: stopCamera, resizeCanvas: resizeCanvas };
})();