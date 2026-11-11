// ==UserScript==
// @name         Filter Quick Add
// @namespace    reconclipboard
// @version      1.8
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/FILTER_QUICKADD.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/FILTER_QUICKADD.js
// @description  PartsTech: hover a part card + press Enter -> adds it to the open Tekion RO (Oil & Filter Change job, else RECON FEES). Oil filters also get the right drain plug gasket for the make (Lexus = Toyota, Infiniti = Nissan).
// @match        https://app.partstech.com/*
// @match        https://app.tekioncloud.com/parts/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

const LOG = '[FilterAdd]';
function log(...a) { console.log(LOG, ...a); }

const REQ_KEY = 'fqa_request';     // dedicated GM keys (shared PartsTech <-> Tekion inside this one script)
const CLAIM_KEY = 'fqa_claim';
const MAX_AGE_MS = 30 * 1000;

// Drain plug gasket by make (numbers given by Gabe).
const GASKET_BY_MAKE = [
  { makes: ['SUBARU'], pn: '803916010' },
  { makes: ['TOYOTA', 'LEXUS'], pn: '90430-12031' },   // v1.8: Lexus uses the Toyota gasket
  { makes: ['NISSAN', 'INFINITI'], pn: '11026-01M02' },   // v1.8: Infiniti uses the Nissan gasket
  { makes: ['HONDA', 'ACURA', 'HYUNDAI', 'KIA', 'MAZDA', 'GENESIS'], pn: '94109-14000' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
function waitFor(fn, timeoutMs) {
  return new Promise(resolve => {
    const start = Date.now();
    (function tick() {
      const v = fn();
      if (v) return resolve(v);
      if (Date.now() - start > timeoutMs) return resolve(null);
      setTimeout(tick, 100);
    })();
  });
}

let toastEl = null, toastTimer = null;
function toast(text, bad) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;color:#fff;font:700 13px Segoe UI,sans-serif;'
      + 'padding:8px 14px;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.5);pointer-events:none;';
    document.body.appendChild(toastEl);
  }
  toastEl.style.background = bad ? '#b91c1c' : '#16a34a';
  toastEl.textContent = text;
  toastEl.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.style.display = 'none'; }, 3500);
}

// =====================================================================
// PARTSTECH SIDE: hover a result card, press Enter
// =====================================================================
function initPartsTech() {
  let hoverCard = null;
  document.addEventListener('mouseover', e => {
    const c = e.target.closest && e.target.closest('[data-testid="product"]');
    if (c) hoverCard = c;
  }, true);
  document.addEventListener('mouseout', e => {
    if (hoverCard && !hoverCard.contains(e.relatedTarget)) hoverCard = null;
  }, true);

  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
    if (!hoverCard || !hoverCard.isConnected) return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, button, a, [contenteditable="true"]')) return; // never hijack real typing/buttons

    // Part number span (same one the probability badge and right-click copy use)
    const span = hoverCard.querySelector('span.css-1og29io');
    const part = span ? span.textContent.trim() : '';
    if (!part) { log('Hovered a card but could not read a part number.'); toast('Could not read part number', true); return; }

    // First line of the card = its title, e.g. "Wix XP Engine Oil Filter"
    const title = (hoverCard.innerText || '').split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
    const oil = /oil filter/i.test(title) && !/gasket|adapter|housing|cap/i.test(title);

    e.preventDefault(); e.stopPropagation();
    GM_setValue(REQ_KEY, JSON.stringify({ part, oil, title, ts: Date.now(), id: String(Date.now()) }));
    log('Sent', part, '| title:', JSON.stringify(title), '| oil filter:', oil);
    toast('Sent ' + part + (oil ? ' (+ gasket)' : '') + ' to Tekion');
    const prev = hoverCard.style.outline;
    hoverCard.style.outline = '3px solid #16a34a';
    const card = hoverCard;
    setTimeout(() => { card.style.outline = prev; }, 800);
  }, true);
}

// =====================================================================
// TEKION SIDE: add the part(s) to the right job
// =====================================================================
const PART_INPUT_SEL = 'input[data-test-id$="partsTable-partSelect"]';
const FIRST_ITEM_SEL = '[data-test-id="@tekion-parts-downshift-autocomplete-first-item"]';

