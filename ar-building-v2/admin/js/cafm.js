// ===================================================
// cafm.js – CAFM-Modul (Technische Anlagen, Wartung)
// Admin-Oberfläche für Anlagenverwaltung, Wartungsplanung
// und Protokolle mit DIN 276 / VDMA 24186 Unterstützung.
// ===================================================

import * as api from './api.js';
import { openModal, closeModal, showConfirm } from './admin-app.js';

// Cache für Objekte und VDMA-Vorlagen.
let objectsCache = [];
let vdmaTemplates = [];
let plantsCache = [];

// ====================================================
// ÖFFENTLICHE API
// ====================================================

export async function loadCafm() {
  setupCafmTabs();
  await Promise.all([
    loadObjectsCache(),
    loadVDMATemplates(),
  ]);
  await loadPlants();
}

// ====================================================
// TAB-STEUERUNG
// ====================================================

let cafmTabsReady = false;

function setupCafmTabs() {
  if (cafmTabsReady) return;
  cafmTabsReady = true;

  document.querySelectorAll('#section-cafm .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#section-cafm .tab-content').forEach(tc => tc.classList.add('hidden'));
      document.querySelectorAll('#section-cafm .tab-btn').forEach(b => b.classList.remove('active'));
      const targetId = btn.dataset.tab;
      document.getElementById(targetId).classList.remove('hidden');
      btn.classList.add('active');
    });
  });
}

// ====================================================
// DATEN LADEN
// ====================================================

async function loadObjectsCache() {
  try {
    objectsCache = await api.getObjects();
  } catch (e) {
    console.error('Objekte laden fehlgeschlagen:', e.message);
    objectsCache = [];
  }
}

async function loadVDMATemplates() {
  try {
    vdmaTemplates = await api.getVDMATemplates();
  } catch (e) {
    console.error('VDMA-Vorlagen laden fehlgeschlagen:', e.message);
    vdmaTemplates = [];
  }
}

// ====================================================
// ANLAGEN-TAB
// ====================================================

async function loadPlants() {
  try {
    plantsCache = await api.getPlants();
  } catch (e) {
    console.error('Anlagen laden fehlgeschlagen:', e.message);
    plantsCache = [];
  }
  renderPlantsTable();
  renderSchedulesTable();
  renderLogsTable();
}

