// ===================================================
// rooms.js – Raum-Verwaltung
// Tabelle mit Sortierung, Spalten-Filter, Mehrfachauswahl
// und Sammel-Löschen. QR-Code je Zeile.
// ===================================================

import * as api from './api.js';
import { openModal, closeModal, showConfirm } from './admin-app.js';

let quillRoom = null;

// Alle vom Backend geladenen Räume (unveränderter Master).
let _allRooms = [];

// Aktuell angezeigte Zeilen nach Filter + Sortierung.
let _filteredRows = [];

// Sortierzustand: Spaltenname + Richtung.
let _sort = { col: 'id', dir: 'asc' };

// Filterwerte pro Spalte.
let _filters = { id: '', name: '', marker_id: '', short_desc: '' };

// ====================================================
// EINSTIEG
// ====================================================

export async function loadRooms() {
  const tbody = document.querySelector('#rooms-table tbody');
  renderLoadingRow(tbody, 6);

  ensurePrintAllButton('rooms-table', () => printAllQR(_filteredRows));
  ensureDeleteSelectedButton('rooms-table', deleteSelectedRooms);

  try {
    _allRooms = await api.getRooms();
    applyFilterAndSort();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted" style="padding:20px">Fehler: ${e.message}</td></tr>`;
  }
}

// ====================================================
// FILTER + SORT → RENDER
// ====================================================

// Filtert _allRooms nach _filters, sortiert nach _sort, rendert die Tabelle.
function applyFilterAndSort() {
  // Filtern: alle Spalten-Texte müssen den Filter-Text enthalten (case-insensitiv).
  _filteredRows = _allRooms.filter(r =>
    String(r.id).includes(_filters.id) &&
    r.name.toLowerCase().includes(_filters.name.toLowerCase()) &&
    r.marker_id.toLowerCase().includes(_filters.marker_id.toLowerCase()) &&
    (r.short_desc || '').toLowerCase().includes(_filters.short_desc.toLowerCase())
  );

  // Sortieren.
  const { col, dir } = _sort;
  _filteredRows.sort((a, b) => {
    const av = col === 'id' ? a.id : String(a[col] ?? '').toLowerCase();
    const bv = col === 'id' ? b.id : String(b[col] ?? '').toLowerCase();
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
  const table  = document.getElementById('rooms-table');
  const tbody  = table.querySelector('tbody');
  tbody.innerHTML = '';

  // Header mit Sortier-Pfeilen und Filter-Eingaben aufbauen.
  renderHeader(table);
  updateDeleteSelectedBtn();

  if (_filteredRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted" style="padding:20px">
      ${_allRooms.length === 0 ? 'Noch keine Räume vorhanden.' : 'Kein Eintrag entspricht dem Filter.'}
    </td></tr>`;
    return;
  }

  for (const room of _filteredRows) {
    const tr = document.createElement('tr');
    tr.dataset.id = room.id;
    tr.innerHTML = `
      <td class="col-check">
        <input type="checkbox" class="row-check" data-id="${room.id}" />
      </td>
      <td>${room.id}</td>
      <td>${esc(room.name)}</td>
      <td><code>${esc(room.marker_id)}</code></td>
      <td>${esc(room.short_desc)}</td>
      <td class="qr-cell">
        <div class="qr-thumb" id="qr-room-${room.id}"
          data-marker="${esc(room.marker_id)}" data-name="${esc(room.name)}"
          title="Klicken für QR-Optionen"></div>
      </td>
      <td>
        <div class="action-btns">
          <button class="btn-secondary btn-sm" data-edit="${room.id}">Bearbeiten</button>
          <button class="btn-danger btn-sm" data-delete="${room.id}" data-name="${esc(room.name)}">Löschen</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
    renderThumbQR(`qr-room-${room.id}`, room.marker_id);
  }

  // QR-Klick.
  tbody.querySelectorAll('.qr-thumb').forEach(cell => {
    cell.addEventListener('click', () => openQRDialog(cell.dataset.marker, cell.dataset.name));
  });

  // Bearbeiten / Löschen.
  tbody.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openRoomModal(+btn.dataset.edit));
  });
  tbody.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', () => {
      showConfirm(`Raum „${btn.dataset.name}" wirklich löschen?`, async () => {
        await api.deleteRoom(+btn.dataset.delete);
        loadRooms();
      });
    });
  });

  // Checkbox-Änderung → Button-Zustand aktualisieren.
  tbody.querySelectorAll('.row-check').forEach(cb => {
    cb.addEventListener('change', updateDeleteSelectedBtn);
  });
}