function setNative(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  input.focus();
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function realClick(el) {
  ['mousedown', 'mouseup', 'click'].forEach(type =>
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })));
}

// "Oil & Filter Change" job, else "RECON FEES". Job numbers change, so match by title.
function findSection() {
  const secs = [...document.querySelectorAll('[data-id^="Job"]')];
  const head = s => (s.textContent || '').slice(0, 120);
  return secs.find(s => /oil\s*&\s*filter\s*change/i.test(head(s)))
      || secs.find(s => /recon\s*fees/i.test(head(s)))
      || null;
}
function emptyInput(sec) {
  const all = [...sec.querySelectorAll(PART_INPUT_SEL)].filter(i => i.value === '');
  return all.length ? all[all.length - 1] : null;
}
// ---- Subaru: 4-cylinder and 6-cylinder use different drain plug gaskets ----
// The engine is read from the TRIM box in Tekion's vehicle info panel
// (#vehicleDetailsOverviewTrim), e.g. "Touring: SUV 2.5L H4 4DR ..." = 4 cyl.
// The panel is not always open, so every trim seen is remembered per VIN.
const SUBARU_4CYL = '803916010';
const SUBARU_6CYL = '11126AA000';
const TRIM_CACHE_KEY = 'fqa_trim_by_vin';
function pageVin() {                       // exact 17-char VIN in a leaf element (RO header)
  for (const el of document.querySelectorAll('span,div,p,td,input')) {
    const t = (el.tagName === 'INPUT' ? el.value : (el.childElementCount === 0 ? el.textContent : '')) || '';
    if (/^[A-HJ-NPR-Z0-9]{17}$/.test(t.trim())) return t.trim();
  }
  return '';
}
function trimOnPage() {
  const el = document.querySelector('#vehicleDetailsOverviewTrim');
  return el ? (el.value || el.textContent || '').trim() : '';
}
function rememberTrim() {
  const trim = trimOnPage();
  if (!trim) return;
  const vin = pageVin();
  if (!vin) return;
  let cache = {};
  try { cache = JSON.parse(GM_getValue(TRIM_CACHE_KEY, '{}')); } catch (e) {}
  if (cache[vin] === trim) return;
  cache[vin] = trim;
  const keys = Object.keys(cache);
  if (keys.length > 500) keys.slice(0, keys.length - 500).forEach(k => delete cache[k]);   // keep newest 500
  GM_setValue(TRIM_CACHE_KEY, JSON.stringify(cache));
  log('Remembered trim for', vin, ':', trim);
}
function subaruCylinders() {
  let trim = trimOnPage();
  if (!trim) {
    try { trim = JSON.parse(GM_getValue(TRIM_CACHE_KEY, '{}'))[pageVin()] || ''; } catch (e) {}
  }
  if (/\b[HV]6\b|\b6[\s-]*CYL/i.test(trim)) return { cyl: 6, trim };
  if (/\b[HI]4\b|\b4[\s-]*CYL/i.test(trim)) return { cyl: 4, trim };
  return { cyl: 0, trim };
}

function vehicleMake() {
  const el = document.querySelector('[data-test-id="undefined-modelButton"] span');
  const text = el ? el.textContent.toUpperCase() : '';
  if (text.includes('SUBARU')) {
    const s = subaruCylinders();
    if (s.cyl === 6) return { text, pn: SUBARU_6CYL, note: '6 cyl' };
    if (s.cyl === 4) return { text, pn: SUBARU_4CYL, note: '4 cyl' };
    return { text, pn: null, why: 'Subaru engine unknown, no gasket. Open the vehicle info panel, then press Enter on the filter again' };
  }
  for (const g of GASKET_BY_MAKE) if (g.makes.some(m => text.includes(m))) return { text, pn: g.pn };
  return { text, pn: null };
}

