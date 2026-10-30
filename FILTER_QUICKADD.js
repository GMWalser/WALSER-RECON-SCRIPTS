// ==UserScript==
// @name         Filter Quick Add
// @namespace    reconclipboard
// @version      1.3
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/FILTER_QUICKADD.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/FILTER_QUICKADD.js
// @description  PartsTech: hover a part card + press Enter -> adds it to the open Tekion RO (Oil & Filter Change job, else RECON FEES). Oil filters also get the right drain plug gasket for the make.
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
  { makes: ['TOYOTA'], pn: '90430-12031' },
  { makes: ['NISSAN'], pn: '11026-01M02' },
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
function vehicleMake() {
  const el = document.querySelector('[data-test-id="undefined-modelButton"] span');
  const text = el ? el.textContent.toUpperCase() : '';
  for (const g of GASKET_BY_MAKE) if (g.makes.some(m => text.includes(m))) return { text, pn: g.pn };
  return { text, pn: null };
}

// Is there already a drain plug gasket LINE in this job? Looks only at the part-name cells (not all text),
// and matches the number OR "DRAIN PLUG" because Tekion may swap in its own in-stock number.
function gasketLine(sec, pn) {
  const cells = [...sec.querySelectorAll('[data-test-id*="requestTable-itemName-cell-"]')];
  const hit = cells.map(c => (c.textContent || '').trim().replace(/\s+/g, ' '))
    .find(t => t.toUpperCase().indexOf(pn.toUpperCase()) === 0 || /drain\s*plug/i.test(t));
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
  const want = partNumber.toUpperCase();
  const optionsNow = () => [...document.querySelectorAll('li[role="option"]')].filter(li => li.isConnected);
  const pickNow = () => optionsNow().find(li => {
    const t = (li.textContent || '').trim().toUpperCase();
    return t.indexOf('CREATE') !== 0 && t.indexOf(want) === 0;
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
      if (!mk.pn) { log('Make not recognised from header text', JSON.stringify(mk.text), '-- no gasket added.'); toast('Filter added. Make not recognised, no gasket', true); return; }
      const sec = findSection();
      const have = sec && gasketLine(sec, mk.pn);
      if (have) { log('Gasket already on a line in the job -- skipped. Line was:', JSON.stringify(have)); toast('Added ' + req.part + '. Gasket already on RO'); return; }
      log('Make:', mk.text, '-> gasket', mk.pn);
      if (await addOne(mk.pn)) toast('Added ' + req.part + ' + gasket ' + mk.pn);
    } else if (ok) {
      toast('Added ' + req.part);
    }
  } catch (e) {
    log('Error:', e);
  } finally {
    busy = false;
  }
}

function initTekion() {
  GM_addValueChangeListener(REQ_KEY, (name, oldVal, newVal) => { handleRequest(newVal); });
}

if (location.hostname.indexOf('partstech') !== -1) initPartsTech();
else initTekion();

log('v1.3 loaded on', location.hostname);
})();
