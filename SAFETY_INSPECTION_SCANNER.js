// ==UserScript==
// @name         Safety Inspection Parts Scanner
// @namespace    reconclipboard
// @version      1.3
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/SAFETY_INSPECTION_SCANNER.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/SAFETY_INSPECTION_SCANNER.js
// @description  Scans all 4 Safety Inspection team buckets for mechanical repair lines that still need a parts quote (no part number entered), flags them on the vehicle in the bucket list, and badges the team bucket itself in the sidebar nav.
// @match        https://app.reconvision.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

const LOG = '[Safety Scanner]';
function log(...args) { console.log(LOG, ...args); }

// The 4 Safety Inspection team bucket department IDs (confirmed from Gabe).
// Team labels are NOT hardcoded here -- they're read live off whatever text
// RV itself shows in its own sidebar nav links (e.g. "Safety Inspection -
// Team 1"), so this never needs updating if RV renames a bucket.
const SAFETY_BUCKET_IDS = ['23406', '3160', '3881', '3131'];

// ---------------------------------------------------------------------
// Skip-line logic -- reused VERBATIM from RV-Tekion Parts Bridge (PARTS_
// BRIDGE.js), which already has this confirmed and battle-tested. Keep
// these two scripts' lists in sync if either changes.
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
  'part i', // not a real service line
];

const DEALER_DESTINATION_CODES = [
  'kia', 'fmp', 'napa', 'az', 'or', 'wp', '1-800',
  'bgb', 'cjd', 'dob', 'ford', 'hon', 'maz igh', 'nis', 'sub stp', 'toy',
  'aaa', 'pams', 'lkq', 'key', 'usaf',
];
const DEALER_CODE_WITH_NUMBER_PATTERN = /^[a-z]{2,6}-\d{1,4}$/i;
const PERSONAL_LINE_PATTERN = /^[a-z]+'?s?\s+line$/i;

// NEW rules confirmed by Gabe (10/7/26): skip PULSE, Alignment, and plain
// "Balance" lines outright -- none of these ever need a parts quote.
// EXCEPTION: "Mount and Balance 2 Tires" / "...4 Tires" is NOT skipped --
// that's a real tire purchase and does need a quote. Reuses the exact same
// mount+balance+tire test already proven in Bucket Mover's Alloy Wheel gate.
function isTireMountBalanceLine(normalized) {
  return /mount\s*(and|&)?\s*balance/i.test(normalized) && /tire/i.test(normalized);
}

// Confirmed by Gabe (10/7/26): a pure "Remove X" line (labor only, nothing
// installed back) never needs a parts quote -- e.g. "Remove Tonneau Cover".
// Does NOT skip a line that's actually a remove-and-replace/install job,
// since that one does need a real part.
function isRemovalOnlyLine(normalized) {
  return /^remove\b/i.test(normalized) && !/(and\s+(install|replace)|\breplace\b)/i.test(normalized);
}

function isSkipLine(rawName, hasLockIcon) {
  if (hasLockIcon) return true; // admin/placeholder line ("Team N ___'s Line") -- confirmed via lock icon marker
  const normalized = (rawName || '').replace(/^\*/, '').toLowerCase().trim();
  if (!normalized) return true;
  if (RV_SKIP_LINES.includes(normalized)) return true;
  if (PERSONAL_LINE_PATTERN.test(normalized)) return true;
  if (DEALER_DESTINATION_CODES.includes(normalized)) return true;
  if (DEALER_CODE_WITH_NUMBER_PATTERN.test(normalized)) return true;
  if (/pulse/i.test(normalized)) return true;
  if (/alignment/i.test(normalized)) return true;
  if (/balance/i.test(normalized) && !isTireMountBalanceLine(normalized)) return true;
  // Matched as a substring, not just an exact match, since real line names
  // sometimes carry a team prefix or suffix that the exact RV_SKIP_LINES
  // entry wouldn't catch (e.g. "Team 1 Estimate Parts").
  if (/estimate parts/i.test(normalized)) return true;
  if (isRemovalOnlyLine(normalized)) return true;
  return false;
}

// ---------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------
function GM_addStyleSafe(css) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

