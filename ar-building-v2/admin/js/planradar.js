// ===================================================
// planradar.js – PlanRadar-Sektion
// Verwaltet drei Karten:
//   1. Verbindung & Konfiguration (Customer-ID, Verbindungstest)
//   2. Projektliste & Rollenzuweisung
//   3. Marker-Mapping (PlanRadar-Listen ↔ AR-Marker) inkl. Auto-Mapping
// ===================================================

import * as api from './api.js';
import { showConfirm } from './admin-app.js';

// ====================================================
// ZUSTAND – wird von Karte 3 und Auto-Mapping geteilt
// ====================================================

let _currentEntries   = [];
let _currentProjectId = '';
let _currentListId    = '';

// ====================================================
// EINSTIEGSPUNKT
// ====================================================

export async function loadPlanRadar() {
  console.log('loadPlanRadar gestartet');
  await loadConnectionCard();
  await loadProjectsCard();
  await loadMappingCard();
}

// ====================================================
// KARTE 1 – VERBINDUNG & KONFIGURATION
// ====================================================

async function loadConnectionCard() {
  try {
    const s = await api.getSettings();
    const input = document.getElementById('pr-customer-id');
    if (input) input.value = s.planradar_customer_id || '';
  } catch (e) {
    console.error('PlanRadar: Settings konnten nicht geladen werden:', e.message);
  }

  document.getElementById('pr-save-customer-id').onclick = savePlanRadarCustomerId;
  document.getElementById('pr-test-connection').onclick  = testPlanRadarConnection;
}

async function savePlanRadarCustomerId() {
  const resultEl = document.getElementById('pr-connection-result');
  resultEl.textContent = 'Speichert…';
  resultEl.className = 'pr-result-neutral';
  try {
    const s = await api.getSettings();
    s.planradar_customer_id = document.getElementById('pr-customer-id').value.trim();
    await api.saveSettings(s);
    resultEl.textContent = '✓ Customer-ID gespeichert';
    resultEl.className = 'pr-result-ok';
  } catch (e) {
    resultEl.textContent = '✗ Fehler: ' + e.message;
    resultEl.className = 'pr-result-err';
  }
}

async function testPlanRadarConnection() {
  const resultEl = document.getElementById('pr-connection-result');
  resultEl.textContent = 'Teste…';
  resultEl.className = 'pr-result-neutral';
  try {
    const projects = await api.getPlanRadarProjects();
    resultEl.textContent = `✓ Verbindung OK – ${projects.length} Projekt(e) gefunden`;
    resultEl.className = 'pr-result-ok';
  } catch (e) {
    resultEl.textContent = '✗ Fehler: ' + e.message;
    resultEl.className = 'pr-result-err';
  }
}

// ====================================================
// KARTE 2 – PROJEKTLISTE & ROLLENZUWEISUNG
// ====================================================

