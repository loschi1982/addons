// ===================================================
// objects.js – Objekt- und Objekttyp-Verwaltung
// Tabelle mit Sortierung, Spalten-Filter, Mehrfachauswahl
// und Sammel-Löschen. QR-Code je Zeile.
// ===================================================

import * as api from './api.js';
import { openModal, closeModal, showConfirm } from './admin-app.js';

let quillObj = null;
let _objSensorIds = new Set(); // aktuell ausgewählte Sensor-Entity-IDs im Objekt-Formular

let _allObjects   = [];
let _filteredRows = [];
let _sort    = { col: 'id', dir: 'asc' };
let _filters = { id: '', name: '', marker_id: '', type_name: '', room_id: '' };

// ====================================================
// EINSTIEG
// ====================================================

export async function loadObjects() {
  const tbody = document.querySelector('#objects-table tbody');
  renderLoadingRow(tbody, 7);

  ensurePrintAllButton('objects-table', () => printAllQR(_filteredRows));
  ensureDeleteSelectedButton('objects-table', deleteSelectedObjects);

  try {
    _allObjects = await api.getObjects();
    applyFilterAndSort();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted" style="padding:20px">Fehler: ${e.message}</td></tr>`;
  }
}

// ====================================================
// FILTER + SORT → RENDER
// ====================================================

function applyFilterAndSort() {
  _filteredRows = _allObjects.filter(o =>
    String(o.id).includes(_filters.id) &&
    o.name.toLowerCase().includes(_filters.name.toLowerCase()) &&
    o.marker_id.toLowerCase().includes(_filters.marker_id.toLowerCase()) &&
    (o.type_name || '').toLowerCase().includes(_filters.type_name.toLowerCase()) &&
    String(o.room_id).includes(_filters.room_id)
  );

  const { col, dir } = _sort;
  _filteredRows.sort((a, b) => {
    const av = (col === 'id' || col === 'room_id') ? +a[col] : String(a[col] ?? '').toLowerCase();
    const bv = (col === 'id' || col === 'room_id') ? +b[col] : String(b[col] ?? '').toLowerCase();
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });

  renderTable();
}

// ====================================================
// TABELLE RENDERN
// ====================================================

function renderTable() {
  const table = document.getElementById('objects-table');
  const tbody = table.querySelector('tbody');
  tbody.innerHTML = '';

  renderHeader(table);
  updateDeleteSelectedBtn();

  if (_filteredRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted" style="padding:20px">
      ${_allObjects.length === 0 ? 'Noch keine Objekte vorhanden.' : 'Kein Eintrag entspricht dem Filter.'}
    </td></tr>`;
    return;
  }

  for (const obj of _filteredRows) {
    const tr = document.createElement('tr');
    tr.dataset.id = obj.id;
    tr.innerHTML = `
      <td class="col-check">
        <input type="checkbox" class="row-check" data-id="${obj.id}" />
      </td>
      <td>${obj.id}</td>
      <td>${esc(obj.name)}</td>
      <td><code>${esc(obj.marker_id)}</code></td>
      <td>${esc(obj.type_name)}</td>
      <td>${obj.room_id}</td>
      <td class="qr-cell">
        <div class="qr-thumb" id="qr-obj-${obj.id}"
          data-marker="${esc(obj.marker_id)}" data-name="${esc(obj.name)}"
          title="Klicken für QR-Optionen"></div>
      </td>
      <td>
        <div class="action-btns">
          <button class="btn-secondary btn-sm" data-edit="${obj.id}">Bearbeiten</button>
          <button class="btn-danger btn-sm" data-delete="${obj.id}" data-name="${esc(obj.name)}">Löschen</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
    renderThumbQR(`qr-obj-${obj.id}`, obj.marker_id);
  }

  tbody.querySelectorAll('.qr-thumb').forEach(cell => {
    cell.addEventListener('click', () => openQRDialog(cell.dataset.marker, cell.dataset.name));
  });
  tbody.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openObjectModal(+btn.dataset.edit));
  });
  tbody.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', () => {
      showConfirm(`Objekt „${btn.dataset.name}" wirklich löschen?`, async () => {
        await api.deleteObject(+btn.dataset.delete);
        loadObjects();
      });
    });
  });
  tbody.querySelectorAll('.row-check').forEach(cb => {
    cb.addEventListener('change', updateDeleteSelectedBtn);
  });
}

