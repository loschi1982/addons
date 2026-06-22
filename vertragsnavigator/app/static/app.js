"use strict";

/* Vertragsnavigator – Frontend (Vanilla JS).
   Drei Spalten: Vertragsbaum, Dokumentenansicht (markierbar), Themenübersicht. */

const API = (window.__VN__ && window.__VN__.apiBase) || "";

//: Breite der rechten Marginalspalte für Verweis-/Notiz-Annotationen (px).
const VERWEIS_GUTTER = 250;

//: Einheitliche Notizfarbe (Indigo) für Rahmen/Linien.
const NOTIZ_FARBE = "rgba(59, 91, 219, 0.9)";

const state = {
  themen: [],
  alleDocs: [],
  aktuellesDok: null,
  paperlessUrl: "",
  externalUrl: "", // vom Browser erreichbare Paperless-URL (Detailansicht-Link)
  linkSource: null, // Markierungs-ID im Verknüpfungsmodus
  verweisSource: null, // { dokument_id, seite, text } im Verweis-Modus (Quelle = Nachtrag)
  docModus: "pdf", // "pdf" (gerendertes PDF, markierbar) | "text" (reiner OCR-Text)
  pdfZoom: 1, // Zoom-Faktor relativ zur eingepassten Breite (1 = Breite einpassen)
  pdfDocId: null, // aktuell im PDF-Renderer angezeigtes Dokument
  pdfDokument: null, // geladenes PDF.js-Dokument (Cache: kein Reload beim Zoom)
  pdfSeiten: [], // [{ n, textDivs }] je gerenderter Seite (für Hervorhebungen)
  uebersicht: [], // zuletzt geladene Themen-Gruppen (für Liste + Overlay)
  overlayOffen: false,
  offenesThemaId: undefined, // thema_id des im Overlay gezeigten Themas (null = "Ohne Thema")
  gruppierung: "alle", // "alle" | "keine" | <Tag-Name>
  zugeklappt: new Set(), // eingeklappte Objekt-Gruppen
  dragId: null, // Dokument-ID im Drag-Vorgang
  such: { hits: [], index: -1 }, // In-PDF-Suchtreffer (Navigator)
};

// --- API-Helfer -----------------------------------------------------------

async function api(method, pfad, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    opt.headers["Content-Type"] = "application/json";
    opt.body = JSON.stringify(body);
  }
  const res = await fetch(API + pfad, opt);
  if (res.status === 401 && pfad !== "/api/login") {
    zeigeLogin(); // Session fehlt/abgelaufen -> Login einblenden
  }
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
  // Immer aktive Bindings (auch vor dem Login)
  document.addEventListener("click", verbergeCtxMenu);
  // Such-Panel/Optionen schließen bei Klick außerhalb
  document.addEventListener("click", (ev) => {
    if (!ev.target.closest("#such-panel") && !ev.target.closest("#such-form") && !ev.target.closest("#such-erweitert")) {
      document.getElementById("such-panel").hidden = true;
      document.getElementById("such-erweitert").hidden = true;
    }
  });
  document.getElementById("login-form").addEventListener("submit", aufLogin);
  document.getElementById("abmelden").addEventListener("click", aufLogout);

  let status = { erforderlich: false, angemeldet: true };
  try {
    status = await api("GET", "/api/auth/status");
  } catch (e) { /* Status sollte immer gehen */ }

  if (status.erforderlich && !status.angemeldet) {
    zeigeLogin();
    return; // App erst nach erfolgreichem Login starten
  }
  if (status.erforderlich) document.getElementById("abmelden").hidden = false;
  await starteApp();
}

// --- Login / Logout -------------------------------------------------------

function zeigeLogin() {
  document.getElementById("login-overlay").hidden = false;
  const u = document.getElementById("login-user");
  if (u) u.focus();
}

async function aufLogin(ev) {
  ev.preventDefault();
  const user = document.getElementById("login-user").value.trim();
  const pass = document.getElementById("login-pass").value;
  const fehler = document.getElementById("login-fehler");
  fehler.hidden = true;
  try {
    await api("POST", "/api/login", { username: user, password: pass });
    document.getElementById("login-overlay").hidden = true;
    document.getElementById("login-pass").value = "";
    document.getElementById("abmelden").hidden = false;
    await starteApp();
  } catch (e) {
    fehler.textContent = e.message || "Anmeldung fehlgeschlagen";
    fehler.hidden = false;
  }
}

async function aufLogout() {
  try {
    await api("POST", "/api/logout");
  } catch (e) { /* egal */ }
  location.reload();
}

// Startet die eigentliche App (nach bestandener Anmeldung).
async function starteApp() {
  try {
    const cfg = await api("GET", "/api/config");
    state.paperlessUrl = cfg.paperless_url || "";
    state.externalUrl = cfg.paperless_external_url || "";
    if (!cfg.konfiguriert) {
      setStatus("Paperless nicht konfiguriert – bitte Add-on-Optionen prüfen.", true);
    }
  } catch (e) { /* /api/config sollte hier gehen */ }

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

  // Suche
  document.getElementById("such-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    fuehreSucheAus();
  });
  document.getElementById("such-erweitert-btn").addEventListener("click", (ev) => {
    ev.stopPropagation();
    const p = document.getElementById("such-erweitert");
    p.hidden = !p.hidden;
  });
  document.getElementById("treffer-prev").addEventListener("click", () => geheZuTreffer(state.such.index - 1));
  document.getElementById("treffer-next").addEventListener("click", () => geheZuTreffer(state.such.index + 1));
  document.getElementById("treffer-zu").addEventListener("click", beendeSuche);

  // Zoom für die PDF-Ansicht
  document.getElementById("btn-zoom-in").addEventListener("click", () => zoomAendern(0.2));
  document.getElementById("btn-zoom-out").addEventListener("click", () => zoomAendern(-0.2));
  updateZoomAnzeige();

  // Themen-Overlay schließen (X, Klick auf Backdrop, ESC)
  document.getElementById("overlay-close").addEventListener("click", schliesseOverlay);
  document.getElementById("thema-umbenennen").addEventListener("click", themaUmbenennen);
  document.getElementById("thema-loeschen").addEventListener("click", themaLoeschen);
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
    fuelleGruppierung(docs);
    fuelleSuchTag(docs);
    rendereBaum(docs);
  } catch (e) {
    setStatus("Dokumente konnten nicht geladen werden: " + e.message, true);
    document.getElementById("baum").innerHTML = '<p class="hinweis">' + escapeHtml(e.message) + "</p>";
  }
}

