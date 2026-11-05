// ==UserScript==
// @name         Parts Order Quote Scanner
// @namespace    reconclipboard
// @version      1.0
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/PARTS_ORDER_SCANNER.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/PARTS_ORDER_SCANNER.js
// @description  On the Parts Order bucket, pre-reads every vehicle's mechanical lines and tags each vehicle green (quoted) or red (not quoted). Hover the tag to see which parts still need part#/price/vendor.
// @match        https://app.reconvision.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

const LOG = '[Parts Order Scanner]';
function log(...args) { console.log(LOG, ...args); }

const PARTS_ORDER_BUCKET_ID = '3134';

// A vehicle is GREEN when at least this share of its part lines are fully
// quoted (part#, price, vendor all filled). Everything below is RED.
// 0.8 => 8 of 10 = green, 1 of 5 = red. Change here if it feels off.
const GREEN_THRESHOLD = 0.8;

// Dedicated cache key -- never shared with another script's storage.
const CACHE_KEY = 'pos_scan_cache';

// ---------------------------------------------------------------------
// Skip-line logic -- same list as Safety Inspection Parts Scanner (which
// reuses it from PARTS_BRIDGE.js). Keep these in sync if either changes.
// 'parts i' added here: a "Parts I" service line (0 parts) shows up on
// ROs and is not a real work item.
// ---------------------------------------------------------------------
const RV_SKIP_LINES = [
  'ready for pick up',
  'measure all 4 tires - input measurements on inspection form',
  'at recon',
  'body shop review',
  'pre-order parts',
  'fast pass - pre inspection',
  'fast pass - safety inspection w/ test drive',
  '**estimate parts**',
  'estimate parts',
  'parts ordered',
  "andrew's line",
  'pdr - misc',
  'detail 1',
  'detail i',
  'photos/fees',
  'coon rapids hyundai - 26',
  'delivered to lot',
  'part i',
  'parts i',
];

const DEALER_DESTINATION_CODES = [
  'kia', 'fmp', 'napa', 'az', 'or', 'wp', '1-800',
  'bgb', 'cjd', 'dob', 'ford', 'hon', 'maz igh', 'nis', 'sub stp', 'toy',
  'aaa', 'pams', 'lkq', 'key', 'usaf',
];
const DEALER_CODE_WITH_NUMBER_PATTERN = /^[a-z]{2,6}-\d{1,4}$/i;
const PERSONAL_LINE_PATTERN = /^[a-z]+'?s?\s+line$/i;

function isTireMountBalanceLine(normalized) {
  return /mount\s*(and|&)?\s*balance/i.test(normalized) && /tire/i.test(normalized);
}

function isRemovalOnlyLine(normalized) {
  return /^remove\b/i.test(normalized) && !/(and\s+(install|replace)|\breplace\b)/i.test(normalized);
}

function isSkipLine(rawName, hasLockIcon) {
  if (hasLockIcon) return true;
  const normalized = (rawName || '').replace(/^\*/, '').toLowerCase().trim();
  if (!normalized) return true;
  if (RV_SKIP_LINES.includes(normalized)) return true;
  if (PERSONAL_LINE_PATTERN.test(normalized)) return true;
  if (DEALER_DESTINATION_CODES.includes(normalized)) return true;
  if (DEALER_CODE_WITH_NUMBER_PATTERN.test(normalized)) return true;
  if (/pulse/i.test(normalized)) return true;
  if (/alignment/i.test(normalized)) return true;
  if (/balance/i.test(normalized) && !isTireMountBalanceLine(normalized)) return true;
  if (/estimate parts/i.test(normalized)) return true;
  if (isRemovalOnlyLine(normalized)) return true;
  return false;
}

// ---------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------
function addStyle(css) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

addStyle(`
  #pos-scan-bar {
    position:sticky;top:0;left:0;z-index:9999;background:#0d0d0d;border:2px solid #166534;
    border-top:none;padding:8px 14px;display:inline-flex;align-items:center;gap:10px;
    font-family:'Segoe UI',sans-serif;border-radius:0 0 8px 0;width:fit-content;max-width:420px;
  }
  #pos-scan-btn {
    background:#16a34a;color:#fff;font-weight:700;font-size:13px;border:none;
    border-radius:6px;padding:8px 16px;cursor:pointer;
  }
  #pos-scan-btn:hover { background:#15803d; }
  #pos-scan-btn:disabled { background:#333;color:#777;cursor:not-allowed; }
  #pos-scan-status { color:#9ca3af;font-size:12px; }
  .pos-flag-tag {
    display:block;margin-top:5px;font-size:11px;font-weight:700;padding:3px 9px;border-radius:10px;
    background:#1a1a1a;cursor:pointer;width:fit-content;
    position:relative;z-index:50;letter-spacing:.02em;
  }
  .pos-flag-tag.pos-red   { border:1px solid #dc2626;color:#fca5a5; }
  .pos-flag-tag.pos-red:hover   { background:#2a1414; }
  .pos-flag-tag.pos-green { border:1px solid #16a34a;color:#86efac; }
  .pos-flag-tag.pos-green:hover { background:#10261a; }
  .pos-stock-stacked {
    display:flex !important;flex-direction:column !important;align-items:flex-start !important;
  }
`);