// ====================================================
// TABELLEN-HEADER
// ====================================================

const OBJ_COLS = [
  { key: 'id',        label: 'ID'        },
  { key: 'name',      label: 'Name'      },
  { key: 'marker_id', label: 'Marker-ID' },
  { key: 'type_name', label: 'Typ'       },
  { key: 'room_id',   label: 'Raum'      },
];

function renderHeader(table) {
  const thead = table.querySelector('thead');
  thead.innerHTML = '';

  const trTitle = document.createElement('tr');

  const thCheck = document.createElement('th');
  thCheck.className = 'col-check';
  const cbAll = document.createElement('input');
  cbAll.type  = 'checkbox';
  cbAll.id    = 'objects-check-all';
  cbAll.title = 'Alle sichtbaren Zeilen markieren';
  cbAll.addEventListener('change', () => toggleAllRows('objects-table', cbAll.checked));
  thCheck.appendChild(cbAll);
  trTitle.appendChild(thCheck);

  for (const col of OBJ_COLS) {
    const th = document.createElement('th');
    th.className = 'sortable';
    const isActive = _sort.col === col.key;
    th.innerHTML = `${col.label} <span class="sort-arrow">${isActive ? (_sort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>`;
    th.addEventListener('click', () => {
      if (_sort.col === col.key) {
        _sort.dir = _sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        _sort = { col: col.key, dir: 'asc' };
      }
      applyFilterAndSort();
    });
    trTitle.appendChild(th);
  }

  const thQR  = document.createElement('th'); thQR.textContent  = 'QR';       trTitle.appendChild(thQR);
  const thAct = document.createElement('th'); thAct.textContent = 'Aktionen';  trTitle.appendChild(thAct);
  thead.appendChild(trTitle);

  const trFilter = document.createElement('tr');
  trFilter.className = 'filter-row';
  trFilter.appendChild(document.createElement('td'));

  for (const col of OBJ_COLS) {
    const td  = document.createElement('td');
    const inp = document.createElement('input');
    inp.type        = 'text';
    inp.placeholder = '🔍 Filter…';
    inp.className   = 'filter-input';
    inp.value       = _filters[col.key] || '';
    inp.addEventListener('input', e => {
      _filters[col.key] = e.target.value;
      applyFilterAndSort();
    });
    td.appendChild(inp);
    trFilter.appendChild(td);
  }

  trFilter.appendChild(document.createElement('td'));
  trFilter.appendChild(document.createElement('td'));
  thead.appendChild(trFilter);
}

// ====================================================
// MEHRFACHAUSWAHL
// ====================================================

function getSelectedIds(tableId) {
  return [...document.querySelectorAll(`#${tableId} tbody .row-check:checked`)]
    .map(cb => +cb.dataset.id);
}

function toggleAllRows(tableId, checked) {
  document.querySelectorAll(`#${tableId} tbody .row-check`).forEach(cb => {
    cb.checked = checked;
  });
  updateDeleteSelectedBtn();
}

// ====================================================
// SAMMEL-LÖSCHEN
// ====================================================

async function deleteSelectedObjects() {
  const ids = getSelectedIds('objects-table');
  if (ids.length === 0) return;

  showConfirm(
    `${ids.length} Objekt${ids.length !== 1 ? 'e' : ''} wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`,
    async () => {
      let failed = 0;
      for (const id of ids) {
        try { await api.deleteObject(id); }
        catch { failed++; }
      }
      if (failed > 0) alert(`${failed} Objekt(e) konnten nicht gelöscht werden.`);
      loadObjects();
    }
  );
}

function updateDeleteSelectedBtn() {
  const btn = document.querySelector('.btn-delete-selected[data-target="objects"]');
  if (!btn) return;
  const count = getSelectedIds('objects-table').length;
  btn.textContent   = count > 0 ? `🗑 ${count} löschen` : '🗑 Auswahl löschen';
  btn.style.display = count > 0 ? 'inline-block' : 'none';

  const cbAll = document.getElementById('objects-check-all');
  if (cbAll) {
    const total = document.querySelectorAll('#objects-table tbody .row-check').length;
    cbAll.checked       = total > 0 && count === total;
    cbAll.indeterminate = count > 0 && count < total;
  }
}

