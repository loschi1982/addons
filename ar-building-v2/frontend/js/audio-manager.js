// audio-manager.js – Web Audio API, ein Audio gleichzeitig.
// Kein import/export – schreibt auf window.AR.audio.

(function () {
  'use strict';

  var audioCtx     = null;
  var currentSource = null;
  var bufferCache  = {};

  function getCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function stopCurrent() {
    if (currentSource) {
      try { currentSource.stop(); } catch (e) { /* bereits gestoppt */ }
      currentSource.disconnect();
      currentSource = null;
    }
  }

  async function loadBuffer(url) {
    if (bufferCache[url]) return bufferCache[url];
    var res    = await fetch(url);
    var bytes  = await res.arrayBuffer();
    var buffer = await getCtx().decodeAudioData(bytes);
    bufferCache[url] = buffer;
    return buffer;
  }

  // Spielt eine Audio-Datei einmalig ab (kein Loop).
  async function playAudio(url) {
    stopCurrent();
    try {
      var ctx    = getCtx();
      var buffer = await loadBuffer(url);
      var source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop   = false; // Einmaliges Abspielen – keine Dauerschleife
      source.connect(ctx.destination);
      source.start();
      currentSource = source;
      // Referenz nach Ende der Wiedergabe aufräumen
      source.onended = function () {
        if (currentSource === source) currentSource = null;
      };
    } catch (e) {
      console.error('[Audio] Fehler:', url, e);
    }
  }

  // Raum-Audio: einmalig abspielen (kein Loop)
  function playRoomAudio(path)   { playAudio(path); }
  // Objekt-Audio: einmalig abspielen (kein Loop)
  function playObjectAudio(path) { playAudio(path); }
  // Alles stoppen (Logout oder Raumwechsel)
  function stopAllAudio()        { stopCurrent(); }

  window.AR = window.AR || {};
  window.AR.audio = { playRoomAudio: playRoomAudio, playObjectAudio: playObjectAudio, stopAllAudio: stopAllAudio };
})();