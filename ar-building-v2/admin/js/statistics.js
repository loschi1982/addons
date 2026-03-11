// ===================================================
// statistics.js – Statistik-Ansicht mit Zeitraum-Auswahl
// Zeigt KPI-Karten, Charts (Chart.js) und Live-Daten.
// Unterstützt Presets (Heute/Woche/Monat/Jahr), Vor/Zurück-
// Navigation und freie Datumsauswahl per Kalender.
// ===================================================

import * as api from './api.js';

// ---- Chart.js-Instanzen ----
let timelineChart = null;
let loginChart    = null;

// ---- Live-Refresh-Timer ----
let liveTimer = null;

// ---- Zeitraum-Status ----
let rangeMode   = 'day';   // day | week | month | year | custom
let rangeOffset = 0;       // 0 = aktuell, -1 = vorherige Periode, …

// ====================================================
// ÖFFENTLICHE API
// ====================================================

// Wird beim Betreten der Statistik-Sektion aufgerufen.
export async function loadStatistics() {
  setupRangeBar();
  await reloadDashboard();
  await loadLive();
  startLiveRefresh();
}

// Stoppt den Live-Refresh-Timer.
export function stopLiveRefresh() {
  if (liveTimer) {
    clearInterval(liveTimer);
    liveTimer = null;
  }
}

// ====================================================
// ZEITRAUM-BERECHNUNG
// ====================================================

// Gibt { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', label: '…' } zurück.
function computeDateRange() {
  const now = new Date();

  if (rangeMode === 'custom') {
    const f = document.getElementById('stats-date-from').value;
    const t = document.getElementById('stats-date-to').value;
    return { from: f, to: t, label: `${fmtDE(f)} – ${fmtDE(t)}` };
  }

  if (rangeMode === 'day') {
    const d = new Date(now);
    d.setDate(d.getDate() + rangeOffset);
    const iso = isoDate(d);
    const label = rangeOffset === 0
      ? `Heute, ${fmtDE(iso)}`
      : fmtDE(iso);
    return { from: iso, to: iso, label };
  }

  if (rangeMode === 'week') {
    // Woche beginnt am Montag.
    const d = new Date(now);
    const dow = d.getDay() || 7;           // Sonntag = 7
    d.setDate(d.getDate() - dow + 1);      // auf Montag zurück
    d.setDate(d.getDate() + rangeOffset * 7);
    const monday = isoDate(d);
    const sun = new Date(d);
    sun.setDate(sun.getDate() + 6);
    const sunday = isoDate(sun);
    return {
      from: monday,
      to: sunday,
      label: `KW ${weekNumber(d)}: ${fmtDE(monday)} – ${fmtDE(sunday)}`,
    };
  }

  if (rangeMode === 'month') {
    const d = new Date(now.getFullYear(), now.getMonth() + rangeOffset, 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const label = d.toLocaleString('de-DE', { month: 'long', year: 'numeric' });
    return { from: isoDate(d), to: isoDate(last), label };
  }

  // year
  const year = now.getFullYear() + rangeOffset;
  return {
    from: `${year}-01-01`,
    to:   `${year}-12-31`,
    label: String(year),
  };
}

// ====================================================
// ZEITRAUM-LEISTE (Event-Binding)
// ====================================================

let rangeBarReady = false;

function setupRangeBar() {
  if (rangeBarReady) return;
  rangeBarReady = true;

  // Preset-Buttons (Heute / Woche / Monat / Jahr).
  document.querySelectorAll('.stats-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      rangeMode   = btn.dataset.range;
      rangeOffset = 0;
      highlightPreset();
      reloadDashboard();
    });
  });

  // Vor / Zurück.
  document.getElementById('stats-prev').addEventListener('click', () => {
    if (rangeMode === 'custom') return;
    rangeOffset--;
    reloadDashboard();
  });
  document.getElementById('stats-next').addEventListener('click', () => {
    if (rangeMode === 'custom') return;
    rangeOffset++;
    reloadDashboard();
  });

  // Freie Datumsauswahl.
  document.getElementById('stats-apply-custom').addEventListener('click', () => {
    const f = document.getElementById('stats-date-from').value;
    const t = document.getElementById('stats-date-to').value;
    if (!f || !t) return;
    rangeMode = 'custom';
    highlightPreset();
    reloadDashboard();
  });
}

