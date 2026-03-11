// ===================================================
// api.js – Zentrale API-Kommunikation
// Alle Anfragen ans Backend laufen über dieses Modul.
// Basis-URL kommt aus window.APP_CONFIG.apiBase.
// ===================================================

const BASE = window.APP_CONFIG.apiBase;

// Liest den gespeicherten JWT aus dem sessionStorage.
function getToken() {
  return sessionStorage.getItem('ar_jwt');
}

// Baut den Authorization-Header mit dem JWT.
function authHeader() {
  const t = getToken();
  return t ? { 'Authorization': `Bearer ${t}` } : {};
}

// Wird bei einem 401 aufgerufen: sessionStorage leeren und zur Login-Seite.
// Das verhindert, dass die App mit ungültigem Token im Hintergrund weiterläuft.
function handleUnauthorized() {
  sessionStorage.removeItem('ar_jwt');
  sessionStorage.removeItem('ar_role');
  sessionStorage.removeItem('ar_username');
  // Seite neu laden → init() in admin-app.js erkennt fehlenden Token → Login-Screen
  window.location.reload();
}

// Zentrale Fetch-Funktion für alle API-Aufrufe.
// Wirft einen Fehler wenn der Server einen Fehlercode zurückgibt.
async function request(method, path, body = null, isFormData = false) {
  const headers = { ...authHeader() };

  // Bei JSON-Body den Content-Type setzen.
  // Bei FormData wird der Header weggelassen (Browser setzt ihn automatisch).
  if (body && !isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  const opts = { method, headers };
  if (body) {
    opts.body = isFormData ? body : JSON.stringify(body);
  }

  const res = await fetch(`${BASE}${path}`, opts);

  // 401 = Token fehlt oder ist abgelaufen → automatisch ausloggen und neu laden.
  if (res.status === 401) {
    handleUnauthorized();
    // Promise wird nie aufgelöst – die Seite lädt bereits neu.
    return new Promise(() => {});
  }

  // Kein Inhalt bei DELETE (204 = No Content, Body ist leer).
  if (res.status === 204) {
    return null;
  }

  // Bei 201 (Created) kann ein Body vorhanden sein (z.B. neu angelegter Raum).
  // Content-Length 0 oder fehlendes Content-Type bedeutet kein Body.
  const contentType = res.headers.get('content-type') || '';
  if (res.status === 201 && !contentType.includes('application/json')) {
    return null;
  }

  const data = await res.json();

  if (!res.ok) {
    // Fehlermeldung aus der Antwort extrahieren oder generisch melden.
    const msg = data?.detail || `Fehler ${res.status}`;
    throw new Error(msg);
  }

  return data;
}

// ---- AUTH ---- //

// Sendet Login-Daten (username + pin) und gibt JWT + Rolle zurück.
export async function login(username, pin) {
  return request('POST', '/api/auth/login', { username, pin });
}

// Generiert einen neuen Visitor-QR-Token (nur Admin).
export async function getVisitorToken() {
  return request('GET', '/api/auth/visitor-token');
}

// ---- RÄUME ---- //

// Gibt alle Räume als Liste zurück.
export async function getRooms() {
  return request('GET', '/api/rooms');
}

// Gibt einen einzelnen Raum mit allen Details zurück.
export async function getRoom(id) {
  return request('GET', `/api/rooms/${id}`);
}

// Legt einen neuen Raum an. Erwartet ein RoomCreate-Objekt.
export async function createRoom(data) {
  return request('POST', '/api/rooms', data);
}

// Aktualisiert einen bestehenden Raum.
export async function updateRoom(id, data) {
  return request('PUT', `/api/rooms/${id}`, data);
}

// Löscht einen Raum anhand seiner ID.
export async function deleteRoom(id) {
  return request('DELETE', `/api/rooms/${id}`);
}

// Lädt eine Datei (ONNX-Modell, Audio oder Video) für einen Raum hoch.
// file_type muss 'model', 'audio' oder 'video' sein.
export async function uploadRoomFile(roomId, file, fileType) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('file_type', fileType);
  return request('POST', `/api/rooms/${roomId}/files`, fd, true);
}

// ---- OBJEKTE ---- //

// Gibt alle Objekte zurück. Optional gefiltert nach Raum.
export async function getObjects(roomId = null) {
  const q = roomId ? `?room_id=${roomId}` : '';
  return request('GET', `/api/objects${q}`);
}

// Gibt ein einzelnes Objekt mit allen Details zurück.
export async function getObject(id) {
  return request('GET', `/api/objects/${id}`);
}