// Füllt das "Objekt"-Auswahlfeld: Alle Objekte / je Tag / keine Gruppierung.
function fuelleGruppierung(docs) {
  const sel = document.getElementById("gruppierung");
  const tags = Array.from(new Set(docs.flatMap((d) => d.tags || []))).sort((a, b) => a.localeCompare(b));

  let aktuell = state.gruppierung || "alle";
  if (aktuell !== "alle" && aktuell !== "keine" && !tags.includes(aktuell)) {
    aktuell = "alle"; // gewählter Tag existiert nicht mehr
    state.gruppierung = "alle";
  }

  sel.innerHTML = "";
  const opt = (val, label) => {
    const o = document.createElement("option");
    o.value = val;
    o.textContent = label;
    if (val === aktuell) o.selected = true;
    sel.appendChild(o);
  };
  opt("alle", "Alle Objekte");
  for (const t of tags) opt(t, t);
  opt("keine", "keine Gruppierung");

  sel.onchange = () => {
    state.gruppierung = sel.value;
    rendereBaum(state.alleDocs);
  };
}

// --- Suche ----------------------------------------------------------------

function kuerzen2(s, n) {
  s = s || "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// Paperless-Highlight-Snippet sicher rendern (nur <span class="match"> -> <mark>).
function snippetHtml(s) {
  return escapeHtml(s || "")
    .replace(/&lt;span class=&quot;match&quot;&gt;/g, "<mark>")
    .replace(/&lt;\/span&gt;/g, "</mark>");
}

function fuelleSuchTag(docs) {
  const sel = document.getElementById("such-tag");
  if (!sel) return;
  const tags = Array.from(new Set(docs.flatMap((d) => d.tags || []))).sort((a, b) => a.localeCompare(b));
  const aktuell = sel.value;
  sel.innerHTML = '<option value="">— alle —</option>';
  for (const t of tags) {
    const o = document.createElement("option");
    o.value = t;
    o.textContent = t;
    sel.appendChild(o);
  }
  if (aktuell) sel.value = aktuell;
}

async function fuehreSucheAus() {
  const q = document.getElementById("such-feld").value.trim();
  const panel = document.getElementById("such-panel");
  if (!q) {
    panel.hidden = true;
    return;
  }
  const modus = (document.querySelector('input[name="such-modus"]:checked') || {}).value || "stichwort";
  const tag = document.getElementById("such-tag").value || "";
  const ctx = { woerter: q.split(/\s+/).filter(Boolean), modus: modus, phrase: q };

  document.getElementById("such-erweitert").hidden = true;
  panel.hidden = false;
  panel.innerHTML = '<p class="hinweis">Suche …</p>';
  try {
    const body = await api(
      "GET",
      "/api/suche?q=" + encodeURIComponent(q) + "&modus=" + modus + "&tag=" + encodeURIComponent(tag)
    );
    rendereSuchErgebnisse(body, ctx);
  } catch (e) {
    panel.innerHTML = '<p class="hinweis">Fehler: ' + escapeHtml(e.message) + "</p>";
  }
}

function rendereSuchErgebnisse(body, ctx) {
  const panel = document.getElementById("such-panel");
  panel.innerHTML = "";
  const dok = body.dokumente || [];
  const lokal = body.lokal || [];
  if (!dok.length && !lokal.length) {
    panel.innerHTML = '<p class="hinweis">Keine Treffer.</p>';
    return;
  }

  if (dok.length) {
    const h = document.createElement("div");
    h.className = "such-gruppe-titel";
    h.textContent = "Dokumente (" + dok.length + ")";
    panel.appendChild(h);
    for (const d of dok) {
      const item = document.createElement("div");
      item.className = "such-item";
      item.innerHTML =
        '<div class="such-titel">📄 ' + escapeHtml(d.title) + "</div>" +
        (d.snippet ? '<div class="such-snippet">' + snippetHtml(d.snippet) + "</div>" : "");
      item.addEventListener("click", () => waehleDokumentTreffer(d.id, ctx));
      panel.appendChild(item);
    }
  }

  if (lokal.length) {
    const h = document.createElement("div");
    h.className = "such-gruppe-titel";
    h.textContent = "Markierungen & Themen (" + lokal.length + ")";
    panel.appendChild(h);
    for (const t of lokal) {
      const item = document.createElement("div");
      item.className = "such-item";
      if (t.typ === "thema") {
        item.innerHTML = '<div class="such-titel">🏷 Thema: ' + escapeHtml(t.name) + "</div>";
      } else {
        const quelle =
          escapeHtml(t.dokument_titel) + " · S. " + t.seite + (t.thema_name ? " · " + escapeHtml(t.thema_name) : "");
        item.innerHTML =
          '<div class="such-titel">✏ ' + quelle + "</div>" +
          '<div class="such-snippet">' + escapeHtml(kuerzen2(t.textauszug || t.notiz || "", 140)) + "</div>";
      }
      item.addEventListener("click", () => waehleLokalTreffer(t));
      panel.appendChild(item);
    }
  }
}

function schliesseSuchPanel() {
  document.getElementById("such-panel").hidden = true;
}

// Wartet, bis das PDF des Dokuments gerendert ist (Treffer brauchen die Textebene).
function warteAufPdf(id) {
  return new Promise((res) => {
    let n = 0;
    const tick = () => {
      if (state.pdfDocId === id && state.pdfSeiten.length) return res();
      if (n++ > 150) return res();
      setTimeout(tick, 100);
    };
    tick();
  });
}

// Alle Vorkommen der Suchwörter auf einer Seite (sortiert nach Position).
function findeTrefferAufSeite(textDivs, needles) {
  let compact = "";
  const charDiv = [];
  for (const div of textDivs) {
    for (const ch of div.textContent || "") {
      if (/\s/.test(ch)) continue;
      compact += ch.toLowerCase();
      charDiv.push(div);
    }
  }
  const treffer = [];
  for (const w of needles) {
    const n = (w || "").replace(/\s+/g, "").toLowerCase();
    if (n.length < 2) continue;
    let from = 0;
    let idx;
    while ((idx = compact.indexOf(n, from)) >= 0) {
      const divs = new Set();
      for (let i = idx; i < idx + n.length && i < charDiv.length; i++) divs.add(charDiv[i]);
      treffer.push({ pos: idx, divs: Array.from(divs) });
      from = idx + n.length;
    }
  }
  treffer.sort((a, b) => a.pos - b.pos);
  return treffer;
}

async function waehleDokumentTreffer(id, ctx) {
  schliesseSuchPanel();
  state.docModus = "pdf";
  await oeffneDokument(id); // setzt Suche zurück
  await warteAufPdf(id);
  const needles = ctx.modus === "phrase" ? [ctx.phrase] : ctx.woerter;
  const hits = [];
  for (const seite of state.pdfSeiten) {
    for (const tr of findeTrefferAufSeite(seite.textDivs, needles)) {
      hits.push({ seite: seite.n, divs: tr.divs });
    }
  }
  state.such.hits = hits;
  state.such.index = -1;
  hits.forEach((h) => h.divs.forEach((d) => d.classList.add("such-treffer")));
  zeigeTrefferNav();
  if (hits.length) geheZuTreffer(0);
  else aktualisiereTrefferAnzeige();
}

async function waehleLokalTreffer(t) {
  schliesseSuchPanel();
  if (t.typ === "thema") {
    oeffneThemaOverlay(t.thema_id);
    return;
  }
  state.docModus = "pdf";
  await oeffneDokument(t.dokument_id);
  await warteAufPdf(t.dokument_id);
  scrolleZu(t.seite, t.markierung_id);
}

function geheZuTreffer(i) {
  const hits = state.such.hits;
  if (!hits.length) return;
  if (state.such.index >= 0 && hits[state.such.index]) {
    hits[state.such.index].divs.forEach((d) => d.classList.remove("such-aktiv"));
  }
  state.such.index = ((i % hits.length) + hits.length) % hits.length;
  const h = hits[state.such.index];
  h.divs.forEach((d) => d.classList.add("such-aktiv"));
  if (h.divs[0]) h.divs[0].scrollIntoView({ behavior: "smooth", block: "center" });
  aktualisiereTrefferAnzeige();
}

function aktualisiereTrefferAnzeige() {
  const n = state.such.hits.length;
  document.getElementById("treffer-anzeige").textContent = "Treffer " + (n ? state.such.index + 1 : 0) + "/" + n;
}

function zeigeTrefferNav() {
  document.getElementById("treffer-nav").hidden = false;
  aktualisiereTrefferAnzeige();
}

function loescheSuchTreffer() {
  for (const seite of state.pdfSeiten) {
    for (const d of seite.textDivs) d.classList.remove("such-treffer", "such-aktiv");
  }
  state.such = { hits: [], index: -1 };
}

function beendeSuche() {
  loescheSuchTreffer();
  document.getElementById("treffer-nav").hidden = true;
}

function rendereBaum(docs) {
  const container = document.getElementById("baum");
  container.innerHTML = "";
  if (!docs || docs.length === 0) {
    container.innerHTML = '<p class="hinweis">Keine Dokumente in Paperless gefunden.</p>';
    return;
  }

  const modus = state.gruppierung || "alle";

  if (modus === "keine") {
    rendereGruppeInhalt(container, docs);
    macheDropZiel(container, null); // freie Fläche -> Hauptvertrag
    return;
  }

  let gruppen;
  if (modus === "alle") {
    const tags = Array.from(new Set(docs.flatMap((d) => d.tags || []))).sort((a, b) => a.localeCompare(b));
    gruppen = tags.map((t) => ({ name: t, docs: docs.filter((d) => (d.tags || []).includes(t)) }));
    const ohne = docs.filter((d) => !(d.tags || []).length);
    if (ohne.length) gruppen.push({ name: "Ohne Objekt", docs: ohne });
  } else {
    gruppen = [{ name: modus, docs: docs.filter((d) => (d.tags || []).includes(modus)) }];
  }

  for (const g of gruppen) {
    const zu = state.zugeklappt.has(g.name);

    const kopf = document.createElement("div");
    kopf.className = "objekt-kopf";
    kopf.innerHTML =
      '<span class="pfeil">' + (zu ? "▸" : "▾") + "</span>" +
      '<span class="objekt-name">' + escapeHtml(g.name) + "</span>" +
      '<span class="badge">' + g.docs.length + "</span>";
    kopf.addEventListener("click", () => {
      if (zu) state.zugeklappt.delete(g.name);
      else state.zugeklappt.add(g.name);
      rendereBaum(state.alleDocs);
    });
    macheDropZiel(kopf, null); // Drop auf Objekt-Kopf -> Hauptvertrag (kein Elternteil)
    container.appendChild(kopf);

    if (!zu) {
      const body = document.createElement("div");
      body.className = "objekt-body";
      rendereGruppeInhalt(body, g.docs);
      container.appendChild(body);
    }
  }
}

// Baut innerhalb einer Gruppe die Hauptvertrag/Nachtrag-Hierarchie auf.
function rendereGruppeInhalt(container, docsInGruppe) {
  const ids = new Set(docsInGruppe.map((d) => d.id));
  const kinder = new Map();
  const wurzeln = [];
  for (const d of docsInGruppe) {
    if (d.eltern_id != null && ids.has(d.eltern_id)) {
      if (!kinder.has(d.eltern_id)) kinder.set(d.eltern_id, []);
      kinder.get(d.eltern_id).push(d);
    } else {
      wurzeln.push(d);
    }
  }
  const renderKnoten = (d, tiefe) => {
    container.appendChild(erstelleKnoten(d, tiefe));
    (kinder.get(d.id) || []).sort((a, b) => a.titel.localeCompare(b.titel)).forEach((k) => renderKnoten(k, tiefe + 1));
  };
  wurzeln.sort((a, b) => a.titel.localeCompare(b.titel)).forEach((w) => renderKnoten(w, 0));
}

function erstelleKnoten(d, tiefe) {
  const div = document.createElement("div");
  div.className = "knoten" + (tiefe > 0 ? " kind" : "");
  div.dataset.id = d.id;
  div.draggable = true;
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
  div.addEventListener("dragstart", (ev) => {
    ev.stopPropagation();
    state.dragId = d.id;
    ev.dataTransfer.effectAllowed = "move";
    try {
      ev.dataTransfer.setData("text/plain", String(d.id));
    } catch (e) { /* manche Browser */ }
  });

  macheDropZiel(div, d.id); // Drop hierauf -> wird Nachtrag dieses Dokuments
  return div;
}

// Macht ein Element zum Drop-Ziel; setzt beim Drop den Hauptvertrag des
// gezogenen Dokuments (zielElternId = Dokument-ID oder null für "Hauptvertrag").
function macheDropZiel(el, zielElternId) {
  el.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    ev.dataTransfer.dropEffect = "move";
    el.classList.add("drop-ziel");
  });
  el.addEventListener("dragleave", () => el.classList.remove("drop-ziel"));
  el.addEventListener("drop", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    el.classList.remove("drop-ziel");
    const id = state.dragId;
    state.dragId = null;
    if (id == null) return;
    if (zielElternId != null && id === zielElternId) return; // auf sich selbst
    try {
      await api("POST", "/api/docs/" + id + "/parent", { eltern_id: zielElternId });
      await ladeBaum();
    } catch (e) {
      alert("Fehler: " + e.message);
    }
  });
}