// ====================================================
// TOOLBAR-BUTTONS
// ====================================================

function ensurePrintAllButton(tableId, onClickFn) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const wrap = table.closest('.table-wrap');
  if (!wrap) return;
  let toolbar = wrap.parentElement.querySelector('.table-toolbar');
  if (!toolbar) {
    toolbar = document.createElement('div');
    toolbar.className = 'table-toolbar';
    wrap.parentElement.insertBefore(toolbar, wrap);
  }
  if (!toolbar.querySelector('.btn-print-all')) {
    const btn = document.createElement('button');
    btn.className   = 'btn-secondary btn-print-all';
    btn.textContent = '🖨 Alle QR drucken';
    btn.onclick     = onClickFn;
    toolbar.appendChild(btn);
  } else {
    toolbar.querySelector('.btn-print-all').onclick = onClickFn;
  }
}

function ensureDeleteSelectedButton(tableId, onClickFn) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const wrap = table.closest('.table-wrap');
  if (!wrap) return;
  let toolbar = wrap.parentElement.querySelector('.table-toolbar');
  if (!toolbar) {
    toolbar = document.createElement('div');
    toolbar.className = 'table-toolbar';
    wrap.parentElement.insertBefore(toolbar, wrap);
  }
  if (!toolbar.querySelector('.btn-delete-selected')) {
    const btn = document.createElement('button');
    btn.className      = 'btn-danger btn-delete-selected';
    btn.dataset.target = 'objects';
    btn.textContent    = '🗑 Auswahl löschen';
    btn.style.display  = 'none';
    btn.onclick        = onClickFn;
    toolbar.appendChild(btn);
  } else {
    toolbar.querySelector('.btn-delete-selected').onclick = onClickFn;
  }
}

// ====================================================
// OBJEKT-MODAL
// ====================================================

