// api.js – Alle Backend-Aufrufe gebündelt.
// Schreibt seine Funktionen auf window.AR.api damit andere Scripts sie nutzen können.
// Kein import/export – klassisches Script für maximale Browser-Kompatibilität.

(function () {
  'use strict';

  var BASE      = function () { return window.APP_CONFIG.apiBase; };
  var getToken  = function () { return sessionStorage.getItem('ar_jwt'); };
  var authHeader = function () { return { Authorization: 'Bearer ' + getToken() }; };

  async function request(method, path, body) {
    var headers = Object.assign({}, authHeader());
    if (body) headers['Content-Type'] = 'application/json';

    var res = await fetch(BASE() + path, {
      method:  method,
      headers: headers,
      body:    body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) return null;
    var data = await res.json();
    if (!res.ok) throw new Error(data && data.detail ? data.detail : 'HTTP ' + res.status);
    return data;
  }

  // ---- Auth ----

  function loginWithPin(username, pin) {
    return request('POST', '/api/auth/login', { username: username, pin: pin });
  }

  function loginWithToken(token) {
    return request('POST', '/api/auth/login', { token: token });
  }

  function changePin(newPin) {
    return request('POST', '/api/auth/change-pin', { new_pin: newPin });
  }

  // ---- Räume ----

  function getRoomByMarker(markerId) {
    return request('GET', '/api/rooms/by-marker/' + encodeURIComponent(markerId));
  }

  function getObjectsByRoom(roomId) {
    return request('GET', '/api/objects?room_id=' + roomId);
  }

  // ---- Objekte ----

  function getObjectByMarker(markerId) {
    return request('GET', '/api/objects/by-marker/' + encodeURIComponent(markerId));
  }

  function getObject(objectId) {
    return request('GET', '/api/objects/' + objectId);
  }

  // ---- HA-Sensoren ----

  function getSensor(entityId) {
    return request('GET', '/api/ha/sensors/' + encodeURIComponent(entityId));
  }

  // ---- PlanRadar ----

  function getTicketsForObject(objectId) {
    return request('GET', '/api/planradar/tickets?object_id=' + objectId);
  }

  async function getTicketsByMarker(markerId) {
    try {
      return await request('GET', '/api/planradar/tickets?marker_id=' + encodeURIComponent(markerId));
    } catch (e) {
      return [];
    }
  }

  // Journals (Kommentare + Änderungshistorie) eines Tickets laden.
  // GET /api/planradar/tickets/{id}/journals?project_id=...
  // project_id wird aus dem Ticket-Objekt übergeben (laut API-Vertrag v2.2 immer vorhanden).
  function getTicketJournals(ticketId, projectId) {
    var qs = projectId ? '?project_id=' + encodeURIComponent(projectId) : '';
    return request('GET', '/api/planradar/tickets/' + encodeURIComponent(ticketId) + '/journals' + qs);
  }

  // Attachments eines Tickets laden.
  // GET /api/planradar/tickets/{id}/attachments?project_id=...
  function getTicketAttachments(ticketId, projectId) {
    var qs = projectId ? '?project_id=' + encodeURIComponent(projectId) : '';
    return request('GET', '/api/planradar/tickets/' + encodeURIComponent(ticketId) + '/attachments' + qs);
  }

  // Status eines Tickets ändern.
  // PUT /api/planradar/tickets/{id}/status?project_id=...
  // project_id MUSS mitgeschickt werden – der Backend-Cache ist nach einem
  // Neustart leer und liefert sonst 400 "project_id nicht bekannt".
  // Das Ticket-Objekt enthält project_id laut PlanRadarTicket-Schema (API-Vertrag v2.2).
  function updateTicketStatus(ticketId, status, projectId) {
    var qs = projectId ? '?project_id=' + encodeURIComponent(projectId) : '';
    return request(
      'PUT',
      '/api/planradar/tickets/' + encodeURIComponent(ticketId) + '/status' + qs,
      { status: status }
    );
  }

  // Kommentar zu einem Ticket hinzufügen.
  // POST /api/planradar/tickets/{id}/comment?project_id=...
  // project_id MUSS mitgeschickt werden – gleicher Grund wie bei updateTicketStatus.
  function addTicketComment(ticketId, comment, projectId) {
    var qs = projectId ? '?project_id=' + encodeURIComponent(projectId) : '';
    return request(
      'POST',
      '/api/planradar/tickets/' + encodeURIComponent(ticketId) + '/comment' + qs,
      { comment: comment }
    );
  }

  // ---- Statistik ----

  function postEvent(eventType, sessionId, opts) {
    opts = opts || {};
    return request('POST', '/api/stats/event', {
      event_type: eventType,
      session_id: sessionId,
      role:       opts.role      || null,
      room_id:    opts.roomId    || null,
      object_id:  opts.objectId  || null,
      timestamp:  new Date().toISOString(),
    });
  }

  function postHeartbeat(sessionId, roomId) {
    return request('POST', '/api/stats/heartbeat', {
      session_id: sessionId,
      room_id:    roomId || null,
    });
  }

  // ---- CAFM ----

  function getPlantData(objectId) {
    return request('GET', '/api/cafm/plants/' + objectId);
  }

  function getDueMaintenance(objectId) {
    return request('GET', '/api/cafm/plants/' + objectId + '/due');
  }

  function completeMaintenance(scheduleId, data) {
    return request('POST', '/api/cafm/schedules/' + scheduleId + '/complete', data);
  }

  function getLogPdfUrl(logId) {
    return BASE() + '/api/cafm/logs/' + logId + '/pdf';
  }

  window.AR = window.AR || {};
  window.AR.api = {
    loginWithPin:          loginWithPin,
    loginWithToken:        loginWithToken,
    changePin:             changePin,
    getRoomByMarker:       getRoomByMarker,
    getObjectsByRoom:      getObjectsByRoom,
    getObjectByMarker:     getObjectByMarker,
    getObject:             getObject,
    getSensor:             getSensor,
    getTicketsForObject:   getTicketsForObject,
    getTicketsByMarker:    getTicketsByMarker,
    getTicketJournals:     getTicketJournals,
    getTicketAttachments:  getTicketAttachments,
    updateTicketStatus:    updateTicketStatus,
    addTicketComment:      addTicketComment,
    postEvent:             postEvent,
    postHeartbeat:         postHeartbeat,
    getPlantData:          getPlantData,
    getDueMaintenance:     getDueMaintenance,
    completeMaintenance:   completeMaintenance,
    getLogPdfUrl:          getLogPdfUrl,
  };
})();