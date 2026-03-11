// stats-tracker.js – Session-ID, Events, Heartbeat.
// Kein import/export – schreibt auf window.AR.stats.

(function () {
  'use strict';

  var SESSION_ID        = crypto.randomUUID();
  var heartbeatInterval = null;
  var activeRoomId      = null;
  var userRole          = null;

  function getSessionId() { return SESSION_ID; }

  function startTracking(role) {
    userRole = role;
    heartbeatInterval = setInterval(function () {
      window.AR.api.postHeartbeat(SESSION_ID, activeRoomId).catch(function () {});
    }, 30000);
    window.AR.api.postHeartbeat(SESSION_ID, null).catch(function () {});
  }

  function stopTracking() {
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    window.AR.api.postEvent('session_end', SESSION_ID, { role: userRole }).catch(function () {});
    userRole = null; activeRoomId = null;
  }

  function setActiveRoom(roomId) { activeRoomId = roomId; }

  function trackRoomScan(roomId) {
    setActiveRoom(roomId);
    window.AR.api.postEvent('room_scan', SESSION_ID, { role: userRole, roomId: roomId }).catch(function () {});
  }

  function trackObjectDetected(objectId, roomId) {
    window.AR.api.postEvent('object_detected', SESSION_ID, { role: userRole, roomId: roomId, objectId: objectId }).catch(function () {});
  }

  function trackDetailOpened(objectId, roomId) {
    window.AR.api.postEvent('detail_opened', SESSION_ID, { role: userRole, roomId: roomId, objectId: objectId }).catch(function () {});
  }

  window.AR = window.AR || {};
  window.AR.stats = {
    getSessionId: getSessionId, startTracking: startTracking, stopTracking: stopTracking,
    setActiveRoom: setActiveRoom, trackRoomScan: trackRoomScan,
    trackObjectDetected: trackObjectDetected, trackDetailOpened: trackDetailOpened,
  };
})();