function highlightPreset() {
  document.querySelectorAll('.stats-preset').forEach(b => b.classList.remove('active'));
  if (rangeMode !== 'custom') {
    const active = document.querySelector(`.stats-preset[data-range="${rangeMode}"]`);
    if (active) active.classList.add('active');
  }
}

// ====================================================
// DASHBOARD LADEN
// ====================================================

async function reloadDashboard() {
  const range = computeDateRange();

  // Label aktualisieren.
  document.getElementById('stats-range-label').textContent = range.label;

  try {
    const d = await api.getDashboard(range.from, range.to);

    // KPI-Karten.
    document.getElementById('kpi-sessions').textContent   = d.total_sessions    ?? '–';
    document.getElementById('kpi-room-scans').textContent = d.total_room_scans   ?? '–';
    document.getElementById('kpi-obj-scans').textContent  = d.total_object_scans ?? '–';
    document.getElementById('kpi-active').textContent     = d.active_sessions_now ?? '–';

    renderTimelineChart(d.timeline_events || [], d.timeline_granularity || 'hour', range);
    renderLoginChart(d.login_breakdown || {});
    renderTopRooms(d.top_rooms || []);
    renderTopObjects(d.top_objects || []);

  } catch (e) {
    console.error('Statistik-Ladefehler:', e.message);
  }
}

// ====================================================
// ZEITACHSEN-CHART (stündlich / täglich / monatlich)
// ====================================================

const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONATE     = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

function renderTimelineChart(events, granularity, range) {
  const ctx = document.getElementById('chart-hourly').getContext('2d');

  // Chart-Titel anpassen.
  const titleEl = document.getElementById('chart-timeline-title');
  if (granularity === 'hour')  titleEl.textContent = 'Events pro Stunde';
  else if (granularity === 'day') titleEl.textContent = 'Events pro Tag';
  else titleEl.textContent = 'Events pro Monat';

  // Lookup: label → count.
  const dataMap = {};
  for (const ev of events) {
    dataMap[ev.label] = ev.count;
  }

  // Vollständige Labels erzeugen (Lücken mit 0 auffüllen).
  let labels, values;

  if (granularity === 'hour') {
    labels = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
    values = labels.map(l => dataMap[l] ?? 0);
    // Anzeige-Labels hübscher.
    labels = labels.map(l => `${parseInt(l, 10)}:00`);

  } else if (granularity === 'day') {
    const allDays = dateRange(range.from, range.to);
    labels = allDays;
    values = allDays.map(d => dataMap[d] ?? 0);
    // Kurze Anzeige-Labels: "Mo 11.3."
    labels = allDays.map(d => {
      const dt = new Date(d + 'T00:00:00');
      return `${WOCHENTAGE[dt.getDay()]} ${dt.getDate()}.${dt.getMonth() + 1}.`;
    });

  } else {
    // month
    const allMonths = monthRange(range.from, range.to);
    labels = allMonths;
    values = allMonths.map(m => dataMap[m] ?? 0);
    labels = allMonths.map(m => {
      const [y, mo] = m.split('-');
      return `${MONATE[parseInt(mo, 10) - 1]} ${y}`;
    });
  }

  if (timelineChart) timelineChart.destroy();

  timelineChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Events',
        data: values,
        borderColor:     '#3a7bd5',
        backgroundColor: 'rgba(58,123,213,.15)',
        borderWidth: 2,
        tension: 0.3,
        fill: true,
        pointRadius: labels.length > 60 ? 0 : 3,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#888', font: { size: 11 }, maxRotation: 45 }, grid: { color: '#222' } },
        y: { ticks: { color: '#888', font: { size: 11 } }, grid: { color: '#222' }, beginAtZero: true }
      }
    }
  });
}

// ====================================================
// LOGIN-CHART (Donut)
// ====================================================