// ---------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------
function getCache() {
  try { return JSON.parse(GM_getValue(CACHE_KEY, '{}')); }
  catch (e) { return {}; }
}
function saveCache(cache) {
  GM_setValue(CACHE_KEY, JSON.stringify(cache));
}

// ---------------------------------------------------------------------
// Scrape vehicle rows off a bucket list page (same confirmed markup the
// Safety scanner and Bucket Mover use).
// ---------------------------------------------------------------------
function scrapeBucketRows() {
  const rows = [];
  document.querySelectorAll('.info-bar__item--inv').forEach(el => {
    const text = el.innerText.replace(/\s+/g, ' ').trim();
    const m = text.match(/WAL(\d+)/);
    if (!m) return;
    const invId = m[1];
    const card = el.closest('#vehicle-info-bar') || el.closest('.info-bar');
    let stockEl = card ? card.querySelector('.info-bar__item--stock div') : null;
    const stock = stockEl ? stockEl.innerText.trim() : invId;
    const link = card ? card.querySelector('.work-order-link') : null;

    let woId = invId;
    if (link) {
      const href = link.getAttribute('href') || '';
      const hrefMatch = href.match(/\/work_orders\/(\d+)/);
      if (hrefMatch) woId = hrefMatch[1];
    }
    rows.push({ woId, stock, link });
  });
  return rows;
}

// ---------------------------------------------------------------------
// Step 1: fetch the work order edit page, find the "Mechanical Repairs -
// Team N" section(s), pull out candidate lines (not locked, not skipped).
// Same confirmed selectors as the Safety Inspection scanner.
// ---------------------------------------------------------------------
function fetchCandidateLines(woId) {
  return fetch(`https://app.reconvision.com/work_orders/${woId}/edit`, { credentials: 'include' })
    .then(r => r.text())
    .then(html => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const sections = [...doc.querySelectorAll('section.work-order-breakdown--department')]
        .filter(sec => /work-order-mechanical-repairs-team-\d+/i.test(sec.className));
      if (!sections.length) return [];

      const candidates = [];
      sections.forEach(sec => {
        sec.querySelectorAll('tr.table__row--content[data-service-id]').forEach(row => {
          const serviceId = row.getAttribute('data-service-id');
          if (!serviceId) return;
          const nameInput = row.querySelector('.work-order-cell--svc input[name$="[name]"]');
          const rawName = nameInput ? (nameInput.getAttribute('title') || nameInput.getAttribute('value') || '') : '';
          const hasLock = !!row.querySelector('span[name$="[lock]"]');
          if (isSkipLine(rawName, hasLock)) return;
          candidates.push({ serviceId, name: (rawName || '').replace(/^\*/, '').trim() });
        });
      });
      return candidates;
    })
    .catch(e => { log('fetchCandidateLines failed for woId', woId, e); return null; });
}