export async function loadProjectsCard() {
  const tbody = document.querySelector('#pr-projects-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" class="muted">Lädt…</td></tr>';

  try {
    const [projects, allRoles] = await Promise.all([
      api.getPlanRadarProjects(),
      api.getPlanRadarProjectRoles(),
    ]);

    const rolesMap = {};
    for (const r of allRoles) rolesMap[r.project_id] = r.visible_to_roles || [];

    tbody.innerHTML = '';

    if (projects.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="muted">Keine Projekte gefunden. Verbindung testen?</td></tr>';
      return;
    }

    for (const p of projects) {
      const assigned = rolesMap[p.id] || [];
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${esc(p.name)}</td>
        <td>
          <span class="pr-status-badge ${p.active ? 'pr-status-active' : 'pr-status-inactive'}">
            ${p.active ? 'Aktiv' : 'Inaktiv'}
          </span>
        </td>
        <td>
          <div class="pr-role-checks" data-project="${esc(p.id)}">
            ${['visitor','staff','technician','admin'].map(role => `
              <label>
                <input type="checkbox" class="pr-role-check" value="${role}"
                  ${assigned.includes(role) ? 'checked' : ''} />
                ${role}
              </label>
            `).join('')}
          </div>
        </td>
        <td>
          <button class="btn-secondary btn-sm" data-save-project="${esc(p.id)}">Speichern</button>
        </td>
      `;
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll('[data-save-project]').forEach(btn => {
      btn.addEventListener('click', () => saveProjectRoles(btn.dataset.saveProject));
    });

  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">Fehler: ${e.message}</td></tr>`;
  }
}

async function saveProjectRoles(projectId) {
  const container = document.querySelector(`.pr-role-checks[data-project="${projectId}"]`);
  if (!container) return;
  const visible_to_roles = [...container.querySelectorAll('.pr-role-check:checked')]
    .map(cb => cb.value);
  try {
    await api.savePlanRadarProjectRoles([{ project_id: projectId, visible_to_roles }]);
  } catch (e) {
    alert('Fehler beim Speichern der Rollenzuweisung: ' + e.message);
  }
}

// ====================================================
// KARTE 3 – MARKER-MAPPING
// ====================================================

async function loadMappingCard() {
  await loadExistingMappings();
  setupMappingForm();
}

async function loadExistingMappings() {
  const tbody = document.querySelector('#pr-mappings-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="muted">Lädt…</td></tr>';

  try {
    const mappings = await api.getPlanRadarMappings();
    tbody.innerHTML = '';

    if (mappings.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">Noch keine Mappings vorhanden.</td></tr>';
      return;
    }

    for (const m of mappings) {
      const roles = (m.visible_to_roles || []).join(', ') || '–';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>${esc(m.ar_marker_id)}</code></td>
        <td>${esc(m.planradar_entry_name)}</td>
        <td>${esc(m.planradar_list_id)}</td>
        <td>${esc(roles)}</td>
        <td>
          <button class="btn-danger btn-sm" data-delete-mapping="${m.id}"
            data-name="${esc(m.planradar_entry_name)}">Löschen</button>
        </td>
      `;
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll('[data-delete-mapping]').forEach(btn => {
      btn.addEventListener('click', () => {
        showConfirm(
          `Mapping für „${btn.dataset.name}" wirklich löschen?`,
          async () => {
            await api.deletePlanRadarMapping(+btn.dataset.deleteMapping);
            loadExistingMappings();
          }
        );
      });
    });

  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">Fehler: ${e.message}</td></tr>`;
  }
}

