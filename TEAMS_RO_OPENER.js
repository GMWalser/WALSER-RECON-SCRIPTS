// ==UserScript==
// @name         Teams RO Opener
// @namespace    reconclipboard
// @version      1.5
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/TEAMS_RO_OPENER.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/TEAMS_RO_OPENER.js
// @description  Hover an RO number in Teams (last 4 digits or full 7) -> it highlights green; click it to open in RV, finds it with RV search, and clicks "Open in Tekion". In the "New Filter Room" channel it also ticks the 3 Filter Lookups in the RV Pre-Loader and clicks Open PartsTech.
// @match        https://teams.cloud.microsoft/*
// @match        https://teams.microsoft.com/*
// @match        https://app.reconvision.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

const LOG = '[Teams RO Opener]';
function log(...a) { console.log(LOG, ...a); }

// RO numbers are 7 digits (example 7329179). Techs often type only the last 4.
// A typed "last 4" is turned into the 7-digit RO closest to the newest RO we
// know about (so 0012 right after 7329979 becomes 7330012, not 7320012).
// The newest known RO updates itself from RV pages and successful searches.
const DEFAULT_CURRENT_RO = 7329179;
const CURRENT_KEY = 'tro_current_ro';   // dedicated GM key

function getCurrentRo() {
  const v = parseInt(GM_getValue(CURRENT_KEY, DEFAULT_CURRENT_RO), 10);
  return v >= DEFAULT_CURRENT_RO ? v : DEFAULT_CURRENT_RO;
}
function noteRo(n) {
  n = parseInt(n, 10);
  if (n >= 1000000 && n <= 9999999 && n > getCurrentRo()) {
    GM_setValue(CURRENT_KEY, n);
    log('Newest known RO is now', n);
  }
}
function fullFromLast4(last4) {
  const cur = getCurrentRo();
  const base = Math.floor(cur / 10000) * 10000;
  const l = parseInt(last4, 10);
  let best = null;
  [base - 10000, base, base + 10000].forEach(b => {
    const c = b + l;
    if (best === null || Math.abs(c - cur) < Math.abs(best - cur)) best = c;
  });
  return String(best);
}

const REQ_KEY = 'tro_request';          // dedicated GM key: { ro, stage, ts }
const MAX_AGE_MS = 2 * 60 * 1000;       // ignore stale requests

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

// Confirmed from DOM: the channel name is <h2 data-tid="channelTitle-text">
const FILTER_ROOM = 'New Filter Room';
function inFilterRoom() {
  const h = document.querySelector('h2[data-tid="channelTitle-text"]');
  return !!h && h.textContent.trim() === FILTER_ROOM;
}

// =====================================================================
// TEAMS SIDE: select a number -> floating button
// =====================================================================
function initTeams() {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;display:none;'
    + 'background:rgba(34,197,94,.35);outline:2px solid #16a34a;border-radius:3px;';
  document.body.appendChild(box);

  let hot = null; // { ro, rect }

  // 4 digits = last 4 of an RO; exactly 7 digits = full RO
  function classify(t) {
    if (/^\d{4}$/.test(t)) return { last4: t };
    if (/^\d{7}$/.test(t)) return { full: t };
    return null;
  }

  function caretAt(x, y) {
    if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (!p) return null;
      const r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); return r;
    }
    return null;
  }

  function findHot(x, y) {
    const r = caretAt(x, y);
    if (!r || r.startContainer.nodeType !== 3) return null;
    const node = r.startContainer;
    const parent = node.parentElement;
    if (!parent || parent.closest('[contenteditable="true"], input, textarea')) return null; // never touch the compose box
    const text = node.nodeValue;
    let i = r.startOffset;
    // the caret can sit on either side of a digit -- step onto a digit if needed
    if (!/\d/.test(text[i] || '') && /\d/.test(text[i - 1] || '')) i--;
    if (!/\d/.test(text[i] || '')) return null;
    let s0 = i, e0 = i;
    while (s0 > 0 && /\d/.test(text[s0 - 1])) s0--;
    while (e0 < text.length && /\d/.test(text[e0])) e0++;
    const kind = classify(text.slice(s0, e0));
    if (!kind) return null;
    const rr = document.createRange();
    rr.setStart(node, s0); rr.setEnd(node, e0);
    const rect = rr.getBoundingClientRect();
    // caret snaps to the nearest text, so make sure the mouse is really over the digits
    if (x < rect.left - 1 || x > rect.right + 1 || y < rect.top - 1 || y > rect.bottom + 1) return null;
    return { kind, rect };
  }

  let pending = false;
  document.addEventListener('mousemove', e => {
    if (pending) return;
    pending = true;
    const x = e.clientX, y = e.clientY;
    requestAnimationFrame(() => {
      pending = false;
      hot = findHot(x, y);
      if (hot) {
        box.style.display = 'block';
        box.style.left = hot.rect.left - 2 + 'px';
        box.style.top = hot.rect.top - 1 + 'px';
        box.style.width = hot.rect.width + 4 + 'px';
        box.style.height = hot.rect.height + 2 + 'px';
        document.body.style.cursor = 'pointer';
      } else {
        box.style.display = 'none';
        document.body.style.cursor = '';
      }
    });
  }, true);

  document.addEventListener('click', e => {
    if (!hot) return;
    const h = findHot(e.clientX, e.clientY);
    if (!h) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    GM_setValue(REQ_KEY, JSON.stringify({ last4: h.kind.last4 || null, full: h.kind.full || null, filters: inFilterRoom(), stage: 'search', ts: Date.now() }));
    log('Requested RO', h.kind.full || ('last4 ' + h.kind.last4), '| filter room:', inFilterRoom(), '-> opening RV');
    GM_openInTab('https://app.reconvision.com/', { active: true });
  }, true);
}