function markiereAktivenBaum(id) {
  document.querySelectorAll("#baum .knoten").forEach((k) => {
    k.classList.toggle("aktiv", parseInt(k.dataset.id, 10) === id);
  });
}

// --- Dokumentenansicht ----------------------------------------------------

async function oeffneDokument(id) {
  setStatus("Lade Dokument …");
  beendeSuche(); // Suchtreffer/Navigator des vorherigen Dokuments zurücksetzen
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

async function zoomAendern(delta) {
  const neu = Math.min(3, Math.max(0.4, Math.round((state.pdfZoom + delta) * 10) / 10));
  if (neu === state.pdfZoom) return;
  state.pdfZoom = neu;
  updateZoomAnzeige();
  if (state.docModus !== "pdf" || !state.aktuellesDok) return;

  // Sichtbares Zentrum als Anteil merken, um die Ansicht nach dem Neuzeichnen
  // zu erhalten (sonst springt das PDF an den Anfang).
  const frame = document.getElementById("doc-ansicht");
  const vMitte = frame.scrollHeight ? (frame.scrollTop + frame.clientHeight / 2) / frame.scrollHeight : 0;
  const hMitte = frame.scrollWidth ? (frame.scrollLeft + frame.clientWidth / 2) / frame.scrollWidth : 0;

  if (state.pdfDokument && state.pdfDocId === state.aktuellesDok.id) {
    await zeichneSeiten(); // nur neu zeichnen (kein erneuter Download)
  } else {
    await renderePdf(state.aktuellesDok);
  }

  frame.scrollTop = Math.max(0, vMitte * frame.scrollHeight - frame.clientHeight / 2);
  frame.scrollLeft = Math.max(0, hMitte * frame.scrollWidth - frame.clientWidth / 2);
}

// Rendert das PDF (bei neuem Dokument) oder aktualisiert nur die Hervorhebungen.
function aktualisierePdf() {
  if (state.docModus !== "pdf" || !state.aktuellesDok) return;
  if (state.pdfDocId === state.aktuellesDok.id) {
    refreshPdfMarken();
  } else {
    renderePdf(state.aktuellesDok);
  }
}

let pdfRenderToken = 0;

// Lädt das PDF-Dokument (einmal) und zeichnet es anschließend.
async function renderePdf(dok) {
  const ziel = document.getElementById("pdf-render");
  state.pdfDocId = null;
  state.pdfDokument = null;
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
    state.pdfDokument = pdf;
    state.pdfDocId = dok.id;
    await zeichneSeiten();
  } catch (e) {
    ziel.innerHTML =
      '<p class="hinweis">PDF konnte nicht geladen werden: ' + escapeHtml(e.message) + "</p>";
    state.pdfDocId = null;
    state.pdfDokument = null;
  }
}