// ---------------------------------------------------------------------
// Step 2: fetch one line's Parts modal content (confirmed in the Safety
// scanner: /parts_modal_body returns a JS response with the modal HTML
// escaped inside .append("...") -- needs the AJAX header + CSRF token).
// ---------------------------------------------------------------------
function unescapeJsString(s) {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

function getCsrfToken() {
  const meta = document.querySelector('meta[name="csrf-token"]');
  return meta ? meta.getAttribute('content') : '';
}

// Price/vendor selectors are based on the markup the clipboard script
// already reads/writes in these same part rows (price input id contains
// "part_price"; vendor text lives in the Description textarea of
// td.save_value.description). If a row ever has no matching field, it is
// NOT counted against the vehicle (avoids a wall of false reds from a
// selector miss) and is counted in selectorMisses so the status line
// tells you to check the console.
const PRICE_SEL  = 'input[id*="part_price"], input[name*="[part_price]"], input[data-field-name="partPrice"]';
const VENDOR_SEL = 'td.save_value.description textarea, textarea[id*="_description"], textarea[name*="[description]"], textarea[data-field-name="description"]';

let selectorMisses = 0;
let debugRowLogged = false;

// Returns { done, total, needed: [text...] } for one service line, or null
// if the fetch failed (caller leaves the vehicle's previous result alone).
function fetchLineUnits(woId, cand) {
  const url = `https://app.reconvision.com/work_orders/${woId}/parts_modal_body?line_item_id=${cand.serviceId}&limited_access=false`;
  return fetch(url, {
    credentials: 'include',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'text/javascript, application/javascript, */*; q=0.01',
      'X-CSRF-Token': getCsrfToken(),
    },
  })
    .then(r => {
      if (!r.ok) {
        log('parts_modal_body responded', r.status, 'for serviceId', cand.serviceId, '-- leaving this vehicle unchanged this pass.');
        return Promise.reject(new Error('bad status ' + r.status));
      }
      return r.text();
    })
    .then(jsText => {
      const m = jsText.match(/\.append\(\s*"([\s\S]*)"\s*\)\s*;?\s*$/);
      if (!m) {
        log('Could not find .append(...) payload for serviceId', cand.serviceId, '-- leaving this vehicle unchanged this pass.');
        return null;
      }
      const modalDoc = new DOMParser().parseFromString(unescapeJsString(m[1]), 'text/html');
      const partFields = modalDoc.querySelectorAll('[name="line_item[parts_attributes][][part_number]"], [id*="_part_number"]');

      const seenRows = new Set();
      const needed = [];
      let total = 0, done = 0;

      partFields.forEach(f => {
        const tr = f.closest('tr') || f.parentElement;
        if (!tr || seenRows.has(tr)) return;
        seenRows.add(tr);

        const partNum = (f.value || f.textContent || '').trim();
        const priceEl = tr.querySelector(PRICE_SEL);
        const vendorEl = tr.querySelector(VENDOR_SEL);
        const priceNum = priceEl ? parseFloat(String(priceEl.value || priceEl.getAttribute('value') || '').replace(/[^0-9.]/g, '')) : NaN;
        const vendorText = vendorEl ? (vendorEl.value || vendorEl.textContent || '').trim() : '';

        // Completely blank row (e.g. an empty template row) -- not a part.
        if (!partNum && !(priceNum > 0) && !vendorText) return;

        if (!debugRowLogged) {
          debugRowLogged = true;
          log('First part row seen (for selector check) -- part#:', JSON.stringify(partNum),
            '| price field found:', !!priceEl, 'value:', priceEl ? priceEl.value : '(n/a)',
            '| vendor field found:', !!vendorEl, 'value:', vendorEl ? JSON.stringify(vendorText) : '(n/a)');
        }

        const missing = [];
        if (!partNum) missing.push('part #');
        if (!priceEl) selectorMisses++;
        else if (!(priceNum > 0)) missing.push('price');
        if (!vendorEl) selectorMisses++;
        else if (!vendorText) missing.push('vendor');

        total++;
        if (!missing.length) done++;
        else needed.push(`${cand.name}: ${partNum || '(no part #)'} — missing ${missing.join(', ')}`);
      });

      // A real service line with no part rows at all is itself "not quoted".
      if (total === 0) {
        return { done: 0, total: 1, needed: [`${cand.name}: no parts entered`] };
      }
      return { done, total, needed };
    })
    .catch(e => {
      log('fetchLineUnits failed for serviceId', cand.serviceId, e);
      return null;
    });
}

// ---------------------------------------------------------------------
// Full scan of the bucket page's vehicles.
// ---------------------------------------------------------------------
let scanning = false;