function setupMappingForm() {
  const btnLoadLists   = document.getElementById('pr-load-lists');
  const btnLoadEntries = document.getElementById('pr-load-entries');
  const btnSaveMapping = document.getElementById('pr-save-mapping');
  const btnAutoMapping = document.getElementById('pr-auto-mapping');

  if (!btnLoadLists) return;

  fillProjectDropdown();

  btnLoadLists.addEventListener('click', async () => {
    const projectId = document.getElementById('pr-map-project').value;
    if (!projectId) { alert('Bitte erst ein Projekt auswählen.'); return; }
    _currentProjectId = projectId;

    try {
      const lists = await api.getPlanRadarLists(projectId);
      const select = document.getElementById('pr-map-list');
      select.innerHTML = '<option value="">– Liste wählen –</option>' +
        lists.map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');
      document.getElementById('pr-map-list-row').classList.remove('hidden');
      document.getElementById('pr-map-entries-row').classList.add('hidden');
      document.getElementById('pr-map-marker-row').classList.add('hidden');
      if (btnAutoMapping) btnAutoMapping.classList.add('hidden');
      _currentEntries = [];
      _currentListId  = '';
    } catch (e) {
      alert('Fehler beim Laden der Listen: ' + e.message);
    }
  });

  btnLoadEntries.addEventListener('click', async () => {
    const listId = document.getElementById('pr-map-list').value;
    if (!listId) { alert('Bitte erst eine Liste auswählen.'); return; }
    _currentListId = listId;

    try {
      const entries = await api.getPlanRadarListEntries(listId);
      _currentEntries = entries;

      const select = document.getElementById('pr-map-entry');
      select.innerHTML = '<option value="">– Eintrag wählen –</option>' +
        entries.map(e =>
          `<option value="${esc(e.uuid)}" data-name="${esc(e.name)}">${esc(e.name)}</option>`
        ).join('');

      document.getElementById('pr-map-entries-row').classList.remove('hidden');
      document.getElementById('pr-map-marker-row').classList.remove('hidden');

      if (btnAutoMapping && entries.length > 0) {
        btnAutoMapping.classList.remove('hidden');
      }
    } catch (e) {
      alert('Fehler beim Laden der Einträge: ' + e.message);
    }
  });

  btnSaveMapping.addEventListener('click', async () => {
    const projectSel = document.getElementById('pr-map-project');
    const listSel    = document.getElementById('pr-map-list');
    const entrySel   = document.getElementById('pr-map-entry');
    const markerEl   = document.getElementById('pr-map-marker');

    const planradar_project_id = projectSel.value;
    const planradar_list_id    = listSel.value;
    const planradar_entry_uuid = entrySel.value;
    const selectedOpt          = entrySel.options[entrySel.selectedIndex];
    const planradar_entry_name = selectedOpt?.dataset?.name || '';
    const ar_marker_id         = markerEl.value.trim();
    const visible_to_roles     = [...document.querySelectorAll('.pr-map-role-check:checked')]
      .map(cb => cb.value);

    if (!planradar_project_id || !planradar_list_id || !planradar_entry_uuid || !ar_marker_id) {
      alert('Bitte Projekt, Liste, Eintrag und AR-Marker-ID ausfüllen.');
      return;
    }

    try {
      await api.savePlanRadarMapping({
        planradar_project_id, planradar_list_id,
        planradar_entry_uuid, planradar_entry_name,
        ar_marker_id, visible_to_roles,
      });
      markerEl.value = '';
      document.querySelectorAll('.pr-map-role-check').forEach(cb => (cb.checked = false));
      document.getElementById('pr-map-list-row').classList.add('hidden');
      document.getElementById('pr-map-entries-row').classList.add('hidden');
      document.getElementById('pr-map-marker-row').classList.add('hidden');
      if (btnAutoMapping) btnAutoMapping.classList.add('hidden');
      _currentEntries = [];
      await loadExistingMappings();
    } catch (e) {
      alert('Fehler beim Speichern des Mappings: ' + e.message);
    }
  });

  if (btnAutoMapping) {
    btnAutoMapping.addEventListener('click', () => openAutoMappingModal());
  }
}

async function fillProjectDropdown() {
  const select = document.getElementById('pr-map-project');
  if (!select) return;
  try {
    const projects = await api.getPlanRadarProjects();
    select.innerHTML = '<option value="">– Projekt wählen –</option>' +
      projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  } catch (e) {
    select.innerHTML = '<option value="">Fehler beim Laden</option>';
  }
}

// ====================================================
// AUTO-MAPPING – MUSTERERKENNUNG
// ====================================================

// Ermittelt das Namensmuster eines Eintrags anhand der Anzahl Bindestriche im Präfix.
function detectPattern(entryName) {
  const prefix = entryName.split(' ')[0];
  const count  = (prefix.match(/-/g) || []).length;

  if (count === 0) return { key: '0', label: 'Kein Bindestrich',  example: prefix };
  if (count === 1) return { key: '1', label: '1 Bindestrich',     example: prefix };
  if (count === 2) return { key: '2', label: '2 Bindestriche',    example: prefix };
  return             { key: `${count}`, label: `${count} Bindestriche`, example: prefix };
}