// =====================================================================
// RV SIDE: run the search, open the single result, click Open in Tekion
// =====================================================================
function readRequest() {
  try {
    const r = JSON.parse(GM_getValue(REQ_KEY, 'null'));
    if (!r || !(r.ro || r.full || r.last4) || (Date.now() - r.ts) > MAX_AGE_MS) return null;
    return r;
  } catch (e) { return null; }
}

function setNative(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function snapshotRows() {
  return [...document.querySelectorAll('#searchresultsmodal tr[data-test^="work-order-"]')].map(r => r.getAttribute('data-test')).join('|');
}

// Returns the rows (as a NodeList) if the search produced results, else null.
async function searchOnce(input, ro) {
  const before = snapshotRows();
  input.focus();
  setNative(input, ro);
  log('Searching RV for', ro);
  const goBtn = document.getElementById('go-search');
  if (goBtn) goBtn.click();
  else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  return waitFor(() => {
    const r = document.querySelectorAll('#searchresultsmodal tr[data-test^="work-order-"]');
    return (r.length && snapshotRows() !== before) ? r : null;
  }, 3500);
}

async function doSearch(req) {
  const input = await waitFor(() => document.getElementById('search_target'), 10000);
  if (!input) { log('Search box (#search_target) not found.'); return; }

  // mark progress first so a reload/second instance doesn't repeat it
  GM_setValue(REQ_KEY, JSON.stringify({ stage: 'searching', filters: !!req.filters, ts: req.ts }));

  // Full RO -> use as typed. Last 4 -> closest RO to the newest one we know.
  const full = req.full || req.ro;
  const candidates = [full || fullFromLast4(req.last4)];

  let rows = null, hitRo = null;
  for (const ro of candidates) {
    rows = await searchOnce(input, ro);
    if (rows) { hitRo = ro; break; }
    log('No result for', ro);
  }

  if (!rows) {
    log('No search results for', candidates.join(' / '), '-- RV search may not match this number. Request cancelled.');
    GM_deleteValue(REQ_KEY);
    return;
  }
  if (rows.length > 1) {
    log(rows.length, 'results for', hitRo, '-- not guessing which one; pick it yourself. Request cancelled.');
    GM_deleteValue(REQ_KEY);
    return;
  }
  noteRo(hitRo); // a real RO exists with this number

  const link = rows[0].querySelector('a[href*="/work_orders/"]');
  if (!link) { log('Result row had no work order link.'); GM_deleteValue(REQ_KEY); return; }
  log('One result for', hitRo, '-> opening', link.getAttribute('href'));
  GM_setValue(REQ_KEY, JSON.stringify({ ro: hitRo, stage: 'tekion', filters: !!req.filters, ts: req.ts }));
  window.location.href = link.href;
}

async function doTekion(req) {
  // consume the request first so it can only ever fire once
  GM_deleteValue(REQ_KEY);
  if (req.filters) {
    // The Pre-Loader panel builds these 3 boxes (Air / Engine Oil / Cabin Air). Its Open PartsTech
    // button reads .checked, so setting it is all that's needed.
    const boxes = await waitFor(() => { const b = document.querySelectorAll('.rv-filter-cb'); return b.length >= 3 ? b : null; }, 15000);
    if (boxes) {
      boxes.forEach(b => { b.checked = true; });
      // filter room = filters only, so untick the job-line boxes the Pre-Loader ticked on its own
      document.querySelectorAll('#rv-pt-lines .rv-cb, #rv-manual-rows .rv-cb').forEach(c => { c.checked = false; });
      log('Ticked', boxes.length, 'filter lookup boxes (job lines unticked).');
      const openPT = await waitFor(() => { const o = document.getElementById('rv-pt-btn'); return (o && !o.disabled) ? o : null; }, 5000);
      if (openPT) { openPT.click(); log('Clicked Open PartsTech.'); await new Promise(r => setTimeout(r, 800)); }
      else log('Open PartsTech button (#rv-pt-btn) not found -- filters ticked only.');
    } else log('Filter Lookup boxes (.rv-filter-cb) never appeared -- filters not ticked.');
  }
  const tekionBtn = await waitFor(() => document.getElementById('rv-tekion-btn'), 15000);
  if (!tekionBtn) { log('"Open in Tekion" button (#rv-tekion-btn) never appeared.'); return; }
  log('Clicking Open in Tekion for RO', req.ro);
  tekionBtn.click();
}

function learnFromPage() {
  waitFor(() => document.getElementById('rv-tekion-btn'), 15000).then(b => {
    if (!b) return;
    const m = (b.getAttribute('title') || '').match(/RO#\s*(\d{7})/);
    if (m) noteRo(m[1]);
  });
}

function initRV() {
  if (/\/work_orders\/\d+\/edit/.test(location.pathname)) learnFromPage();
  const req = readRequest();
  if (!req) return;
  if (req.stage === 'search') doSearch(req);
  else if (req.stage === 'tekion' && /\/work_orders\/\d+\/edit/.test(location.pathname)) doTekion(req);
}

// ---------------------------------------------------------------------
if (location.hostname.indexOf('teams.') === 0) initTeams();
else initRV();

log('v1.5 loaded on', location.hostname);
})();