GM_addStyleSafe(`
  #safety-scan-bar {
    position:sticky;top:0;left:0;z-index:9999;background:#0d0d0d;border:2px solid #7f1d1d;
    border-top:none;padding:8px 14px;display:inline-flex;align-items:center;gap:10px;
    font-family:'Segoe UI',sans-serif;border-radius:0 0 8px 0;width:fit-content;max-width:380px;
  }
  #safety-scan-btn {
    background:#dc2626;color:#fff;font-weight:700;font-size:13px;border:none;
    border-radius:6px;padding:8px 16px;cursor:pointer;
  }
  #safety-scan-btn:hover { background:#b91c1c; }
  #safety-scan-btn:disabled { background:#333;color:#777;cursor:not-allowed; }
  #safety-scan-status { color:#9ca3af;font-size:12px; }
  .safety-flag-tag {
    display:block;margin-top:5px;font-size:11px;font-weight:700;padding:3px 9px;border-radius:10px;
    border:1px solid #dc2626;background:#1a1a1a;color:#fca5a5;cursor:pointer;width:fit-content;
    position:relative;z-index:50;letter-spacing:.02em;
  }
  .safety-flag-tag:hover { background:#2a1414; }
  .safety-stock-stacked {
    display:flex !important;flex-direction:column !important;align-items:flex-start !important;
  }
  .safety-sidebar-badge {
    display:inline-flex;align-items:center;justify-content:center;
    min-width:16px;height:16px;padding:0 4px;margin-left:6px;
    background:#dc2626;color:#fff;font-size:10px;font-weight:700;
    border-radius:9px;vertical-align:middle;
  }
`);

// ---------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------
function getCache() {
  try { return JSON.parse(GM_getValue('rv_safety_scan_cache', '{}')); }
  catch (e) { return {}; }
}
function saveCache(cache) {
  GM_setValue('rv_safety_scan_cache', JSON.stringify(cache));
}

// Derive per-bucket flagged-vehicle counts from the vehicle-level cache --
// computed on the fly rather than stored separately, so there's no second
// place for counts to go stale/out of sync.
function getBucketCounts() {
  const cache = getCache();
  const counts = {};
  Object.values(cache).forEach(entry => {
    if (entry.flaggedLines && entry.flaggedLines.length && entry.bucketId) {
      counts[entry.bucketId] = (counts[entry.bucketId] || 0) + 1;
    }
  });
  return counts;
}

// ---------------------------------------------------------------------
// Scrape vehicle rows off a bucket list page. Identical approach to
// Bucket Mover's scrapeBucketRows() -- same confirmed markup.
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
// Team N" section(s), and pull out candidate lines (not locked, not on
// the skip list). Confirmed section class pattern from real DOM:
//   work-order-mechanical-repairs-team-1 / -team-2 / etc.
// Confirmed per-row markup: tr.table__row--content[data-service-id].
//
// v1.2 fix (10/7/26): the name and lock selectors below were WRONG and
// matched nothing real -- confirmed via Inspect-Element screenshots of an
// actual row. The line's real display name lives on the <input
// name="work_order[line_items_attributes][ID][name]"> inside
// td.work-order-cell--svc (its "title" and "value" attributes both hold
// it, e.g. "*PULSE - Install" -- strip the leading "*", that's just
// Clipboard's snapshot marker). A locked/admin line (e.g. "Team N ___'s
// Line", "Team N Air Filter - Engine") is marked by a <span> whose "name"
// attribute ENDS in "[lock]" (e.g. name="work_order[line_items_attributes]
// [ID][lock]") -- NOT a data-title="lock" attribute, which doesn't exist.
// Because both of the old selectors silently matched nothing, every line
// (including locked/PULSE/admin lines) was wrongly treated as a real
// candidate -- this is what caused the false "PARTS NEEDED" flags.
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
// Step 2: for one candidate line, fetch its Parts modal content and check
// whether a real part number has been entered. Confirmed via real Network
// capture: GET /work_orders/{woId}/parts_modal_body?line_item_id={id}
// &limited_access=false returns a text/javascript response shaped like:
//   var modal_content = $("#parts_modal").find(".modal-content");
//   modal_content.empty();
//   modal_content.append("<div class=\'info-bar\'>...escaped html...");
// -- NOT JSON, NOT plain HTML. Must pull the string argument out of the
// .append(...) call, un-escape the JS string escapes Rails' escape_
// javascript() put in, then parse that as HTML to look for a part_number
// field with real content.
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