// Gruppiert Einträge nach Mustertyp.
function groupEntriesByPattern(entries) {
  const groups = {};

  for (const entry of entries) {
    const { key, label, example } = detectPattern(entry.name);

    if (!groups[key]) {
      groups[key] = { key, label, entries: [], examples: [] };
    }
    groups[key].entries.push(entry);

    if (groups[key].examples.length < 2 && !groups[key].examples.includes(example)) {
      groups[key].examples.push(example);
    }
  }

  return Object.values(groups).sort((a, b) => +a.key - +b.key);
}

// ====================================================
// AUTO-MAPPING – Schritt 0: Typ-Abfrage
// ====================================================

// Fragt vor der Vorschau, ob nicht gematchte Einträge als Räume oder
// Objekte (mit Auswahl des Objekttyps) automatisch angelegt werden sollen.
// Gibt ein Objekt { createAs, typeId, typeName, roomId } zurück oder null bei Abbruch.
async function openAutoMappingTypeDialog() {
  return new Promise(async (resolve) => {

    // Objekttypen laden für das Dropdown
    let objectTypes = [];
    try {
      objectTypes = await api.getObjectTypes();
    } catch (e) {
      // Kein Fatal – Objekttypen sind optional wenn nur Räume angelegt werden
    }

    // Räume laden für die Raum-Auswahl bei Objekten
    let rooms = [];
    try {
      rooms = await api.getRooms();
    } catch (e) { /* */ }

    const typeOptions = objectTypes.map(t =>
      `<option value="${t.id}" data-name="${esc(t.name)}">${esc(t.name)}</option>`
    ).join('');

    const roomOptions = rooms.map(r =>
      `<option value="${r.id}">${esc(r.name)} (${esc(r.marker_id)})</option>`
    ).join('');

    const html = `
      <div class="pr-auto-modal">
        <p class="muted" style="margin-bottom:16px">
          Nicht zuordenbare Listeneinträge können automatisch als neue AR-Einträge angelegt werden.
          Bitte festlegen, was diese Einträge darstellen.
        </p>

        <div style="display:flex; flex-direction:column; gap:14px;">
          <label class="pr-field-label">Einträge anlegen als
            <select id="pr-type-dialog-as" style="margin-top:4px">
              <option value="room">Räume (neue Räume werden angelegt)</option>
              <option value="object">Objekte (neue Objekte werden angelegt)</option>
              <option value="none">Nicht anlegen – nur vorhandene Matches übernehmen</option>
            </select>
          </label>

          <div id="pr-type-dialog-obj-fields" style="display:none; flex-direction:column; gap:12px;">
            <label class="pr-field-label">Objekttyp für neue Objekte *
              <select id="pr-type-dialog-type" style="margin-top:4px">
                ${typeOptions || '<option value="">– Keine Objekttypen vorhanden –</option>'}
              </select>
            </label>
            <label class="pr-field-label">Raum für neue Objekte *
              <select id="pr-type-dialog-room" style="margin-top:4px">
                ${roomOptions || '<option value="">– Keine Räume vorhanden –</option>'}
              </select>
            </label>
          </div>
        </div>

        <div class="modal-actions" style="margin-top:20px;">
          <button class="btn-secondary" id="pr-type-cancel">Abbrechen</button>
          <button class="btn-primary" id="pr-type-next">Weiter zur Vorschau →</button>
        </div>
      </div>
    `;

    showAutoModal('Auto-Mapping — Eintragstyp festlegen', html);

    // Felder für Objekttyp + Raum ein-/ausblenden
    const asSelect = document.getElementById('pr-type-dialog-as');
    const objFields = document.getElementById('pr-type-dialog-obj-fields');

    asSelect.addEventListener('change', () => {
      objFields.style.display = asSelect.value === 'object' ? 'flex' : 'none';
    });

    document.getElementById('pr-type-cancel').addEventListener('click', () => {
      closeAutoModal();
      resolve(null);
    });

    document.getElementById('pr-type-next').addEventListener('click', () => {
      const createAs = asSelect.value;

      if (createAs === 'object') {
        const typeSelect = document.getElementById('pr-type-dialog-type');
        const roomSelect = document.getElementById('pr-type-dialog-room');
        const typeId = typeSelect.value;
        const typeName = typeSelect.options[typeSelect.selectedIndex]?.dataset?.name || '';
        const roomId = roomSelect.value;

        if (!typeId || !roomId) {
          alert('Bitte Objekttyp und Raum auswählen.');
          return;
        }
        resolve({ createAs, typeId: +typeId, typeName, roomId: +roomId });
      } else {
        resolve({ createAs, typeId: null, typeName: null, roomId: null });
      }
    });
  });
}