// ====================================================
// TABELLEN-HEADER (Sortier-Pfeile + Filter-Zeile)
// ====================================================

// Spalten-Definition: key = Feldname im Raum-Objekt, label = Anzeigename.
const ROOM_COLS = [
  { key: 'id',        label: 'ID'               },
  { key: 'name',      label: 'Name'             },
  { key: 'marker_id', label: 'Marker-ID'        },
  { key: 'short_desc',label: 'Kurzbeschreibung' },
];

function renderHeader(table) {
  const thead = table.querySelector('thead');
  // Header immer neu rendern damit Pfeile und Filter aktuell sind.
  thead.innerHTML = '';

  // Zeile 1: Spalten-Titel mit Sortier-Pfeilen.
  const trTitle = document.createElement('tr');

  // Checkbox-Spalte: „alle markieren".
  const thCheck = document.createElement('th');
  thCheck.className = 'col-check';
  const cbAll = document.createElement('input');
  cbAll.type  = 'checkbox';
  cbAll.id    = 'rooms-check-all';
  cbAll.title = 'Alle sichtbaren Zeilen markieren';
  cbAll.addEventListener('change', () => toggleAllRows('rooms-table', cbAll.checked));
  thCheck.appendChild(cbAll);
  trTitle.appendChild(thCheck);

  for (const col of ROOM_COLS) {
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

  // QR-Spalte + Aktionen-Spalte: kein Sortieren.
  const thQR  = document.createElement('th'); thQR.textContent  = 'QR';      trTitle.appendChild(thQR);
  const thAct = document.createElement('th'); thAct.textContent = 'Aktionen'; trTitle.appendChild(thAct);
  thead.appendChild(trTitle);

  // Zeile 2: Filter-Eingaben.
  const trFilter = document.createElement('tr');
  trFilter.className = 'filter-row';

  // Leere Zelle für Checkbox-Spalte.
  trFilter.appendChild(document.createElement('td'));

  for (const col of ROOM_COLS) {
    const td = document.createElement('td');
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

  // Leere Zellen für QR + Aktionen.
  trFilter.appendChild(document.createElement('td'));
  trFilter.appendChild(document.createElement('td'));
  thead.appendChild(trFilter);
}

// ====================================================
// MEHRFACHAUSWAHL
// ====================================================

// Gibt die IDs aller aktuell angehakten Zeilen zurück.
function getSelectedIds(tableId) {
  return [...document.querySelectorAll(`#${tableId} tbody .row-check:checked`)]
    .map(cb => +cb.dataset.id);
}

// Alle sichtbaren Checkboxen auf checked/unchecked setzen.
function toggleAllRows(tableId, checked) {
  document.querySelectorAll(`#${tableId} tbody .row-check`).forEach(cb => {
    cb.checked = checked;
  });
  updateDeleteSelectedBtn();
}

// ====================================================
// SAMMEL-LÖSCHEN
// ====================================================

// Löscht alle markierten Räume nach Bestätigung.
async function deleteSelectedRooms() {
  const ids = getSelectedIds('rooms-table');
  if (ids.length === 0) return;

  showConfirm(
    `${ids.length} Raum${ids.length !== 1 ? 'e' : ''} wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`,
    async () => {
      let failed = 0;
      for (const id of ids) {
        try {
          await api.deleteRoom(id);
        } catch {
          failed++;
        }
      }
      if (failed > 0) alert(`${failed} Raum/Räume konnten nicht gelöscht werden.`);
      loadRooms();
    }
  );
}

// Aktualisiert den „Ausgewählte löschen"-Button: nur eingeblendet wenn ≥1 markiert.
function updateDeleteSelectedBtn() {
  const btn = document.querySelector('.btn-delete-selected[data-target="rooms"]');
  if (!btn) return;
  const count = getSelectedIds('rooms-table').length;
  btn.textContent = count > 0 ? `🗑 ${count} löschen` : '🗑 Auswahl löschen';
  btn.style.display = count > 0 ? 'inline-block' : 'none';

  // „Alle markieren"-Checkbox synchronisieren.
  const cbAll = document.getElementById('rooms-check-all');
  if (cbAll) {
    const total = document.querySelectorAll('#rooms-table tbody .row-check').length;
    cbAll.checked       = total > 0 && count === total;
    cbAll.indeterminate = count > 0 && count < total;
  }
}

// ====================================================
// TOOLBAR-BUTTONS (Print-All + Delete-Selected)
// ====================================================

// Fügt „Alle QR drucken"- und „Auswahl löschen"-Buttons einmalig oberhalb der Tabelle ein.
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
    btn.className          = 'btn-danger btn-delete-selected';
    btn.dataset.target     = 'rooms';
    btn.textContent        = '🗑 Auswahl löschen';
    btn.style.display      = 'none'; // erst einblenden wenn etwas markiert
    btn.onclick            = onClickFn;
    toolbar.appendChild(btn);
  } else {
    toolbar.querySelector('.btn-delete-selected').onclick = onClickFn;
  }
}