async function runScan(btn, status, force) {
  if (scanning) return;
  scanning = true;
  if (btn) btn.disabled = true;
  selectorMisses = 0;

  try {
    const rows = scrapeBucketRows();
    if (!rows.length) {
      if (status) status.textContent = 'No vehicles found on this page.';
      return;
    }

    const cache = getCache();
    const RESCAN_SKIP_MS = 30 * 60 * 1000;
    const toScan = rows.filter(row => {
      if (force) return true;
      const entry = cache[row.woId];
      if (!entry) return true;
      if (!entry.green) return true; // red -> always rescan
      if (entry.lastScanned && (Date.now() - entry.lastScanned) < RESCAN_SKIP_MS) return false;
      return true;
    });

    if (!toScan.length) {
      if (status) status.textContent = 'Up to date.';
      return;
    }

    let scanned = 0;
    const BATCH_SIZE = 3;
    for (let i = 0; i < toScan.length; i += BATCH_SIZE) {
      const batch = toScan.slice(i, i + BATCH_SIZE);
      if (status) status.textContent = `Scanning ${scanned + 1}-${Math.min(scanned + batch.length, toScan.length)} of ${toScan.length}...`;

      await Promise.all(batch.map(async (row) => {
        const candidates = await fetchCandidateLines(row.woId);
        scanned++;
        if (candidates === null) return; // fetch failed, leave prior cache entry alone

        let done = 0, total = 0, failed = false;
        const needed = [];
        for (const cand of candidates) {
          const res = await fetchLineUnits(row.woId, cand);
          if (res === null) { failed = true; break; }
          done += res.done;
          total += res.total;
          needed.push(...res.needed);
        }
        if (failed) return; // leave prior result alone rather than guess

        const c = getCache();
        if (total === 0) {
          delete c[row.woId]; // nothing that needs parts on this RO -> no tag
        } else {
          c[row.woId] = {
            stock: row.stock, done, total, needed,
            green: (done / total) >= GREEN_THRESHOLD,
            lastScanned: Date.now(),
          };
        }
        saveCache(c);
        applyVehicleTags();
      }));

      if (i + BATCH_SIZE < toScan.length) {
        await new Promise(r => setTimeout(r, 150));
      }
    }

    const all = Object.values(getCache());
    const greens = all.filter(e => e.green).length;
    let msg = `Scan complete — ${greens} quoted (green), ${all.length - greens} not quoted (red).`;
    if (selectorMisses > 0) msg += ` (price/vendor field not found on ${selectorMisses} spot(s) — check console)`;
    if (status) status.textContent = msg;
  } finally {
    scanning = false;
    if (btn) btn.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Render per-vehicle tags. Only rewrites a tag when its content changed,
// so a hover tooltip isn't reset by the periodic refresh.
// ---------------------------------------------------------------------
function applyVehicleTags() {
  const cache = getCache();
  scrapeBucketRows().forEach(row => {
    const entry = cache[row.woId];
    const card = row.link ? row.link.closest('#vehicle-info-bar') : null;
    if (!card) return;

    card.querySelectorAll('.info-bar__item--stock div').forEach(stockEl => {
      if (!stockEl.isConnected) return;
      const wrapper = stockEl.closest('.info-bar__item--stock') || stockEl.parentElement;
      if (!wrapper) return;
      const oldTag = wrapper.querySelector('.pos-flag-tag');

      if (!entry) {
        if (oldTag) oldTag.remove();
        wrapper.classList.remove('pos-stock-stacked');
        return;
      }

      const sig = [entry.green ? 'G' : 'R', entry.done, entry.total, (entry.needed || []).join('|')].join('~');
      if (oldTag && oldTag.dataset.sig === sig) return;
      if (oldTag) oldTag.remove();
      wrapper.classList.add('pos-stock-stacked');

      const tag = document.createElement('button');
      tag.type = 'button';
      tag.dataset.sig = sig;
      tag.className = 'pos-flag-tag ' + (entry.green ? 'pos-green' : 'pos-red');
      tag.textContent = entry.green
        ? `✓ QUOTED (${entry.done}/${entry.total})`
        : `⚠ NOT QUOTED (${entry.done}/${entry.total})`;
      const needed = entry.needed || [];
      tag.title = (entry.green ? 'Quoted' : 'Still needs quoting') + ` — ${entry.done} of ${entry.total} part lines complete`
        + (needed.length ? ':\n' + needed.join('\n') : '')
        + '\n(click to open this vehicle)';
      tag.addEventListener('mousedown', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); }, true);
      tag.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        window.open(`https://app.reconvision.com/work_orders/${row.woId}/edit`, '_blank');
      }, true);
      wrapper.appendChild(tag);
    });
  });
}

// ---------------------------------------------------------------------
// Init -- only active on the Parts Order bucket. Watches the URL so it
// also starts/stops correctly if you navigate in or out without a full
// page load.
// ---------------------------------------------------------------------
function currentBucketId() {
  const m = location.pathname.match(/\/departments\/(\d+)/);
  return m ? m[1] : null;
}

function buildScanBar() {
  const bar = document.createElement('div');
  bar.id = 'pos-scan-bar';
  const btn = document.createElement('button');
  btn.id = 'pos-scan-btn';
  btn.textContent = 'Rescan Parts Order Bucket';
  const status = document.createElement('span');
  status.id = 'pos-scan-status';
  bar.appendChild(btn);
  bar.appendChild(status);

  const mainContent = document.querySelector('main.content') || document.body;
  mainContent.insertBefore(bar, mainContent.firstChild);

  btn.addEventListener('click', () => runScan(btn, status, true));
  return { btn, status };
}

function ensureActiveOnBucket() {
  const onBucket = currentBucketId() === PARTS_ORDER_BUCKET_ID;
  const bar = document.getElementById('pos-scan-bar');
  if (onBucket && !bar) {
    const { btn, status } = buildScanBar();
    applyVehicleTags(); // show cached results immediately
    status.textContent = 'Auto-scanning in background...';
    runScan(btn, status, false);
  } else if (!onBucket && bar) {
    bar.remove();
  } else if (onBucket) {
    applyVehicleTags(); // cheap re-apply if the list re-rendered
  }
}

setTimeout(() => {
  ensureActiveOnBucket();
  setInterval(ensureActiveOnBucket, 2000);
}, 1000);

log('v1.0 loaded');
})();