export async function openObjectModal(objectId = null) {
  let rooms = [], types = [];
  try {
    [rooms, types] = await Promise.all([api.getRooms(), api.getObjectTypes()]);
  } catch (e) { alert('Fehler beim Laden der Vorauswahl: ' + e.message); return; }

  const roomOptions = rooms.map(r => `<option value="${r.id}">${esc(r.name)} (${esc(r.marker_id)})</option>`).join('');
  const typeOptions = types.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');

  const html = `
    <div class="form-grid">
      <div class="form-group"><label>Name *</label>
        <input type="text" id="o-name" placeholder="z.B. Konzertflügel" /></div>
      <div class="form-group"><label>Marker-ID *</label>
        <input type="text" id="o-marker" placeholder="object:42" /></div>
      <div class="form-group full-width"><label>Kurzbeschreibung</label>
        <input type="text" id="o-short" placeholder="Ein Satz Beschreibung" /></div>
      <div class="form-group full-width">
        <label>Detailtext (HTML)</label>
        <div class="quill-wrap" id="o-quill-wrap"></div>
        <div class="sensor-hint">
          <span class="sensor-hint-label">💡 Sensor einbetten:</span>
          <code>{{sensor:sensor.entity_id}}</code>
          <span class="sensor-hint-sub">– wird in der PWA durch den Live-Wert ersetzt</span>
          <button type="button" class="btn-secondary btn-sm" id="o-insert-sensor">Sensor einfügen</button>
        </div>
      </div>
      <div class="form-group"><label>Raum *</label><select id="o-room">${roomOptions}</select></div>
      <div class="form-group"><label>Objekttyp *</label><select id="o-type">${typeOptions}</select></div>
      <div class="form-group"><label>ONNX-Klassen-ID</label>
        <input type="number" id="o-onnx" placeholder="z.B. 0" /></div>
      <div class="form-group"><label>Video-Pfad</label>
        <input type="text" id="o-video" placeholder="/uploads/1/tour.mp4" /></div>
      <div class="form-group full-width">
        <label>Video-Transparenz</label>
        <div class="slider-row">
          <input type="range" id="o-opacity" min="0" max="100" value="80" />
          <span class="slider-val" id="o-opacity-val">80%</span>
        </div>
      </div>
      <div class="form-group full-width"><label>Audio-Pfad</label>
        <input type="text" id="o-audio" placeholder="/uploads/1/sound.mp3" /></div>
      <div class="form-group full-width"><label>HA-Sensoren</label>
        <div class="sensor-picker" id="o-sensor-picker">
          <div class="sensor-chips" id="o-sensor-chips"></div>
          <button type="button" class="btn-secondary btn-sm" id="o-sensor-add">+ Sensor wählen</button>
        </div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" id="o-cancel">Abbrechen</button>
      <button class="btn-primary" id="o-save">Speichern</button>
    </div>
  `;

  _objSensorIds = new Set(); // State für neues Objekt zurücksetzen
  openModal(objectId ? 'Objekt bearbeiten' : 'Neues Objekt', html);

  quillObj = new Quill('#o-quill-wrap', {
    theme: 'snow', placeholder: 'Ausführliche Beschreibung des Objekts…',
    modules: { toolbar: [['bold','italic','underline'],[{list:'ordered'},{list:'bullet'}],['link'],['clean']] }
  });

  document.getElementById('o-insert-sensor').addEventListener('click', () => insertSensorPlaceholder(quillObj));
  document.getElementById('o-sensor-add').addEventListener('click', (e) => {
    openSensorMultiPicker(e.currentTarget, _objSensorIds);
  });

  if (objectId) {
    try {
      const obj = await api.getObject(objectId);
      document.getElementById('o-name').value    = obj.name || '';
      document.getElementById('o-marker').value  = obj.marker_id || '';
      document.getElementById('o-short').value   = obj.short_desc || '';
      quillObj.root.innerHTML                    = obj.detail_text || '';
      document.getElementById('o-room').value    = obj.room_id;
      document.getElementById('o-type').value    = obj.type_id;
      document.getElementById('o-onnx').value    = obj.onnx_class_id ?? '';
      document.getElementById('o-video').value   = obj.video_path || '';
      const pct = Math.round((obj.video_opacity ?? 0.8) * 100);
      document.getElementById('o-opacity').value = pct;
      document.getElementById('o-opacity-val').textContent = pct + '%';
      document.getElementById('o-audio').value   = obj.audio_path || '';
      _objSensorIds = new Set(obj.ha_sensor_ids || []);
      renderSensorChips(document.getElementById('o-sensor-chips'), _objSensorIds);
    } catch (e) { alert('Fehler beim Laden der Objektdaten: ' + e.message); }
  }

  document.getElementById('o-opacity').addEventListener('input', e => {
    document.getElementById('o-opacity-val').textContent = e.target.value + '%';
  });
  document.getElementById('o-cancel').addEventListener('click', closeModal);

  document.getElementById('o-save').addEventListener('click', async () => {
    const name        = document.getElementById('o-name').value.trim();
    const marker_id   = document.getElementById('o-marker').value.trim();
    if (!name || !marker_id) { alert('Name und Marker-ID sind Pflichtfelder.'); return; }

    const payload = {
      name, marker_id,
      short_desc:    document.getElementById('o-short').value.trim(),
      detail_text:   quillObj.root.innerHTML,
      type_id:       +document.getElementById('o-type').value,
      room_id:       +document.getElementById('o-room').value,
      onnx_class_id: document.getElementById('o-onnx').value.trim() !== ''
                     ? +document.getElementById('o-onnx').value : null,
      video_path:    document.getElementById('o-video').value.trim() || null,
      video_opacity: +document.getElementById('o-opacity').value / 100,
      audio_path:    document.getElementById('o-audio').value.trim() || null,
      ha_sensor_ids: [..._objSensorIds],
    };

    try {
      objectId ? await api.updateObject(objectId, payload) : await api.createObject(payload);
      closeModal();
      loadObjects();
    } catch (e) { alert('Fehler beim Speichern: ' + e.message); }
  });
}

// ====================================================
// OBJEKTTYPEN
// ====================================================

