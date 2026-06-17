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
  docModus: "pdf", // "pdf" (gerendertes PDF, markierbar) | "text" (reiner OCR-Text)
  pdfZoom: 1, // Zoom-Faktor relativ zur eingepassten Breite (1 = Breite einpassen)
  pdfDocId: null, // aktuell im PDF-Renderer angezeigtes Dokument
  pdfSeiten: [], // [{ n, textDivs }] je gerenderter Seite (für Hervorhebungen)
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

  // Kontextmenü auf Text- bzw. PDF-Ansicht
  document.getElementById("doc-content").addEventListener("contextmenu", aufContextMenu);
  document.getElementById("pdf-render").addEventListener("contextmenu", aufContextMenuPdf);

  // Klick auf hervorgehobene PDF-Stelle = Ziel im Verknüpfungsmodus
  document.getElementById("pdf-render").addEventListener("click", (ev) => {
    const el = ev.target.closest(".markiert");
    if (el && el.dataset.markId) klickAufMarkierung(parseInt(el.dataset.markId, 10));
  });

  // PDF.js-Worker (vom selben CDN)
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  // Umschalter PDF / Text
  document.getElementById("btn-pdf").addEventListener("click", () => setzeDocModus("pdf"));
  document.getElementById("btn-text").addEventListener("click", () => setzeDocModus("text"));

  // Zoom für die PDF-Ansicht
  document.getElementById("btn-zoom-in").addEventListener("click", () => zoomAendern(0.2));
  document.getElementById("btn-zoom-out").addEventListener("click", () => zoomAendern(-0.2));
  updateZoomAnzeige();

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
    setzeDocModus(state.docModus); // Ansicht anwenden + PDF rendern/hervorheben
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

// --- Ansichts-Modus: PDF (markierbar) bzw. Text (OCR) --------------------

function setzeDocModus(modus) {
  state.docModus = modus;
  document.getElementById("btn-pdf").classList.toggle("aktiv", modus === "pdf");
  document.getElementById("btn-text").classList.toggle("aktiv", modus === "text");
  document.getElementById("doc-pdf").hidden = modus !== "pdf";
  document.getElementById("doc-content").hidden = modus !== "text";
  document.getElementById("pdf-zoom").hidden = modus !== "pdf";
  if (modus === "pdf") aktualisierePdf();
}

function updateZoomAnzeige() {
  const el = document.getElementById("zoom-anzeige");
  if (el) el.textContent = Math.round(state.pdfZoom * 100) + " %";
}

function zoomAendern(delta) {
  const neu = Math.min(3, Math.max(0.4, Math.round((state.pdfZoom + delta) * 10) / 10));
  if (neu === state.pdfZoom) return;
  state.pdfZoom = neu;
  updateZoomAnzeige();
  if (state.docModus === "pdf" && state.aktuellesDok) {
    state.pdfDocId = null; // Neu-Rendern mit neuem Zoom erzwingen
    renderePdf(state.aktuellesDok);
  }
}

// Rendert das PDF (bei neuem Dokument) oder aktualisiert nur die Hervorhebungen.
function aktualisierePdf() {
  if (state.docModus !== "pdf" || !state.aktuellesDok) return;
  if (state.pdfDocId === state.aktuellesDok.id) {
    aktualisierePdfHighlights(state.aktuellesDok.markierungen || []);
  } else {
    renderePdf(state.aktuellesDok);
  }
}

let pdfRenderToken = 0;

async function renderePdf(dok) {
  const ziel = document.getElementById("pdf-render");
  const token = ++pdfRenderToken;
  state.pdfDocId = null;
  state.pdfSeiten = [];

  if (!window.pdfjsLib) {
    ziel.innerHTML = '<p class="hinweis">PDF-Bibliothek nicht geladen (Internet/CDN erreichbar?).</p>';
    return;
  }

  ziel.innerHTML = '<p class="hinweis">PDF wird geladen …</p>';
  try {
    const pdf = await pdfjsLib.getDocument({
      url: API + "/api/pdf/" + dok.id,
      withCredentials: true,
    }).promise;
    if (token !== pdfRenderToken) return; // zwischenzeitlich anderes Dokument geöffnet

    ziel.innerHTML = "";
    const breite = (ziel.clientWidth || 800) - 4;

    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      if (token !== pdfRenderToken) return;

      const basis = page.getViewport({ scale: 1 });
      const scale = Math.max(0.1, (breite / basis.width) * state.pdfZoom);
      const viewport = page.getViewport({ scale });

      const seiteDiv = document.createElement("div");
      seiteDiv.className = "pdf-seite";
      seiteDiv.dataset.seite = n;
      seiteDiv.style.width = viewport.width + "px";
      seiteDiv.style.height = viewport.height + "px";

      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      seiteDiv.appendChild(canvas);

      const textLayerDiv = document.createElement("div");
      textLayerDiv.className = "textLayer";
      // pdf.js 3.x positioniert/skaliert die Text-Spans über diese CSS-Variable.
      // Ohne sie liegt die Textebene nicht bündig über dem PDF.
      textLayerDiv.style.setProperty("--scale-factor", String(scale));
      seiteDiv.appendChild(textLayerDiv);

      ziel.appendChild(seiteDiv);

      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      const textContent = await page.getTextContent();
      const textDivs = [];
      // pdf.js 3.x: Parameter heißt textContentSource (nicht textContent).
      await pdfjsLib.renderTextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport: viewport,
        textDivs: textDivs,
      }).promise;

      state.pdfSeiten.push({ n: n, textDivs: textDivs });
    }

    state.pdfDocId = dok.id;
    aktualisierePdfHighlights(dok.markierungen || []);
  } catch (e) {
    ziel.innerHTML =
      '<p class="hinweis">PDF konnte nicht geladen werden: ' + escapeHtml(e.message) + "</p>";
    state.pdfDocId = null;
  }
}

