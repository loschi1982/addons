// ===================================================
// auth.js – Login, Logout, JWT-Verwaltung
// Speichert das JWT im sessionStorage.
// Prüft ob der eingeloggte Benutzer Admin ist.
// ===================================================

import * as api from './api.js';

// Schlüssel unter dem das JWT im sessionStorage gespeichert wird.
const JWT_KEY = 'ar_jwt';

// Speichert das JWT nach erfolgreichem Login.
export function saveToken(jwt) {
  sessionStorage.setItem(JWT_KEY, jwt);
}

// Gibt das gespeicherte JWT zurück oder null wenn nicht eingeloggt.
export function getToken() {
  return sessionStorage.getItem(JWT_KEY);
}

// Löscht das JWT (= Logout).
export function clearToken() {
  sessionStorage.removeItem(JWT_KEY);
  sessionStorage.removeItem('ar_role');
  sessionStorage.removeItem('ar_username');
}

// Prüft ob ein gültiges JWT vorhanden ist.
export function isLoggedIn() {
  return !!getToken();
}

// Gibt die Rolle des eingeloggten Benutzers zurück.
export function getRole() {
  return sessionStorage.getItem('ar_role');
}

// Gibt den Benutzernamen zurück.
export function getUsername() {
  return sessionStorage.getItem('ar_username');
}

// Versucht den Login mit username + PIN.
// Gibt true zurück wenn erfolgreich und die Rolle admin ist.
// Wirft einen Fehler bei falschen Daten oder fehlender Admin-Berechtigung.
export async function login(username, pin) {
  const res = await api.login(username, pin);

  // Nur Admins dürfen die Admin-Oberfläche benutzen.
  if (res.role !== 'admin') {
    throw new Error('Kein Admin-Zugang. Bitte mit einem Admin-Konto anmelden.');
  }

  // JWT und Metadaten speichern.
  saveToken(res.jwt);
  sessionStorage.setItem('ar_role', res.role);
  sessionStorage.setItem('ar_username', res.username);

  return true;
}

// Meldet den Benutzer ab und leert den Speicher.
export function logout() {
  clearToken();
}