// Zeichnet alle Seiten des geladenen PDFs im aktuellen Zoom (ohne Neu-Download).
async function zeichneSeiten() {
  const pdf = state.pdfDokument;
  const ziel = document.getElementById("pdf-render");
  if (!pdf) return;

  const token = ++pdfRenderToken;
  ziel.innerHTML = "";
  state.pdfSeiten = [];

  // Rechter Rand (Marginalspalte) für Verweis-/Notiz-Annotationen – nur wenn das
  // Dokument Verweise oder Notizen hat, sonst volle Breite fürs PDF.
  const dok = state.aktuellesDok;
  const hatRand = !!dok && (((dok.verweise || []).length > 0) || (dok.markierungen || []).some((m) => m.notiz));
  const gutter = hatRand ? VERWEIS_GUTTER : 0;
  const breite = Math.max(120, (ziel.clientWidth || 800) - gutter - 8);

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    if (token !== pdfRenderToken) return; // zwischenzeitlich neu gezeichnet/gewechselt

    const basis = page.getViewport({ scale: 1 });
    const scale = Math.max(0.1, (breite / basis.width) * state.pdfZoom);
    const viewport = page.getViewport({ scale });

    const seiteDiv = document.createElement("div");
    seiteDiv.className = "pdf-seite";
    seiteDiv.dataset.seite = n;
    seiteDiv.style.width = viewport.width + gutter + "px"; // Seite + Marginalspalte
    seiteDiv.style.height = viewport.height + "px";

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    seiteDiv.appendChild(canvas);

    const textLayerDiv = document.createElement("div");
    textLayerDiv.className = "textLayer";
    // Textebene exakt über dem Canvas (nicht über der Marginalspalte).
    textLayerDiv.style.width = viewport.width + "px";
    textLayerDiv.style.height = viewport.height + "px";
    // pdf.js 3.x positioniert/skaliert die Text-Spans über diese CSS-Variable.
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

    state.pdfSeiten.push({
      n: n,
      textDivs: textDivs,
      seiteDiv: seiteDiv,
      pageWidth: viewport.width,
    });
  }

  refreshPdfMarken();
}