// Hebt gespeicherte Markierungen in der PDF-Textebene hervor.
function aktualisierePdfHighlights(markierungen) {
  for (const seite of state.pdfSeiten) {
    for (const d of seite.textDivs) {
      d.classList.remove("markiert");
      delete d.dataset.markId;
    }
    const marken = markierungen.filter((m) => m.seite === seite.n);
    if (marken.length) hebeHervorDivs(seite.textDivs, marken);
  }
}

// Sucht den Textauszug (whitespace-tolerant) in der Textebene und markiert die
// betroffenen Spans.
function hebeHervorDivs(textDivs, marken) {
  let compact = "";
  const charDiv = [];
  for (const div of textDivs) {
    const t = div.textContent || "";
    for (const ch of t) {
      if (/\s/.test(ch)) continue;
      compact += ch.toLowerCase();
      charDiv.push(div);
    }
  }
  for (const m of marken) {
    const needle = (m.textauszug || "").replace(/\s+/g, "").toLowerCase();
    if (!needle) continue;
    const idx = compact.indexOf(needle);
    if (idx < 0) continue;
    const divs = new Set();
    for (let i = idx; i < idx + needle.length && i < charDiv.length; i++) divs.add(charDiv[i]);
    divs.forEach((d) => {
      d.classList.add("markiert");
      d.dataset.markId = m.id;
    });
  }
}

// Aus der Themen-Zusammenfassung in die PDF-Ansicht springen (kein neues Fenster).
async function springeZuMarkierung(dokumentId, seite, markId) {
  schliesseOverlay();
  state.docModus = "pdf"; // sicherstellen, dass die PDF-Ansicht aktiv ist
  await oeffneDokument(dokumentId); // lädt + rendert das PDF (asynchron)
  scrolleZu(seite, markId);
}

