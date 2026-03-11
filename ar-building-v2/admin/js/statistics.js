// ===================================================
// statistics.js – Statistik-Ansicht
// Zeigt KPI-Karten, Charts (Chart.js) und Live-Daten.
// Live-Daten werden alle 15 Sekunden automatisch aktualisiert.
// ===================================================

import * as api from './api.js';

// Referenzen auf aktive Chart.js-Instanzen.
// Bestehende Charts müssen zerstört werden bevor neue erstellt werden,
// damit Chart.js keine Fehler wirft.
let hourlyChart = null;
let loginChart  = null;

// Timer-ID für den automatischen Live-Refresh.
let liveTimer = null;

// Lädt alle Statistik-Daten (Dashboard + Live) und rendert sie.
export async function loadStatistics() {
  await loadDashboard();
  await loadLive();
  startLiveRefresh();
}

// Stoppt den Live-Refresh-Timer.
// Wird aufgerufen wenn der Benutzer in eine andere Sektion wechselt.
export function stopLiveRefresh() {
  if (liveTimer) {
    clearInterval(liveTimer);
    liveTimer = null;
  }
}

// Startet den automatischen Live-Refresh alle 15 Sekunden.
function startLiveRefresh() {
  stopLiveRefresh();
  liveTimer = setInterval(loadLive, 15_000);
}

// Lädt die aggregierten KPI-Daten vom Backend und rendert sie.
async function loadDashboard() {
  try {
    const d = await api.getDashboard();

    // KPI-Karten befüllen.
    document.getElementById('kpi-sessions').textContent   = d.total_sessions_today    ?? '–';
    document.getElementById('kpi-room-scans').textContent = d.total_room_scans_today   ?? '–';
    document.getElementById('kpi-obj-scans').textContent  = d.total_object_scans_today ?? '–';
    document.getElementById('kpi-active').textContent     = d.active_sessions_now      ?? '–';

    renderHourlyChart(d.hourly_events || []);
    renderLoginChart(d.login_breakdown || {});
    renderTopRooms(d.top_rooms || []);
    renderTopObjects(d.top_objects || []);

  } catch (e) {
    console.error('Statistik-Ladefehler:', e.message);
  }
}

// Zeichnet das Linien-Chart für Events pro Stunde.
// Nutzt Chart.js. Zerstört zuerst eine evtl. vorhandene alte Instanz.
function renderHourlyChart(hourlyEvents) {
  const ctx = document.getElementById('chart-hourly').getContext('2d');

  // Alle 24 Stunden vorbereiten, fehlende Stunden mit 0 auffüllen.
  const hourMap = {};
  for (const { hour, count } of hourlyEvents) {
    hourMap[hour] = count;
  }

  const labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
  const values = Array.from({ length: 24 }, (_, i) => hourMap[i] ?? 0);

  if (hourlyChart) {
    hourlyChart.destroy();
  }

  hourlyChart = new Chart(ctx, {
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
        pointRadius: 3,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#888', font: { size: 11 } }, grid: { color: '#222' } },
        y: { ticks: { color: '#888', font: { size: 11 } }, grid: { color: '#222' }, beginAtZero: true }
      }
    }
  });
}

// Zeichnet das Donut-Chart für Login-Arten (pin / visitor / failed).
function renderLoginChart(breakdown) {
  const ctx = document.getElementById('chart-logins').getContext('2d');

  const pin     = breakdown.pin     ?? 0;
  const visitor = breakdown.visitor ?? 0;
  const failed  = breakdown.failed  ?? 0;

  if (loginChart) {
    loginChart.destroy();
  }

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

// Rendert die Top-Räume-Tabelle mit Mini-CSS-Balken.
// Der breiteste Balken entspricht dem Maximalwert (100%).
function renderTopRooms(topRooms) {
  const tbody = document.querySelector('#top-rooms-table tbody');
  tbody.innerHTML = '';

  const maxScans = Math.max(...topRooms.map(r => r.scans), 1);

  for (const r of topRooms) {
    const pct = Math.round((r.scans / maxScans) * 100);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(r.name)}</td>
      <td>${r.scans}</td>
      <td>
        <div class="mini-bar-wrap">
          <div class="mini-bar" style="width:${pct}%"></div>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }

  if (topRooms.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="muted">Keine Daten</td></tr>';
  }
}

// Rendert die Top-Objekte-Tabelle mit Mini-CSS-Balken.
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
      <td>
        <div class="mini-bar-wrap">
          <div class="mini-bar" style="width:${pct}%"></div>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }

  if (topObjects.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="muted">Keine Daten</td></tr>';
  }
}

// Lädt die Live-Daten (aktive Sessions + aktive Räume) und rendert sie.
// Wird alle 15 Sekunden automatisch aufgerufen.
async function loadLive() {
  try {
    const live = await api.getLive();

    // Aktive Sessions nach Rolle anzeigen.
    const sessEl = document.getElementById('live-sessions');
    const sessions = live.active_sessions || {};
    const roles = ['visitor', 'staff', 'technician', 'admin'];

    sessEl.innerHTML = roles.map(role => `
      <div class="live-role-row">
        <span>${role}</span>
        <strong>${sessions[role] ?? 0}</strong>
      </div>
    `).join('');

    // Aktive Räume anzeigen.
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

// HTML-Sonderzeichen escapen.
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}