// ====================================================
// AUTO-MAPPING – Schritt 1: Muster-Übersicht
// ====================================================

async function openAutoMappingModal() {
  if (_currentEntries.length === 0) {
    alert('Bitte zuerst Einträge laden.');
    return;
  }

  const groups = groupEntriesByPattern(_currentEntries);

  const groupsHtml = groups.map(g => `
    <div class="pr-pattern-group">
      <label class="pr-pattern-group-label">
        <input type="checkbox" class="pr-group-check" value="${esc(g.key)}" checked />
        <div class="pr-pattern-group-info">
          <span class="pr-pattern-group-title">${esc(g.label)}</span>
          <span class="pr-pattern-group-meta">
            ${g.entries.length} Eintrag${g.entries.length !== 1 ? 'e' : ''}
            &nbsp;·&nbsp;
            Beispiele: <code>${g.examples.map(esc).join('</code>, <code>')}</code>
          </span>
        </div>
      </label>
    </div>
  `).join('');

  const html = `
    <div class="pr-auto-modal">
      <p class="muted" style="margin-bottom:16px">
        Das System hat <strong>${groups.length} Namensmuster</strong> in den
        ${_currentEntries.length} Einträgen erkannt.
        Wähle aus welche Muster automatisch gemappt werden sollen.
      </p>
      <div class="pr-pattern-group-list" id="pr-group-list">
        ${groupsHtml}
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" id="pr-auto-cancel">Abbrechen</button>
        <button class="btn-primary" id="pr-auto-next">Weiter →</button>
      </div>
    </div>
  `;

  showAutoModal('Auto-Mapping — Erkannte Muster', html);

  document.getElementById('pr-auto-cancel').addEventListener('click', closeAutoModal);

  document.getElementById('pr-auto-next').addEventListener('click', async () => {
    const selectedKeys = [...document.querySelectorAll('.pr-group-check:checked')]
      .map(cb => cb.value);

    if (selectedKeys.length === 0) {
      alert('Bitte mindestens ein Muster auswählen.');
      return;
    }

    const selectedEntries = _currentEntries.filter(entry => {
      const { key } = detectPattern(entry.name);
      return selectedKeys.includes(key);
    });

    // Schritt 0: Typ-Dialog anzeigen bevor die Vorschau geöffnet wird
    const typeConfig = await openAutoMappingTypeDialog();
    if (typeConfig === null) return; // Abbruch

    await openAutoMappingPreview(selectedEntries, typeConfig);
  });
}

// ====================================================
// AUTO-MAPPING – Schritt 2: Vorschau & Bestätigung
// ====================================================