// v1.1 fix (10/7/26): this endpoint was returning 500 Internal Server Error
// on every single request when called from a plain background fetch() --
// confirmed via console screenshot showing 100% failure across every
// vehicle, not just one. RV's server is a Rails app and this is an
// AJAX-only endpoint; it needs the "this is a real AJAX call" header and
// the page's CSRF token, which a plain fetch() doesn't send on its own
// the way a real in-app click (via jQuery/rails-ujs) does.
function getCsrfToken() {
  const meta = document.querySelector('meta[name="csrf-token"]');
  return meta ? meta.getAttribute('content') : '';
}

function checkLineIsQuoted(woId, serviceId) {
  const url = `https://app.reconvision.com/work_orders/${woId}/parts_modal_body?line_item_id=${serviceId}&limited_access=false`;
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
        log('checkLineIsQuoted: server responded', r.status, 'for serviceId', serviceId, '-- leaving unflagged this pass rather than guessing.');
        return Promise.reject(new Error('bad status ' + r.status));
      }
      return r.text();
    })
    .then(jsText => {
      const m = jsText.match(/\.append\(\s*"([\s\S]*)"\s*\)\s*;?\s*$/);
      if (!m) {
        log('checkLineIsQuoted: could not find .append(...) payload for serviceId', serviceId, '-- leaving unflagged this pass rather than guessing.');
        return true; // fail safe: don't flag on a parse miss, avoid false alarms from a script bug
      }
      const htmlStr = unescapeJsString(m[1]);
      const modalDoc = new DOMParser().parseFromString(htmlStr, 'text/html');
      const partFields = modalDoc.querySelectorAll('[name="line_item[parts_attributes][][part_number]"], [id*="_part_number"]');
      let hasRealPart = false;
      partFields.forEach(f => {
        const val = (f.value || f.textContent || '').trim();
        if (val) hasRealPart = true;
      });
      return hasRealPart;
    })
    .catch(e => {
      log('checkLineIsQuoted fetch failed for serviceId', serviceId, e);
      return true; // fail safe -- same reasoning as above
    });
}

// ---------------------------------------------------------------------
// Full scan of one bucket page's vehicles.
// ---------------------------------------------------------------------
async function runScan(bucketId, btn, status) {
  if (btn) btn.disabled = true;
  const rows = scrapeBucketRows();
  if (!rows.length) {
    if (status) status.textContent = 'No vehicles found on this page.';
    if (btn) btn.disabled = false;
    return;
  }

  let cache = getCache();
  const RESCAN_SKIP_MS = 30 * 60 * 1000;
  const toScan = rows.filter(row => {
    const entry = cache[row.woId];
    if (!entry) return true;
    if (entry.flaggedLines && entry.flaggedLines.length) return true; // still flagged -> always rescan
    if (entry.lastScanned && (Date.now() - entry.lastScanned) < RESCAN_SKIP_MS) return false;
    return true;
  });

  if (!toScan.length) {
    if (status) status.textContent = 'Up to date.';
    if (btn) btn.disabled = false;
    return;
  }

  let scanned = 0;
  const BATCH_SIZE = 3; // smaller than Bucket Mover's -- this does 2 fetch layers per vehicle, not 1
  for (let i = 0; i < toScan.length; i += BATCH_SIZE) {
    const batch = toScan.slice(i, i + BATCH_SIZE);
    if (status) status.textContent = `Scanning ${scanned + 1}-${Math.min(scanned + batch.length, toScan.length)} of ${toScan.length}...`;

    await Promise.all(batch.map(async (row) => {
      const candidates = await fetchCandidateLines(row.woId);
      scanned++;
      if (candidates === null) return; // fetch failed, leave prior cache entry alone

      const flaggedLines = [];
      for (const cand of candidates) {
        const quoted = await checkLineIsQuoted(row.woId, cand.serviceId);
        if (!quoted) flaggedLines.push(cand);
      }

      let c = getCache();
      if (flaggedLines.length) {
        c[row.woId] = { stock: row.stock, bucketId, flaggedLines, lastScanned: Date.now() };
      } else {
        delete c[row.woId];
      }
      saveCache(c);
      applyVehicleTags();
      updateSidebarBadges();
    }));

    if (i + BATCH_SIZE < toScan.length) {
      await new Promise(r => setTimeout(r, 150));
    }
  }

  if (status) status.textContent = `Scan complete — ${Object.values(getCache()).filter(e => e.bucketId === bucketId).length} flagged in this bucket.`;
  if (btn) btn.disabled = false;
}