export async function loadObjectTypes() {
  const tbody = document.querySelector('#types-table tbody');
  tbody.innerHTML = '<tr><td colspan="4" class="muted" style="padding:20px">Lädt…</td></tr>';

  try {
    const types = await api.getObjectTypes();
    tbody.innerHTML = '';
    if (types.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="muted" style="padding:20px">Noch keine Objekttypen vorhanden.</td></tr>';
      return;
    }
    for (const t of types) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${t.id}</td>
        <td>${esc(t.name)}</td>
        <td>${esc((t.visible_to_roles||[]).join(', '))}</td>
        <td>
          <div class="action-btns">
            <button class="btn-secondary btn-sm" data-edit="${t.id}">Bearbeiten</button>
            <button class="btn-danger btn-sm" data-delete="${t.id}" data-name="${esc(t.name)}">Löschen</button>
          </div>
        </td>`;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => openTypeModal(+btn.dataset.edit));
    });
    tbody.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', () => {
        showConfirm(`Objekttyp „${btn.dataset.name}" wirklich löschen?`, async () => {
          await api.deleteObjectType(+btn.dataset.delete);
          loadObjectTypes();
        });
      });
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted" style="padding:20px">Fehler: ${e.message}</td></tr>`;
  }
}

export async function openTypeModal(typeId = null) {
  const checksHtml = ['visitor','staff','technician','admin'].map(r =>
    `<label><input type="checkbox" class="type-role-check" value="${r}" /> ${r}</label>`).join('');

  openModal(typeId ? 'Objekttyp bearbeiten' : 'Neuer Objekttyp', `
    <div class="form-grid">
      <div class="form-group full-width"><label>Name *</label>
        <input type="text" id="t-name" placeholder="z.B. Exponat" /></div>
      <div class="form-group full-width"><label>Sichtbar für Rollen</label>
        <div class="role-checks">${checksHtml}</div></div>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" id="t-cancel">Abbrechen</button>
      <button class="btn-primary" id="t-save">Speichern</button>
    </div>`);

  if (typeId) {
    try {
      const all = await api.getObjectTypes();
      const t = all.find(x => x.id === typeId);
      if (t) {
        document.getElementById('t-name').value = t.name;
        document.querySelectorAll('.type-role-check').forEach(cb => {
          cb.checked = (t.visible_to_roles||[]).includes(cb.value);
        });
      }
    } catch (e) { alert('Fehler beim Laden: ' + e.message); }
  }

  document.getElementById('t-cancel').addEventListener('click', closeModal);
  document.getElementById('t-save').addEventListener('click', async () => {
    const name = document.getElementById('t-name').value.trim();
    if (!name) { alert('Name ist ein Pflichtfeld.'); return; }
    const visible_to_roles = [...document.querySelectorAll('.type-role-check:checked')].map(cb=>cb.value);
    try {
      typeId ? await api.updateObjectType(typeId,{name,visible_to_roles})
             : await api.createObjectType({name,visible_to_roles});
      closeModal(); loadObjectTypes();
    } catch (e) { alert('Fehler beim Speichern: ' + e.message); }
  });
}

// ====================================================
// QR-CODE
// ====================================================

function renderThumbQR(containerId, markerValue) {
  const el = document.getElementById(containerId);
  if (!el) return;
  new QRCode(el, { text: markerValue, width: 48, height: 48,
    colorDark: '#000', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.M });
}

function generateQRDataUrl(markerValue, sizePx = 300) {
  return new Promise((resolve, reject) => {
    const tmp = document.createElement('div');
    tmp.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
    document.body.appendChild(tmp);
    try {
      new QRCode(tmp, { text: markerValue, width: sizePx, height: sizePx,
        colorDark: '#000', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.M });
      setTimeout(() => {
        const c = tmp.querySelector('canvas');
        if (c) resolve(c.toDataURL('image/png'));
        else reject(new Error('QR-Canvas nicht gefunden'));
        document.body.removeChild(tmp);
      }, 60);
    } catch (e) { document.body.removeChild(tmp); reject(e); }
  });
}

