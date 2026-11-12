// ==UserScript==
// @name         Picked Up Filter Order
// @namespace    reconclipboard
// @version      1.3
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/PICKED_UP_FILTER_ORDER.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/PICKED_UP_FILTER_ORDER.js
// @description  Picked Up bucket: every NON-European car gets a Filters button (opens the RO in RV, ticks the filter lookups, opens PartsTech, opens Tekion) and a check button that adds the note FILTERS ORDERED. Euro cars are skipped (they use Euro Filter Order).
// @match        https://app.reconvision.com/departments/28149*
// @match        https://app.reconvision.com/work_orders/*/edit*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

const LOG = '[PU Filter Order]';
function log(...a) { console.log(LOG, ...a); }

// Must match EURO_MAKES in EURO_FILTER_ORDER.js so a car gets one button or the other.
const EURO_MAKES = ['audi', 'bmw', 'mercedes', 'porsche', 'land rover', 'jaguar', 'volkswagen', 'mini', 'volvo', 'genesis'];
const HASH_KEY = '#pu_filters=1';
const MARK = 'data-pu-filters';

function isEuropean(text) {
  const t = (text || '').toLowerCase();
  return EURO_MAKES.some(m => t.includes(m));
}

function waitFor(fn, timeoutMs) {
  return new Promise(resolve => {
    const start = Date.now();
    (function tick() {
      const v = fn();
      if (v) return resolve(v);
      if (Date.now() - start > timeoutMs) return resolve(null);
      setTimeout(tick, 150);
    })();
  });
}

// =====================================================================
// BUCKET SIDE
// =====================================================================
function setTextarea(t, v) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(t, v);
  t.dispatchEvent(new Event('input', { bubbles: true }));
}

// Same confirmed method as Euro Filter Order v1.4: click the row's own notes button,
// wait until the shared #notesmodal shows THIS work order, type the note, save.
// Red = note already added. Remembered in this browser so it survives refreshes.
const DONE_KEY = 'pu_filters_done';
function doneList() { try { return JSON.parse(localStorage.getItem(DONE_KEY) || '[]'); } catch (e) { return []; } }
function rememberDone(woId) {
  try { const l = doneList(); if (!l.includes(String(woId))) { l.push(String(woId)); localStorage.setItem(DONE_KEY, JSON.stringify(l.slice(-500))); } } catch (e) {}
}
// v1.2: the state is shown in WORDS too (a one-color theme like Wasteland Terminal turned red and teal both green),
// and the button's id starts with "wr-theme-" so Page Themes never repaints it.
function paintDone(btn) { btn.style.background = '#dc2626'; btn.style.width = 'auto'; btn.style.padding = '0 8px'; btn.textContent = '\u2713 NOTED'; btn.title = 'FILTERS ORDERED note added'; }
function paintBusy(btn) { btn.style.background = '#a16207'; btn.style.width = 'auto'; btn.style.padding = '0 8px'; btn.textContent = 'SAVING\u2026'; }
function paintFail(btn, why) { btn.style.background = '#7c2d12'; btn.style.width = 'auto'; btn.style.padding = '0 8px'; btn.textContent = '\u26a0 RETRY'; btn.title = 'Note NOT saved: ' + why + ' - click to try again'; }

async function markFiltersOrdered(notesBtn, woId, btn) {
  if (btn) paintBusy(btn);
  notesBtn.click();
  const ok = await waitFor(() => {
    const modal = document.getElementById('notesmodal');
    const idField = document.getElementById('comment_commentable_id');
    if (!modal || !idField) return null;
    const visible = modal.style.display === 'block' || modal.classList.contains('in');
    return (visible && idField.value === String(woId)) ? true : null;
  }, 4000);
  if (!ok) { log('Notes modal never opened (or loaded the wrong WO) for WO', woId); if (btn) paintFail(btn, 'notes window did not open'); return; }
  const ta = document.getElementById('comment_comment');
  const save = document.getElementById('save-note');
  if (!ta || !save) { log('Notes textarea/save button not found for WO', woId); if (btn) paintFail(btn, 'notes box not found'); return; }
  setTextarea(ta, 'FILTERS ORDERED');
  save.click();
  log('Marked FILTERS ORDERED for WO', woId);
  rememberDone(woId);
  if (btn) paintDone(btn);
}

function addOrderedButton(link, woId) {
  const notesBtn = link.querySelector('.info-bar__notes-button');
  if (!notesBtn) return;
  const box = notesBtn.parentElement;
  if (!box || box.querySelector('.pu-ordered-btn')) return;
  const b = document.createElement('div');
  b.className = 'info-bar__button pu-ordered-btn';
  b.id = 'wr-theme-pu-ordered-' + woId;          // Page Themes leaves ids starting "wr-theme" alone
  b.title = 'Add note: FILTERS ORDERED';
  b.textContent = '✓';
  b.style.cssText = 'display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;margin-right:4px;background:#0f766e;color:#fff;font-weight:700;font-size:14px;cursor:pointer;white-space:nowrap;font-family:"Segoe UI",sans-serif;';
  b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); markFiltersOrdered(notesBtn, woId, b); });
  if (doneList().includes(String(woId))) paintDone(b);
  box.insertBefore(b, notesBtn);
}

