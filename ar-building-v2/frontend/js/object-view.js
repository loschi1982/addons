// object-view.js – Objekt- und Raum-Detailfenster mit Reitern.
// Kein import/export – schreibt auf window.AR.objectView.

(function () {
  'use strict';

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ----------------------------------------------------------------
  // Status-Konfiguration laut API-Vertrag v2.1.0
  // Enum: open | in_progress | resolved | feedback | closed | rejected
  // ----------------------------------------------------------------
  var STATUS_CONFIG = {
    open:        { label: 'Offen',       color: '#4a9eff' },
    in_progress: { label: 'In Arbeit',   color: '#f0a500' },
    resolved:    { label: 'Erledigt',    color: '#4caf50' },
    feedback:    { label: 'Feedback',    color: '#9c27b0' },
    closed:      { label: 'Geschlossen', color: '#757575' },
    rejected:    { label: 'Abgelehnt',   color: '#e53935' },
  };
  var STATUS_OPTIONS = ['open', 'in_progress', 'resolved', 'feedback', 'closed', 'rejected'];

  // Marker-ID des aktuell geöffneten Raums/Objekts.
  // Wird nach einem Status-Update genutzt um die Ticket-Liste neu zu laden.
  var currentMarkerId = '';

  // ----------------------------------------------------------------
  // Panel-HTML beim ersten Aufruf aufbauen
  // ----------------------------------------------------------------

var panelReady = false;

  function ensurePanel() {
    if (panelReady) return;
    panelReady = true;

    // Close-Button liegt im HTML außerhalb des Panels (pointer-events:none am Panel).
    // Einmalig hier binden – nicht in ensureTicketDrawer, da der Panel früher bereit ist.
    var closeBtnEl = document.getElementById('detail-close');
    if (closeBtnEl) {
      closeBtnEl.addEventListener('click', function () { closeDetailPanel(); });
    }

    var inner = document.querySelector('.detail-panel__inner');
    inner.innerHTML =
      '<h2 id="detail-name" class="detail-panel__title"></h2>' +

      '<div class="detail-tabs">' +
        '<button class="detail-tab detail-tab--active" data-tab="desc">Beschreibung</button>' +
        '<button class="detail-tab" data-tab="planradar">PlanRadar</button>' +
        '<button class="detail-tab hidden" data-tab="anlage" id="detail-tab-btn-anlage">Anlage</button>' +
      '</div>' +

      '<div id="detail-tab-desc" class="detail-tab-content">' +
        '<div id="detail-text"    class="detail-panel__text"></div>' +
        '<div id="detail-sensors" class="detail-panel__sensors"></div>' +
      '</div>' +

      '<div id="detail-tab-planradar" class="detail-tab-content hidden">' +
        '<div id="detail-tickets"></div>' +
      '</div>' +

      '<div id="detail-tab-anlage" class="detail-tab-content hidden">' +
        '<div id="detail-plant"></div>' +
      '</div>';

    inner.querySelectorAll('.detail-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        inner.querySelectorAll('.detail-tab').forEach(function (b) {
          b.classList.remove('detail-tab--active');
        });
        btn.classList.add('detail-tab--active');
        inner.querySelectorAll('.detail-tab-content').forEach(function (c) {
          c.classList.add('hidden');
        });
        document.getElementById('detail-tab-' + btn.dataset.tab)
          .classList.remove('hidden');
      });
    });

    // Ticket-Detail-Drawer einmalig aufbauen
    ensureTicketDrawer();
  }

  function resetTabs() {
    var inner = document.querySelector('.detail-panel__inner');
    inner.querySelectorAll('.detail-tab').forEach(function (b) {
      b.classList.remove('detail-tab--active');
    });
    var descTab = inner.querySelector('[data-tab="desc"]');
    if (descTab) descTab.classList.add('detail-tab--active');
    inner.querySelectorAll('.detail-tab-content').forEach(function (c) {
      c.classList.add('hidden');
    });
    var descContent = document.getElementById('detail-tab-desc');
    if (descContent) descContent.classList.remove('hidden');
  }

  // ----------------------------------------------------------------
  // Ticket-Detail-Drawer
  //
  // Liegt als direktes Kind von <body> – dadurch außerhalb des
  // .detail-panel-Stacking-Contexts. z-index:200 (per CSS) stellt
  // sicher dass er über dem Panel (z-index:50) angezeigt wird.
  // ----------------------------------------------------------------

  var drawerEl = null;

  function ensureTicketDrawer() {
    if (drawerEl) return;

    // Das CSS-Grundgerüst kommt aus main.css (#ticket-drawer).
    // Hier nur DOM aufbauen, Styling per CSS-Klasse.
    drawerEl = document.createElement('div');
    drawerEl.id = 'ticket-drawer';
    drawerEl.style.display = 'none'; // Startzustand; JS schaltet auf 'flex'

    // ── Kopfzeile ──────────────────────────────────────────────────
    var hdr = document.createElement('div');
    hdr.style.cssText = [
      'display:flex', 'align-items:flex-start', 'justify-content:space-between',
      'padding:14px 16px 0', 'flex-shrink:0', 'gap:8px'
    ].join(';');

    var hdrLeft = document.createElement('div');
    hdrLeft.style.cssText = 'flex:1;min-width:0';

    var titleEl = document.createElement('div');
    titleEl.id = 'ticket-drawer-title';
    titleEl.style.cssText = [
      'font-size:1rem', 'font-weight:bold', 'color:#4a9eff', 'word-break:break-word'
    ].join(';');

    var badgeEl = document.createElement('span');
    badgeEl.id = 'ticket-drawer-badge';
    badgeEl.style.cssText = [
      'display:inline-block', 'font-size:0.72rem', 'margin-top:4px',
      'padding:2px 8px', 'border-radius:10px', 'border:1px solid #555', 'color:#ccc'
    ].join(';');

    hdrLeft.appendChild(titleEl);
    hdrLeft.appendChild(document.createElement('br'));
    hdrLeft.appendChild(badgeEl);

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = [
      'background:none', 'border:none', 'color:#aaa', 'font-size:1.4rem',
      'cursor:pointer', 'padding:0 4px', 'line-height:1', 'flex-shrink:0'
    ].join(';');
    closeBtn.addEventListener('click', closeTicketDrawer);

    hdr.appendChild(hdrLeft);
    hdr.appendChild(closeBtn);
    drawerEl.appendChild(hdr);

    // Trennlinie
    var hr = document.createElement('div');
    hr.style.cssText = 'height:1px;background:#2a2a4a;margin:10px 16px 0;flex-shrink:0';
    drawerEl.appendChild(hr);

    // Scrollbarer Body
    var body = document.createElement('div');
    body.id = 'ticket-drawer-body';
    body.style.cssText = 'flex:1;overflow-y:auto;padding:14px 16px';
    drawerEl.appendChild(body);

    // An <body> hängen – NICHT an .detail-panel.
    // Nur so ist der Drawer unabhängig vom Stacking-Context des Panels.
    document.body.appendChild(drawerEl);
  }

  // Öffnet den Drawer und füllt ihn mit den Daten eines Tickets.
  function openTicketDrawer(ticket) {
    ensureTicketDrawer();

    var cfg = STATUS_CONFIG[ticket.status] || { label: ticket.status || '?', color: '#aaa' };

    // Kopfzeile befüllen
    document.getElementById('ticket-drawer-title').textContent = ticket.title || '(Kein Titel)';
    var badge = document.getElementById('ticket-drawer-badge');
    badge.textContent       = cfg.label;
    badge.style.color       = cfg.color;
    badge.style.borderColor = cfg.color;
    badge.style.background  = cfg.color + '22';

    // Body aufbauen
    var body = document.getElementById('ticket-drawer-body');
    body.innerHTML = '';

    // ── Beschreibung ────────────────────────────────────────────────
    if (ticket.description) {
      body.appendChild(_section('Beschreibung',
        '<p style="color:#ccc;font-size:.9rem;line-height:1.6;margin:0">' +
          esc(ticket.description) + '</p>'
      ));
    }

    // ── Metadaten ───────────────────────────────────────────────────
    var metaRows = '';
    if (ticket.assignee)   metaRows += _metaRow('Assignee',  esc(ticket.assignee));
    if (ticket.created_at) metaRows += _metaRow('Erstellt',  esc(formatDate(ticket.created_at)));
    if (ticket.id)         metaRows += _metaRow('Ticket-ID', esc(String(ticket.id)));
    if (metaRows) {
      body.appendChild(_section('Details',
        '<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:.85rem">' +
          metaRows + '</div>'
      ));
    }

    // ── Status ändern ───────────────────────────────────────────────
    // Nur Techniker und Admins dürfen Status setzen (API-Vertrag v2.1.0)
    var role    = (sessionStorage.getItem('ar_role') || '').toLowerCase();
    var canEdit = (role === 'technician' || role === 'admin');

    var statusSection = _section('Status ändern', '');

    if (canEdit) {
      var sel = document.createElement('select');
      sel.style.cssText = [
        'background:#0f0f23', 'color:#e0e0e0', 'border:1px solid #4a9eff',
        'border-radius:6px', 'padding:6px 10px', 'font-size:.9rem',
        'width:100%', 'margin-bottom:8px', 'cursor:pointer'
      ].join(';');
      STATUS_OPTIONS.forEach(function (s) {
        var opt = document.createElement('option');
        opt.value = s;
        opt.textContent = STATUS_CONFIG[s].label;
        if (s === ticket.status) opt.selected = true;
        sel.appendChild(opt);
      });

      var saveBtn = document.createElement('button');
      saveBtn.textContent = 'Status speichern';
      saveBtn.style.cssText = [
        'background:#4a9eff', 'color:#fff', 'border:none',
        'border-radius:6px', 'padding:7px 16px', 'font-size:.9rem', 'cursor:pointer'
      ].join(';');

      var statusMsg = document.createElement('div');
      statusMsg.style.cssText = 'font-size:.8rem;margin-top:6px;min-height:1.2em';

      saveBtn.addEventListener('click', function () {
        saveBtn.disabled    = true;
        saveBtn.textContent = '…';
        statusMsg.textContent = '';

        // PUT /api/planradar/tickets/{id}/status?project_id=...
        // project_id mitsenden – Backend-Cache ist nach Neustart leer
        window.AR.api.updateTicketStatus(ticket.id, sel.value, ticket.project_id)
          .then(function (updated) {
            ticket.status = updated.status || sel.value;
            var updCfg = STATUS_CONFIG[ticket.status] || { label: ticket.status, color: '#aaa' };
            badge.textContent       = updCfg.label;
            badge.style.color       = updCfg.color;
            badge.style.borderColor = updCfg.color;
            badge.style.background  = updCfg.color + '22';
            statusMsg.style.color   = '#4caf50';
            statusMsg.textContent   = '✓ Status gespeichert';
            saveBtn.disabled        = false;
            saveBtn.textContent     = 'Status speichern';
            // Ticket-Liste im Hintergrund neu laden
            if (currentMarkerId) loadTicketsByMarker(currentMarkerId);
          })
          .catch(function (err) {
            statusMsg.style.color = '#e57373';
            statusMsg.textContent = '✗ ' + (err.message || 'Fehler');
            saveBtn.disabled      = false;
            saveBtn.textContent   = 'Status speichern';
          });
      });

      statusSection.appendChild(sel);
      statusSection.appendChild(saveBtn);
      statusSection.appendChild(statusMsg);
    } else {
      var note = document.createElement('p');
      note.style.cssText = 'color:#888;font-size:.85rem;margin:0';
      note.textContent = 'Aktuell: ' + cfg.label + ' (nur Techniker/Admin können ändern)';
      statusSection.appendChild(note);
    }
    body.appendChild(statusSection);

    // ── Kommentar hinzufügen ────────────────────────────────────────
    var commentSection = _section('Kommentar hinzufügen', '');

    var textarea = document.createElement('textarea');
    textarea.placeholder = 'Kommentar eingeben…';
    textarea.rows = 3;
    textarea.style.cssText = [
      'width:100%', 'box-sizing:border-box',
      'background:#0f0f23', 'color:#e0e0e0',
      'border:1px solid #333', 'border-radius:6px',
      'padding:8px', 'font-size:.9rem', 'resize:vertical',
      'font-family:inherit', 'margin-bottom:8px'
    ].join(';');
    textarea.addEventListener('focus', function () { textarea.style.borderColor = '#4a9eff'; });
    textarea.addEventListener('blur',  function () { textarea.style.borderColor = '#333'; });

    var sendBtn = document.createElement('button');
    sendBtn.textContent = 'Kommentar senden';
    sendBtn.style.cssText = [
      'background:#4a9eff', 'color:#fff', 'border:none',
      'border-radius:6px', 'padding:7px 16px', 'font-size:.9rem', 'cursor:pointer'
    ].join(';');

    var commentMsg = document.createElement('div');
    commentMsg.style.cssText = 'font-size:.8rem;margin-top:6px;min-height:1.2em';

    sendBtn.addEventListener('click', function () {
      var text = textarea.value.trim();
      if (!text) {
        commentMsg.style.color = '#f0a500';
        commentMsg.textContent = 'Bitte Kommentar eingeben.';
        return;
      }
      sendBtn.disabled    = true;
      sendBtn.textContent = '…';
      commentMsg.textContent = '';

      // POST /api/planradar/tickets/{id}/comment?project_id=...
      // project_id mitsenden – Backend-Cache ist nach Neustart leer
      window.AR.api.addTicketComment(ticket.id, text, ticket.project_id)
        .then(function () {
          commentMsg.style.color = '#4caf50';
          commentMsg.textContent = '✓ Kommentar gesendet';
          textarea.value         = '';
          sendBtn.disabled       = false;
          sendBtn.textContent    = 'Kommentar senden';
        })
        .catch(function (err) {
          commentMsg.style.color = '#e57373';
          commentMsg.textContent = '✗ ' + (err.message || 'Fehler');
          sendBtn.disabled       = false;
          sendBtn.textContent    = 'Kommentar senden';
        });
    });

    commentSection.appendChild(textarea);
    commentSection.appendChild(sendBtn);
    commentSection.appendChild(commentMsg);
    body.appendChild(commentSection);
    
    // ── Journals (Kommentare + Änderungshistorie) ───────────────────
    // Werden asynchron nachgeladen – Drawer öffnet sofort, Inhalt folgt.
    var journalsSection = _section('Verlauf', '');
    var journalsBody = document.createElement('div');
    journalsBody.textContent = 'Lädt…';
    journalsBody.style.cssText = 'color:#666;font-size:.85rem';
    journalsSection.appendChild(journalsBody);
    body.appendChild(journalsSection);

    window.AR.api.getTicketJournals(ticket.id, ticket.project_id)
      .then(function (journals) {
        if (!journals || !journals.length) {
          journalsBody.textContent = 'Keine Einträge.';
          return;
        }
        journalsBody.innerHTML = '';
        journals.forEach(function (j) {
          var entry = document.createElement('div');
          entry.style.cssText = [
            'border-left:3px solid #2a2a4a', 'padding:6px 10px',
            'margin-bottom:8px', 'font-size:.85rem'
          ].join(';');
          // Typ-Icon: 1=Kommentar, 2=Medien, 3=Statusänderung
          var icon = j.type === 1 ? '💬' : j.type === 2 ? '📎' : j.type === 3 ? '🔄' : '•';
          entry.innerHTML =
            '<div style="color:#aaa;margin-bottom:3px">' +
              icon + ' <strong style="color:#ccc">' + esc(j.author || '?') + '</strong>' +
              ' <span style="color:#555;font-size:.78rem">' + esc(formatDate(j.created_at)) + '</span>' +
            '</div>' +
            '<div style="color:#ddd;line-height:1.5">' + esc(j.text || '') + '</div>';
          journalsBody.appendChild(entry);
        });
      })
      .catch(function () {
        journalsBody.textContent = 'Verlauf nicht verfügbar.';
      });

    // ── Attachments ─────────────────────────────────────────────────
    var attachSection = _section('Anhänge', '');
    var attachBody = document.createElement('div');
    attachBody.textContent = 'Lädt…';
    attachBody.style.cssText = 'color:#666;font-size:.85rem';
    attachSection.appendChild(attachBody);
    body.appendChild(attachSection);

    window.AR.api.getTicketAttachments(ticket.id, ticket.project_id)
      .then(function (attachments) {
        if (!attachments || !attachments.length) {
          attachBody.textContent = 'Keine Anhänge.';
          return;
        }
        attachBody.innerHTML = '';
        attachments.forEach(function (a) {
          var link = document.createElement('a');
          link.href   = a.url;
          link.target = '_blank';
          link.rel    = 'noopener';
          link.style.cssText = [
            'display:flex', 'align-items:center', 'gap:8px',
            'color:#4a9eff', 'font-size:.85rem', 'text-decoration:none',
            'margin-bottom:6px', 'word-break:break-all'
          ].join(';');
          // Datei-Icon je nach Typ
          var icon = (a.type || '').toLowerCase().includes('image') ? '🖼️' : '📄';
          link.textContent = icon + ' ' + (a.filename || a.url);
          if (a.caption && a.caption !== a.filename) {
            var cap = document.createElement('span');
            cap.style.cssText = 'color:#666;font-size:.78rem;display:block';
            cap.textContent = a.caption;
            var wrap = document.createElement('div');
            wrap.appendChild(link);
            wrap.appendChild(cap);
            attachBody.appendChild(wrap);
          } else {
            attachBody.appendChild(link);
          }
        });
      })
      .catch(function () {
        attachBody.textContent = 'Anhänge nicht verfügbar.';
      });

    drawerEl.style.display = 'flex';
  }

  function closeTicketDrawer() {
    if (drawerEl) drawerEl.style.display = 'none';
  }

  // Sektion mit grauer Überschrift.
  function _section(heading, innerHtml) {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:18px';
    var h = document.createElement('div');
    h.style.cssText = [
      'font-size:.72rem', 'color:#555', 'text-transform:uppercase',
      'letter-spacing:.05em', 'margin-bottom:8px'
    ].join(';');
    h.textContent = heading;
    wrap.appendChild(h);
    if (innerHtml) wrap.insertAdjacentHTML('beforeend', innerHtml);
    return wrap;
  }

  // Eine Zeile im Metadaten-Grid.
  function _metaRow(label, value) {
    return '<span style="color:#666;white-space:nowrap">' + label + ':</span>' +
           '<span style="color:#ccc">' + value + '</span>';
  }

  // ----------------------------------------------------------------
  // Sensor-Platzhalter auflösen (unverändert)
  // ----------------------------------------------------------------

  async function resolveSensorPlaceholders(container) {
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    var nodes  = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (var i = 0; i < nodes.length; i++) {
      var node    = nodes[i];
      var matches = node.textContent.match(/\{\{sensor:([^}]+)\}\}/g);
      if (!matches) continue;

      var text = node.textContent;
      for (var j = 0; j < matches.length; j++) {
        var entityId = matches[j].replace('{{sensor:', '').replace('}}', '').trim();
        try {
          var sensor  = await window.AR.api.getSensor(entityId);
          var display = sensor.state + (sensor.unit ? '\u00a0' + sensor.unit : '');
          text = text.replace(matches[j], display);
        } catch (e) {
          text = text.replace(matches[j], '–');
        }
      }
      node.textContent = text;
    }
  }

  // ----------------------------------------------------------------
  // Öffentliche Funktionen
  // ----------------------------------------------------------------

  async function openDetailPanel(object, sessionId) {
    ensurePanel();
    resetTabs();
    closeTicketDrawer();

    // Close-Button sichtbar schalten wenn Panel geöffnet wird
    var closeBtnEl = document.getElementById('detail-close');
    if (closeBtnEl) closeBtnEl.classList.remove('hidden');

    currentMarkerId = object.marker_id || '';

    document.getElementById('detail-name').textContent = object.name;

    var descContainer = document.getElementById('detail-text');
    descContainer.innerHTML = object.detail_text || '';
    await resolveSensorPlaceholders(descContainer);

    document.getElementById('detail-sensors').innerHTML = '';
    document.getElementById('detail-tickets').innerHTML =
      '<p class="tickets-loading">Tickets werden geladen…</p>';

    document.getElementById('detail-panel').classList.remove('hidden');

    window.AR.api.postEvent('detail_opened', sessionId, {
      objectId: object.id,
      roomId:   object.room_id,
    }).catch(function () {});

    if (object.audio_path) window.AR.audio.playObjectAudio(object.audio_path);

    loadSensors(object.ha_sensor_ids || []);
    loadTicketsByMarker(object.marker_id);

    // CAFM: Anlage-Tab laden wenn plant_data vorhanden.
    if (object.plant_data) {
      var anlageBtn = document.getElementById('detail-tab-btn-anlage');
      if (anlageBtn) anlageBtn.classList.remove('hidden');
      loadPlantTab(object.id, object.plant_data);
    } else {
      var anlageBtn2 = document.getElementById('detail-tab-btn-anlage');
      if (anlageBtn2) anlageBtn2.classList.add('hidden');
    }
  }

  async function openRoomDetailPanel(room, sessionId) {
    ensurePanel();
    resetTabs();
    closeTicketDrawer();

    // Close-Button sichtbar schalten wenn Panel geöffnet wird
    var closeBtnEl = document.getElementById('detail-close');
    if (closeBtnEl) closeBtnEl.classList.remove('hidden');

    currentMarkerId = room.marker_id || '';

    document.getElementById('detail-name').textContent = room.name;

    var descContainer = document.getElementById('detail-text');
    descContainer.innerHTML = room.detail_text || '';
    await resolveSensorPlaceholders(descContainer);

    document.getElementById('detail-sensors').innerHTML = '';
    document.getElementById('detail-tickets').innerHTML =
      '<p class="tickets-loading">Tickets werden geladen…</p>';

    document.getElementById('detail-panel').classList.remove('hidden');

    if (sessionId) {
      window.AR.api.postEvent('detail_opened', sessionId, {
        roomId: room.id,
      }).catch(function () {});
    }

    loadSensors(room.ha_sensor_ids || []);
    loadTicketsByMarker(room.marker_id);
  }

  function closeDetailPanel() {
  closeTicketDrawer();
  document.getElementById('detail-panel').classList.add('hidden');
  var closeBtnEl = document.getElementById('detail-close');
  if (closeBtnEl) closeBtnEl.classList.add('hidden');
  currentMarkerId = '';
}

  function isDetailOpen() {
    return !document.getElementById('detail-panel').classList.contains('hidden');
  }

  // ----------------------------------------------------------------
  // Hilfsfunktionen
  // ----------------------------------------------------------------

  async function loadSensors(entityIds) {
    if (!entityIds || !entityIds.length) return;
    var results = await Promise.allSettled(
      entityIds.map(function (id) { return window.AR.api.getSensor(id); })
    );
    var chips = results
      .filter(function (r) { return r.status === 'fulfilled' && r.value; })
      .map(function (r) {
        var s = r.value;
        return '<span class="sensor-chip">' +
          esc(s.friendly_name || s.entity_id) + ': ' +
          esc(s.state) + (s.unit ? '\u00a0' + esc(s.unit) : '') +
          '</span>';
      });
    var el = document.getElementById('detail-sensors');
    if (el) el.innerHTML = chips.join('');
  }

  // Lädt Tickets per marker_id und rendert sie als klickbare Karten.
  async function loadTicketsByMarker(markerId) {
    var el = document.getElementById('detail-tickets');
    if (!el) return;

    var tickets;
    try {
      tickets = await window.AR.api.getTicketsByMarker(markerId);
    } catch (e) {
      el.innerHTML = '<p class="tickets-empty">Keine Tickets verfügbar.</p>';
      return;
    }

    if (!tickets || !tickets.length) {
      el.innerHTML = '<p class="tickets-empty">Keine offenen Tickets.</p>';
      return;
    }

    el.innerHTML = '';
    tickets.forEach(function (t) {
      var cfg = STATUS_CONFIG[t.status] || { label: t.status || '?', color: '#aaa' };

      var card = document.createElement('div');
      card.className = 'ticket-card';
      // Farbiger linker Rand zeigt Status auf einen Blick
      card.style.borderLeft = '4px solid ' + cfg.color;

      card.innerHTML =
        '<div class="ticket-card__header">' +
          '<span class="ticket-card__title">' + esc(t.title) + '</span>' +
          '<span class="ticket-status" style="' +
            'background:' + cfg.color + '22;' +
            'color:' + cfg.color + ';' +
            'border:1px solid ' + cfg.color +
          '">' + esc(cfg.label) + '</span>' +
        '</div>' +
        (t.description
          ? '<div class="ticket-card__desc">' +
              esc(t.description.length > 100
                ? t.description.substring(0, 100) + '…'
                : t.description) +
            '</div>'
          : '') +
        '<div class="ticket-card__meta">' +
          (t.assignee   ? '<span>👤 ' + esc(t.assignee) + '</span>' : '') +
          (t.created_at ? '<span>📅 ' + esc(formatDate(t.created_at)) + '</span>' : '') +
        '</div>';

      // Klick öffnet den Ticket-Detail-Drawer
      card.addEventListener('click', function (e) {
        e.stopPropagation();
        openTicketDrawer(t);
      });

      el.appendChild(card);
    });
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric'
      });
    } catch (e) { return iso; }
  }

  // ----------------------------------------------------------------
  // CAFM – Anlage-Tab
  // ----------------------------------------------------------------

  function loadPlantTab(objectId, plantData) {
    var el = document.getElementById('detail-plant');
    if (!el) return;

    var p = plantData;
    var html = '';

    // Stammdaten.
    html += '<div style="margin-bottom:16px">';
    html += _plantRow('Hersteller', p.hersteller);
    html += _plantRow('Modell', p.modell);
    html += _plantRow('Seriennummer', p.seriennummer);
    html += _plantRow('Baujahr', p.baujahr);
    html += _plantRow('Einbaudatum', p.einbaudatum ? formatDate(p.einbaudatum) : null);
    html += _plantRow('Standort', p.standort_detail);
    html += _plantRow('Garantie bis', p.garantie_bis ? formatDate(p.garantie_bis) : null);
    html += _plantRow('Status', p.status);
    html += _plantRow('DIN 276 KG', p.din276_kg);
    html += _plantRow('Anlagentyp', p.anlagen_variante ? p.anlagen_variante.replace(/_/g, ' ') : null);
    html += '</div>';

    // Dokumente.
    if (p.documents && p.documents.length > 0) {
      html += '<div style="font-size:.72rem;color:#555;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Dokumente</div>';
      p.documents.forEach(function (d) {
        html += '<a href="' + esc(d.file_path) + '" target="_blank" ' +
          'style="display:block;color:#4a9eff;font-size:.85rem;margin-bottom:4px;text-decoration:none">' +
          esc(d.filename) + ' <span style="color:#555;font-size:.75rem">(' + esc(d.category) + ')</span></a>';
      });
      html += '<div style="margin-bottom:16px"></div>';
    }

    el.innerHTML = html;

    // Fällige Wartungen laden.
    loadDueMaintenance(objectId, el);
  }

  function _plantRow(label, value) {
    if (!value && value !== 0) return '';
    return '<div style="display:flex;gap:8px;font-size:.85rem;margin-bottom:3px">' +
      '<span style="color:#666;min-width:110px">' + label + ':</span>' +
      '<span style="color:#ccc">' + esc(String(value)) + '</span></div>';
  }

  function loadDueMaintenance(objectId, container) {
    window.AR.api.getDueMaintenance(objectId)
      .then(function (schedules) {
        if (!schedules || !schedules.length) {
          container.insertAdjacentHTML('beforeend',
            '<div style="font-size:.72rem;color:#555;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Fällige Wartungen</div>' +
            '<p style="color:#666;font-size:.85rem">Keine fälligen Wartungen.</p>'
          );
          return;
        }

        container.insertAdjacentHTML('beforeend',
          '<div style="font-size:.72rem;color:#555;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Fällige Wartungen</div>'
        );

        schedules.forEach(function (s) {
          var card = document.createElement('div');
          card.style.cssText = [
            'background:#1a1a2e', 'border:1px solid #2a2a4a', 'border-radius:8px',
            'padding:12px', 'margin-bottom:10px'
          ].join(';');

          var overdue = s.days_until_due < 0;
          var badge = overdue
            ? '<span style="background:#e5393522;color:#e53935;font-size:.72rem;padding:2px 6px;border-radius:8px">Überfällig</span>'
            : '<span style="background:#f0a50022;color:#f0a500;font-size:.72rem;padding:2px 6px;border-radius:8px">Fällig</span>';

          card.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
              '<strong style="color:#ccc;font-size:.9rem">' + esc(s.title) + '</strong>' +
              badge +
            '</div>' +
            '<div style="color:#666;font-size:.8rem;margin-bottom:8px">' +
              'Fällig: ' + formatDate(s.next_due) + ' | ' + s.interval_months + ' Monate' +
            '</div>';

          // Button: Wartung durchführen (nur Techniker/Admin).
          var role = (sessionStorage.getItem('ar_role') || '').toLowerCase();
          if (role === 'technician' || role === 'admin') {
            var btn = document.createElement('button');
            btn.textContent = 'Wartung durchführen';
            btn.style.cssText = [
              'background:#4a9eff', 'color:#fff', 'border:none',
              'border-radius:6px', 'padding:7px 14px', 'font-size:.85rem', 'cursor:pointer'
            ].join(';');
            btn.addEventListener('click', function () {
              openMaintenanceForm(s, container);
            });
            card.appendChild(btn);
          }

          container.appendChild(card);
        });
      })
      .catch(function () {
        container.insertAdjacentHTML('beforeend',
          '<p style="color:#666;font-size:.85rem">Wartungsdaten konnten nicht geladen werden.</p>'
        );
      });
  }

  function openMaintenanceForm(schedule, parentEl) {
    // Bestehenden Inhalt im Anlage-Tab ersetzen mit Checkliste.
    var checklist = schedule.checklist || [];
    var html = '<div style="margin-bottom:16px">' +
      '<div style="font-size:.72rem;color:#555;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">' +
        'Wartung: ' + esc(schedule.title) +
      '</div>';

    if (checklist.length === 0) {
      html += '<p style="color:#888;font-size:.85rem">Keine Checkliste vorhanden.</p>';
    } else {
      checklist.forEach(function (item, idx) {
        html += '<div style="background:#1a1a2e;border:1px solid #2a2a4a;border-radius:6px;padding:8px 10px;margin-bottom:6px">' +
          '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem;color:#ccc">' +
            '<input type="checkbox" class="maint-check" data-idx="' + idx + '" /> ' +
            esc(item.text) +
          '</label>' +
          '<input type="text" class="maint-note" data-idx="' + idx + '" placeholder="Bemerkung…" ' +
            'style="width:100%;box-sizing:border-box;margin-top:4px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:4px;padding:4px 8px;font-size:.8rem" />' +
        '</div>';
      });
    }

    html += '<label style="display:block;font-size:.8rem;color:#888;margin-top:10px">Allgemeine Bemerkungen</label>' +
      '<textarea id="maint-notes" rows="3" style="width:100%;box-sizing:border-box;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:6px;padding:8px;font-size:.85rem;resize:vertical;font-family:inherit"></textarea>';

    html += '<div style="display:flex;gap:8px;margin-top:10px">' +
      '<button id="maint-submit" style="background:#4caf50;color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:.9rem;cursor:pointer">Wartung abschließen</button>' +
      '<button id="maint-cancel" style="background:#333;color:#ccc;border:none;border-radius:6px;padding:8px 16px;font-size:.9rem;cursor:pointer">Abbrechen</button>' +
    '</div>';

    html += '<div id="maint-msg" style="font-size:.8rem;margin-top:6px;min-height:1.2em"></div>';
    html += '</div>';

    parentEl.innerHTML = html;

    document.getElementById('maint-cancel').addEventListener('click', function () {
      // Reload plant tab.
      window.AR.api.getPlantData(schedule.plant_id)
        .then(function (plant) { loadPlantTab(plant.object_id, plant); })
        .catch(function () { parentEl.innerHTML = '<p style="color:#888">Fehler beim Neuladen.</p>'; });
    });

    document.getElementById('maint-submit').addEventListener('click', function () {
      var checks = parentEl.querySelectorAll('.maint-check');
      var notes  = parentEl.querySelectorAll('.maint-note');
      var checklist = schedule.checklist || [];
      var results = [];

      for (var i = 0; i < checklist.length; i++) {
        results.push({
          id:   checklist[i].id,
          text: checklist[i].text,
          ok:   checks[i] ? checks[i].checked : false,
          note: notes[i] ? notes[i].value : '',
        });
      }

      var generalNotes = document.getElementById('maint-notes').value;
      var submitBtn = document.getElementById('maint-submit');
      var msgEl     = document.getElementById('maint-msg');

      submitBtn.disabled    = true;
      submitBtn.textContent = 'Wird gespeichert…';
      msgEl.textContent     = '';

      window.AR.api.completeMaintenance(schedule.id, { results: results, notes: generalNotes })
        .then(function (log) {
          msgEl.style.color = '#4caf50';
          msgEl.innerHTML   = '✓ Wartung abgeschlossen.';
          if (log.pdf_path) {
            msgEl.innerHTML += ' <a href="#" onclick="window.AR.api.downloadLogPdf(' + log.id +
              ');return false;" style="color:#4a9eff">PDF herunterladen</a>';
          }
          submitBtn.textContent = 'Erledigt';
        })
        .catch(function (err) {
          msgEl.style.color   = '#e57373';
          msgEl.textContent   = '✗ ' + (err.message || 'Fehler');
          submitBtn.disabled  = false;
          submitBtn.textContent = 'Wartung abschließen';
        });
    });
  }

  window.AR = window.AR || {};
  window.AR.objectView = {
    openDetailPanel:     openDetailPanel,
    openRoomDetailPanel: openRoomDetailPanel,
    closeDetailPanel:    closeDetailPanel,
    isDetailOpen:        isDetailOpen,
  };
})();