// Legt ein neues Objekt an.
export async function createObject(data) {
  return request('POST', '/api/objects', data);
}

// Aktualisiert ein bestehendes Objekt.
export async function updateObject(id, data) {
  return request('PUT', `/api/objects/${id}`, data);
}

// Löscht ein Objekt anhand seiner ID.
export async function deleteObject(id) {
  return request('DELETE', `/api/objects/${id}`);
}

// ---- OBJEKTTYPEN ---- //

// Gibt alle Objekttypen zurück.
export async function getObjectTypes() {
  return request('GET', '/api/object-types');
}

// Legt einen neuen Objekttyp an.
export async function createObjectType(data) {
  return request('POST', '/api/object-types', data);
}

// Aktualisiert einen bestehenden Objekttyp.
export async function updateObjectType(id, data) {
  return request('PUT', `/api/object-types/${id}`, data);
}

// Löscht einen Objekttyp.
export async function deleteObjectType(id) {
  return request('DELETE', `/api/object-types/${id}`);
}

// ---- BENUTZER ---- //

// Gibt alle Benutzer zurück (nur Admin).
export async function getUsers() {
  return request('GET', '/api/users');
}

// Legt einen neuen Benutzer an.
export async function createUser(data) {
  return request('POST', '/api/users', data);
}

// Aktualisiert einen bestehenden Benutzer.
export async function updateUser(id, data) {
  return request('PUT', `/api/users/${id}`, data);
}

// Löscht einen Benutzer.
export async function deleteUser(id) {
  return request('DELETE', `/api/users/${id}`);
}

// ---- STATISTIK ---- //

// Lädt aggregierte KPI-Daten für das Admin-Dashboard.
export async function getDashboard() {
  return request('GET', '/api/stats/dashboard');
}

// Lädt Live-Daten: aktive Sessions + aktive Räume.
export async function getLive() {
  return request('GET', '/api/stats/live');
}

// ---- EINSTELLUNGEN ---- //

// Lädt alle System-Einstellungen.
export async function getSettings() {
  return request('GET', '/api/settings');
}

// Speichert die Einstellungen.
export async function saveSettings(data) {
  return request('PUT', '/api/settings', data);
}

// ---- HOME ASSISTANT ---- //

// Gibt alle verfügbaren HA-Sensoren zurück.
export async function getHASensors() {
  return request('GET', '/api/ha/sensors');
}

// ---- PLANRADAR ---- //

// Gibt alle PlanRadar-Projekte des Accounts zurück (Proxy zur PlanRadar-API).
// Erfordert konfigurierte Customer-ID und Token in den Einstellungen.
export async function getPlanRadarProjects() {
  return request('GET', '/api/planradar/projects');
}

// Gibt alle Custom Listen eines PlanRadar-Projekts zurück.
// project_id ist optional – ohne Filter alle Listen des Accounts.
export async function getPlanRadarLists(projectId = null) {
  const q = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
  return request('GET', `/api/planradar/lists${q}`);
}

// Gibt alle Einträge einer PlanRadar-Liste zurück (z.B. einzelne Räume oder Anlagen).
export async function getPlanRadarListEntries(listId) {
  return request('GET', `/api/planradar/lists/${encodeURIComponent(listId)}/entries`);
}

// Gibt alle gespeicherten Rollenzuordnungen für PlanRadar-Projekte zurück.
export async function getPlanRadarProjectRoles() {
  return request('GET', '/api/planradar/project-roles');
}

// Speichert Rollenzuordnungen für PlanRadar-Projekte (Upsert per project_id).
// data ist ein Array von { project_id, visible_to_roles }.
export async function savePlanRadarProjectRoles(data) {
  return request('PUT', '/api/planradar/project-roles', data);
}

// Gibt alle gespeicherten Marker-Mappings zurück (PlanRadar-Eintrag ↔ AR-Marker).
export async function getPlanRadarMappings() {
  return request('GET', '/api/planradar/mappings');
}

// Legt ein neues Mapping an oder aktualisiert ein bestehendes (Upsert per ar_marker_id).
// Erwartet ein PlanRadarMappingCreate-Objekt laut API-Vertrag v2.1.0.
export async function savePlanRadarMapping(data) {
  return request('POST', '/api/planradar/mappings', data);
}

// Löscht ein Marker-Mapping anhand seiner internen ID.
export async function deletePlanRadarMapping(id) {
  return request('DELETE', `/api/planradar/mappings/${id}`);
}