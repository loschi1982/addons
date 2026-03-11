// ===================================================
// users.js – Benutzerverwaltung und Visitor-QR-Token
// Zeigt alle Benutzer, erlaubt Anlegen/Bearbeiten/Löschen
// und generiert Visitor-QR-Codes zum Ausdrucken.
// ===================================================

import * as api from './api.js';
import { openModal, closeModal, showConfirm } from './admin-app.js';

// Lädt alle Benutzer und rendert die Tabelle.
export async function loadUsers() {
  const tbody = document.querySelector('#users-table tbody');
  tbody.innerHTML = '<tr><td colspan="4" class="muted" style="padding:20px">Lädt…</td></tr>';

  try {
    const users = await api.getUsers();
    tbody.innerHTML = '';

    if (users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="muted" style="padding:20px">Noch keine Benutzer vorhanden.</td></tr>';
      return;
    }

    for (const u of users) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${u.id}</td>
        <td>${esc(u.username)}</td>
        <td>${esc(u.role)}</td>
        <td>
          <div class="action-btns">
            <button class="btn-secondary btn-sm" data-edit="${u.id}" data-username="${esc(u.username)}" data-role="${esc(u.role)}">Bearbeiten</button>
            <button class="btn-danger btn-sm" data-delete="${u.id}" data-name="${esc(u.username)}">Löschen</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => openUserModal(+btn.dataset.edit));
    });

    tbody.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', () => {
        showConfirm(`Benutzer „${btn.dataset.name}" wirklich löschen?`, async () => {
          await api.deleteUser(+btn.dataset.delete);
          loadUsers();
        });
      });
    });

  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted" style="padding:20px">Fehler: ${e.message}</td></tr>`;
  }
}

// Öffnet das Modal zum Anlegen oder Bearbeiten eines Benutzers.
// Bei Bearbeitung wird die bestehende Rolle vorgewählt.
// Die PIN muss immer neu angegeben werden (Sicherheit).
export async function openUserModal(userId = null) {
  const html = `
    <div class="form-grid">
      <div class="form-group">
        <label>Benutzername *</label>
        <input type="text" id="u-username" placeholder="z.B. max.mustermann" />
      </div>
      <div class="form-group">
        <label>PIN (4 Stellen) *</label>
        <input type="password" id="u-pin" maxlength="4" placeholder="4-stellige PIN" />
      </div>
      <div class="form-group full-width">
        <label>Rolle *</label>
        <select id="u-role">
          <option value="staff">staff – Mitarbeiter</option>
          <option value="technician">technician – Techniker</option>
          <option value="admin">admin – Administrator</option>
        </select>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" id="u-cancel">Abbrechen</button>
      <button class="btn-primary" id="u-save">Speichern</button>
    </div>
  `;

  openModal(userId ? 'Benutzer bearbeiten' : 'Neuer Benutzer', html);

  // Bei Bearbeitung: Benutzerliste erneut laden um aktuelle Werte zu bekommen.
  if (userId) {
    try {
      const users = await api.getUsers();
      const u = users.find(x => x.id === userId);
      if (u) {
        document.getElementById('u-username').value = u.username;
        document.getElementById('u-role').value     = u.role;
      }
    } catch (e) {
      alert('Fehler beim Laden: ' + e.message);
    }
  }

  document.getElementById('u-cancel').addEventListener('click', closeModal);

  document.getElementById('u-save').addEventListener('click', async () => {
    const username = document.getElementById('u-username').value.trim();
    const pin      = document.getElementById('u-pin').value.trim();
    const role     = document.getElementById('u-role').value;

    if (!username || !pin) {
      alert('Benutzername und PIN sind Pflichtfelder.');
      return;
    }

    // PIN muss exakt 4 Stellen haben.
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      alert('PIN muss aus genau 4 Ziffern bestehen.');
      return;
    }

    const payload = { username, pin, role };

    try {
      if (userId) {
        await api.updateUser(userId, payload);
      } else {
        await api.createUser(payload);
      }
      closeModal();
      loadUsers();
    } catch (e) {
      alert('Fehler beim Speichern: ' + e.message);
    }
  });
}

// Generiert einen neuen Visitor-QR-Token und zeigt ihn als QR-Code an.
// Ruft GET /api/auth/visitor-token auf und rendert das Ergebnis mit QRCode.js.
export async function generateVisitorToken() {
  const resultDiv = document.getElementById('visitor-qr-result');
  const qrDiv     = document.getElementById('visitor-qr-code');
  const tokenText = document.getElementById('visitor-token-text');

  // Alten QR-Code entfernen.
  qrDiv.innerHTML = '';
  resultDiv.classList.add('hidden');

  try {
    const res = await api.getVisitorToken();
    const tokenValue = res.qr_content || res.token;

    // QR-Code mit QRCode.js erzeugen.
    // QRCode.js erstellt automatisch ein Canvas-Element im Ziel-Container.
    new QRCode(qrDiv, {
      text:   tokenValue,
      width:  200,
      height: 200,
      colorDark:  '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });

    // Token-String als Text darunter anzeigen (für manuelle Eingabe).
    tokenText.textContent = tokenValue;

    resultDiv.classList.remove('hidden');
  } catch (e) {
    alert('Fehler beim Generieren des Visitor-Tokens: ' + e.message);
  }
}

// Öffnet den Browser-Druckdialog für den QR-Code.
// Druckt nur den sichtbaren Bereich mit QR-Code und Token-Text.
export function printVisitorQR() {
  window.print();
}

// HTML-Sonderzeichen escapen.
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}