// Öffnet die Vorschau-Tabelle.
// typeConfig = { createAs: 'room'|'object'|'none', typeId, typeName, roomId }
async function openAutoMappingPreview(entries, typeConfig) {
  showAutoModal('Auto-Mapping — Vorschau', `
    <div class="pr-auto-modal">
      <p class="muted">Lade Räume und Objekte…</p>
    </div>
  `);

  let rooms   = [];
  let objects = [];

  try {
    [rooms, objects] = await Promise.all([api.getRooms(), api.getObjects()]);
  } catch (e) {
    showAutoModal('Auto-Mapping — Vorschau', `
      <div class="pr-auto-modal">
        <p style="color:#e74c3c">Fehler beim Laden der AR-Daten: ${esc(e.message)}</p>
        <div class="modal-actions">
          <button class="btn-secondary" id="pr-auto-back-err">← Zurück</button>
        </div>
      </div>
    `);
    document.getElementById('pr-auto-back-err').addEventListener('click', openAutoMappingModal);
    return;
  }

  const allMarkers = [
    ...rooms.map(r   => ({ marker_id: r.marker_id, name: r.name, type: 'Raum'   })),
    ...objects.map(o => ({ marker_id: o.marker_id, name: o.name, type: 'Objekt' })),
  ];

  // Für jeden Eintrag den besten Match suchen.
  // Teil nach " - " im Namen, case-insensitiver Teilstring-Vergleich.
  const rows = entries.map(entry => {
    const label   = entry.name.includes(' - ')
      ? entry.name.split(' - ').slice(1).join(' - ').trim()
      : entry.name;
    const matches = allMarkers.filter(m =>
      m.name.toLowerCase().includes(label.toLowerCase())
    );
    return { entry, label, matches, chosen: matches[0] || null };
  });

  const matchCount   = rows.filter(r => r.matches.length > 0).length;
  const noMatchCount = rows.filter(r => r.matches.length === 0).length;

  // Hinweis-Text je nach typeConfig und Anzahl nicht-gematchter Einträge
  let noMatchHint = '';
  if (noMatchCount > 0) {
    if (typeConfig.createAs === 'room') {
      noMatchHint = `<p style="margin-top:8px; font-size:13px; color:#7cb3ff">
        💡 ${noMatchCount} Eintrag${noMatchCount !== 1 ? 'e' : ''} ohne Match
        werden als <strong>neue Räume</strong> angelegt und direkt gemappt.
      </p>`;
    } else if (typeConfig.createAs === 'object') {
      noMatchHint = `<p style="margin-top:8px; font-size:13px; color:#7cb3ff">
        💡 ${noMatchCount} Eintrag${noMatchCount !== 1 ? 'e' : ''} ohne Match
        werden als <strong>neue Objekte (${esc(typeConfig.typeName)})</strong> angelegt und direkt gemappt.
      </p>`;
    } else {
      noMatchHint = `<p style="margin-top:8px; font-size:13px; color:var(--muted)">
        ℹ️ ${noMatchCount} Eintrag${noMatchCount !== 1 ? 'e' : ''} ohne Match werden übersprungen.
      </p>`;
    }
  }

  const rowsHtml = rows.map((row, idx) => {
    const hasMatch = row.matches.length > 0;
    const willCreate = !hasMatch && typeConfig.createAs !== 'none';

    let markerCell = '';
    if (row.matches.length > 1) {
      markerCell = `
        <select class="pr-auto-marker-select" data-row="${idx}">
          ${row.matches.map(m =>
            `<option value="${esc(m.marker_id)}">${esc(m.marker_id)} – ${esc(m.name)} (${esc(m.type)})</option>`
          ).join('')}
        </select>
      `;
    } else if (row.matches.length === 1) {
      markerCell = `<code>${esc(row.matches[0].marker_id)}</code> – ${esc(row.matches[0].name)}`;
    } else if (willCreate) {
      // Wird neu angelegt – Marker-ID = Name des PlanRadar-Eintrags
      markerCell = `<span style="color:#7cb3ff; font-size:12px">
        ✨ Neu anlegen als ${typeConfig.createAs === 'room' ? 'Raum' : 'Objekt'}
        <br><span class="muted">Marker-ID: „${esc(row.entry.name)}"</span>
      </span>`;
    } else {
      markerCell = `<span class="muted">— kein Match —</span>`;
    }

    // Zeile ist wählbar wenn: Match vorhanden ODER automatisches Anlegen aktiv
    const canSelect = hasMatch || willCreate;
    const checkHtml = canSelect
      ? `<input type="checkbox" class="pr-auto-row-check" data-row="${idx}" checked />`
      : `<input type="checkbox" class="pr-auto-row-check" data-row="${idx}" disabled />`;

    return `
      <tr class="${canSelect ? '' : 'pr-auto-row-nomatch'}" data-row="${idx}">
        <td>${esc(row.entry.name)}</td>
        <td>${markerCell}</td>
        <td>${checkHtml}</td>
      </tr>
    `;
  }).join('');

  const canSaveCount = rows.filter(r => r.matches.length > 0 || (typeConfig.createAs !== 'none' && r.matches.length === 0)).length;

  const html = `
    <div class="pr-auto-modal">
      <p class="muted" style="margin-bottom:4px">
        ${matchCount} von ${rows.length} Einträgen konnten automatisch zugeordnet werden.
        Deaktiviere einzelne Zeilen um sie zu überspringen.
      </p>
      ${noMatchHint}
      <div class="table-wrap" style="max-height:340px; overflow-y:auto; margin-top:12px;">
        <table class="pr-auto-preview-table">
          <thead>
            <tr>
              <th>PlanRadar-Eintrag</th>
              <th>Vorgeschlagener AR-Marker</th>
              <th>Übernehmen</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      <div id="pr-auto-save-msg" style="margin-top:10px; font-size:13px;"></div>
      <div class="modal-actions">
        <button class="btn-secondary" id="pr-auto-back">← Zurück</button>
        <button class="btn-primary" id="pr-auto-save"
          ${canSaveCount === 0 ? 'disabled' : ''}>
          Übernehmen & Speichern
        </button>
      </div>
    </div>
  `;

  showAutoModal('Auto-Mapping — Vorschau & Bestätigung', html);

  document.getElementById('pr-auto-back').addEventListener('click', openAutoMappingModal);
  document.getElementById('pr-auto-save').addEventListener('click', async () => {
    await saveAutoMappings(rows, typeConfig);
  });
}