// ====================================================
// RAUM-MODAL
// ====================================================

export async function openRoomModal(roomId = null) {
  const html = `
    <div class="form-grid">
      <div class="form-group">
        <label>Name *</label>
        <input type="text" id="r-name" placeholder="z.B. Großer Saal" />
      </div>
      <div class="form-group">
        <label>Marker-ID *</label>
        <input type="text" id="r-marker" placeholder="room:1" />
      </div>
      <div class="form-group full-width">
        <label>Kurzbeschreibung</label>
        <input type="text" id="r-short" placeholder="Ein Satz Beschreibung" />
      </div>
      <div class="form-group full-width">
        <label>Detailtext (HTML)</label>
        <div class="quill-wrap" id="r-quill-wrap"></div>
        <div class="sensor-hint">
          <span class="sensor-hint-label">💡 Sensor einbetten:</span>
          <code>{{sensor:sensor.entity_id}}</code>
          <span class="sensor-hint-sub">– wird in der PWA durch den Live-Wert ersetzt</span>
          <button type="button" class="btn-secondary btn-sm" id="r-insert-sensor">Sensor einfügen</button>
        </div>
      </div>
      <div class="form-group full-width">
        <label>Video-Transparenz</label>
        <div class="slider-row">
          <input type="range" id="r-opacity" min="0" max="100" value="80" />
          <span class="slider-val" id="r-opacity-val">80%</span>
        </div>
      </div>
      <div class="form-group full-width">
        <label>HA-Sensoren (entity_ids, kommagetrennt)</label>
        <input type="text" id="r-sensors" placeholder="sensor.temp_foyer, sensor.humidity_foyer" />
      </div>
      <div class="form-group full-width">
        <label>Datei-Upload</label>
        <div class="upload-group">
          <div class="upload-item">
            <label>ONNX-Modell</label>
            <input type="file" id="r-file-model" accept=".onnx" />
          </div>
          <div class="upload-item">
            <label>Audio</label>
            <input type="file" id="r-file-audio" accept="audio/*" />
          </div>
          <div class="upload-item">
            <label>Video</label>
            <input type="file" id="r-file-video" accept="video/*" />
          </div>
        </div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" id="r-cancel">Abbrechen</button>
      <button class="btn-primary" id="r-save">Speichern</button>
    </div>
  `;

  openModal(roomId ? 'Raum bearbeiten' : 'Neuer Raum', html);

  quillRoom = new Quill('#r-quill-wrap', {
    theme: 'snow',
    placeholder: 'Ausführliche Beschreibung des Raums…',
    modules: { toolbar: [['bold','italic','underline'],[{list:'ordered'},{list:'bullet'}],['link'],['clean']] }
  });

  if (roomId) {
    try {
      const room = await api.getRoom(roomId);
      document.getElementById('r-name').value   = room.name || '';
      document.getElementById('r-marker').value  = room.marker_id || '';
      document.getElementById('r-short').value   = room.short_desc || '';
      quillRoom.root.innerHTML                   = room.detail_text || '';
      const pct = Math.round((room.video_opacity ?? 0.8) * 100);
      document.getElementById('r-opacity').value = pct;
      document.getElementById('r-opacity-val').textContent = pct + '%';
      document.getElementById('r-sensors').value = (room.ha_sensor_ids || []).join(', ');
    } catch (e) {
      alert('Fehler beim Laden der Raumdaten: ' + e.message);
    }
  }

  document.getElementById('r-insert-sensor').addEventListener('click', () => insertSensorPlaceholder(quillRoom));
  document.getElementById('r-opacity').addEventListener('input', e => {
    document.getElementById('r-opacity-val').textContent = e.target.value + '%';
  });
  document.getElementById('r-cancel').addEventListener('click', closeModal);

  document.getElementById('r-save').addEventListener('click', async () => {
    const name        = document.getElementById('r-name').value.trim();
    const marker_id   = document.getElementById('r-marker').value.trim();
    const short_desc  = document.getElementById('r-short').value.trim();
    const detail_text = quillRoom.root.innerHTML;
    const video_opacity = +document.getElementById('r-opacity').value / 100;
    const ha_sensor_ids = document.getElementById('r-sensors').value.split(',').map(s => s.trim()).filter(Boolean);

    if (!name || !marker_id) { alert('Name und Marker-ID sind Pflichtfelder.'); return; }

    const payload = { name, marker_id, short_desc, detail_text, video_opacity, ha_sensor_ids };

    try {
      const savedRoom = roomId ? await api.updateRoom(roomId, payload) : await api.createRoom(payload);
      const uploadId  = savedRoom?.id ?? roomId;
      if (uploadId) await uploadRoomFiles(uploadId);
      closeModal();
      loadRooms();
    } catch (e) {
      alert('Fehler beim Speichern: ' + e.message);
    }
  });
}