// Scrollt zur Markierung (falls schon hervorgehoben) bzw. zur Seite. Wartet, bis
// die betreffende PDF-Seite gerendert ist.
function scrolleZu(seite, markId) {
  let n = 0;
  const tick = () => {
    const span =
      markId != null
        ? document.querySelector('#pdf-render .markiert[data-mark-id="' + markId + '"]')
        : null;
    if (span) {
      span.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const seiteEl = document.querySelector('#pdf-render .pdf-seite[data-seite="' + seite + '"]');
    n++;
    // Seite vorhanden + kurze Kulanz für die Hervorhebung -> zur Seite scrollen.
    if (seiteEl && n > 8) {
      seiteEl.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (n > 80) return; // Abbruch nach ~8 s
    setTimeout(tick, 100);
  };
  tick();
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
  zeigeCtxMenu(ev.clientX, ev.clientY, { text: text.trim(), offset: offset });
}

// Kontextmenü beim Markieren direkt im gerenderten PDF.
function aufContextMenuPdf(ev) {
  const sel = window.getSelection();
  const text = sel && sel.toString();
  if (!text || !text.trim()) return;
  if (!state.aktuellesDok) return;
  // Seite aus dem umgebenden .pdf-seite-Container ableiten (exakte Seitenzahl).
  let node = sel.anchorNode;
  let el = node && (node.nodeType === 1 ? node : node.parentElement);
  el = el && el.closest(".pdf-seite");
  const seite = el ? parseInt(el.dataset.seite, 10) : undefined;
  ev.preventDefault();
  zeigeCtxMenu(ev.clientX, ev.clientY, { text: text.trim(), seite: seite });
}

function zeigeCtxMenu(x, y, kontext) {
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
    add(th.name, "thema-item", () => markierungSpeichern(kontext, th.id, null));
  }
  add("+ Neues Thema …", "thema-item", async () => {
    const name = prompt("Name des neuen Themas:");
    if (!name || !name.trim()) return;
    try {
      const th = await api("POST", "/api/themen", { name: name.trim() });
      state.themen.push(th);
      state.themen.sort((a, b) => a.name.localeCompare(b.name));
      await markierungSpeichern(kontext, th.id, null);
    } catch (e) {
      alert("Fehler: " + e.message);
    }
  });

  trenner();
  add("Verknüpfen mit …", null, () => starteVerknuepfung(kontext));
  add("Notiz hinzufügen", null, async () => {
    const n = prompt("Notiz zur Markierung:");
    if (n === null) return;
    await markierungSpeichern(kontext, null, n);
  });

  menu.style.left = Math.min(x, window.innerWidth - 220) + "px";
  menu.style.top = Math.min(y, window.innerHeight - 20) + "px";
  menu.hidden = false;
}

function verbergeCtxMenu() {
  document.getElementById("ctxmenu").hidden = true;
}

async function markierungSpeichern(kontext, themaId, notiz) {
  if (!state.aktuellesDok) return null;
  try {
    setStatus("Speichere Markierung …");
    const m = await api("POST", "/api/markierungen", {
      dokument_id: state.aktuellesDok.id,
      thema_id: themaId,
      textauszug: kontext.text,
      notiz: notiz,
      seite: kontext.seite, // bei PDF-Markierung exakt bekannt
      offset: kontext.offset, // bei Text-Markierung für die Seiten-Heuristik
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

async function starteVerknuepfung(kontext) {
  // Aktuelle Auswahl als Markierung (ohne Thema) sichern, dann Ziel wählen.
  const m = await markierungSpeichern(kontext, null, null);
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

  // Sprung erfolgt IM Add-on (mittlere PDF-Ansicht) statt in einem neuen Tab.
  let quelle =
    '<a class="sprung" href="#" data-doc="' + m.dokument_id + '" data-seite="' + m.seite +
    '" data-mark="' + m.id + '" title="Im PDF anzeigen">📄 ' +
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

  // Sprung in die PDF-Ansicht des Add-ons (kein neues Fenster)
  const sprungEl = karte.querySelector("a.sprung");
  if (sprungEl) {
    sprungEl.addEventListener("click", (ev) => {
      ev.preventDefault();
      springeZuMarkierung(
        parseInt(sprungEl.dataset.doc, 10),
        parseInt(sprungEl.dataset.seite, 10),
        parseInt(sprungEl.dataset.mark, 10)
      );
    });
  }

  // Post-It / Notiz: anlegen und bearbeiten
  const notizWrap = document.createElement("div");
  notizWrap.className = "notiz-bereich";
  renderNotizBereich(notizWrap, m);
  karte.appendChild(notizWrap);

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

// Zeigt die Notiz als Post-It (klickbar zum Bearbeiten) bzw. einen Button zum Anlegen.
function renderNotizBereich(wrap, m) {
  wrap.innerHTML = "";
  if (m.notiz) {
    const pit = document.createElement("div");
    pit.className = "postit";
    pit.textContent = m.notiz;
    pit.title = "Notiz bearbeiten";
    pit.addEventListener("click", () => oeffneNotizEditor(wrap, m));
    wrap.appendChild(pit);
  } else {
    const btn = document.createElement("button");
    btn.className = "notiz-btn";
    btn.textContent = "📝 Notiz hinzufügen";
    btn.addEventListener("click", () => oeffneNotizEditor(wrap, m));
    wrap.appendChild(btn);
  }
}

function oeffneNotizEditor(wrap, m) {
  wrap.innerHTML = "";
  const ta = document.createElement("textarea");
  ta.className = "notiz-edit";
  ta.rows = 3;
  ta.value = m.notiz || "";
  wrap.appendChild(ta);

  const leiste = document.createElement("div");
  leiste.className = "notiz-aktionen";

  const speichern = document.createElement("button");
  speichern.className = "btn-speichern";
  speichern.textContent = "Speichern";
  speichern.addEventListener("click", async () => {
    const text = ta.value.trim();
    try {
      await api("PATCH", "/api/markierungen/" + m.id, { notiz: text || null });
      m.notiz = text || null; // lokalen Stand aktualisieren
      await ladeUebersicht(); // Overlay + Liste neu aufbauen
    } catch (e) {
      alert("Fehler: " + e.message);
    }
  });

  const abbrechen = document.createElement("button");
  abbrechen.className = "btn-abbrechen";
  abbrechen.textContent = "Abbrechen";
  abbrechen.addEventListener("click", () => renderNotizBereich(wrap, m));

  leiste.appendChild(speichern);
  leiste.appendChild(abbrechen);
  wrap.appendChild(leiste);
  ta.focus();
}