// Findet die Spans, die einen (whitespace-toleranten) Textauszug abdecken.
function findeSpansFuerText(textDivs, text) {
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
  const needle = (text || "").replace(/\s+/g, "").toLowerCase();
  if (!needle) return [];
  const idx = compact.indexOf(needle);
  if (idx < 0) return [];
  const divs = new Set();
  for (let i = idx; i < idx + needle.length && i < charDiv.length; i++) divs.add(charDiv[i]);
  return Array.from(divs);
}

// Rendert pro Seite die Themen-Markierungen (gelb) und die Verweis-Redlines neu.
function refreshPdfMarken() {
  const marks = (state.aktuellesDok && state.aktuellesDok.markierungen) || [];
  const verweise = (state.aktuellesDok && state.aktuellesDok.verweise) || [];
  for (const seite of state.pdfSeiten) {
    // Zurücksetzen
    for (const d of seite.textDivs) {
      d.classList.remove("markiert", "verweis-strich", "verweis-quelle", "verweis-ziel", "notiz-markiert");
      delete d.dataset.markId;
    }
    if (seite.seiteDiv) seite.seiteDiv.querySelectorAll(".verweis-annot, .verweis-linien").forEach((e) => e.remove());

    const seitenMarks = marks.filter((x) => x.seite === seite.n);

    // Themen-Markierungen (gelb) + Notiz-Rahmen
    for (const m of seitenMarks) {
      const divs = findeSpansFuerText(seite.textDivs, m.textauszug);
      divs.forEach((d) => {
        d.classList.add("markiert");
        d.dataset.markId = m.id;
        if (m.notiz) d.classList.add("notiz-markiert");
      });
    }

    // Rand-Annotationen sammeln (Verweise + Notizen) und gestapelt platzieren
    const eintraege = [];
    for (const v of verweise.filter((x) => x.eigene_seite === seite.n)) {
      const spans = findeSpansFuerText(seite.textDivs, v.eigene_text);
      const istZiel = v.rolle === "ziel";
      if (istZiel && (v.art === "gestrichen" || v.art === "geändert")) spans.forEach((s) => s.classList.add("verweis-strich"));
      else if (istZiel) spans.forEach((s) => s.classList.add("verweis-ziel"));
      else spans.forEach((s) => s.classList.add("verweis-quelle"));
      const b = _spanBox(spans);
      eintraege.push({ ankerTop: b.top, sx: b.right, sy: b.mid, gefunden: spans.length > 0, farbe: "art-" + artKey(v.art), karte: () => baueVerweisKarte(v, spans.length > 0) });
    }
    for (const m of seitenMarks) {
      if (!m.notiz) continue;
      const spans = findeSpansFuerText(seite.textDivs, m.textauszug);
      const b = _spanBox(spans);
      eintraege.push({ ankerTop: b.top, sx: b.right, sy: b.mid, gefunden: spans.length > 0, farbe: "notiz", karte: () => baueNotizKarte(m) });
    }

    if (eintraege.length) platziereRand(seite, eintraege);
  }
}