async function uploadRoomFiles(roomId) {
  for (const { inputId, type } of [
    { inputId: 'r-file-model', type: 'model' },
    { inputId: 'r-file-audio', type: 'audio' },
    { inputId: 'r-file-video', type: 'video' },
  ]) {
    const inp = document.getElementById(inputId);
    if (inp && inp.files.length > 0) {
      try { await api.uploadRoomFile(roomId, inp.files[0], type); }
      catch (e) { alert(`Upload fehlgeschlagen (${type}): ${e.message}`); }
    }
  }
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
        const canvas = tmp.querySelector('canvas');
        if (canvas) resolve(canvas.toDataURL('image/png'));
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
        Marker-ID: <code>${esc(markerId)}</code>
      </p>
      <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;">
        <button class="btn-primary" id="qr-btn-download">⬇ Herunterladen</button>
        <button class="btn-secondary" id="qr-btn-print">🖨 Drucken</button>
      </div>
    </div>
  `);
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
  const entries = await Promise.all(items.map(async r => ({
    markerId: r.marker_id, name: r.name, dataUrl: await generateQRDataUrl(r.marker_id)
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

function insertSensorPlaceholder(qi) {
  const id = prompt('HA Sensor Entity-ID (z.B. sensor.temperature_foyer):');
  if (!id?.trim()) return;
  const r = qi.getSelection(true);
  const p = `{{sensor:${id.trim()}}}`;
  qi.insertText(r.index, p, 'user');
  qi.setSelection(r.index + p.length);
}

function esc(s) {
  return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escHtml(s) {
  return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}