// Is there already a drain plug gasket LINE in this job? Looks only at the part-name cells (not all text),
// and matches the number OR "DRAIN PLUG" because Tekion may swap in its own in-stock number.
// Part number without dashes/spaces, for matching Tekion's replaced numbers (EAP9043012031 ~ 90430-12031)
function pnKey(t) { return (t || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
// Part names on the RO lines, read the same way as the (confirmed working) Parts Transfer tool:
// any cell whose test id contains "itemName-cell", from its input box first, else its text.
function lineTexts(sec) {
  return [...sec.querySelectorAll('[data-test-id*="itemName-cell"]')].map(c => {
    const inp = c.querySelector('input');
    return ((inp && inp.value) || c.textContent || '').trim().replace(/\s+/g, ' ');
  }).filter(t => t && !/^select$/i.test(t));
}
function gasketLine(sec, pn) {
  const key = pnKey(pn);
  const hit = lineTexts(sec)
    .find(t => pnKey(t.split(' - ')[0]).indexOf(key) !== -1 || /drain\s*plug/i.test(t));   // EAP9043012031 = 90430-12031
  return hit || null;
}

let busy = false;
async function addOne(partNumber) {
  const sec = findSection();
  if (!sec) { log('No "Oil & Filter Change" or "RECON FEES" job found on this RO.'); toast('No Oil & Filter / Recon Fees job found', true); return false; }
  const input = emptyInput(sec);
  if (!input) { log('No empty "Select" row in that job.'); toast('No empty row in the job', true); return false; }

  setNative(input, partNumber);

  // Pick the dropdown option whose text STARTS with the typed part number (never "Create ..."),
  // and only once the list has updated for what was typed.
  const want = partNumber.toUpperCase(), wantKey = pnKey(partNumber);
  const optionsNow = () => [...document.querySelectorAll('li[role="option"]')].filter(li => li.isConnected);
  const pickNow = () => optionsNow().find(li => {
    const t = (li.textContent || '').trim().toUpperCase();
    return t.indexOf('CREATE') !== 0 && (t.indexOf(want) === 0 || pnKey(t.split(' - ')[0]).indexOf(wantKey) !== -1);   // also Tekion's replaced numbers
  });
  let item = await waitFor(pickNow, 6000);
  if (item) { await sleep(300); item = pickNow(); }   // let the list settle, then re-pick
  const seen = optionsNow().map(li => (li.textContent || '').trim());
  if (!item) { log(partNumber, 'no matching Tekion option. Options were:', seen); toast(partNumber + ' not found in Tekion', true); return false; }
  log('Options:', seen, '-> clicking:', (item.textContent || '').trim());
  ['mouseover', 'mousemove'].forEach(t => item.dispatchEvent(new MouseEvent(t, { bubbles: true })));
  realClick(item);

  // Safety net: if Tekion opened "Add New Part" anyway, cancel it.
  await sleep(1200);
  const hdr = [...document.querySelectorAll('.ant-v5-modal-wrap, .ant-modal-wrap, [role="dialog"]')]
    .find(m => /add new part/i.test(m.textContent || '') && m.offsetParent !== null);
  if (hdr) {
    const cancel = [...hdr.querySelectorAll('button')].find(b => b.textContent.trim() === 'Cancel');
    if (cancel) realClick(cancel);
    log('Tekion opened "Add New Part" for', partNumber, '-- cancelled it.');
    toast(partNumber + ': Tekion tried to create a new part, cancelled', true);
    return false;
  }
  log('Selected', partNumber, '-- waiting for Tekion to update the line...');

  // Tekion can take a moment (it may swap in the in-stock part). The typed box holds the number until the
  // line is saved; wait for a fresh empty row before doing the next one.
  const ready = await waitFor(() => { const s = findSection(); return (s && emptyInput(s)) ? true : null; }, 10000);
  await sleep(600);
  // Tekion leaves the old dropdown ("FP92 ... / Create \"FP92\"") open under the new empty row. Close it
  // so nothing can click "Create" by accident.
  const leftover = findSection() && emptyInput(findSection());
  if (leftover) {
    leftover.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    leftover.blur();
  }
  if (!ready) log('Line for', partNumber, 'took longer than 10s to settle -- carrying on.');
  return true;
}

async function handleRequest(raw) {
  let req = null;
  try { req = JSON.parse(raw); } catch (e) {}
  if (!req || !req.part || (Date.now() - req.ts) > MAX_AGE_MS) return;
  if (!document.querySelector('[data-id^="Job"]')) return;          // not an RO page with jobs
  if (GM_getValue(CLAIM_KEY, '') === req.id) return;                // another Tekion tab already took it
  GM_setValue(CLAIM_KEY, req.id);
  if (busy) { log('Still adding the last part -- ignored', req.part); return; }
  busy = true;
  try {
    log('Adding', req.part, '| oil filter:', req.oil);
    const ok = await addOne(req.part);
    if (ok && req.oil) {
      const mk = vehicleMake();
      if (!mk.pn) { log('No gasket:', mk.why || 'make not recognised', '| header text', JSON.stringify(mk.text)); toast(mk.why ? 'Filter added. ' + mk.why : 'Filter added. Make not recognised, no gasket', true); return; }
      const sec = findSection();
      const have = sec && gasketLine(sec, mk.pn);
      if (have) { log('Gasket already on a line in the job -- skipped. Line was:', JSON.stringify(have)); toast('Added ' + req.part + '. Gasket already on RO'); return; }
      log('Make:', mk.text, '-> gasket', mk.pn);
      if (await addOne(mk.pn)) toast('Added ' + req.part + ' + gasket ' + mk.pn + (mk.note ? ' (' + mk.note + ')' : ''));
    } else if (ok) {
      toast('Added ' + req.part);
    }
  } catch (e) {
    log('Error:', e);
  } finally {
    busy = false;
  }
}


// =====================================================================
// AUTO GASKET WATCHER (Tekion): whenever an oil filter line is on the RO
// of a listed make and there is no drain plug gasket yet, add the gasket -
// no matter how the filter was added (typed, pasted, PartsTech cart, Enter).
// =====================================================================
const OIL_FILTER_RE = /\boil\s*filter\b|\bfilter\b[\s\w,.\-]{0,16}\boil\b|\boil\s*fltr\b/i;
const NOT_FILTER_RE = /housing|adapter|\bcap\b|gasket|wrench|cooler|seal|o-?ring|bypass|plug/i;
const autoDone = new Set();                      // RO + filter line already handled this session
async function autoGasketCheck() {
  if (busy || document.hidden) return;
  const secs = [...document.querySelectorAll('[data-id^="Job"]')];
  if (!secs.length) return;
  for (const sec of secs) {
    const cells = lineTexts(sec);
    const filt = cells.find(t => OIL_FILTER_RE.test(t) && !NOT_FILTER_RE.test(t));
    if (!filt) continue;
    const key = location.pathname + '|' + pageVin() + '|' + filt;
    if (autoDone.has(key)) continue;
    const mk = vehicleMake();
    if (!mk.pn) {                                 // not a gasket make (or Subaru engine unknown)
      autoDone.add(key);
      if (mk.why) { log('Auto gasket:', mk.why); toast(mk.why, true); }
      return;
    }
    const anyJob = secs.some(sx => gasketLine(sx, mk.pn));
    if (anyJob) { autoDone.add(key); continue; }
    autoDone.add(key);
    busy = true;
    try {
      log('Auto gasket: oil filter line found (' + filt + ') on', mk.text, '-> adding', mk.pn);
      if (await addOne(mk.pn)) toast('Auto-added gasket ' + mk.pn + (mk.note ? ' (' + mk.note + ')' : '') + ' for the oil filter');
    } catch (e) { log('Auto gasket error:', e); }
    finally { busy = false; }
    return;
  }
}

function initTekion() {
  GM_addValueChangeListener(REQ_KEY, (name, oldVal, newVal) => { handleRequest(newVal); });
  setInterval(rememberTrim, 1000);          // remember trim whenever the vehicle info panel is open
  setInterval(autoGasketCheck, 2500);       // add the gasket for any oil filter line, however it was added
}

if (location.hostname.indexOf('partstech') !== -1) initPartsTech();
else initTekion();

log('v1.8 loaded on', location.hostname);
})();