function openQRDialog(markerId, name) {
  openModal(`QR-Code: ${name}`, `
    <div style="display:flex;flex-direction:column;align-items:center;gap:20px;padding:10px 0;">
      <div id="qr-dialog-preview" style="background:#fff;padding:12px;border-radius:6px;"></div>
      <p style="font-size:13px;color:var(--muted);text-align:center;">
        Marker-ID: <code>${esc(markerId)}</code></p>
      <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;">
        <button class="btn-primary" id="qr-btn-download">⬇ Herunterladen</button>
        <button class="btn-secondary" id="qr-btn-print">🖨 Drucken</button>
      </div>
    </div>`);
  new QRCode(document.getElementById('qr-dialog-preview'), {
    text: markerId, width: 200, height: 200,
    colorDark: '#000', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.M });
  document.getElementById('qr-btn-download').addEventListener('click', async () => {
    try {
      const url = await generateQRDataUrl(markerId);
      const a = document.createElement('a');
      a.href = url; a.download = `qr-${markerId.replace(/[^a-zA-Z0-9_-]/g,'_')}.png`; a.click();
    } catch (e) { alert('Download fehlgeschlagen: ' + e.message); }
  });
  document.getElementById('qr-btn-print').addEventListener('click', async () => {
    try { openPrintWindow([{ markerId, name, dataUrl: await generateQRDataUrl(markerId) }]); }
    catch (e) { alert('Druckvorbereitung fehlgeschlagen: ' + e.message); }
  });
}

async function printAllQR(items) {
  if (!items.length) return;
  const entries = await Promise.all(items.map(async o => ({
    markerId: o.marker_id, name: o.name, dataUrl: await generateQRDataUrl(o.marker_id)
  })));
  openPrintWindow(entries);
}