function bucketScan() {
  document.querySelectorAll('a.work-order-link').forEach(link => {
    if (link.hasAttribute(MARK)) return;
    const makeEl = link.querySelector('.info-bar__item--make');
    const ymm = makeEl ? makeEl.innerText.trim() : '';
    if (!ymm) return;                          // not rendered yet -- next scan
    if (isEuropean(ymm)) { link.setAttribute(MARK, 'euro'); return; }
    const m = (link.getAttribute('href') || '').match(/\/work_orders\/(\d+)/);
    const stock = link.querySelector('.info-bar__item--stock');
    if (!m || !stock) return;
    link.setAttribute(MARK, '1');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'wr-theme-pu-filters-' + m[1];        // keeps its colors under any theme
    btn.textContent = '🔧 Filters';
    btn.title = 'Open RO in RV + Tekion and look up filters in PartsTech';
    btn.style.cssText = 'display:inline-block;margin-top:4px;padding:3px 9px;background:#0f766e;color:#ccfbf1;border:1px solid #14b8a6;border-radius:10px;font-size:11px;font-weight:700;cursor:pointer;font-family:"Segoe UI",sans-serif;white-space:nowrap;';
    btn.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      log('Filters button -> opening WO', m[1], ymm);
      window.open('https://app.reconvision.com/work_orders/' + m[1] + '/edit' + HASH_KEY, '_blank');
    });
    if (!stock.classList.contains('rv-fs-stacked')) {
      stock.style.display = 'flex';
      stock.style.flexDirection = 'column';
      stock.style.alignItems = 'flex-start';
    }
    stock.appendChild(btn);
    addOrderedButton(link, m[1]);
  });
}

function initBucket() {
  bucketScan();
  setInterval(bucketScan, 10000);
}

// =====================================================================
// WORK ORDER EDIT PAGE: only runs when opened by the Filters button (hash).
// Same steps as Teams RO Opener's filter flow.
// =====================================================================
function banner(msg) {
  const b = document.createElement('div');
  b.id = 'wr-theme-pu-banner';                       // Page Themes leaves ids starting "wr-theme" alone
  b.textContent = '\u26a0 ' + msg + '  (click to close)';
  b.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483646;background:#7c2d12;color:#fff;border:2px solid #fb923c;border-radius:8px;padding:10px 16px;font:700 14px "Segoe UI",sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.5);cursor:pointer;max-width:80vw';
  b.addEventListener('click', () => b.remove());
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 20000);
}
async function doFilters() {
  history.replaceState(null, '', location.pathname + location.search);   // run once, clean the URL
  const boxes = await waitFor(() => { const b = document.querySelectorAll('.rv-filter-cb'); return b.length >= 3 ? b : null; }, 15000);
  if (boxes) {
    boxes.forEach(b => { b.checked = true; });
    document.querySelectorAll('#rv-pt-lines .rv-cb, #rv-manual-rows .rv-cb').forEach(c => { c.checked = false; });
    log('Ticked', boxes.length, 'filter lookup boxes (job lines unticked).');
    const openPT = await waitFor(() => { const o = document.getElementById('rv-pt-btn'); return (o && !o.disabled) ? o : null; }, 5000);
    if (openPT) { openPT.click(); log('Clicked Open PartsTech.'); await new Promise(r => setTimeout(r, 800)); }
    else log('Open PartsTech button (#rv-pt-btn) not found -- filters ticked only.');
  } else log('Filter Lookup boxes (.rv-filter-cb) never appeared -- filters not ticked.');
  const tekionBtn = await waitFor(() => document.getElementById('rv-tekion-btn'), 15000);
  if (!tekionBtn) { log('"Open in Tekion" button (#rv-tekion-btn) never appeared.'); banner('Tekion NOT opened: the Open in Tekion button never appeared on this work order.'); return; }
  if (tekionBtn.dataset.noRo) {                     // v1.3: no RO number in RV yet -- say so instead of silently stopping
    log('No RO# in RV yet for this vehicle -- Tekion not opened.');
    banner('Tekion NOT opened: this vehicle has no RO# in RV yet. Filters were ticked and PartsTech opened.');
    return;
  }
  log('Clicking Open in Tekion.');
  tekionBtn.click();
}

if (/^\/departments\/28149/.test(location.pathname)) initBucket();
else if (/\/work_orders\/\d+\/edit/.test(location.pathname) && location.hash === HASH_KEY) doFilters();

log('v1.3 loaded');
})();