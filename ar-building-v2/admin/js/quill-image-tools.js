// quill-image-tools.js – Bild-Werkzeuge für die Quill-Editoren im Admin.
//
// Funktionen pro ausgewähltem Bild:
//  - Größe: Eck-Griff ziehen → Breite in % der Editorbreite (responsive).
//  - Ausrichtung: links / mitte / rechts → Klasse img-left/img-center/img-right.
//  - Reihenfolge: ↑ / ↓ → Bild eine Zeile nach oben/unten verschieben.
//
// Breite landet als inline-style (width:NN%), Ausrichtung als Klasse direkt am
// <img>. Beides wird beim Speichern über quill.root.innerHTML mitgenommen.
// Ein registriertes ImageFormat führt style+class zusätzlich in Quills Modell
// nach, damit sie auch Reorder/Undo überleben.
//
// Vertrag mit der PWA: dieselben img-*-Klassen werden in
// frontend/css/main.css gestylt – Editor und Besucheransicht zeigen also
// dieselbe Ausrichtung. Klassisches <script> (kein Modul); braucht das globale
// Quill und exponiert window.ARQuillImageTools.

(function () {
  'use strict';

  if (typeof Quill === 'undefined') {
    console.warn('[image-tools] Quill nicht geladen – Bild-Werkzeuge inaktiv.');
    return;
  }

  var MAX_DIM = 1600; // Bilder beim Einfügen auf diese Kantenlänge herunterskalieren.

  // ── Custom ImageFormat: style/class/width am Bild in Quills Modell halten ──
  // Standardmäßig kennt Quill an Bildern keine Breite/Ausrichtung; ohne diese
  // Registrierung würden direkte DOM-Änderungen bei manchen Operationen
  // verworfen. Mit dem überschriebenen formats()/format() bleiben sie erhalten.
  (function registerImageFormat() {
    try {
      var BaseImage = Quill.import('formats/image');
      var TRACKED = ['alt', 'height', 'width', 'style', 'class'];

      class ARImage extends BaseImage {
        static formats(domNode) {
          return TRACKED.reduce(function (formats, attr) {
            if (domNode.hasAttribute(attr)) formats[attr] = domNode.getAttribute(attr);
            return formats;
          }, {});
        }
        format(name, value) {
          if (TRACKED.indexOf(name) > -1) {
            if (value) this.domNode.setAttribute(name, value);
            else this.domNode.removeAttribute(name);
          } else {
            super.format(name, value);
          }
        }
      }
      Quill.register(ARImage, true);
    } catch (e) {
      console.warn('[image-tools] ImageFormat-Registrierung fehlgeschlagen:', e);
    }
  })();

  // ── Editor-seitige Styles + Overlay-Optik einmalig injizieren ──
  (function injectStyles() {
    if (document.getElementById('ar-imgtools-style')) return;
    var s = document.createElement('style');
    s.id = 'ar-imgtools-style';
    s.textContent = [
      '.ql-editor img { max-width:100%; height:auto; cursor:pointer; }',
      '.ql-editor img.img-left   { float:left;  margin:0.25rem 1rem 0.5rem 0; }',
      '.ql-editor img.img-right  { float:right; margin:0.25rem 0 0.5rem 1rem; }',
      '.ql-editor img.img-center { display:block; float:none; margin:0.5rem auto; }',
      '.ql-editor::after { content:""; display:block; clear:both; }',
      '.ar-imgtools-bar { position:fixed; z-index:100000; display:none; gap:2px;',
      '  background:#1f2733; border-radius:6px; padding:3px; box-shadow:0 2px 8px rgba(0,0,0,.4); }',
      '.ar-imgtools-bar button { background:#2d3a4d; color:#fff; border:none; border-radius:4px;',
      '  font-size:12px; padding:4px 7px; cursor:pointer; line-height:1; }',
      '.ar-imgtools-bar button:hover { background:#3a4a63; }',
      '.ar-imgtools-bar .sep { width:1px; background:#44546b; margin:2px 1px; }',
      '.ar-imgtools-box { position:fixed; z-index:99999; display:none; pointer-events:none;',
      '  border:2px solid #1a73e8; border-radius:3px; }',
      '.ar-imgtools-handle { position:fixed; z-index:100000; display:none; width:14px; height:14px;',
      '  background:#1a73e8; border:2px solid #fff; border-radius:3px; cursor:nwse-resize;',
      '  box-shadow:0 1px 3px rgba(0,0,0,.4); }',
    ].join('\n');
    document.head.appendChild(s);
  })();

  // ── Zustand + Overlay-Singletons ──
  var currentQuill = null;
  var selectedImg = null;
  var bar = null, box = null, handle = null;

  function ensureOverlay() {
    if (bar) return;

    box = document.createElement('div');
    box.className = 'ar-imgtools-box';

    bar = document.createElement('div');
    bar.className = 'ar-imgtools-bar';
    bar.innerHTML =
      '<button type="button" data-act="left"   title="Links ausrichten">Links</button>' +
      '<button type="button" data-act="center" title="Zentrieren">Mitte</button>' +
      '<button type="button" data-act="right"  title="Rechts ausrichten">Rechts</button>' +
      '<span class="sep"></span>' +
      '<button type="button" data-act="up"   title="Eine Zeile nach oben">↑</button>' +
      '<button type="button" data-act="down" title="Eine Zeile nach unten">↓</button>';

    handle = document.createElement('div');
    handle.className = 'ar-imgtools-handle';
    handle.title = 'Größe ziehen';

    document.body.appendChild(box);
    document.body.appendChild(bar);
    document.body.appendChild(handle);

    bar.addEventListener('click', onBarClick);
    handle.addEventListener('pointerdown', onResizeStart);

    // Beim Scrollen (auch im Modal, daher capture) und Resizen neu ausrichten.
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);

    // Klick außerhalb von Bild/Overlay → Auswahl aufheben.
    document.addEventListener('mousedown', function (e) {
      if (!selectedImg) return;
      if (e.target === selectedImg) return;
      if (bar.contains(e.target) || handle.contains(e.target) || box.contains(e.target)) return;
      deselect();
    });
  }

  // ── Auswahl ──
  function select(img) {
    selectedImg = img;
    ensureOverlay();
    reposition();
  }

  function deselect() {
    selectedImg = null;
    hideOverlay();
  }

  function hideOverlay() {
    if (bar) bar.style.display = 'none';
    if (box) box.style.display = 'none';
    if (handle) handle.style.display = 'none';
  }

  function reposition() {
    if (!selectedImg || !selectedImg.isConnected) { deselect(); return; }
    var r = selectedImg.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) { hideOverlay(); return; }

    box.style.display = 'block';
    box.style.top = (r.top - 2) + 'px';
    box.style.left = (r.left - 2) + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';

    bar.style.display = 'flex';
    bar.style.left = r.left + 'px';
    bar.style.top = Math.max(4, r.top - bar.offsetHeight - 6) + 'px';

    handle.style.display = 'block';
    handle.style.top = (r.bottom - 7) + 'px';
    handle.style.left = (r.right - 7) + 'px';
  }

  // ── Toolbar-Aktionen (Ausrichtung + Reihenfolge) ──
  function onBarClick(e) {
    var act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
    if (!act || !selectedImg) return;
    if (act === 'left' || act === 'center' || act === 'right') setAlign(act);
    else if (act === 'up') reorder('up');
    else if (act === 'down') reorder('down');
  }

  function setAlign(which) {
    selectedImg.classList.remove('img-left', 'img-center', 'img-right');
    selectedImg.classList.add('img-' + which);
    reposition();
  }

  function reorder(dir) {
    if (!selectedImg || !currentQuill) return;
    var quill = currentQuill;
    var blot = Quill.find(selectedImg);
    if (!blot) return;
    var index = quill.getIndex(blot);
    var lineInfo = quill.getLine(index);
    var line = lineInfo && lineInfo[0];
    if (!line) return;

    var sibling = (dir === 'up') ? line.prev : line.next;
    if (!sibling) return; // schon am Rand

    var src = selectedImg.getAttribute('src');
    var style = selectedImg.getAttribute('style') || '';
    var cls = selectedImg.getAttribute('class') || '';

    var target = quill.getIndex(sibling);
    quill.deleteText(index, 1, 'user');
    // Indizes hinter der gelöschten Stelle rücken um 1 nach vorn.
    if (target > index) target -= 1;
    quill.insertEmbed(target, 'image', src, 'user');

    // Stil/Klasse am neu erzeugten <img> wiederherstellen.
    var leaf = quill.getLeaf(target);
    var newImg = leaf && leaf[0] && leaf[0].domNode;
    if (newImg && newImg.tagName === 'IMG') {
      if (style) newImg.setAttribute('style', style);
      if (cls) newImg.setAttribute('class', cls);
      select(newImg);
    } else {
      deselect();
    }
  }

  // ── Größe ziehen ──
  function onResizeStart(e) {
    if (!selectedImg) return;
    e.preventDefault();
    var startX = e.clientX;
    var startW = selectedImg.getBoundingClientRect().width;
    var editorW = (currentQuill && currentQuill.root.clientWidth) ||
                  selectedImg.parentElement.clientWidth || startW;

    function move(ev) {
      var newW = startW + (ev.clientX - startX);
      newW = Math.max(40, Math.min(newW, editorW));
      var pct = Math.round(newW / editorW * 100);
      selectedImg.style.width = pct + '%';
      selectedImg.style.height = 'auto';
      reposition();
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ── Bild einfügen (mit Downscale, base64) ──
  function pickAndInsert(quill) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        downscale(reader.result, MAX_DIM, function (dataUrl) {
          var range = quill.getSelection(true) || { index: quill.getLength() };
          quill.insertEmbed(range.index, 'image', dataUrl, 'user');
          quill.setSelection(range.index + 1, 0, 'silent');
        });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  function downscale(dataUrl, maxDim, cb) {
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth, h = img.naturalHeight;
      if (Math.max(w, h) <= maxDim) { cb(dataUrl); return; } // klein genug
      var scale = maxDim / Math.max(w, h);
      var cw = Math.round(w * scale), ch = Math.round(h * scale);
      var canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
      cb(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = function () { cb(dataUrl); };
    img.src = dataUrl;
  }

  // ── Öffentliche API: pro Quill-Instanz aktivieren ──
  function attach(quill) {
    if (!quill || !quill.root) return;

    // Image-Button-Handler überschreiben (Downscale statt Default-base64).
    try {
      var toolbar = quill.getModule('toolbar');
      if (toolbar) toolbar.addHandler('image', function () { pickAndInsert(quill); });
    } catch (e) { /* Toolbar ohne image-Button – ignorieren */ }

    quill.root.addEventListener('click', function (e) {
      if (e.target && e.target.tagName === 'IMG' && quill.root.contains(e.target)) {
        currentQuill = quill;
        select(e.target);
      } else {
        deselect();
      }
    });
  }

  window.ARQuillImageTools = { attach: attach };
})();