function openPrintWindow(entries) {
  const labels = entries.map(e => `
    <div class="label">
      <div class="label-text">${escHtml(e.markerId)}</div>
      <img src="${e.dataUrl}" alt="${escHtml(e.markerId)}" />
    </div>`).join('');
  const win = window.open('', '_blank', 'width=800,height=600');
  win.document.write(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"/>
<title>QR-Codes drucken</title><style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:sans-serif;background:#fff;}
.toolbar{padding:12px 16px;background:#f5f5f5;border-bottom:1px solid #ddd;display:flex;align-items:center;gap:12px;}
.toolbar button{padding:8px 18px;background:#1a73e8;color:#fff;border:none;border-radius:5px;font-size:14px;font-weight:600;cursor:pointer;}
.toolbar button:hover{background:#1558b0;}
.toolbar span{font-size:13px;color:#555;}
.grid{display:flex;flex-wrap:wrap;gap:6px;padding:16px;}
.label{width:2cm;height:2.5cm;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;border:1px dashed #ccc;padding:1px;}
.label-text{font-size:4pt;font-weight:600;color:#000;text-align:center;word-break:break-all;max-width:100%;line-height:1.2;margin-bottom:1px;flex-shrink:0;}
.label img{width:100%;flex:1;min-height:0;object-fit:contain;}
@media print{.toolbar{display:none;}.grid{padding:4mm;gap:2mm;}.label{border:none;page-break-inside:avoid;}}
</style></head><body>
<div class="toolbar">
  <button onclick="window.print()">🖨 Drucken</button>
  <span>${entries.length} QR-Code${entries.length!==1?'s':''} · 2 × 2,5 cm (B×H) · Marker-ID über dem Code</span>
</div>
<div class="grid">${labels}</div>
<script>setTimeout(()=>window.print(),400);<\/script>
</body></html>`);
  win.document.close();
}

// ====================================================
// HILFSFUNKTIONEN
// ====================================================

function renderLoadingRow(tbody, cols) {
  tbody.innerHTML = `<tr><td colspan="${cols}" class="muted" style="padding:20px">Lädt…</td></tr>`;
}

function renderSensorChips(container, idSet) {
  container.innerHTML = '';
  idSet.forEach(id => {
    const chip = document.createElement('span');
    chip.className = 'sensor-chip';
    chip.innerHTML = `${escHtml(id)}<button type="button" title="Entfernen" data-id="${esc(id)}">×</button>`;
    chip.querySelector('button').onclick = () => { idSet.delete(id); renderSensorChips(container, idSet); };
    container.appendChild(chip);
  });
}

async function _buildSensorDropdown(anchor, renderItems) {
  document.querySelector('.sensor-dropdown')?.remove();

  const dropdown = document.createElement('div');
  dropdown.className = 'sensor-dropdown';
  dropdown.innerHTML = `
    <div class="sensor-dropdown-header">
      <input type="text" class="sensor-search" placeholder="Suchen…" />
      <button type="button" class="btn-secondary btn-sm sensor-dropdown-close">Fertig</button>
    </div>
    <div class="sensor-dropdown-list"><div class="sensor-dropdown-info">Lädt Sensoren…</div></div>`;
  anchor.after(dropdown);

  const searchInput = dropdown.querySelector('.sensor-search');
  const listEl      = dropdown.querySelector('.sensor-dropdown-list');
  dropdown.querySelector('.sensor-dropdown-close').onclick = () => dropdown.remove();

  let sensors = [];
  try {
    sensors = await api.getHASensors();
  } catch (e) {
    listEl.innerHTML = `<div class="sensor-dropdown-info" style="color:#e44">Fehler: ${escHtml(e.message)}</div>`;
    return;
  }

  function render(q) {
    const filtered = sensors.filter(s =>
      !q || s.entity_id.toLowerCase().includes(q) ||
      (s.friendly_name || '').toLowerCase().includes(q)
    );
    if (!filtered.length) {
      listEl.innerHTML = '<div class="sensor-dropdown-info">Keine Sensoren gefunden.</div>';
      return;
    }
    listEl.innerHTML = filtered.map(s => {
      const val = s.state + (s.unit ? '\u00a0' + s.unit : '');
      return renderItems(s, val);
    }).join('');
  }

  render('');
  searchInput.addEventListener('input', () => render(searchInput.value.toLowerCase().trim()));
  searchInput.focus();
  return { listEl, render, searchInput };
}

async function openSensorMultiPicker(anchor, idSet) {
  await _buildSensorDropdown(anchor, (s, val) => {
    const checked = idSet.has(s.entity_id);
    return `<label class="sensor-option${checked ? ' sensor-option--checked' : ''}">
      <input type="checkbox" value="${esc(s.entity_id)}"${checked ? ' checked' : ''} />
      <span class="sensor-option-body">
        <span class="sensor-option-name">${escHtml(s.friendly_name || s.entity_id)}</span>
        <span class="sensor-option-id">${escHtml(s.entity_id)}</span>
      </span>
      <span class="sensor-option-val">${escHtml(val)}</span>
    </label>`;
  });

  // Checkbox-Handler nach dem Rendern verdrahten (Event-Delegation auf listEl).
  document.querySelector('.sensor-dropdown-list')?.addEventListener('change', e => {
    const cb = e.target;
    if (cb.type !== 'checkbox') return;
    if (cb.checked) idSet.add(cb.value); else idSet.delete(cb.value);
    cb.closest('label')?.classList.toggle('sensor-option--checked', cb.checked);
    renderSensorChips(document.getElementById('o-sensor-chips'), idSet);
  });
}

async function insertSensorPlaceholder(qi) {
  const result = await _buildSensorDropdown(
    document.getElementById('o-insert-sensor'),
    (s, val) => `<div class="sensor-option sensor-option--click" data-id="${esc(s.entity_id)}">
      <span class="sensor-option-body">
        <span class="sensor-option-name">${escHtml(s.friendly_name || s.entity_id)}</span>
        <span class="sensor-option-id">${escHtml(s.entity_id)}</span>
      </span>
      <span class="sensor-option-val">${escHtml(val)}</span>
    </div>`
  );
  if (!result) return;

  result.listEl.addEventListener('click', e => {
    const item = e.target.closest('.sensor-option--click');
    if (!item) return;
    const r = qi.getSelection(true);
    const p = `{{sensor:${item.dataset.id}}}`;
    qi.insertText(r.index, p, 'user');
    qi.setSelection(r.index + p.length);
    document.querySelector('.sensor-dropdown')?.remove();
  });
}

function esc(s) {
  return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escHtml(s) {
  return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}