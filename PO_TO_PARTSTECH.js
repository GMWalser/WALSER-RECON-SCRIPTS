// ==UserScript==
// @name         PO Part to PartsTech
// @namespace    reconclipboard
// @version      1.3
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/PO_TO_PARTSTECH.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/PO_TO_PARTSTECH.js
// @description  LEFT-click a part in the Tekion PO "Parts List" to copy its part number. RIGHT-click the PartsTech search box to paste it and search.
// @match        https://app.tekioncloud.com/*
// @match        https://app.partstech.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

const LOG = '[PO->PartsTech]';
function log(...a) { console.log(LOG, ...a); }

const KEY = 'pop_part';   // dedicated GM key (shared Tekion <-> PartsTech inside this one script)

// A copied PO part is only "armed" for a short time and only for ONE paste, so the
// PartsTech right-click behaves normally the rest of the time.
const MAX_AGE_MS = 3 * 60 * 1000;

// Any normal copy (Ctrl+C / right-click Copy) on Tekion or PartsTech disarms it too.
document.addEventListener('copy', () => { GM_setValue(KEY, 'null'); }, true);

// =====================================================================
// TEKION SIDE: left-click the part name in the PO Parts List
// =====================================================================
function initTekion() {
  let toast = null, toastTimer = null;

  function showToast(text, x, y) {
    if (!toast) {
      toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;z-index:2147483647;background:#16a34a;color:#fff;font:700 12px Segoe UI,sans-serif;'
        + 'padding:5px 10px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.5);pointer-events:none;';
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.style.left = Math.min(x + 12, window.innerWidth - 220) + 'px';
    toast.style.top = Math.max(4, y - 30) + 'px';
    toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 1400);
  }

  // "19431551 - WIRE SET-SPARK PLUG" -> "19431551"; "12742701 (S) - INJECTOR KIT" -> "12742701"
  function partNumberFrom(text) {
    let t = (text || '').replace(/\s+/g, ' ').trim();
    const i = t.indexOf(' - ');
    if (i > 0) t = t.slice(0, i);
    return t.replace(/\s*\(S\)\s*$/i, '').trim();
  }

  // Any click inside the Parts List table: if it is the FIRST cell of its row, copy that row's part number.
  // (No dependence on row ids, so it works for every row, however many there are.)
  document.addEventListener('click', e => {
    const table = e.target.closest('#po-table');
    if (!table) return;
    if (e.target.closest('input, button, textarea, select, a')) return;   // never hijack real controls
    const cell = e.target.closest('[role="cell"]');
    if (!cell || !cell.parentElement) { log('Click inside the Parts List but not on a cell.'); return; }
    if (cell.parentElement.querySelector('[role="cell"]') !== cell) return; // only the Part column

    const pn = partNumberFrom(cell.textContent);
    if (!pn) { log('Clicked the Part column but could not read a part number from:', JSON.stringify(cell.textContent)); return; }

    GM_setValue(KEY, JSON.stringify({ part: pn, ts: Date.now() }));
    try { navigator.clipboard.writeText(pn); } catch (err) {}
    log('Copied part number:', pn, '| row id:', cell.parentElement.id || '(none)');
    showToast('Copied ' + pn, e.clientX, e.clientY);

    const prev = cell.style.outline;
    cell.style.outline = '2px solid #3b9bff';
    setTimeout(() => { cell.style.outline = prev; }, 700);
  }, true);

  // Blue part numbers. Uses the browser's text-highlight feature, so Tekion's own
  // page content is never modified (re-built every moment as rows appear/re-render).
  const st = document.createElement('style');
  st.textContent = '::highlight(po-pn){color:#3b9bff;text-decoration:underline;}'
    + '#po-table [role="cell"]:first-child{cursor:pointer;}';
  document.head.appendChild(st);

  function paintPartNumbers() {
    if (!window.CSS || !CSS.highlights || typeof Highlight === 'undefined') return;
    const table = document.getElementById('po-table');
    if (!table) { CSS.highlights.delete('po-pn'); return; }
    const ranges = [];
    table.querySelectorAll('[role="row"]').forEach(row => {
      const cell = row.querySelector('[role="cell"]');
      if (!cell) return;
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode();
      if (!node || !node.nodeValue.trim()) return;
      const pn = partNumberFrom(node.nodeValue);
      const start = node.nodeValue.indexOf(pn);
      if (!pn || start < 0) return;
      const r = new Range();
      r.setStart(node, start); r.setEnd(node, start + pn.length);
      ranges.push(r);
    });
    CSS.highlights.set('po-pn', new Highlight(...ranges));
  }
  setInterval(paintPartNumbers, 700);
  new MutationObserver(paintPartNumbers).observe(document.body, { childList: true, subtree: true });
}

// =====================================================================
// PARTSTECH SIDE: right-click the search box -> paste + search
// =====================================================================
function initPartsTech() {
  function setNative(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    input.focus();
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  document.addEventListener('contextmenu', e => {
    const input = e.target.closest('input[name="search"]');
    if (!input || !input.closest('[data-testid="searchBar"]')) return;

    let data = null;
    try { data = JSON.parse(GM_getValue(KEY, 'null')); } catch (err) {}
    if (!data || !data.part || (Date.now() - data.ts) > MAX_AGE_MS) return; // nothing armed -> normal right-click menu

    e.preventDefault(); e.stopPropagation();
    GM_setValue(KEY, 'null');   // one paste per copy
    setNative(input, data.part);
    log('Pasted', data.part, 'into PartsTech search (disarmed until you click another PO part)');

    // v1.3: the old version clicked Search a fixed 150ms after pasting. When PartsTech was a
    // little slow to register the pasted text, the search ran on an empty/old term and found
    // nothing (a second Enter then worked). Now: wait until the box really holds the part
    // number, give PartsTech a moment to settle, then search -- and log what it saw.
    const want = data.part;
    let tries = 0;
    (function waitThenSearch() {
      const current = document.querySelector('[data-testid="searchBar"] input[name="search"]') || input;
      if (current.value !== want && tries < 10) {
        tries++;
        setNative(current, want);               // re-apply if PartsTech wiped it
        return setTimeout(waitThenSearch, 100);
      }
      setTimeout(() => {
        const box = document.querySelector('[data-testid="searchBar"] input[name="search"]') || input;
        const btn = document.querySelector('[data-testid="searchBar"] button.search-button');
        log('Searching now -- box holds:', JSON.stringify(box.value), '| expected:', JSON.stringify(want),
          '| search button:', btn ? (btn.disabled ? 'DISABLED' : 'ready') : 'not found', '| waited', tries * 100 + 350, 'ms');
        if (btn) btn.click();
        else {
          log('Search button not found -- pressing Enter instead.');
          box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        }
      }, 350);
    })();
  }, true);
}

if (location.hostname.indexOf('partstech') !== -1) initPartsTech();
else initTekion();

log('v1.3 loaded on', location.hostname);
})();