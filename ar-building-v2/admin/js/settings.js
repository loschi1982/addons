// ===================================================
// settings.js – System-Einstellungen
// Lädt und speichert die Einstellungen über die API.
// Bietet einen HA-Verbindungstest.
// ===================================================

import * as api from './api.js';

// Lädt die aktuellen Einstellungen und befüllt das Formular.
export async function loadSettings() {
  try {
    const s = await api.getSettings();
    document.getElementById('set-ha-url').value            = s.ha_url              || '';
    document.getElementById('set-ha-token').value          = s.ha_token            || '';
    document.getElementById('set-planradar-token').value   = s.planradar_token     || '';
    // Neu in v2.1.0: planradar_customer_id
    document.getElementById('set-planradar-customer-id').value = s.planradar_customer_id || '';
    // JWT-Secret ist nur lesbar – wird angezeigt aber kann nicht bearbeitet werden.
    document.getElementById('set-jwt-secret').value        = s.jwt_secret          || '';
    document.getElementById('set-jwt-hours').value         = s.jwt_expire_hours    ?? 12;
  } catch (e) {
    showSettingsMsg('Fehler beim Laden der Einstellungen: ' + e.message, 'error');
  }
}

// Sammelt die Formulardaten und sendet sie als PUT ans Backend.
// Sendet alle Felder inklusive planradar_customer_id (neu in v2.1.0).
export async function saveSettings() {
  const payload = {
    ha_url:                 document.getElementById('set-ha-url').value.trim(),
    ha_token:               document.getElementById('set-ha-token').value.trim(),
    planradar_token:        document.getElementById('set-planradar-token').value.trim(),
    planradar_customer_id:  document.getElementById('set-planradar-customer-id').value.trim(),
    jwt_secret:             document.getElementById('set-jwt-secret').value.trim(),
    jwt_expire_hours:       +document.getElementById('set-jwt-hours').value,
  };

  try {
    await api.saveSettings(payload);
    showSettingsMsg('Einstellungen wurden gespeichert.', 'success');
  } catch (e) {
    showSettingsMsg('Fehler beim Speichern: ' + e.message, 'error');
  }
}

// Testet die HA-Verbindung indem ein Sensor-Abruf durchgeführt wird.
// Nutzt GET /api/ha/sensors – wenn die Antwort kommt, ist die Verbindung OK.
export async function testHAConnection() {
  const resultEl = document.getElementById('ha-test-result');
  resultEl.textContent = 'Teste…';
  resultEl.style.color = '#888';

  try {
    await api.getHASensors();
    resultEl.textContent = '✓ Verbindung erfolgreich';
    resultEl.style.color = '#27ae60';
  } catch (e) {
    resultEl.textContent = '✗ Verbindung fehlgeschlagen: ' + e.message;
    resultEl.style.color = '#e74c3c';
  }
}

// Zeigt eine Erfolgs- oder Fehlermeldung im Einstellungs-Formular.
// type ist 'success' oder 'error'.
function showSettingsMsg(msg, type) {
  const el = document.getElementById('settings-msg');
  el.textContent = msg;
  el.className = type; // CSS-Klassen 'success' oder 'error' anwenden
  el.classList.remove('hidden');

  // Nachricht nach 4 Sekunden automatisch ausblenden.
  setTimeout(() => el.classList.add('hidden'), 4000);
}