// ---------------------------------------------------------------------
// Render per-vehicle flag tags on a bucket list page.
// ---------------------------------------------------------------------
function applyVehicleTags() {
  const cache = getCache();
  scrapeBucketRows().forEach(row => {
    const entry = cache[row.woId];
    const card = row.link ? row.link.closest('#vehicle-info-bar') : null;
    if (!card) return;
    const stockEls = card.querySelectorAll('.info-bar__item--stock div');

    stockEls.forEach(stockEl => {
      if (!stockEl.isConnected) return;
      const wrapper = stockEl.closest('.info-bar__item--stock') || stockEl.parentElement;
      if (!wrapper) return;
      const oldTag = wrapper.querySelector('.safety-flag-tag');
      if (oldTag) oldTag.remove();
      if (!entry || !entry.flaggedLines || !entry.flaggedLines.length) {
        wrapper.classList.remove('safety-stock-stacked');
        return;
      }
      wrapper.classList.add('safety-stock-stacked');

      const tag = document.createElement('button');
      tag.type = 'button';
      tag.className = 'safety-flag-tag';
      tag.textContent = `⚠ PARTS NEEDED (${entry.flaggedLines.length})`;
      tag.title = 'Needs a parts quote: ' + entry.flaggedLines.map(l => l.name).join(', ') + ' — click to open this vehicle.';
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
// Badge the team buckets themselves, wherever RV's own sidebar nav shows
// their links. Runs on every page (this script matches all of
// reconvision.com) -- purely reads the cache, no network calls, so it's
// cheap to re-run often. Badge count reflects whenever that bucket was
// last actually scanned (i.e. last time someone was on that bucket page),
// not a live cross-bucket check from wherever you currently are.
// ---------------------------------------------------------------------
function updateSidebarBadges() {
  const counts = getBucketCounts();
  document.querySelectorAll('a[href*="/departments/"]').forEach(a => {
    const m = a.getAttribute('href').match(/\/departments\/(\d+)/);
    if (!m) return;
    const deptId = m[1];
    if (!SAFETY_BUCKET_IDS.includes(deptId)) return;

    const existing = a.parentElement ? a.parentElement.querySelector('.safety-sidebar-badge') : null;
    const count = counts[deptId] || 0;

    if (!count) {
      if (existing) existing.remove();
      return;
    }
    if (existing) {
      existing.textContent = String(count);
    } else {
      const badge = document.createElement('span');
      badge.className = 'safety-sidebar-badge';
      badge.textContent = String(count);
      badge.title = `${count} vehicle(s) with parts still needed in this bucket`;
      a.insertAdjacentElement('afterend', badge);
    }
  });
}

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------
function buildScanBar(bucketId) {
  const bar = document.createElement('div');
  bar.id = 'safety-scan-bar';
  const btn = document.createElement('button');
  btn.id = 'safety-scan-btn';
  btn.textContent = 'Scan Safety Bucket for Missing Parts';
  const status = document.createElement('span');
  status.id = 'safety-scan-status';
  bar.appendChild(btn);
  bar.appendChild(status);

  const mainContent = document.querySelector('main.content') || document.body;
  mainContent.insertBefore(bar, mainContent.firstChild);

  btn.addEventListener('click', () => runScan(bucketId, btn, status));
  return { btn, status };
}

function currentBucketId() {
  const m = location.pathname.match(/\/departments\/(\d+)/);
  return m ? m[1] : null;
}

function init() {
  const bucketId = currentBucketId();
  if (bucketId && SAFETY_BUCKET_IDS.includes(bucketId)) {
    const { btn, status } = buildScanBar(bucketId);
    applyVehicleTags(); // show cached flags immediately
    status.textContent = 'Auto-scanning in background...';
    runScan(bucketId, null, status);
  }

  // Sidebar badges run on every page, with retries since the nav may
  // render after this script's first pass (SPA-ish page, same reasoning
  // as other scripts here that poll for landmark elements).
  updateSidebarBadges();
  let badgeAttempts = 0;
  const badgeTick = setInterval(() => {
    badgeAttempts++;
    updateSidebarBadges();
    if (badgeAttempts >= 10) clearInterval(badgeTick);
  }, 1000);
}

setTimeout(init, 1000);

})();