function artKey(art) {
  return { "geändert": "geaendert", "ergänzt": "ergaenzt", "erweitert": "erweitert", "gestrichen": "gestrichen" }[art] || "ergaenzt";
}

// Beschriftung der Annotation, abhängig von Rolle/Art.
function verweisLabel(v) {
  const ziel = v.andere_dokument_titel + " · S. " + v.andere_seite;
  if (v.rolle === "quelle") {
    return "↪ " + escapeHtml(v.art) + " in " + escapeHtml(ziel);
  }
  if (v.art === "gestrichen") return "✗ gestrichen (Nachtrag: " + escapeHtml(ziel) + ")";
  if (v.art === "geändert") return "✎ geändert → " + escapeHtml(v.andere_text);
  if (v.art === "ergänzt") return "＋ ergänzt: " + escapeHtml(v.andere_text);
  if (v.art === "erweitert") return "＋ erweitert: " + escapeHtml(v.andere_text);
  return escapeHtml(v.art);
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Bounding-Box mehrerer Spans (für Ankerpunkt der Verbindungslinie).
function _spanBox(spans) {
  if (!spans.length) return { top: 0, right: 0, mid: 0 };
  let top = Infinity, bottom = 0, right = 0;
  spans.forEach((s) => {
    top = Math.min(top, s.offsetTop);
    bottom = Math.max(bottom, s.offsetTop + s.offsetHeight);
    right = Math.max(right, s.offsetLeft + s.offsetWidth);
  });
  return { top: top, right: right, mid: (top + bottom) / 2 };
}

// Notiz-Karte (Post-It) für die Marginalspalte – nicht klickbar.
function baueNotizKarte(m) {
  const card = document.createElement("div");
  card.className = "verweis-annot notiz";
  card.innerHTML = '<span class="vtext">📝 ' + escapeHtml(m.notiz) + "</span>";
  return card;
}

// Platziert Rand-Annotationen (Verweise + Notizen) gestapelt in der rechten
// Marginalspalte und verbindet jede mit einer blassen Linie zur Stelle.
function platziereRand(seite, eintraege) {
  eintraege.sort((a, b) => a.ankerTop - b.ankerTop);

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "verweis-linien");
  svg.style.width = seite.seiteDiv.style.width;
  svg.style.height = seite.seiteDiv.style.height;
  seite.seiteDiv.appendChild(svg);

  const left = seite.pageWidth + 8;
  let prevBottom = -Infinity;
  for (const e of eintraege) {
    const card = e.karte();
    card.style.left = left + "px";
    card.style.width = VERWEIS_GUTTER - 16 + "px";
    const top = Math.max(e.ankerTop, prevBottom + 6);
    card.style.top = top + "px";
    seite.seiteDiv.appendChild(card);
    prevBottom = top + card.offsetHeight;

    if (e.gefunden) {
      const cy = top + card.offsetHeight / 2;
      const poly = document.createElementNS(SVG_NS, "polyline");
      poly.setAttribute("points", e.sx + "," + e.sy + " " + seite.pageWidth + "," + e.sy + " " + left + "," + cy);
      poly.setAttribute("class", "vlinie " + e.farbe);
      poly.setAttribute("fill", "none");
      svg.appendChild(poly);
    }
  }
}

