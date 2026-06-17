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
  docModus: "text", // "text" | "split" (OCR-Text bzw. Text + PDF nebeneinander)
  uebersicht: [], // zuletzt geladene Themen-Gruppen (für Liste + Overlay)
  overlayOffen: false,
  offenesThemaId: undefined, // thema_id des im Overlay gezeigten Themas (null = "Ohne Thema")
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

  // Umschalter Text / Text + PDF
  document.getElementById("btn-text").addEventListener("click", () => setzeDocModus("text"));
  document.getElementById("btn-split").addEventListener("click", () => setzeDocModus("split"));

  // Themen-Overlay schließen (X, Klick auf Backdrop, ESC)
  document.getElementById("overlay-close").addEventListener("click", schliesseOverlay);
  document.getElementById("themen-overlay").addEventListener("click", (ev) => {
    if (ev.target.id === "themen-overlay") schliesseOverlay();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && state.overlayOffen) schliesseOverlay();
  });

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
    document.getElementById("ansicht-umschalter").hidden = false;
    aktualisierePdf(); // lädt das PDF, falls der Split-Modus aktiv ist
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

// --- Ansichts-Modus: Text bzw. Text + PDF --------------------------------

function setzeDocModus(modus) {
  state.docModus = modus;
  const ansicht = document.getElementById("doc-ansicht");
  const pdf = document.getElementById("doc-pdf");
  document.getElementById("btn-text").classList.toggle("aktiv", modus === "text");
  document.getElementById("btn-split").classList.toggle("aktiv", modus === "split");

  if (modus === "split") {
    ansicht.classList.add("split");
    pdf.hidden = false;
    aktualisierePdf();
  } else {
    ansicht.classList.remove("split");
    pdf.hidden = true;
  }
}

function aktualisierePdf() {
  if (state.docModus !== "split" || !state.aktuellesDok) return;
  const frame = document.getElementById("pdf-frame");
  const id = String(state.aktuellesDok.id);
  // Nur neu laden, wenn ein anderes Dokument als bisher angezeigt wird.
  if (frame.dataset.docId !== id) {
    frame.src = API + "/api/pdf/" + state.aktuellesDok.id;
    frame.dataset.docId = id;
  }
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
    state.uebersicht = gruppen;
    rendereThemenListe(gruppen);
    if (state.overlayOffen) rendereOverlay(); // offenes Overlay aktuell halten
  } catch (e) {
    document.getElementById("themenliste").innerHTML =
      '<p class="hinweis">' + escapeHtml(e.message) + "</p>";
  }
}

// Spalte 3: reine Liste der Themen (Name + Anzahl). Klick öffnet das Overlay.
function rendereThemenListe(gruppen) {
  const el = document.getElementById("themenliste");
  el.innerHTML = "";

  if (!gruppen || gruppen.length === 0) {
    el.innerHTML = '<p class="hinweis">Noch keine Themen angelegt.</p>';
    return;
  }

  for (const g of gruppen) {
    const item = document.createElement("div");
    item.className = "thema-item";
    item.innerHTML =
      '<span class="thema-name">' + escapeHtml(g.name) + "</span>" +
      '<span class="badge">' + g.markierungen.length + "</span>";
    item.addEventListener("click", () => oeffneThemaOverlay(g.thema_id));
    el.appendChild(item);
  }
}

function findeGruppe(themaId) {
  return (state.uebersicht || []).find((g) => g.thema_id === themaId) || null;
}

function oeffneThemaOverlay(themaId) {
  state.offenesThemaId = themaId;
  state.overlayOffen = true;
  rendereOverlay();
  document.getElementById("themen-overlay").hidden = false;
}

function schliesseOverlay() {
  state.overlayOffen = false;
  document.getElementById("themen-overlay").hidden = true;
}

// Themen-Zusammenfassung: alle Markierungen des Themas, sichtbar getrennt.
function rendereOverlay() {
  const g = findeGruppe(state.offenesThemaId);
  const body = document.getElementById("overlay-body");
  document.getElementById("overlay-titel").textContent = g ? g.name : "Thema";

  if (!g) {
    schliesseOverlay();
    return;
  }
  body.innerHTML = "";
  if (g.markierungen.length === 0) {
    body.innerHTML = '<p class="hinweis">Noch keine Markierungen für dieses Thema.</p>';
    return;
  }

  // alle Markierungen (themenübergreifend) für die Verknüpfungs-Anzeige
  const alle = new Map();
  for (const gr of state.uebersicht) for (const m of gr.markierungen) alle.set(m.id, m);

  for (const m of g.markierungen) body.appendChild(baueKarte(m, alle));
}

// Eine getrennte Karte je Markierung: Quelle + Links, voller Textauszug,
// Notiz, Verknüpfungen, Löschen.
function baueKarte(m, alle) {
  const karte = document.createElement("div");
  karte.className = "karte";

  // PDF wird vom Add-on selbst inline ausgeliefert (eigene Ingress-URL),
  // damit #page=n funktioniert und kein Paperless-Auth/Pfad-Problem auftritt.
  const pdfLink = API + "/api/pdf/" + m.dokument_id + "#page=" + m.seite;
  let quelle =
    '<a class="sprung" href="' + pdfLink + '" target="_blank" rel="noopener">📄 ' +
    escapeHtml(m.dokument_titel) + " · S. " + m.seite + "</a>";
  if (state.externalUrl) {
    const detail = state.externalUrl + "/documents/" + m.dokument_id;
    quelle +=
      ' <a class="paperless-link" href="' + detail +
      '" target="_blank" rel="noopener" title="In Paperless öffnen (mit Notizen)">🗂 Paperless</a>';
  }

  let inner = '<button class="loeschen" title="Markierung löschen" data-id="' + m.id + '">✕</button>';
  inner += '<div class="quelle">' + quelle + "</div>";
  inner += '<blockquote class="auszug">' + escapeHtml(m.textauszug) + "</blockquote>";
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
  karte.innerHTML = inner;

  karte.querySelector(".loeschen").addEventListener("click", async (ev) => {
    ev.stopPropagation();
    if (!confirm("Markierung löschen?")) return;
    try {
      await api("DELETE", "/api/markierungen/" + m.id);
      await ladeUebersicht(); // aktualisiert Liste + offenes Overlay
      await ladeBaum();
      if (state.aktuellesDok) await oeffneDokument(state.aktuellesDok.id);
    } catch (err) {
      alert("Fehler: " + err.message);
    }
  });

  return karte;
}