// ====================================================
// AUTO-MAPPING – Schritt 3: Speichern (inkl. Auto-Anlegen)
// ====================================================

// Speichert alle angehakten Mappings.
// Nicht gematchte Einträge werden zuerst als Raum/Objekt angelegt,
// dann gemappt.
async function saveAutoMappings(rows, typeConfig) {
  const saveBtn = document.getElementById('pr-auto-save');
  const msgEl   = document.getElementById('pr-auto-save-msg');
  if (saveBtn) saveBtn.disabled = true;
  if (msgEl) msgEl.textContent = 'Speichert…';

  let saved    = 0;
  let created  = 0;
  let failed   = 0;

  for (let idx = 0; idx < rows.length; idx++) {
    const cb = document.querySelector(`.pr-auto-row-check[data-row="${idx}"]`);
    if (!cb || !cb.checked || cb.disabled) continue;

    const row = rows[idx];

    // --- Fall 1: Match vorhanden → Marker-ID aus Dropdown oder erstem Match ---
    if (row.matches.length > 0) {
      const sel       = document.querySelector(`.pr-auto-marker-select[data-row="${idx}"]`);
      const marker_id = sel ? sel.value : (row.matches[0]?.marker_id || '');
      if (!marker_id) continue;

      try {
        await api.savePlanRadarMapping({
          planradar_project_id: _currentProjectId,
          planradar_list_id:    _currentListId,
          planradar_entry_uuid: row.entry.uuid,
          planradar_entry_name: row.entry.name,
          ar_marker_id:         marker_id,
          visible_to_roles:     [],
        });
        saved++;
      } catch (e) {
        failed++;
        if (msgEl) msgEl.textContent = `Fehler bei „${row.entry.name}": ${e.message}`;
      }
      continue;
    }

    // --- Fall 2: Kein Match → Neuen Raum oder Objekt anlegen, dann mappen ---
    if (typeConfig.createAs === 'none') continue;

    // Label nach " - " für den Namen des neuen Eintrags
    const newName = row.entry.name.includes(' - ')
      ? row.entry.name.split(' - ').slice(1).join(' - ').trim()
      : row.entry.name;

    // Marker-ID = der vollständige Name des PlanRadar-Listeneintrags.
    // Kein Präfix wie "room:" oder "object:" — der Name wird direkt als ID verwendet.
    const marker_id = row.entry.name;

    try {
      let newRecord;

      if (typeConfig.createAs === 'room') {
        // Neuen Raum anlegen
        newRecord = await api.createRoom({
          name:          newName,
          marker_id:     marker_id,
          short_desc:    row.entry.name,  // Original-Name als Kurzbeschreibung
          detail_text:   '',
          video_opacity: 0.8,
          ha_sensor_ids: [],
        });
      } else {
        // Neues Objekt anlegen
        newRecord = await api.createObject({
          name:           newName,
          marker_id:      marker_id,
          short_desc:     row.entry.name,
          detail_text:    '',
          type_id:        typeConfig.typeId,
          room_id:        typeConfig.roomId,
          video_path:     null,
          video_opacity:  0.8,
          audio_path:     null,
          ha_sensor_ids:  [],
          onnx_class_id:  null,
        });
      }

      created++;

      // Direkt nach dem Anlegen mappen
      await api.savePlanRadarMapping({
        planradar_project_id: _currentProjectId,
        planradar_list_id:    _currentListId,
        planradar_entry_uuid: row.entry.uuid,
        planradar_entry_name: row.entry.name,
        ar_marker_id:         newRecord.marker_id,
        visible_to_roles:     [],
      });
      saved++;

    } catch (e) {
      failed++;
      if (msgEl) msgEl.textContent = `Fehler beim Anlegen von „${newName}": ${e.message}`;
    }
  }

  closeAutoModal();
  await loadExistingMappings();

  // Erfolgsmeldung unter der Mapping-Tabelle
  const anchor = document.querySelector('#pr-mappings-table');
  if (anchor) {
    const msg = document.createElement('p');
    msg.style.cssText = 'margin-top:8px; font-size:13px; color: var(--success)';

    if (failed > 0) {
      msg.textContent = `${saved} Mapping(s) gespeichert, ${created} neu angelegt, ${failed} fehlgeschlagen.`;
      msg.style.color = '#e74c3c';
    } else if (created > 0) {
      msg.textContent = `✓ ${saved} Mapping(s) gespeichert, davon ${created} neu als AR-Eintrag angelegt.`;
    } else {
      msg.textContent = `✓ ${saved} Mapping(s) gespeichert.`;
    }

    anchor.parentNode.insertBefore(msg, anchor.nextSibling);
    setTimeout(() => msg.remove(), 6000);
  }
}

