// room-view.js – Aktiver Raum, ONNX-Modell, Sensoren, Audio, Video.
// Kein import/export – schreibt auf window.AR.roomView.

(function () {
  'use strict';

  var currentRoom     = null;
  var classIdToObject = {}; // onnx_class_id → ObjectDetail

  // Marker-ID des Raums dessen Video gerade läuft.
  // Wird gebraucht um den QR-Positions-Callback beim Raumwechsel zu entfernen.
  var activeVideoMarkerId = null;

  function getCurrentRoom() { return currentRoom; }
  function getClassIdMap()  { return classIdToObject; }

  async function activateRoom(markerId, sessionId) {
    if (currentRoom && currentRoom.marker_id === markerId) return;

    // Altes Video und Callback aufräumen bevor der neue Raum aktiviert wird
    deactivateVideo();

    try {
      var room    = await window.AR.api.getRoomByMarker(markerId);
      currentRoom = room;
      classIdToObject = {};

      // Alle Objekte des Raums laden und nach ONNX-Klassen-ID indizieren
      var objects = await window.AR.api.getObjectsByRoom(room.id);
      objects.forEach(function (obj) {
        if (obj.onnx_class_id !== null && obj.onnx_class_id !== undefined) {
          classIdToObject[obj.onnx_class_id] = obj;
        }
      });

      // ONNX-Modell laden
      if (room.model_path) await window.AR.onnx.loadModel(room.model_path);

      // HA-Sensoren laden und im Raum-Overlay anzeigen
      var sensors = await loadSensors(room.ha_sensor_ids || []);
      window.AR.arOverlay.updateRoomOverlay(room, sensors, sessionId);

      // Raumaudio starten
      if (room.audio_path) window.AR.audio.playRoomAudio(room.audio_path);

      // Video-Overlay: anzeigen und QR-Positions-Callback registrieren.
      // Das Video folgt dem QR-Code des Raums und skaliert sich proportional.
      if (room.video_path) {
        var opacity = room.video_opacity != null ? room.video_opacity : 0.8;
        window.AR.videoOverlay.showVideoOverlay(room.video_path, opacity);
        activeVideoMarkerId = markerId;

        // Der QR-Scanner ruft diesen Callback auf jedem Frame auf,
        // solange der Raum-QR-Code im Bild sichtbar ist.
        window.AR.qr.setPositionCallback(markerId, function (box) {
          window.AR.videoOverlay.updatePosition(box);
        });
      }

      // Statistik
      window.AR.stats.trackRoomScan(room.id);

    } catch (e) {
      console.error('[RoomView] Fehler:', e);
    }
  }

  // Entfernt Video und zugehörigen QR-Callback für den aktuellen Raum.
  function deactivateVideo() {
    if (activeVideoMarkerId) {
      window.AR.qr.clearPositionCallback(activeVideoMarkerId);
      activeVideoMarkerId = null;
    }
    window.AR.videoOverlay.hideVideoOverlay();
  }

  function deactivateRoom() {
    deactivateVideo();
    currentRoom     = null;
    classIdToObject = {};
  }

  async function loadSensors(entityIds) {
    if (!entityIds.length) return [];
    var results = await Promise.allSettled(
      entityIds.map(function (id) { return window.AR.api.getSensor(id); })
    );
    return results
      .filter(function (r) { return r.status === 'fulfilled' && r.value; })
      .map(function (r) { return r.value; });
  }

  window.AR = window.AR || {};
  window.AR.roomView = {
    activateRoom:   activateRoom,
    deactivateRoom: deactivateRoom,
    getCurrentRoom: getCurrentRoom,
    getClassIdMap:  getClassIdMap,
  };
})();