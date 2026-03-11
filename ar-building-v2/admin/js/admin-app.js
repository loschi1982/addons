// ===================================================
// admin-app.js – Haupt-Controller der Admin-Oberfläche
// Initialisiert die App, verwaltet die Navigation,
// steuert das Modal und den Bestätigungs-Dialog.
// ===================================================

import * as auth       from './auth.js';
import * as rooms      from './rooms.js';
import * as objects    from './objects.js';
import * as users      from './users.js';
import * as statistics from './statistics.js';
import * as settings   from './settings.js';
import * as planradar  from './planradar.js';

// ---- Aktuell aktive Sektion speichern ----
let currentSection = 'rooms';

// ====================================================
// INITIALISIERUNG
// ====================================================

// Startet die App: Login prüfen oder Login-Screen zeigen.
function init() {
  if (auth.isLoggedIn()) {
    showApp();
  } else {
    showLoginScreen();
  }
}

// ====================================================
// LOGIN / LOGOUT
// ====================================================

// Zeigt den Login-Screen und bindet den Login-Button.
function showLoginScreen() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');

  // Enter-Taste im PIN-Feld löst Login aus.
  document.getElementById('login-pin').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });

  document.getElementById('login-btn').addEventListener('click', doLogin);
}

// Führt den Login durch. Zeigt Fehlermeldung bei ungültigen Daten.
async function doLogin() {
  const username = document.getElementById('login-username').value.trim();
  const pin      = document.getElementById('login-pin').value.trim();
  const errorEl  = document.getElementById('login-error');

  errorEl.classList.add('hidden');

  if (!username) {
    errorEl.textContent = 'Bitte Benutzername eingeben.';
    errorEl.classList.remove('hidden');
    return;
  }

  try {
    const { mustChangePin } = await auth.login(username, pin);
    if (mustChangePin) {
      showPinSetup();
    } else {
      showApp();
    }
  } catch (e) {
    errorEl.textContent = e.message;
    errorEl.classList.remove('hidden');
  }
}

// Zeigt den PIN-Setup-Dialog (erster Login oder nach Reset).
function showPinSetup() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('pin-setup-screen').classList.remove('hidden');

  document.getElementById('pin-setup-btn').onclick = doPinSetup;
  document.getElementById('pin-setup-new').addEventListener('keydown', e => {
    if (e.key === 'Enter') doPinSetup();
  });
  document.getElementById('pin-setup-confirm').addEventListener('keydown', e => {
    if (e.key === 'Enter') doPinSetup();
  });
}

// Speichert den neuen PIN und öffnet die App.
async function doPinSetup() {
  const newPin     = document.getElementById('pin-setup-new').value.trim();
  const confirmPin = document.getElementById('pin-setup-confirm').value.trim();
  const errorEl    = document.getElementById('pin-setup-error');

  errorEl.classList.add('hidden');

  if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
    errorEl.textContent = 'PIN muss genau 4 Ziffern enthalten.';
    errorEl.classList.remove('hidden');
    return;
  }
  if (newPin !== confirmPin) {
    errorEl.textContent = 'PINs stimmen nicht überein.';
    errorEl.classList.remove('hidden');
    return;
  }

  try {
    await auth.changePin(newPin);
    document.getElementById('pin-setup-screen').classList.add('hidden');
    showApp();
  } catch (e) {
    errorEl.textContent = e.message;
    errorEl.classList.remove('hidden');
  }
}

// Blendet den Login-Screen aus und zeigt die Haupt-App.
function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  // Benutzernamen in der Sidebar anzeigen.
  document.getElementById('sidebar-username').textContent = auth.getUsername() || 'Admin';

  // PWA-Link mit korrekter URL befüllen (Ingress oder direkt).
  document.getElementById('pwa-link').href = window.APP_CONFIG.pwaUrl || '/';

  setupNavigation();
  setupLogout();
  navigateTo('rooms');
}

// ====================================================
// NAVIGATION
// ====================================================

// Bindet Klick-Events an alle Nav-Links in der Sidebar.
function setupNavigation() {
  document.querySelectorAll('.nav-item').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const section = link.dataset.section;
      navigateTo(section);
    });
  });
}

// Wechselt zur angegebenen Sektion.
// Blendet alle anderen Sektionen aus und aktiviert den richtigen Nav-Link.
function navigateTo(sectionName) {
  // Live-Refresh stoppen wenn wir die Statistik verlassen.
  if (currentSection === 'statistics') {
    statistics.stopLiveRefresh();
  }

  currentSection = sectionName;

  // Alle Sektionen ausblenden.
  document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));

  // Ziel-Sektion einblenden.
  const target = document.getElementById(`section-${sectionName}`);
  if (target) target.classList.remove('hidden');

  // Aktiven Nav-Link markieren.
  document.querySelectorAll('.nav-item').forEach(l => l.classList.remove('active'));
  const activeLink = document.querySelector(`.nav-item[data-section="${sectionName}"]`);
  if (activeLink) activeLink.classList.add('active');

  // Sektion-spezifische Daten laden.
  loadSection(sectionName);
}

