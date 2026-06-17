"use strict";

/* Vertragsnavigator – Frontend (Vanilla JS).
   Drei Spalten: Vertragsbaum, Dokumentenansicht (markierbar), Themenübersicht. */

const API = (window.__VN__ && window.__VN__.apiBase) || "";

const state = {
  themen: [],
  alleDocs: [],
  aktuellesDok: null,
  paperlessUrl: "",
  externalUrl: "", // vom Browser erreichbare Paperless-URL (Detailansicht-Link)
  linkSource: null, // Markierungs-ID im Verknüpfungsmodus
};

// --- API-Helfer -----------------------------------------------------------

async function api(method, pfad, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    opt.headers["Content-Type"] = "application/json";
    opt.body = JSON.stringify(body);
  }
  const res = await fetch(API + pfad, opt);
  if (!res.ok) {
    let detail = res.status + " " + res.statusText;
    try {
      const j = await res.json();
      if (j && j.detail) detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch (e) { /* keine JSON-Antwort */ }
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

// --- Hilfsfunktionen ------------------------------------------------------

function setStatus(text, fehler = false) {
  const el = document.getElementById("status");
  el.textContent = text || "";
  el.classList.toggle("fehler", !!fehler);
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function kuerzen(s, n) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// --- Initialisierung ------------------------------------------------------

document.addEventListener("DOMContentLoaded", init);

async function init() {
  document.addEventListener("click", verbergeCtxMenu);

  try {
    const cfg = await api("GET", "/api/config");
    state.paperlessUrl = cfg.paperless_url || "";
    state.externalUrl = cfg.paperless_external_url || "";
    if (!cfg.konfiguriert) {
      setStatus("Paperless nicht konfiguriert – bitte Add-on-Optionen prüfen.", true);
    }
  } catch (e) { /* /api/config sollte immer gehen */ }

  // Kontextmenü auf der Dokumentenansicht
  document.getElementById("doc-content").addEventListener("contextmenu", aufContextMenu);

  await ladeThemen();
  await ladeBaum();
  await ladeUebersicht();
}

// --- Vertragsbaum ---------------------------------------------------------

async function ladeBaum() {
  try {
    const docs = await api("GET", "/api/docs");
    state.alleDocs = docs;
    rendereBaum(docs);
  } catch (e) {
    setStatus("Dokumente konnten nicht geladen werden: " + e.message, true);
    document.getElementById("baum").innerHTML = '<p class="hinweis">' + escapeHtml(e.message) + "</p>";
  }
}

function rendereBaum(docs) {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const kinder = new Map();
  const wurzeln = [];
  for (const d of docs) {
    if (d.eltern_id != null && byId.has(d.eltern_id)) {
      if (!kinder.has(d.eltern_id)) kinder.set(d.eltern_id, []);
      kinder.get(d.eltern_id).push(d);
    } else {
      wurzeln.push(d);
    }
  }

  const container = document.getElementById("baum");
  container.innerHTML = "";
  if (docs.length === 0) {
    container.innerHTML = '<p class="hinweis">Keine Dokumente in Paperless gefunden.</p>';
    return;
  }

  const renderKnoten = (d, tiefe) => {
    const div = document.createElement("div");
    div.className = "knoten" + (tiefe > 0 ? " kind" : "");
    div.dataset.id = d.id;
    div.style.paddingLeft = 0.4 + tiefe * 1.0 + "rem";
    if (state.aktuellesDok && state.aktuellesDok.id === d.id) div.classList.add("aktiv");

    const titel = document.createElement("span");
    titel.className = "titel";
    titel.textContent = d.titel;
    div.appendChild(titel);

    if (d.anzahl_markierungen > 0) {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = d.anzahl_markierungen;
      div.appendChild(b);
    }

    div.addEventListener("click", () => oeffneDokument(d.id));
    container.appendChild(div);

    const ks = (kinder.get(d.id) || []).sort((a, b) => a.titel.localeCompare(b.titel));
    for (const k of ks) renderKnoten(k, tiefe + 1);
  };

  wurzeln.sort((a, b) => a.titel.localeCompare(b.titel));
  for (const w of wurzeln) renderKnoten(w, 0);
}

function markiereAktivenBaum(id) {
  document.querySelectorAll("#baum .knoten").forEach((k) => {
    k.classList.toggle("aktiv", parseInt(k.dataset.id, 10) === id);
  });
}

// --- Dokumentenansicht ----------------------------------------------------

async function oeffneDokument(id) {
  setStatus("Lade Dokument …");
  try {
    const dok = await api("GET", "/api/docs/" + id);
    state.aktuellesDok = dok;
    rendereDokument(dok);
    rendereParentAuswahl(dok);
    markiereAktivenBaum(id);
    setStatus("");
  } catch (e) {
    setStatus("Dokument-Fehler: " + e.message, true);
  }
}

function rendereDokument(dok) {
  document.getElementById("doc-titel").textContent =
    dok.titel + (dok.page_count ? " · " + dok.page_count + " S." : "");

  const cont = document.getElementById("doc-content");
  const text = dok.content || "";
  if (!text) {
    cont.innerHTML = '<p class="hinweis">Kein OCR-Text vorhanden.</p>';
    return;
  }

  // Markierungsbereiche im Text bestimmen (erste Fundstelle je Auszug).
  const ranges = [];
  for (const m of dok.markierungen) {
    const idx = text.indexOf(m.textauszug);
    if (idx >= 0) ranges.push({ start: idx, end: idx + m.textauszug.length, m });
  }
  ranges.sort((a, b) => a.start - b.start);

  let html = "";
  let pos = 0;
  let letztesEnde = -1;
  for (const r of ranges) {
    if (r.start < letztesEnde) continue; // Überlappung überspringen
    html += escapeHtml(text.slice(pos, r.start));
    html +=
      '<mark data-id="' + r.m.id + '" title="' + escapeHtml(r.m.notiz || "") + '">' +
      escapeHtml(text.slice(r.start, r.end)) +
      "</mark>";
    pos = r.end;
    letztesEnde = r.end;
  }
  html += escapeHtml(text.slice(pos));
  cont.innerHTML = html;

  cont.querySelectorAll("mark").forEach((mk) => {
    mk.addEventListener("click", (ev) => {
      ev.stopPropagation();
      klickAufMarkierung(parseInt(mk.dataset.id, 10));
    });
  });
}

function rendereParentAuswahl(dok) {
  const zeile = document.getElementById("parent-zeile");
  const sel = document.getElementById("parent-select");
  sel.innerHTML = "";

  const optKein = document.createElement("option");
  optKein.value = "";
  optKein.textContent = "– kein –";
  sel.appendChild(optKein);

  for (const d of state.alleDocs) {
    if (d.id === dok.id) continue;
    const o = document.createElement("option");
    o.value = d.id;
    o.textContent = d.titel;
    if (dok.eltern_id === d.id) o.selected = true;
    sel.appendChild(o);
  }

  sel.onchange = async () => {
    const val = sel.value ? parseInt(sel.value, 10) : null;
    try {
      await api("POST", "/api/docs/" + dok.id + "/parent", { eltern_id: val });
      setStatus("Hauptvertrag aktualisiert.");
      state.aktuellesDok.eltern_id = val;
      await ladeBaum();
    } catch (e) {
      alert("Fehler: " + e.message);
    }
  };

  zeile.hidden = false;
}

// --- Markieren & Kontextmenü ---------------------------------------------

function globalerOffset(container, node, offsetInNode) {
  let offset = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  let n;
  while ((n = walker.nextNode())) {
    if (n === node) return offset + offsetInNode;
    offset += n.nodeValue.length;
  }
  return offset;
}

function aufContextMenu(ev) {
  const sel = window.getSelection();
  const text = sel && sel.toString();
  if (!text || !text.trim()) return; // ohne Auswahl: Browser-Standardmenü zulassen
  if (!state.aktuellesDok) return;
  ev.preventDefault();
  const range = sel.getRangeAt(0);
  const cont = document.getElementById("doc-content");
  const offset = globalerOffset(cont, range.startContainer, range.startOffset);
  zeigeCtxMenu(ev.clientX, ev.clientY, text.trim(), offset);
}

function zeigeCtxMenu(x, y, text, offset) {
  const menu = document.getElementById("ctxmenu");
  menu.innerHTML = "";

  const ueberschrift = (t) => {
    const u = document.createElement("div");
    u.className = "ueberschrift";
    u.textContent = t;
    menu.appendChild(u);
  };
  const trenner = () => {
    const t = document.createElement("div");
    t.className = "trenner";
    menu.appendChild(t);
  };
  const add = (label, cls, fn) => {
    const d = document.createElement("div");
    d.className = "item" + (cls ? " " + cls : "");
    d.textContent = label;
    d.addEventListener("click", (e) => {
      e.stopPropagation();
      verbergeCtxMenu();
      fn();
    });
    menu.appendChild(d);
  };

  ueberschrift("Zu Thema hinzufügen");
  for (const th of state.themen) {
    add(th.name, "thema-item", () => markierungSpeichern(text, offset, th.id, null));
  }
  add("+ Neues Thema …", "thema-item", async () => {
    const name = prompt("Name des neuen Themas:");
    if (!name || !name.trim()) return;
    try {
      const th = await api("POST", "/api/themen", { name: name.trim() });
      state.themen.push(th);
      state.themen.sort((a, b) => a.name.localeCompare(b.name));
      await markierungSpeichern(text, offset, th.id, null);
    } catch (e) {
      alert("Fehler: " + e.message);
    }
  });

  trenner();
  add("Verknüpfen mit …", null, () => starteVerknuepfung(text, offset));
  add("Notiz hinzufügen", null, async () => {
    const n = prompt("Notiz zur Markierung:");
    if (n === null) return;
    await markierungSpeichern(text, offset, null, n);
  });

  menu.style.left = Math.min(x, window.innerWidth - 220) + "px";
  menu.style.top = Math.min(y, window.innerHeight - 20) + "px";
  menu.hidden = false;
}

function verbergeCtxMenu() {
  document.getElementById("ctxmenu").hidden = true;
}

async function markierungSpeichern(text, offset, themaId, notiz) {
  if (!state.aktuellesDok) return null;
  try {
    setStatus("Speichere Markierung …");
    const m = await api("POST", "/api/markierungen", {
      dokument_id: state.aktuellesDok.id,
      thema_id: themaId,
      textauszug: text,
      notiz: notiz,
      offset: offset,
    });
    setStatus("Markierung auf Seite " + m.seite + " gespeichert.");
    await oeffneDokument(state.aktuellesDok.id);
    await ladeUebersicht();
    await ladeBaum();
    return m;
  } catch (e) {
    setStatus("Fehler beim Speichern: " + e.message, true);
    alert("Fehler: " + e.message);
    return null;
  }
}

// --- Verknüpfungen --------------------------------------------------------

async function starteVerknuepfung(text, offset) {
  // Aktuelle Auswahl als Markierung (ohne Thema) sichern, dann Ziel wählen.
  const m = await markierungSpeichern(text, offset, null, null);
  if (!m) return;
  state.linkSource = m.id;
  zeigeBanner("Verknüpfung: Klicke auf eine hervorgehobene Stelle als Ziel.", () => {
    state.linkSource = null;
    verbergeBanner();
  });
}

async function klickAufMarkierung(id) {
  if (state.linkSource && state.linkSource !== id) {
    try {
      await api("POST", "/api/verknuepfungen", {
        markierung_a_id: state.linkSource,
        markierung_b_id: id,
      });
      setStatus("Verknüpfung erstellt.");
      await ladeUebersicht();
    } catch (e) {
      alert("Fehler: " + e.message);
    } finally {
      state.linkSource = null;
      verbergeBanner();
    }
  }
}

function zeigeBanner(text, abbrechenFn) {
  const b = document.getElementById("banner");
  b.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = text;
  b.appendChild(span);
  const btn = document.createElement("button");
  btn.textContent = "Abbrechen";
  btn.addEventListener("click", abbrechenFn);
  b.appendChild(btn);
  b.hidden = false;
}

function verbergeBanner() {
  document.getElementById("banner").hidden = true;
}

// --- Themen & Übersicht ---------------------------------------------------

async function ladeThemen() {
  try {
    state.themen = await api("GET", "/api/themen");
  } catch (e) {
    state.themen = [];
  }
}

async function ladeUebersicht() {
  try {
    const gruppen = await api("GET", "/api/uebersicht");
    rendereUebersicht(gruppen);
  } catch (e) {
    document.getElementById("uebersicht").innerHTML =
      '<p class="hinweis">' + escapeHtml(e.message) + "</p>";
  }
}

function rendereUebersicht(gruppen) {
  const el = document.getElementById("uebersicht");
  el.innerHTML = "";

  const alle = new Map();
  for (const g of gruppen) for (const m of g.markierungen) alle.set(m.id, m);

  if (gruppen.length === 0) {
    el.innerHTML = '<p class="hinweis">Noch keine Themen oder Markierungen.</p>';
    return;
  }

  for (const g of gruppen) {
    const box = document.createElement("div");
    box.className = "thema";

    const titel = document.createElement("div");
    titel.className = "thema-titel";
    titel.innerHTML = "<span>" + escapeHtml(g.name) + "</span><span>" + g.markierungen.length + "</span>";
    box.appendChild(titel);

    for (const m of g.markierungen) {
      const e = document.createElement("div");
      e.className = "eintrag";

      // PDF wird vom Add-on selbst inline ausgeliefert (eigene Ingress-URL),
      // damit #page=n funktioniert und kein Paperless-Auth/Pfad-Problem auftritt.
      const pdfLink = API + "/api/pdf/" + m.dokument_id + "#page=" + m.seite;
      let quelle =
        '<a class="sprung" href="' + pdfLink + '" target="_blank" rel="noopener">📄 ' +
        escapeHtml(m.dokument_titel) + " · S. " + m.seite + "</a>";
      // Zusätzlicher Link in die Paperless-Detailansicht (mit Notizen/Metadaten),
      // sofern eine vom Browser erreichbare Paperless-URL konfiguriert ist.
      if (state.externalUrl) {
        const detail = state.externalUrl + "/documents/" + m.dokument_id;
        quelle +=
          ' <a class="paperless-link" href="' + detail +
          '" target="_blank" rel="noopener" title="In Paperless öffnen (mit Notizen)">🗂 Paperless</a>';
      }

      let inner = '<button class="loeschen" title="Markierung löschen" data-id="' + m.id + '">✕</button>';
      inner += '<div class="quelle">' + quelle + "</div>";
      inner += '<div class="auszug">' + escapeHtml(kuerzen(m.textauszug, 160)) + "</div>";
      if (m.notiz) inner += '<div class="notiz">📝 ' + escapeHtml(m.notiz) + "</div>";
      if (m.verknuepft_mit && m.verknuepft_mit.length) {
        const ziele = m.verknuepft_mit
          .map((id) => {
            const z = alle.get(id);
            return z ? escapeHtml(z.dokument_titel) + " S." + z.seite : "#" + id;
          })
          .join(", ");
        inner += '<div class="verkn">🔗 ' + ziele + "</div>";
      }
      e.innerHTML = inner;

      e.querySelector(".loeschen").addEventListener("click", async (ev) => {
        ev.stopPropagation();
        if (!confirm("Markierung löschen?")) return;
        try {
          await api("DELETE", "/api/markierungen/" + m.id);
          await ladeUebersicht();
          await ladeBaum();
          if (state.aktuellesDok) await oeffneDokument(state.aktuellesDok.id);
        } catch (err) {
          alert("Fehler: " + err.message);
        }
      });

      box.appendChild(e);
    }
    el.appendChild(box);
  }
}