function renderPlantsTable() {
  const tbody = document.querySelector('#cafm-plants-table tbody');
  tbody.innerHTML = '';

  if (plantsCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="muted">Keine Anlagen vorhanden</td></tr>';
    return;
  }

  for (const p of plantsCache) {
    const obj = objectsCache.find(o => o.id === p.object_id);
    const objName = obj ? obj.name : `Objekt #${p.object_id}`;
    const nextDue = getNextDue(p.schedules);
    const dueClass = nextDue.overdue ? 'style="color:#c0392b;font-weight:bold;"' : '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.id}</td>
      <td>${esc(objName)}</td>
      <td>${esc(p.hersteller || '–')}</td>
      <td>${esc(p.modell || '–')}</td>
      <td>${esc(p.din276_kg || '–')}</td>
      <td><span class="badge badge-${statusColor(p.status)}">${esc(p.status)}</span></td>
      <td ${dueClass}>${nextDue.label}</td>
      <td>
        <button class="btn-sm" onclick="window._cafmEditPlant(${p.object_id})">Bearbeiten</button>
        <button class="btn-sm btn-danger" onclick="window._cafmDeletePlant(${p.object_id})">Löschen</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

function getNextDue(schedules) {
  if (!schedules || schedules.length === 0) return { label: '–', overdue: false };
  const active = schedules.filter(s => s.active);
  if (active.length === 0) return { label: '–', overdue: false };
  active.sort((a, b) => a.next_due.localeCompare(b.next_due));
  const next = active[0];
  const today = new Date().toISOString().slice(0, 10);
  const overdue = next.next_due <= today;
  return {
    label: overdue ? `${fmtDE(next.next_due)} (überfällig)` : fmtDE(next.next_due),
    overdue,
  };
}

function statusColor(status) {
  if (status === 'aktiv') return 'green';
  if (status === 'ausser_betrieb') return 'yellow';
  return 'red';
}

// ====================================================
// WARTUNGSPLANUNG-TAB
// ====================================================

function renderSchedulesTable() {
  const tbody = document.querySelector('#cafm-schedules-table tbody');
  tbody.innerHTML = '';

  const allSchedules = [];
  for (const p of plantsCache) {
    const obj = objectsCache.find(o => o.id === p.object_id);
    for (const s of (p.schedules || [])) {
      allSchedules.push({ ...s, plantName: obj ? obj.name : `Objekt #${p.object_id}`, objectId: p.object_id });
    }
  }

  if (allSchedules.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted">Keine Wartungspläne</td></tr>';
    return;
  }

  allSchedules.sort((a, b) => a.next_due.localeCompare(b.next_due));
  const today = new Date().toISOString().slice(0, 10);

  for (const s of allSchedules) {
    const overdue = s.active && s.next_due <= today;
    const statusBadge = !s.active
      ? '<span class="badge badge-gray">Inaktiv</span>'
      : overdue
        ? '<span class="badge badge-red">Überfällig</span>'
        : '<span class="badge badge-green">OK</span>';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(s.plantName)}</td>
      <td>${esc(s.title)}</td>
      <td>${s.interval_months} Monate</td>
      <td style="${overdue ? 'color:#c0392b;font-weight:bold;' : ''}">${fmtDE(s.next_due)}</td>
      <td>${statusBadge}</td>
      <td>
        <button class="btn-sm" onclick="window._cafmEditSchedule(${s.objectId}, ${s.id})">Bearbeiten</button>
        <button class="btn-sm btn-danger" onclick="window._cafmDeleteSchedule(${s.id})">Löschen</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

// ====================================================
// PROTOKOLLE-TAB
// ====================================================

function renderLogsTable() {
  const tbody = document.querySelector('#cafm-logs-table tbody');
  tbody.innerHTML = '';

  const allLogs = [];
  for (const p of plantsCache) {
    const obj = objectsCache.find(o => o.id === p.object_id);
    for (const l of (p.logs || [])) {
      const schedule = (p.schedules || []).find(s => s.id === l.schedule_id);
      allLogs.push({
        ...l,
        plantName: obj ? obj.name : `Objekt #${p.object_id}`,
        scheduleName: schedule ? schedule.title : '–',
      });
    }
  }

  if (allLogs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">Keine Protokolle</td></tr>';
    return;
  }

  allLogs.sort((a, b) => b.performed_at.localeCompare(a.performed_at));

  for (const l of allLogs) {
    const pdfLink = l.pdf_path
      ? `<a href="${api.getLogPdfUrl(l.id)}" target="_blank" class="btn-sm">PDF</a>`
      : '–';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(l.plantName)}</td>
      <td>${esc(l.scheduleName)}</td>
      <td>${esc(l.technician)}</td>
      <td>${fmtDE(l.performed_at.slice(0, 10))}</td>
      <td>${pdfLink}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ====================================================
// ANLAGEN-MODAL
// ====================================================

export function openNewPlantModal() {
  // Nur Objekte vom Typ "Technische Anlagen" anzeigen, die noch keine Anlagendaten haben.
  const taType = objectsCache.find(o => {
    // type_name comes from ObjectSummary
    return true; // Alle Objekte anbieten, da der Typ erst beim Erstellen festgelegt wird.
  });

  const existingIds = new Set(plantsCache.map(p => p.object_id));
  const availableObjects = objectsCache.filter(o => !existingIds.has(o.id));

  if (availableObjects.length === 0) {
    alert('Alle Objekte haben bereits Anlagendaten oder es sind keine Objekte vorhanden.');
    return;
  }

  const objectOptions = availableObjects.map(o =>
    `<option value="${o.id}">${esc(o.name)} (${esc(o.type_name)})</option>`
  ).join('');

  const kgOptions = vdmaTemplates.map(t =>
    `<option value="${t.kg}">KG ${t.kg} – ${esc(t.label)}</option>`
  ).join('');

  const html = `
    <form id="plant-form">
      <label>Objekt *</label>
      <select id="pf-object-id" required>${objectOptions}</select>

      <div class="form-row">
        <div class="form-col">
          <label>Hersteller</label>
          <input type="text" id="pf-hersteller" />
        </div>
        <div class="form-col">
          <label>Modell</label>
          <input type="text" id="pf-modell" />
        </div>
      </div>

      <div class="form-row">
        <div class="form-col">
          <label>Seriennummer</label>
          <input type="text" id="pf-seriennummer" />
        </div>
        <div class="form-col">
          <label>Baujahr</label>
          <input type="number" id="pf-baujahr" min="1900" max="2100" />
        </div>
      </div>

      <div class="form-row">
        <div class="form-col">
          <label>Einbaudatum</label>
          <input type="date" id="pf-einbaudatum" />
        </div>
        <div class="form-col">
          <label>Garantie bis</label>
          <input type="date" id="pf-garantie-bis" />
        </div>
      </div>

      <label>Standort-Detail</label>
      <input type="text" id="pf-standort" placeholder="z.B. Keller, Technikraum 3" />

      <div class="form-row">
        <div class="form-col">
          <label>DIN 276 Kostengruppe</label>
          <select id="pf-din276">
            <option value="">– Keine –</option>
            ${kgOptions}
          </select>
        </div>
        <div class="form-col">
          <label>VDMA-Gewerk</label>
          <input type="text" id="pf-gewerk" readonly class="muted" />
        </div>
      </div>

      <div class="form-row">
        <div class="form-col">
          <label>Status</label>
          <select id="pf-status">
            <option value="aktiv">Aktiv</option>
            <option value="ausser_betrieb">Außer Betrieb</option>
            <option value="stillgelegt">Stillgelegt</option>
          </select>
        </div>
      </div>

      <label>Bemerkungen</label>
      <textarea id="pf-bemerkungen" rows="3"></textarea>

      <button type="submit" class="btn-primary" style="margin-top:1rem;">Anlage speichern</button>
    </form>
  `;

  openModal('Neue Anlage', html);
  setupPlantFormEvents();

  document.getElementById('plant-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const objectId = parseInt(document.getElementById('pf-object-id').value);
    const data = collectPlantFormData();
    try {
      await api.createPlant(objectId, data);
      closeModal();
      await loadPlants();
    } catch (err) {
      alert('Fehler: ' + err.message);
    }
  });
}

export async function editPlant(objectId) {
  let plant;
  try {
    plant = await api.getPlant(objectId);
  } catch (e) {
    alert('Anlagendaten nicht gefunden: ' + e.message);
    return;
  }

  const obj = objectsCache.find(o => o.id === objectId);
  const objName = obj ? obj.name : `Objekt #${objectId}`;

  const kgOptions = vdmaTemplates.map(t =>
    `<option value="${t.kg}" ${t.kg === plant.din276_kg ? 'selected' : ''}>KG ${t.kg} – ${esc(t.label)}</option>`
  ).join('');

  const docsHtml = renderDocumentsSection(plant);
  const schedulesHtml = renderSchedulesSection(plant, objectId);

  const html = `
    <form id="plant-form">
      <p class="muted" style="margin-bottom:1rem;">Objekt: <strong>${esc(objName)}</strong></p>

      <div class="form-row">
        <div class="form-col">
          <label>Hersteller</label>
          <input type="text" id="pf-hersteller" value="${esc(plant.hersteller || '')}" />
        </div>
        <div class="form-col">
          <label>Modell</label>
          <input type="text" id="pf-modell" value="${esc(plant.modell || '')}" />
        </div>
      </div>

      <div class="form-row">
        <div class="form-col">
          <label>Seriennummer</label>
          <input type="text" id="pf-seriennummer" value="${esc(plant.seriennummer || '')}" />
        </div>
        <div class="form-col">
          <label>Baujahr</label>
          <input type="number" id="pf-baujahr" min="1900" max="2100" value="${plant.baujahr || ''}" />
        </div>
      </div>

      <div class="form-row">
        <div class="form-col">
          <label>Einbaudatum</label>
          <input type="date" id="pf-einbaudatum" value="${plant.einbaudatum || ''}" />
        </div>
        <div class="form-col">
          <label>Garantie bis</label>
          <input type="date" id="pf-garantie-bis" value="${plant.garantie_bis || ''}" />
        </div>
      </div>

      <label>Standort-Detail</label>
      <input type="text" id="pf-standort" value="${esc(plant.standort_detail || '')}" />

      <div class="form-row">
        <div class="form-col">
          <label>DIN 276 Kostengruppe</label>
          <select id="pf-din276">
            <option value="">– Keine –</option>
            ${kgOptions}
          </select>
        </div>
        <div class="form-col">
          <label>VDMA-Gewerk</label>
          <input type="text" id="pf-gewerk" readonly class="muted" />
        </div>
      </div>

      <div class="form-row">
        <div class="form-col">
          <label>Status</label>
          <select id="pf-status">
            <option value="aktiv" ${plant.status === 'aktiv' ? 'selected' : ''}>Aktiv</option>
            <option value="ausser_betrieb" ${plant.status === 'ausser_betrieb' ? 'selected' : ''}>Außer Betrieb</option>
            <option value="stillgelegt" ${plant.status === 'stillgelegt' ? 'selected' : ''}>Stillgelegt</option>
          </select>
        </div>
      </div>

      <label>Bemerkungen</label>
      <textarea id="pf-bemerkungen" rows="3">${esc(plant.bemerkungen || '')}</textarea>

      <button type="submit" class="btn-primary" style="margin-top:1rem;">Änderungen speichern</button>
    </form>

    <hr style="margin:1.5rem 0;border-color:#333;" />

    ${docsHtml}

    <hr style="margin:1.5rem 0;border-color:#333;" />

    ${schedulesHtml}
  `;

  openModal(`Anlage bearbeiten – ${objName}`, html);
  setupPlantFormEvents();
  updateGewerkDisplay();

  document.getElementById('plant-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = collectPlantFormData();
    try {
      await api.updatePlant(objectId, data);
      closeModal();
      await loadPlants();
    } catch (err) {
      alert('Fehler: ' + err.message);
    }
  });
}

function setupPlantFormEvents() {
  const din276Select = document.getElementById('pf-din276');
  if (din276Select) {
    din276Select.addEventListener('change', updateGewerkDisplay);
    updateGewerkDisplay();
  }
}

function updateGewerkDisplay() {
  const kg = document.getElementById('pf-din276').value;
  const gewerkInput = document.getElementById('pf-gewerk');
  if (!kg) {
    gewerkInput.value = '';
    return;
  }
  const tpl = vdmaTemplates.find(t => t.kg === kg);
  gewerkInput.value = tpl ? tpl.gewerk : '';
}

function collectPlantFormData() {
  return {
    hersteller: document.getElementById('pf-hersteller').value || null,
    modell: document.getElementById('pf-modell').value || null,
    seriennummer: document.getElementById('pf-seriennummer').value || null,
    baujahr: document.getElementById('pf-baujahr').value ? parseInt(document.getElementById('pf-baujahr').value) : null,
    einbaudatum: document.getElementById('pf-einbaudatum').value || null,
    garantie_bis: document.getElementById('pf-garantie-bis').value || null,
    standort_detail: document.getElementById('pf-standort').value || null,
    din276_kg: document.getElementById('pf-din276').value || null,
    status: document.getElementById('pf-status').value,
    bemerkungen: document.getElementById('pf-bemerkungen').value || '',
  };
}

// ====================================================
// DOKUMENTE-SEKTION (inline im Modal)
// ====================================================

function renderDocumentsSection(plant) {
  const docs = plant.documents || [];
  const anlagendoku = docs.filter(d => d.category === 'anlagendoku');
  const wartung = docs.filter(d => d.category === 'wartung');

  const docRows = (list) => {
    if (list.length === 0) return '<p class="muted" style="font-size:12px;">Keine Dokumente</p>';
    return list.map(d => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #222;">
        <a href="${esc(d.file_path)}" target="_blank" style="color:#3a7bd5;">${esc(d.filename)}</a>
        <button class="btn-sm btn-danger" onclick="window._cafmDeleteDoc(${d.id}, ${plant.object_id})">X</button>
      </div>
    `).join('');
  };

  return `
    <h3 style="margin-bottom:0.5rem;">Dokumente</h3>

    <div style="margin-bottom:1rem;">
      <h4 style="font-size:13px;color:#aaa;">Anlagendokumentation</h4>
      ${docRows(anlagendoku)}
    </div>
    <div style="margin-bottom:1rem;">
      <h4 style="font-size:13px;color:#aaa;">Wartungsunterlagen</h4>
      ${docRows(wartung)}
    </div>

    <div style="display:flex;gap:0.5rem;align-items:end;">
      <div style="flex:1;">
        <label style="font-size:12px;">Datei</label>
        <input type="file" id="pf-doc-file" />
      </div>
      <div>
        <label style="font-size:12px;">Kategorie</label>
        <select id="pf-doc-category">
          <option value="anlagendoku">Anlagendoku</option>
          <option value="wartung">Wartung</option>
        </select>
      </div>
      <button type="button" class="btn-primary btn-sm" onclick="window._cafmUploadDoc(${plant.object_id})">Hochladen</button>
    </div>
  `;
}

// ====================================================
// WARTUNGSPLAN-SEKTION (inline im Modal)
// ====================================================

function renderSchedulesSection(plant, objectId) {
  const schedules = plant.schedules || [];
  const today = new Date().toISOString().slice(0, 10);

  const rows = schedules.map(s => {
    const overdue = s.active && s.next_due <= today;
    const badge = !s.active ? 'gray' : overdue ? 'red' : 'green';
    const statusText = !s.active ? 'Inaktiv' : overdue ? 'Überfällig' : 'OK';
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #222;">
        <div>
          <strong>${esc(s.title)}</strong>
          <span class="muted" style="font-size:12px;margin-left:8px;">${s.interval_months} Mon. | ${fmtDE(s.next_due)}</span>
          <span class="badge badge-${badge}" style="margin-left:8px;">${statusText}</span>
        </div>
        <div>
          <button class="btn-sm" onclick="window._cafmEditSchedule(${objectId}, ${s.id})">Bearbeiten</button>
          <button class="btn-sm btn-danger" onclick="window._cafmDeleteSchedule(${s.id})">Löschen</button>
        </div>
      </div>
    `;
  }).join('');

  return `
    <h3 style="margin-bottom:0.5rem;">Wartungspläne</h3>
    ${rows || '<p class="muted" style="font-size:12px;">Keine Wartungspläne</p>'}
    <button type="button" class="btn-primary btn-sm" style="margin-top:0.5rem;" onclick="window._cafmNewSchedule(${objectId})">+ Wartungsplan</button>
  `;
}

// ====================================================
// WARTUNGSPLAN-MODAL
// ====================================================

export async function openScheduleModal(objectId, scheduleId = null) {
  let schedule = null;
  let plant;
  try {
    plant = await api.getPlant(objectId);
  } catch (e) {
    alert('Anlagendaten nicht gefunden');
    return;
  }

  if (scheduleId) {
    schedule = (plant.schedules || []).find(s => s.id === scheduleId);
  }

  const title = schedule ? 'Wartungsplan bearbeiten' : 'Neuer Wartungsplan';
  const checklistJson = schedule ? JSON.stringify(schedule.checklist || [], null, 2) : '[]';

  const html = `
    <form id="schedule-form">
      <label>Titel *</label>
      <input type="text" id="sf-title" value="${esc(schedule?.title || '')}" required />

      <div class="form-row">
        <div class="form-col">
          <label>Intervall (Monate) *</label>
          <input type="number" id="sf-interval" min="1" max="120" value="${schedule?.interval_months || 12}" required />
        </div>
        <div class="form-col">
          <label>Nächste Fälligkeit *</label>
          <input type="date" id="sf-next-due" value="${schedule?.next_due || new Date().toISOString().slice(0, 10)}" required />
        </div>
      </div>

      <label>
        <input type="checkbox" id="sf-active" ${schedule?.active !== false ? 'checked' : ''} /> Aktiv
      </label>

      <label style="margin-top:1rem;">Checkliste (JSON)
        <span class="muted" style="font-size:11px;margin-left:8px;">Leer lassen = VDMA-Vorlage wird automatisch verwendet</span>
      </label>
      <textarea id="sf-checklist" rows="10" style="font-family:monospace;font-size:12px;">${esc(checklistJson)}</textarea>

      ${!schedule && plant.din276_kg ? `
        <button type="button" class="btn-secondary btn-sm" style="margin-top:0.5rem;" id="sf-load-vdma">VDMA-Vorlage laden (KG ${plant.din276_kg})</button>
      ` : ''}

      <button type="submit" class="btn-primary" style="margin-top:1rem;">Speichern</button>
    </form>
  `;

  openModal(title, html);

  const vdmaBtn = document.getElementById('sf-load-vdma');
  if (vdmaBtn) {
    vdmaBtn.addEventListener('click', async () => {
      try {
        const tpl = await api.getVDMATemplate(plant.din276_kg);
        document.getElementById('sf-checklist').value = JSON.stringify(tpl.checklist, null, 2);
      } catch (e) {
        alert('Vorlage nicht gefunden: ' + e.message);
      }
    });
  }

  document.getElementById('schedule-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    let checklist;
    try {
      checklist = JSON.parse(document.getElementById('sf-checklist').value || '[]');
    } catch {
      alert('Ungültiges JSON in der Checkliste');
      return;
    }

    const data = {
      title: document.getElementById('sf-title').value,
      interval_months: parseInt(document.getElementById('sf-interval').value),
      next_due: document.getElementById('sf-next-due').value,
      active: document.getElementById('sf-active').checked,
      checklist,
    };

    try {
      if (scheduleId) {
        await api.updateSchedule(scheduleId, data);
      } else {
        await api.createSchedule(objectId, data);
      }
      closeModal();
      await loadPlants();
    } catch (err) {
      alert('Fehler: ' + err.message);
    }
  });
}

// ====================================================
// GLOBALE EVENT-HANDLER (onclick in HTML)
// ====================================================

window._cafmEditPlant = (objectId) => editPlant(objectId);
window._cafmDeletePlant = (objectId) => {
  showConfirm('Anlagendaten und alle zugehörigen Dokumente/Wartungspläne wirklich löschen?', async () => {
    await api.deletePlant(objectId);
    await loadPlants();
  });
};

window._cafmDeleteDoc = (docId, objectId) => {
  showConfirm('Dokument wirklich löschen?', async () => {
    await api.deletePlantDocument(docId);
    // Modal neu laden.
    await editPlant(objectId);
  });
};

window._cafmUploadDoc = async (objectId) => {
  const fileInput = document.getElementById('pf-doc-file');
  const category = document.getElementById('pf-doc-category').value;
  if (!fileInput.files.length) {
    alert('Bitte eine Datei auswählen.');
    return;
  }
  const fd = new FormData();
  fd.append('file', fileInput.files[0]);
  fd.append('category', category);
  try {
    await api.uploadPlantDocument(objectId, fd);
    // Modal neu laden.
    await editPlant(objectId);
  } catch (err) {
    alert('Upload-Fehler: ' + err.message);
  }
};

window._cafmNewSchedule = (objectId) => openScheduleModal(objectId);
window._cafmEditSchedule = (objectId, scheduleId) => openScheduleModal(objectId, scheduleId);
window._cafmDeleteSchedule = (scheduleId) => {
  showConfirm('Wartungsplan wirklich löschen?', async () => {
    await api.deleteSchedule(scheduleId);
    await loadPlants();
  });
};

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

function fmtDE(iso) {
  if (!iso) return '–';
  const [y, m, d] = iso.split('-');
  return `${parseInt(d, 10)}.${parseInt(m, 10)}.${y}`;
}