// Lädt die Daten und bindet Events für die gerade aufgerufene Sektion.
function loadSection(name) {
  switch (name) {
    case 'rooms':
      rooms.loadRooms();
      document.getElementById('btn-new-room').onclick = () => rooms.openRoomModal();
      break;

    case 'objects':
      objects.loadObjects();
      objects.loadObjectTypes();
      setupObjectTabs();
      document.getElementById('btn-new-object').onclick = () => objects.openObjectModal();
      document.getElementById('btn-new-type').onclick   = () => objects.openTypeModal();
      break;

    case 'users':
      users.loadUsers();
      users.loadVisitorToken();
      document.getElementById('btn-new-user').onclick       = () => users.openUserModal();
      document.getElementById('btn-print-qr').onclick       = () => users.printVisitorQR();
      document.getElementById('btn-regen-visitor').onclick  = () => users.regenVisitorToken();
      document.getElementById('visitor-token-toggle').onchange = () => users.toggleVisitorToken();
      break;

    case 'statistics':
      statistics.loadStatistics();
      document.getElementById('btn-refresh-stats').onclick = () => statistics.loadStatistics();
      break;

    case 'planradar':
      // PlanRadar-Sektion: alle drei Karten initialisieren.
      planradar.loadPlanRadar();
      break;

    case 'settings':
      settings.loadSettings();
      document.getElementById('btn-save-settings').onclick = () => settings.saveSettings();
      document.getElementById('btn-test-ha').onclick       = () => settings.testHAConnection();
      break;
  }
}

// Bindet die Tab-Umschaltung in der Objekte-Sektion (Objekte / Objekttypen).
function setupObjectTabs() {
  document.querySelectorAll('#section-objects .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Alle Tabs ausblenden.
      document.querySelectorAll('#section-objects .tab-content').forEach(tc => tc.classList.add('hidden'));
      document.querySelectorAll('#section-objects .tab-btn').forEach(b => b.classList.remove('active'));

      // Gewählten Tab einblenden.
      const targetId = btn.dataset.tab;
      document.getElementById(targetId).classList.remove('hidden');
      btn.classList.add('active');
    });
  });
}

// ====================================================
// LOGOUT
// ====================================================

// Bindet den Logout-Button und leert die Session.
function setupLogout() {
  document.getElementById('logout-btn').addEventListener('click', () => {
    statistics.stopLiveRefresh();
    auth.logout();
    // Seite neu laden = sauberster Weg für Logout (kein State bleibt über).
    window.location.reload();
  });
}

// ====================================================
// MODAL – wird von Untermodulen genutzt
// ====================================================

// Öffnet das globale Modal mit dem angegebenen Titel und HTML-Inhalt.
// Wird von rooms.js, objects.js, users.js importiert und aufgerufen.
export function openModal(title, bodyHtml) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML    = bodyHtml;
  document.getElementById('modal-overlay').classList.remove('hidden');

  // Schließen-Button im Modal-Header.
  document.getElementById('modal-close').onclick = closeModal;

  // Klick auf den dunklen Overlay-Hintergrund schließt das Modal.
  document.getElementById('modal-overlay').onclick = e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  };
}

// Schließt das Modal und leert den Inhalt.
export function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-body').innerHTML = '';
}

// ====================================================
// CONFIRM-DIALOG – wird von Untermodulen genutzt
// ====================================================

// Zeigt einen Bestätigungs-Dialog. Ruft onConfirm() auf wenn bestätigt.
// Wird von rooms.js, objects.js, users.js, planradar.js für Lösch-Aktionen verwendet.
export function showConfirm(text, onConfirm) {
  document.getElementById('confirm-text').textContent = text;
  document.getElementById('confirm-overlay').classList.remove('hidden');

  // Einmaligen Event-Listener für den Bestätigen-Button setzen.
  const okBtn     = document.getElementById('confirm-ok');
  const cancelBtn = document.getElementById('confirm-cancel');

  // Bestehende Listener entfernen um Mehrfach-Auslösung zu verhindern.
  const newOk     = okBtn.cloneNode(true);
  const newCancel = cancelBtn.cloneNode(true);
  okBtn.replaceWith(newOk);
  cancelBtn.replaceWith(newCancel);

  document.getElementById('confirm-ok').addEventListener('click', async () => {
    hideConfirm();
    try {
      await onConfirm();
    } catch (e) {
      alert('Fehler: ' + e.message);
    }
  });

  document.getElementById('confirm-cancel').addEventListener('click', hideConfirm);
}

// Blendet den Bestätigungs-Dialog aus.
function hideConfirm() {
  document.getElementById('confirm-overlay').classList.add('hidden');
}

// ====================================================
// APP STARTEN
// ====================================================

init();