// ====================================================
// AUTO-MAPPING MODAL HELPERS
// ====================================================

function showAutoModal(title, bodyHtml) {
  let overlay = document.getElementById('pr-auto-overlay');

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'pr-auto-overlay';
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,.75);
      display:flex; align-items:center; justify-content:center; z-index:150;
    `;

    const box = document.createElement('div');
    box.id = 'pr-auto-box';
    box.style.cssText = `
      background:var(--card); border:1px solid var(--border); border-radius:10px;
      width:min(720px,95vw); max-height:88vh; overflow-y:auto;
      display:flex; flex-direction:column;
    `;
    box.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:16px 20px;border-bottom:1px solid var(--border);
                  position:sticky;top:0;background:var(--card);z-index:1;">
        <h3 id="pr-auto-title" style="font-size:16px;font-weight:700;"></h3>
        <button id="pr-auto-close"
          style="background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer;padding:0 4px;">
          ✕
        </button>
      </div>
      <div id="pr-auto-body" style="padding:20px;"></div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeAutoModal(); });
  }

  document.getElementById('pr-auto-title').textContent = title;
  document.getElementById('pr-auto-body').innerHTML    = bodyHtml;
  overlay.style.display = 'flex';
  document.getElementById('pr-auto-close').onclick = closeAutoModal;
}

function closeAutoModal() {
  const overlay = document.getElementById('pr-auto-overlay');
  if (overlay) overlay.style.display = 'none';
}

// ====================================================
// HILFSFUNKTIONEN
// ====================================================

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}