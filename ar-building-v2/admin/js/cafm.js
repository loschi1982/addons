// ===================================================
// cafm.js – CAFM-Modul (Technische Anlagen, Wartung)
// Admin-Oberfläche für Anlagenverwaltung, Wartungsplanung
// und Protokolle mit DIN 276 / VDMA 24186 Unterstützung.
// ===================================================

import * as api from './api.js';
import { openModal, closeModal, showConfirm } from './admin-app.js';

// Cache für Objekte, Räume und VDMA-Vorlagen.
let objectsCache = [];
let roomsCache = [];
let vdmaTemplates = [];
let plantsCache = [];

// ====================================================
// ÖFFENTLICHE API
// ====================================================

export async function loadCafm() {
  setupCafmTabs();
  setupPdfSettings();
  await Promise.all([
    loadObjectsCache(),
    loadRoomsCache(),
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

async function loadRoomsCache() {
  try {
    roomsCache = await api.getRooms();
  } catch (e) {
    console.error('Räume laden fehlgeschlagen:', e.message);
    roomsCache = [];
  }
}

// Raum-Name für ein Objekt ermitteln.
function getRoomNameForObject(objectId) {
  const obj = objectsCache.find(o => o.id === objectId);
  if (!obj) return '';
  const room = roomsCache.find(r => r.id === obj.room_id);
  return room ? room.name : '';
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

let overviewMode = 'gantt';
let overviewMonths = 12;   // Sichtbarer Zeitraum in Monaten
let overviewOffset = 0;    // Verschiebung in Monaten (0 = jetzt)

async function loadPlants() {
  try {
    plantsCache = await api.getPlants();
  } catch (e) {
    console.error('Anlagen laden fehlgeschlagen:', e.message);
    plantsCache = [];
  }
  renderPlantsTable();
  renderOverview();
  renderSchedulesTable();
  renderLogsTable();
  setupOverviewToggle();
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
    const varianteLabel = getVarianteLabel(p.din276_kg, p.anlagen_variante);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.id}</td>
      <td>${esc(objName)}</td>
      <td>${esc(p.hersteller || '–')}</td>
      <td>${esc(p.modell || '–')}</td>
      <td>${esc(p.din276_kg || '–')}${varianteLabel ? '<br><span class="muted" style="font-size:11px;">' + esc(varianteLabel) + '</span>' : ''}</td>
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
    tbody.innerHTML = '<tr><td colspan="6" class="muted">Keine Protokolle</td></tr>';
    return;
  }

  allLogs.sort((a, b) => b.performed_at.localeCompare(a.performed_at));

  for (const l of allLogs) {
    // Ergebnis-Zusammenfassung aus results
    const results = l.results || [];
    const okCount = results.filter(r => r.ok === true).length;
    const failCount = results.filter(r => r.ok === false).length;
    const totalCount = results.length;
    let resultBadge = '–';
    if (totalCount > 0) {
      if (failCount === 0) {
        resultBadge = `<span class="badge badge-green">${okCount}/${totalCount} OK</span>`;
      } else {
        resultBadge = `<span class="badge badge-red">${failCount} Mängel</span> <span class="badge badge-green">${okCount} OK</span>`;
      }
    }

    const pdfBtn = l.pdf_path
      ? `<button class="btn-sm" onclick="window._cafmDownloadPdf(${l.id})" title="PDF herunterladen">PDF</button>`
      : '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(l.plantName)}</td>
      <td>${esc(l.scheduleName)}</td>
      <td>${esc(l.technician)}</td>
      <td>${fmtDE(l.performed_at.slice(0, 10))}</td>
      <td>${resultBadge}</td>
      <td>
        <button class="btn-sm" onclick="window._cafmShowLogDetail(${l.id})">Detail</button>
        ${pdfBtn}
      </td>
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

      <div class="form-row" id="pf-variante-row" style="display:none;">
        <div class="form-col">
          <label>Anlagenvariante</label>
          <select id="pf-variante">
            <option value="">– Bitte wählen –</option>
          </select>
        </div>
        <div class="form-col">
          <label>Wartungsanweisungen</label>
          <span id="pf-variante-info" class="muted" style="font-size:12px;line-height:2.4;"></span>
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
  setupPlantFormEvents(null);

  // Standort-Detail aus dem Raum des gewählten Objekts vorbelegen.
  const objectSelect = document.getElementById('pf-object-id');
  const standortInput = document.getElementById('pf-standort');
  function prefillStandort() {
    const oid = parseInt(objectSelect.value);
    const roomName = getRoomNameForObject(oid);
    if (roomName && !standortInput.value) {
      standortInput.value = roomName;
    }
  }
  objectSelect.addEventListener('change', () => {
    standortInput.value = '';
    prefillStandort();
  });
  prefillStandort();

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

      <div class="form-row" id="pf-variante-row" style="display:none;">
        <div class="form-col">
          <label>Anlagenvariante</label>
          <select id="pf-variante">
            <option value="">– Bitte wählen –</option>
          </select>
        </div>
        <div class="form-col">
          <label>Wartungsanweisungen</label>
          <span id="pf-variante-info" class="muted" style="font-size:12px;line-height:2.4;"></span>
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
  setupPlantFormEvents(plant.anlagen_variante || null);

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

function setupPlantFormEvents(preselectedVariante) {
  const din276Select = document.getElementById('pf-din276');
  if (din276Select) {
    din276Select.addEventListener('change', () => {
      updateGewerkDisplay();
      updateVariantenDropdown();
    });
    updateGewerkDisplay();
    updateVariantenDropdown(preselectedVariante);
  }
  const varianteSelect = document.getElementById('pf-variante');
  if (varianteSelect) {
    varianteSelect.addEventListener('change', updateVarianteInfo);
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

function updateVariantenDropdown(preselect) {
  const kg = document.getElementById('pf-din276').value;
  const row = document.getElementById('pf-variante-row');
  const sel = document.getElementById('pf-variante');
  const info = document.getElementById('pf-variante-info');
  if (!row || !sel) return;

  if (!kg) {
    row.style.display = 'none';
    sel.innerHTML = '<option value="">– Bitte wählen –</option>';
    if (info) info.textContent = '';
    return;
  }

  const tpl = vdmaTemplates.find(t => t.kg === kg);
  if (!tpl || !tpl.varianten || tpl.varianten.length === 0) {
    row.style.display = 'none';
    return;
  }

  row.style.display = '';
  let options = '<option value="">– Bitte wählen –</option>';
  for (const v of tpl.varianten) {
    const selected = (preselect && preselect === v.key) ? ' selected' : '';
    options += `<option value="${esc(v.key)}"${selected}>${esc(v.label)} (${v.wartung_count} Prüfpunkte)</option>`;
  }
  sel.innerHTML = options;

  // Auto-select wenn nur eine Variante
  if (tpl.varianten.length === 1) {
    sel.value = tpl.varianten[0].key;
  }

  updateVarianteInfo();
}

function updateVarianteInfo() {
  const info = document.getElementById('pf-variante-info');
  const sel = document.getElementById('pf-variante');
  const kg = document.getElementById('pf-din276').value;
  if (!info || !sel) return;

  const key = sel.value;
  if (!key || !kg) {
    info.textContent = '';
    return;
  }

  const tpl = vdmaTemplates.find(t => t.kg === kg);
  if (!tpl || !tpl.varianten) return;
  const v = tpl.varianten.find(x => x.key === key);
  info.textContent = v ? `${v.wartung_count} Wartungsanweisungen nach VDMA 24186` : '';
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
    anlagen_variante: document.getElementById('pf-variante').value || null,
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
        <button type="button" class="btn-secondary btn-sm" style="margin-top:0.5rem;" id="sf-load-vdma">VDMA-Vorlage laden${plant.anlagen_variante ? '' : ` (KG ${plant.din276_kg})`}</button>
      ` : ''}

      <button type="submit" class="btn-primary" style="margin-top:1rem;">Speichern</button>
    </form>
  `;

  openModal(title, html);

  const vdmaBtn = document.getElementById('sf-load-vdma');
  if (vdmaBtn) {
    vdmaBtn.addEventListener('click', async () => {
      try {
        let checklist;
        if (plant.anlagen_variante) {
          checklist = await api.getVDMAVarianteChecklist(plant.din276_kg, plant.anlagen_variante);
        } else {
          const tpl = await api.getVDMATemplate(plant.din276_kg);
          checklist = tpl.checklist;
        }
        document.getElementById('sf-checklist').value = JSON.stringify(checklist, null, 2);
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

window._cafmShowLogDetail = (logId) => showLogDetail(logId);
window._cafmDownloadPdf = async (logId) => {
  try {
    await api.downloadLogPdf(logId);
  } catch (e) {
    alert('PDF-Download fehlgeschlagen: ' + e.message);
  }
};

function showLogDetail(logId) {
  // Log aus plantsCache suchen.
  let log = null;
  let plantName = '';
  let scheduleName = '';
  for (const p of plantsCache) {
    const obj = objectsCache.find(o => o.id === p.object_id);
    for (const l of (p.logs || [])) {
      if (l.id === logId) {
        log = l;
        plantName = obj ? obj.name : `Objekt #${p.object_id}`;
        const schedule = (p.schedules || []).find(s => s.id === l.schedule_id);
        scheduleName = schedule ? schedule.title : '–';
        break;
      }
    }
    if (log) break;
  }

  if (!log) { alert('Protokoll nicht gefunden'); return; }

  const results = log.results || [];
  let checklistHtml = '';
  if (results.length > 0) {
    checklistHtml = '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:1rem;">';
    checklistHtml += '<thead><tr style="border-bottom:2px solid #444;">';
    checklistHtml += '<th style="text-align:left;padding:6px;">Prüfpunkt</th>';
    checklistHtml += '<th style="text-align:center;padding:6px;width:60px;">Status</th>';
    checklistHtml += '<th style="text-align:left;padding:6px;">Anmerkung</th>';
    checklistHtml += '</tr></thead><tbody>';
    for (const r of results) {
      const statusIcon = r.ok === true
        ? '<span style="color:#27ae60;font-weight:bold;">&#10003; OK</span>'
        : r.ok === false
          ? '<span style="color:#c0392b;font-weight:bold;">&#10007; Mangel</span>'
          : '<span class="muted">–</span>';
      checklistHtml += `<tr style="border-bottom:1px solid #333;">
        <td style="padding:6px;">${esc(r.text || r.id || '–')}</td>
        <td style="text-align:center;padding:6px;">${statusIcon}</td>
        <td style="padding:6px;color:#aaa;">${esc(r.note || '')}</td>
      </tr>`;
    }
    checklistHtml += '</tbody></table>';
  } else {
    checklistHtml = '<p class="muted" style="font-size:13px;">Keine Prüfpunkte erfasst.</p>';
  }

  const pdfBtn = log.pdf_path
    ? `<button class="btn-primary btn-sm" style="margin-top:1rem;" onclick="window._cafmDownloadPdf(${log.id})">PDF herunterladen</button>`
    : '';

  const html = `
    <div style="margin-bottom:1rem;">
      <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;margin-bottom:12px;">
        <div><span class="muted">Anlage:</span> <strong>${esc(plantName)}</strong></div>
        <div><span class="muted">Wartung:</span> <strong>${esc(scheduleName)}</strong></div>
        <div><span class="muted">Techniker:</span> <strong>${esc(log.technician)}</strong></div>
        <div><span class="muted">Datum:</span> <strong>${fmtDE(log.performed_at.slice(0, 10))}</strong></div>
      </div>
    </div>

    <h3 style="font-size:14px;margin-bottom:8px;">Checkliste (${results.length} Prüfpunkte)</h3>
    ${checklistHtml}

    ${log.notes ? `<div style="margin-top:1rem;"><h3 style="font-size:14px;margin-bottom:4px;">Bemerkungen</h3><p style="font-size:13px;color:#ccc;white-space:pre-wrap;">${esc(log.notes)}</p></div>` : ''}

    ${pdfBtn}
  `;

  openModal(`Wartungsprotokoll #${log.id}`, html);
}

// ====================================================
// WARTUNGSÜBERSICHT (GANTT / TABELLE)
// ====================================================

let overviewToggleReady = false;

function setupOverviewToggle() {
  if (overviewToggleReady) return;
  overviewToggleReady = true;

  document.querySelectorAll('.overview-mode').forEach(btn => {
    btn.addEventListener('click', () => {
      overviewMode = btn.dataset.mode;
      document.querySelectorAll('.overview-mode').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderOverview();
    });
  });

  const prevBtn = document.getElementById('cafm-ov-prev');
  const nextBtn = document.getElementById('cafm-ov-next');
  const todayBtn = document.getElementById('cafm-ov-today');
  const rangeSel = document.getElementById('cafm-ov-range-sel');

  if (prevBtn) prevBtn.addEventListener('click', () => { overviewOffset -= Math.max(3, Math.floor(overviewMonths / 2)); renderOverview(); });
  if (nextBtn) nextBtn.addEventListener('click', () => { overviewOffset += Math.max(3, Math.floor(overviewMonths / 2)); renderOverview(); });
  if (todayBtn) todayBtn.addEventListener('click', () => { overviewOffset = 0; renderOverview(); });
  if (rangeSel) rangeSel.addEventListener('change', () => { overviewMonths = parseInt(rangeSel.value); renderOverview(); });
}

function renderOverview() {
  const container = document.getElementById('cafm-overview-content');
  if (!container) return;

  // Alle Wartungspläne sammeln.
  const allSchedules = [];
  for (const p of plantsCache) {
    const obj = objectsCache.find(o => o.id === p.object_id);
    for (const s of (p.schedules || [])) {
      allSchedules.push({
        ...s,
        plantName: obj ? obj.name : `Objekt #${p.object_id}`,
        objectId: p.object_id,
        din276_kg: p.din276_kg,
      });
    }
  }

  // Zeitraum-Label auch bei leeren Daten aktualisieren.
  const range = getOverviewRange();
  updateOverviewRangeLabel(range.startDate, range.endDate);

  if (allSchedules.length === 0) {
    container.innerHTML = '<p class="muted" style="font-size:13px;">Keine Wartungspläne vorhanden.</p>';
    return;
  }

  allSchedules.sort((a, b) => a.next_due.localeCompare(b.next_due));

  if (overviewMode === 'table') {
    renderOverviewTable(container, allSchedules);
  } else {
    renderOverviewGantt(container, allSchedules);
  }
}

function renderOverviewTable(container, schedules) {
  const range = getOverviewRange();
  updateOverviewRangeLabel(range.startDate, range.endDate);
  const today = new Date().toISOString().slice(0, 10);
  let html = `
    <div class="table-wrap">
      <table id="cafm-overview-table">
        <thead>
          <tr>
            <th>Anlage</th><th>KG</th><th>Wartung</th><th>Intervall</th>
            <th>Letzte Wartung</th><th>Nächste Fälligkeit</th><th>Tage</th><th>Status</th>
          </tr>
        </thead>
        <tbody>`;

  for (const s of schedules) {
    const overdue = s.active && s.next_due <= today;
    const days = s.days_until_due ?? 0;
    const statusBadge = !s.active
      ? '<span class="badge badge-gray">Inaktiv</span>'
      : overdue
        ? '<span class="badge badge-red">Überfällig</span>'
        : days <= 30
          ? '<span class="badge badge-yellow">Bald fällig</span>'
          : '<span class="badge badge-green">OK</span>';

    html += `
      <tr>
        <td>${esc(s.plantName)}</td>
        <td>${esc(s.din276_kg || '–')}</td>
        <td>${esc(s.title)}</td>
        <td>${s.interval_months} Mon.</td>
        <td>${s.last_completed ? fmtDE(s.last_completed) : '–'}</td>
        <td style="${overdue ? 'color:#c0392b;font-weight:bold;' : ''}">${fmtDE(s.next_due)}</td>
        <td style="${overdue ? 'color:#c0392b;font-weight:bold;' : days <= 30 ? 'color:#f0a500;' : ''}">${days}</td>
        <td>${statusBadge}</td>
      </tr>`;
  }

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function updateOverviewRangeLabel(startDate, endDate) {
  const el = document.getElementById('cafm-ov-range');
  if (!el) return;
  const fmt = (d) => d.toLocaleString('de-DE', { month: 'short', year: 'numeric' });
  el.textContent = `${fmt(startDate)} – ${fmt(endDate)}`;
}

function getOverviewRange() {
  const today = new Date();
  // 1 Monat zurück + overviewMonths voraus, verschoben um overviewOffset
  const startDate = new Date(today.getFullYear(), today.getMonth() - 1 + overviewOffset, 1);
  const endDate = new Date(today.getFullYear(), today.getMonth() + overviewMonths + overviewOffset, 0);
  return { startDate, endDate, today };
}

function renderOverviewGantt(container, schedules) {
  const { startDate, endDate, today } = getOverviewRange();
  const todayISO = today.toISOString().slice(0, 10);
  updateOverviewRangeLabel(startDate, endDate);

  // Monate als Spalten.
  const months = [];
  const cur = new Date(startDate);
  while (cur <= endDate) {
    months.push({
      year: cur.getFullYear(),
      month: cur.getMonth(),
      label: cur.toLocaleString('de-DE', { month: 'short', year: '2-digit' }),
      start: new Date(cur.getFullYear(), cur.getMonth(), 1),
      end: new Date(cur.getFullYear(), cur.getMonth() + 1, 0),
    });
    cur.setMonth(cur.getMonth() + 1);
  }

  const totalDays = Math.round((endDate - startDate) / 86400000);

  let html = '<div class="gantt-wrap"><table class="gantt-table"><thead><tr>';
  html += '<th>Anlage / Wartung</th>';
  for (const m of months) {
    html += `<th>${m.label}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (const s of schedules) {
    html += '<tr>';
    html += `<td>${esc(s.plantName)}<br><span class="muted" style="font-size:11px">${esc(s.title)}</span></td>`;

    // Für jeden Monat: prüfen ob Fälligkeitsdatum in diesen Monat fällt.
    // Auch vergangene + zukünftige Fälligkeiten basierend auf Intervall berechnen.
    const dueDates = computeDueDates(s, startDate, endDate);

    for (const m of months) {
      const cellDues = dueDates.filter(d => d.getFullYear() === m.year && d.getMonth() === m.month);
      if (cellDues.length === 0) {
        html += '<td class="gantt-cell"></td>';
      } else {
        const d = cellDues[0];
        const dISO = isoDate(d);
        const overdue = s.active && dISO <= todayISO && dISO === s.next_due;
        const isPast = dISO < todayISO && dISO !== s.next_due;
        const barClass = overdue ? 'gantt-bar-overdue' : isPast ? 'gantt-bar-ok' : 'gantt-bar-due';
        // Position innerhalb des Monats.
        const dayInMonth = d.getDate();
        const daysInMonth = m.end.getDate();
        const leftPct = Math.round((dayInMonth / daysInMonth) * 100);
        html += `<td class="gantt-cell">
          <div class="gantt-bar ${barClass}" style="position:absolute;left:${leftPct}%;width:8px;top:50%;transform:translateY(-50%);"
               title="${esc(s.title)}: ${fmtDE(dISO)}"></div>
        </td>`;
      }
    }
    html += '</tr>';
  }

  html += '</tbody></table></div>';

  // Legende.
  html += `
    <div style="display:flex;gap:16px;margin-top:10px;font-size:11px;color:#888;">
      <span><span class="gantt-bar gantt-bar-ok" style="display:inline-block;width:12px;height:12px;border-radius:2px;vertical-align:middle;"></span> Erledigt</span>
      <span><span class="gantt-bar gantt-bar-due" style="display:inline-block;width:12px;height:12px;border-radius:2px;vertical-align:middle;"></span> Geplant</span>
      <span><span class="gantt-bar gantt-bar-overdue" style="display:inline-block;width:12px;height:12px;border-radius:2px;vertical-align:middle;"></span> Überfällig</span>
    </div>`;

  container.innerHTML = html;
}

// Fälligkeitstermine berechnen (vergangene + zukünftige basierend auf Intervall).
function computeDueDates(schedule, rangeStart, rangeEnd) {
  const dates = [];
  if (!schedule.next_due) return dates;

  const nextDue = new Date(schedule.next_due + 'T00:00:00');
  const intervalMs = schedule.interval_months * 30.44 * 86400000; // Approximation

  // Vorwärts vom next_due.
  let d = new Date(nextDue);
  while (d <= rangeEnd) {
    if (d >= rangeStart) dates.push(new Date(d));
    d = new Date(d.getTime() + intervalMs);
  }

  // Rückwärts vom next_due.
  d = new Date(nextDue.getTime() - intervalMs);
  while (d >= rangeStart) {
    dates.push(new Date(d));
    d = new Date(d.getTime() - intervalMs);
  }

  dates.sort((a, b) => a - b);
  return dates;
}

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ====================================================
// HILFSFUNKTIONEN
// ====================================================

function getVarianteLabel(kg, varianteKey) {
  if (!kg || !varianteKey) return '';
  const tpl = vdmaTemplates.find(t => t.kg === kg);
  if (!tpl || !tpl.varianten) return '';
  const v = tpl.varianten.find(x => x.key === varianteKey);
  return v ? v.label : '';
}

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

// ====================================================
// PDF-VORLAGE (BRANDING-EINSTELLUNGEN)
// ====================================================

let pdfSettingsReady = false;

function setupPdfSettings() {
  if (pdfSettingsReady) return;
  pdfSettingsReady = true;

  const form = document.getElementById('pdf-settings-form');
  if (!form) return;

  // Logo-Upload-Button → hidden file input.
  document.getElementById('pdf-logo-upload-btn')?.addEventListener('click', () => {
    document.getElementById('pdf-logo-file')?.click();
  });

  // Logo-Datei gewählt → hochladen.
  document.getElementById('pdf-logo-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await api.uploadPdfLogo(fd);
      updateLogoPreview(res.logo_path);
      showPdfMsg('Logo hochgeladen');
    } catch (err) {
      alert('Logo-Upload fehlgeschlagen: ' + err.message);
    }
  });

  // Logo löschen.
  document.getElementById('pdf-logo-delete-btn')?.addEventListener('click', async () => {
    try {
      await api.deletePdfLogo();
      updateLogoPreview('');
      showPdfMsg('Logo entfernt');
    } catch (err) {
      alert('Fehler: ' + err.message);
    }
  });

  // Formular absenden.
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      company_name: document.getElementById('pdf-company-name').value.trim(),
      header_line1: document.getElementById('pdf-header-line1').value.trim(),
      header_line2: document.getElementById('pdf-header-line2').value.trim(),
      footer_text: document.getElementById('pdf-footer-text').value.trim(),
      show_header: document.getElementById('pdf-show-header').checked,
      show_footer: document.getElementById('pdf-show-footer').checked,
    };
    try {
      await api.savePdfSettings(data);
      showPdfMsg('Gespeichert');
    } catch (err) {
      alert('Fehler: ' + err.message);
    }
  });

  // Einstellungen laden.
  loadPdfSettings();
}

async function loadPdfSettings() {
  try {
    const s = await api.getPdfSettings();
    document.getElementById('pdf-company-name').value = s.company_name || '';
    document.getElementById('pdf-header-line1').value = s.header_line1 || '';
    document.getElementById('pdf-header-line2').value = s.header_line2 || '';
    document.getElementById('pdf-footer-text').value = s.footer_text || '';
    document.getElementById('pdf-show-header').checked = s.show_header !== false;
    document.getElementById('pdf-show-footer').checked = s.show_footer !== false;
    updateLogoPreview(s.logo_path || '');
  } catch (e) {
    console.error('PDF-Einstellungen laden fehlgeschlagen:', e.message);
  }
}

function updateLogoPreview(logoPath) {
  const preview = document.getElementById('pdf-logo-preview');
  const deleteBtn = document.getElementById('pdf-logo-delete-btn');
  if (!preview) return;

  if (logoPath) {
    const base = window.APP_CONFIG.apiBase;
    preview.innerHTML = `<img src="${base}${logoPath}" style="max-width:120px;max-height:60px;object-fit:contain;" />`;
    if (deleteBtn) deleteBtn.style.display = '';
  } else {
    preview.innerHTML = '<span class="muted" style="font-size:11px;">Kein Logo</span>';
    if (deleteBtn) deleteBtn.style.display = 'none';
  }
}

function showPdfMsg(text) {
  const el = document.getElementById('pdf-settings-msg');
  if (!el) return;
  el.textContent = text;
  setTimeout(() => { el.textContent = ''; }, 3000);
}