function baueVerweisKarte(v, gefunden) {
  const card = document.createElement("div");
  card.className = "verweis-annot art-" + artKey(v.art) + (gefunden ? "" : " ohne-anker");
  card.innerHTML =
    '<span class="vtext">' + verweisLabel(v) + "</span>" +
    '<button class="vdel" title="Verweis löschen">✕</button>';
  card.title = "Zum Gegenstück springen (" + v.andere_dokument_titel + " · S. " + v.andere_seite + ")";
  card.addEventListener("click", (ev) => {
    if (ev.target.closest(".vdel")) {
      ev.stopPropagation();
      loescheVerweis(v.id);
      return;
    }
    springeZuSeite(v.andere_dokument_id, v.andere_seite);
  });
  return card;
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

  // Verweise (gerichtete Änderungen zwischen PDFs) – nur sinnvoll im PDF,
  // da dort die Seitenzahl exakt bekannt ist.
  if (kontext.seite != null) {
    trenner();
    if (state.verweisSource) {
      ueberschrift("Verweis abschließen als");
      for (const art of ["ergänzt", "erweitert", "geändert", "gestrichen"]) {
        add(art, "verweis-item", () => abschliesseVerweis(kontext, art));
      }
    } else {
      add("↪ Verweis von hier starten", null, () => starteVerweis(kontext));
    }
  }

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

// --- Verweise zwischen PDFs (gerichtete Änderungen) -----------------------

function starteVerweis(kontext) {
  state.verweisSource = {
    dokument_id: state.aktuellesDok.id,
    seite: kontext.seite,
    text: kontext.text,
  };
  zeigeBanner(
    "Verweis gestartet (Quelle im Nachtrag). Öffne den Originalvertrag, markiere die Stelle und wähle „Verweis abschließen“.",
    () => {
      state.verweisSource = null;
      verbergeBanner();
    }
  );
}

async function abschliesseVerweis(kontext, art) {
  const q = state.verweisSource;
  if (!q || !state.aktuellesDok) return;
  try {
    await api("POST", "/api/verweise", {
      quelle_dokument_id: q.dokument_id,
      quelle_seite: q.seite,
      quelle_text: q.text,
      ziel_dokument_id: state.aktuellesDok.id,
      ziel_seite: kontext.seite,
      ziel_text: kontext.text,
      art: art,
    });
    state.verweisSource = null;
    verbergeBanner();
    setStatus("Verweis (" + art + ") erstellt.");
    await oeffneDokument(state.aktuellesDok.id); // Redline neu rendern
  } catch (e) {
    setStatus("Fehler beim Verweis: " + e.message, true);
    alert("Fehler: " + e.message);
  }
}

async function loescheVerweis(id) {
  if (!confirm("Verweis löschen?")) return;
  try {
    await api("DELETE", "/api/verweise/" + id);
    if (state.aktuellesDok) await oeffneDokument(state.aktuellesDok.id);
  } catch (e) {
    alert("Fehler: " + e.message);
  }
}

// Öffnet ein Dokument in der PDF-Ansicht und scrollt zur Seite (Gegenstück).
async function springeZuSeite(dokId, seite) {
  state.docModus = "pdf";
  if (state.aktuellesDok && state.aktuellesDok.id === dokId) {
    scrolleZu(seite, null);
  } else {
    await oeffneDokument(dokId);
    scrolleZu(seite, null);
  }
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

async function themaUmbenennen() {
  if (state.offenesThemaId == null) return;
  const g = findeGruppe(state.offenesThemaId);
  const name = prompt("Thema umbenennen:", g ? g.name : "");
  if (!name || !name.trim()) return;
  try {
    await api("PATCH", "/api/themen/" + state.offenesThemaId, { name: name.trim() });
    await ladeThemen();
    await ladeUebersicht(); // aktualisiert Liste + offenes Overlay (neuer Name)
  } catch (e) {
    alert("Fehler: " + e.message);
  }
}

async function themaLoeschen() {
  if (state.offenesThemaId == null) return;
  const g = findeGruppe(state.offenesThemaId);
  const anzahl = g ? g.markierungen.length : 0;
  const msg =
    anzahl > 0
      ? 'Thema löschen? Die ' + anzahl + ' Markierung(en) bleiben erhalten und werden "Ohne Thema" zugeordnet.'
      : "Thema löschen?";
  if (!confirm(msg)) return;
  try {
    await api("DELETE", "/api/themen/" + state.offenesThemaId);
    schliesseOverlay();
    await ladeThemen();
    await ladeUebersicht();
    await ladeBaum();
  } catch (e) {
    alert("Fehler: " + e.message);
  }
}

// Themen-Zusammenfassung: alle Markierungen des Themas, sichtbar getrennt.
function rendereOverlay() {
  const g = findeGruppe(state.offenesThemaId);
  const body = document.getElementById("overlay-body");
  document.getElementById("overlay-titel").textContent = g ? g.name : "Thema";

  // Umbenennen/Löschen nur für echte Themen (nicht für "Ohne Thema").
  const istEcht = !!g && g.thema_id != null;
  document.getElementById("thema-umbenennen").hidden = !istEcht;
  document.getElementById("thema-loeschen").hidden = !istEcht;

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

  // PDF-Ausschnitt (formatiert, mit Hervorhebung) asynchron nachladen
  rendereAusschnitt(karte, m);

  return karte;
}

// --- PDF-Ausschnitte für die Themen-Zusammenfassung -----------------------

const _ausschnittDocs = {}; // docId -> Promise<pdfDocument|null>
const _ausschnittSeiten = {}; // "docId:seite" -> Promise<{canvas, items}|null>
const _dokMeta = {}; // docId -> Promise<doc-detail|null> (für Verweise im Ausschnitt)

function _ladeDokMeta(docId) {
  if (!_dokMeta[docId]) _dokMeta[docId] = api("GET", "/api/docs/" + docId).catch(() => null);
  return _dokMeta[docId];
}

function _ladeAusschnittDok(docId) {
  if (!_ausschnittDocs[docId]) {
    _ausschnittDocs[docId] = window.pdfjsLib
      ? pdfjsLib.getDocument({ url: API + "/api/pdf/" + docId, withCredentials: true }).promise.catch(() => null)
      : Promise.resolve(null);
  }
  return _ausschnittDocs[docId];
}

function _ladeAusschnittSeite(docId, seite) {
  const key = docId + ":" + seite;
  if (!_ausschnittSeiten[key]) {
    _ausschnittSeiten[key] = (async () => {
      const pdf = await _ladeAusschnittDok(docId);
      if (!pdf || seite < 1 || seite > pdf.numPages) return null;
      const page = await pdf.getPage(seite);
      const scale = 2; // für scharfe Ausschnitte
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

      // Textebene offscreen rendern und Span-Positionen messen (wie im Viewer
      // -> exakte Boxen). Anschließend DOM wieder entfernen.
      const tc = await page.getTextContent();
      const halter = document.createElement("div");
      halter.style.cssText = "position:fixed;left:-100000px;top:0;";
      const tl = document.createElement("div");
      tl.className = "textLayer";
      tl.style.width = viewport.width + "px";
      tl.style.height = viewport.height + "px";
      tl.style.setProperty("--scale-factor", String(scale));
      halter.appendChild(tl);
      document.body.appendChild(halter);
      const textDivs = [];
      try {
        await pdfjsLib.renderTextLayer({
          textContentSource: tc,
          container: tl,
          viewport: viewport,
          textDivs: textDivs,
        }).promise;
      } catch (e) { /* ignorieren */ }
      const items = textDivs.map((d) => ({
        str: d.textContent || "",
        x: d.offsetLeft,
        y: d.offsetTop,
        w: d.offsetWidth,
        h: d.offsetHeight,
      }));
      document.body.removeChild(halter);

      return { canvas: canvas, items: items };
    })().catch(() => null);
  }
  return _ausschnittSeiten[key];
}

// Findet die Text-Items, die den Auszug (whitespace-tolerant) abdecken. Wird der
// vollständige Auszug nicht gefunden (z. B. Seitenumbruch), wird der längste auf
// der Seite vorhandene Präfix verwendet.
function _findeItemBoxen(items, text) {
  let compact = "";
  const charItem = [];
  for (const it of items) {
    for (const ch of it.str) {
      if (/\s/.test(ch)) continue;
      compact += ch.toLowerCase();
      charItem.push(it);
    }
  }
  const needle = (text || "").replace(/\s+/g, "").toLowerCase();
  if (!needle) return [];

  let bestIdx = compact.indexOf(needle);
  let bestLen = needle.length;
  if (bestIdx < 0) {
    // längsten vorkommenden Präfix per Binärsuche bestimmen
    bestLen = 0;
    let lo = 1, hi = needle.length;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const p = compact.indexOf(needle.slice(0, mid));
      if (p >= 0) {
        bestLen = mid;
        bestIdx = p;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
  }
  if (bestIdx < 0 || bestLen < 3) return [];

  const set = new Set();
  for (let i = bestIdx; i < bestIdx + bestLen && i < charItem.length; i++) set.add(charItem[i]);
  return Array.from(set);
}

// Zeichnet eine horizontale Linie über eine Box (Anteil = vertikale Position).
function _linie(ctx, bx, l, t, anteil) {
  const yy = bx.y - t + bx.h * anteil;
  ctx.beginPath();
  ctx.moveTo(bx.x - l, yy);
  ctx.lineTo(bx.x + bx.w - l, yy);
  ctx.stroke();
}

async function rendereAusschnitt(karte, m) {
  const wrap = document.createElement("div");
  wrap.className = "ausschnitt";
  wrap.innerHTML = '<span class="ausschnitt-laden">PDF-Ausschnitt wird erstellt …</span>';
  karte.insertBefore(wrap, karte.firstChild);

  try {
    const seite = await _ladeAusschnittSeite(m.dokument_id, m.seite);
    if (!seite) {
      wrap.remove();
      return;
    }
    const boxen = _findeItemBoxen(seite.items, m.textauszug);
    if (!boxen.length) {
      wrap.remove(); // Stelle nicht gefunden -> Text bleibt sichtbar
      return;
    }

    let l = Infinity, t = Infinity, r = 0, b = 0;
    boxen.forEach((bx) => {
      l = Math.min(l, bx.x);
      t = Math.min(t, bx.y);
      r = Math.max(r, bx.x + bx.w);
      b = Math.max(b, bx.y + bx.h);
    });
    const pad = 8;
    l = Math.max(0, l - pad);
    t = Math.max(0, t - pad);
    r = Math.min(seite.canvas.width, r + pad);
    b = Math.min(seite.canvas.height, b + pad);
    const w = r - l, h = b - t;
    if (w <= 0 || h <= 0) {
      wrap.remove();
      return;
    }

    const clip = document.createElement("canvas");
    clip.width = w;
    clip.height = h;
    const ctx = clip.getContext("2d");
    ctx.drawImage(seite.canvas, l, t, w, h, 0, 0, w, h);
    ctx.fillStyle = "rgba(255, 213, 0, 0.4)"; // Hervorhebung wie im PDF
    boxen.forEach((bx) => ctx.fillRect(bx.x - l, bx.y - t, bx.w, bx.h));

    // Verweis-Annotationen (Redlines) des Dokuments in den Ausschnitt zeichnen
    try {
      const meta = await _ladeDokMeta(m.dokument_id);
      const verweise = (meta && meta.verweise) || [];
      for (const v of verweise) {
        if (v.eigene_seite !== m.seite) continue;
        const vboxen = _findeItemBoxen(seite.items, v.eigene_text);
        if (!vboxen.length) continue;
        const istZiel = v.rolle === "ziel";
        ctx.lineWidth = 2;
        if (istZiel && (v.art === "gestrichen" || v.art === "geändert")) {
          ctx.strokeStyle = "rgba(200, 0, 0, 0.85)"; // Durchstreichung
          vboxen.forEach((bx) => _linie(ctx, bx, l, t, 0.55));
        } else {
          ctx.strokeStyle = istZiel ? "rgba(20, 120, 60, 0.85)" : "rgba(27, 94, 123, 0.85)"; // Unterstrich
          vboxen.forEach((bx) => _linie(ctx, bx, l, t, 0.92));
        }
      }
    } catch (e) { /* Verweise optional */ }

    // Notiz vorhanden -> farbiger Rahmen um den Ausschnitt
    if (m.notiz) {
      ctx.strokeStyle = NOTIZ_FARBE;
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
    }

    const img = document.createElement("img");
    img.className = "ausschnitt-bild";
    img.alt = m.textauszug;
    img.title = m.textauszug;
    img.src = clip.toDataURL("image/png");
    wrap.innerHTML = "";
    wrap.appendChild(img);

    // Unformatierten Text ausblenden, wenn der Ausschnitt vorhanden ist
    const aus = karte.querySelector(".auszug");
    if (aus) aus.hidden = true;
  } catch (e) {
    wrap.remove();
  }
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
      delete _dokMeta[m.dokument_id]; // Dokument-Cache (für Ausschnitt-Verweise) leeren
      await ladeUebersicht(); // Overlay + Liste neu aufbauen
      // Falls das Dokument gerade offen ist: PDF-Ansicht neu zeichnen (Notiz-Rand)
      if (state.aktuellesDok && state.aktuellesDok.id === m.dokument_id) {
        state.pdfDocId = null; // erzwingt Neuzeichnen inkl. Gutter-Berechnung
        await oeffneDokument(m.dokument_id);
      }
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