function renderLoginChart(breakdown) {
  const ctx = document.getElementById('chart-logins').getContext('2d');

  const pin     = breakdown.pin     ?? 0;
  const visitor = breakdown.visitor ?? 0;
  const failed  = breakdown.failed  ?? 0;

  if (loginChart) loginChart.destroy();

  loginChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['PIN', 'Visitor', 'Fehlgeschlagen'],
      datasets: [{
        data: [pin, visitor, failed],
        backgroundColor: ['#3a7bd5', '#27ae60', '#c0392b'],
        borderColor: '#0f0f0f',
        borderWidth: 3,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#aaa', font: { size: 12 } }
        }
      }
    }
  });
}

// ====================================================
// TOP-LISTEN
// ====================================================

function renderTopRooms(topRooms) {
  const tbody = document.querySelector('#top-rooms-table tbody');
  tbody.innerHTML = '';

  const maxScans = Math.max(...topRooms.map(r => r.scans), 1);
  for (const r of topRooms) {
    const pct = Math.round((r.scans / maxScans) * 100);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(r.name ?? r.room_name)}</td>
      <td>${r.scans}</td>
      <td><div class="mini-bar-wrap"><div class="mini-bar" style="width:${pct}%"></div></div></td>
    `;
    tbody.appendChild(tr);
  }
  if (topRooms.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="muted">Keine Daten</td></tr>';
  }
}

function renderTopObjects(topObjects) {
  const tbody = document.querySelector('#top-objects-table tbody');
  tbody.innerHTML = '';

  const maxDet = Math.max(...topObjects.map(o => o.detections), 1);
  for (const o of topObjects) {
    const pct = Math.round((o.detections / maxDet) * 100);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(o.object_name ?? o.name)}</td>
      <td>${o.detections}</td>
      <td><div class="mini-bar-wrap"><div class="mini-bar" style="width:${pct}%"></div></div></td>
    `;
    tbody.appendChild(tr);
  }
  if (topObjects.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="muted">Keine Daten</td></tr>';
  }
}

// ====================================================
// LIVE-DATEN
// ====================================================

function startLiveRefresh() {
  stopLiveRefresh();
  liveTimer = setInterval(loadLive, 15_000);
}

async function loadLive() {
  try {
    const live = await api.getLive();

    const sessEl = document.getElementById('live-sessions');
    const sessions = live.active_sessions || {};
    const roles = ['visitor', 'staff', 'technician', 'admin'];

    sessEl.innerHTML = roles.map(role => `
      <div class="live-role-row">
        <span>${role}</span>
        <strong>${sessions[role] ?? 0}</strong>
      </div>
    `).join('');

    const roomsEl = document.getElementById('live-rooms');
    const activeRooms = live.active_rooms || [];

    if (activeRooms.length === 0) {
      roomsEl.innerHTML = '<p class="muted" style="font-size:13px">Keine aktiven Räume</p>';
    } else {
      roomsEl.innerHTML = activeRooms.map(r => `
        <div class="live-room-row">
          <span>${esc(r.room_name)}</span>
          <strong>${r.visitor_count} Besucher</strong>
        </div>
      `).join('');
    }

  } catch (e) {
    console.error('Live-Daten-Fehler:', e.message);
  }
}

// ====================================================
// HILFSFUNKTIONEN
// ====================================================

// HTML escapen.
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Date → 'YYYY-MM-DD'.
function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 'YYYY-MM-DD' → 'DD.MM.YYYY' (deutsch).
function fmtDE(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${parseInt(d, 10)}.${parseInt(m, 10)}.${y}`;
}

// Alle Tage von start bis end (inkl.) als ISO-Strings.
function dateRange(startISO, endISO) {
  const result = [];
  const cur = new Date(startISO + 'T00:00:00');
  const end = new Date(endISO + 'T00:00:00');
  while (cur <= end) {
    result.push(isoDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

// Alle Monate von start bis end (inkl.) als 'YYYY-MM'-Strings.
function monthRange(startISO, endISO) {
  const result = [];
  const [sy, sm] = startISO.split('-').map(Number);
  const [ey, em] = endISO.split('-').map(Number);
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    result.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return result;
}

// ISO-Kalenderwoche berechnen.
function weekNumber(d) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  dt.setUTCDate(dt.getUTCDate() + 4 - (dt.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
}
