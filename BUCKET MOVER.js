// ==UserScript==
// @name         ReconVision Bucket Scanner - RPF/DPF/PDR/Alloy Wheel
// @namespace    reconclipboard
// @version      3.2
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/BUCKET%20MOVER.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/BUCKET%20MOVER.js
// @match        https://app.reconvision.com/departments/3122*
// @match        https://app.reconvision.com/departments/4282*
// @match        https://app.reconvision.com/work_orders/*/edit*
// @match        https://app.tekioncloud.com/parts/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

// GM_setValue/GM_getValue storage is shared across all domains this single
// script @matches -- that's the only reliable way to pass the RO# from the
// ReconVision tab to a Tekion tab (including one you opened manually
// yourself), since window.open() can only ever "reuse" a tab it itself
// previously opened and has no way to find an existing unrelated tab.


// Department section slugs we care about. ReconVision builds the section class
// as "work-order-<slugified-department-name>". Slug confirmed from real DOM:
//   R P F - Recon Preferred Finishes  -> work-order-r-p-f-recon-preferred-finishes
//   PDR                                -> work-order-pdr
//   Alloy Wheel                        -> work-order-alloy-wheel
//   DPF (not seen in sample, following same slugify pattern as best guess)
//      DPF - Dealer Preferred Finishes -> work-order-d-p-f-dealer-preferred-finishes
// We match loosely (substring) so small naming variations don't break it.
const TRACKED_DEPTS = [
  { key: 'RPF',   match: /work-order-r[\s-]?p[\s-]?f/i },
  { key: 'DPF',   match: /work-order-d[\s-]?p[\s-]?f/i },
  { key: 'PDR',   match: /work-order-pdr\b/i },
  { key: 'ALLOY', match: /work-order-alloy-wheel/i },
];

// Confirmed department IDs from "Send to another dept" buttons (data-department-id)
const DEPT_IDS = {
  RPF: '3201',   // R P F - Recon Preferred Finishes
  DPF: '3198',   // D P F - Dealer Preferred Finishes
  PDR: '3204',   // PDR
  ALLOY: '3137', // Alloy Wheel
};

const STORAGE_PREFIX = 'rv_bucket_scan_';

function GM_addStyleSafe(css) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

GM_addStyleSafe(`
  #rv-scan-bar {
    position:sticky;top:0;left:0;z-index:9999;background:#0d0d0d;border:2px solid #1e4d8c;
    border-top:none;padding:8px 14px;display:inline-flex;align-items:center;gap:10px;
    font-family:'Segoe UI',sans-serif;border-radius:0 0 8px 0;width:fit-content;max-width:340px;
  }
  #rv-scan-btn {
    background:#3b82f6;color:#fff;font-weight:700;font-size:13px;border:none;
    border-radius:6px;padding:8px 16px;cursor:pointer;
  }
  #rv-scan-btn:hover { background:#2563eb; }
  #rv-scan-btn:disabled { background:#333;color:#777;cursor:not-allowed; }
  #rv-scan-status { color:#9ca3af;font-size:12px; }
  .rv-flag-blue {
    background:#1e3a8a !important;color:#fff !important;border-radius:4px;
    padding:1px 6px;font-weight:700;
  }
  .rv-flag-red {
    background:#7f1d1d !important;color:#fff !important;border-radius:4px;
    padding:1px 6px;font-weight:700;
  }
  .rv-cant-move-btn {
    display:block;margin-top:4px;font-size:11px;font-weight:700;padding:3px 9px;border-radius:10px;
    border:1px solid #555;background:#1a1a1a;color:#ccc;cursor:pointer;width:fit-content;
    position:relative;z-index:50;
  }
  .rv-dept-tags {
    display:flex;flex-wrap:wrap;gap:5px;margin-top:5px;
  }
  .rv-dept-tag {
    font-size:12px;font-weight:700;padding:4px 10px;border-radius:10px;
    border:1px solid #444;background:#1a1a1a;color:#ddd;cursor:pointer;
    position:relative;z-index:50;letter-spacing:.03em;
  }
  .rv-dept-tag:hover { background:#2a2a2a; }
  .rv-dept-tag.RPF   { border-color:#a855f7;color:#c084fc; }
  .rv-dept-tag.DPF   { border-color:#3b82f6;color:#60a5fa; }
  .rv-dept-tag.PDR   { border-color:#f59e0b;color:#fbbf24; }
  .rv-dept-tag.ALLOY { border-color:#10b981;color:#34d399; }
  .rv-dept-tag-blocked {
    border-color:#7f1d1d !important;color:#f87171 !important;
    text-decoration:line-through;opacity:0.7;cursor:not-allowed;
  }
  .rv-dept-tag-blocked:hover { background:#1a1a1a !important; }
  .rv-pdr-note {
    display:block;margin-top:5px;font-size:11px;color:#fbbf24;background:#1a1a1a;
    border:1px solid #f59e0b;border-radius:6px;padding:3px 8px;width:fit-content;
    max-width:200px;cursor:pointer;position:relative;z-index:50;
  }
  .rv-pdr-note:hover { background:#2a2310; }
  #rv-tekion-btn {
    position:fixed;z-index:9999;
    background:#0d0d0d;color:#5b9bd5;border:1px solid #1e4d8c;border-radius:8px;
    padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;
    font-family:'Segoe UI',sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.4);
    display:flex;align-items:center;gap:5px;white-space:nowrap;
  }
  #rv-tekion-btn:hover { background:#13243a; }
  .rv-tekion-btn-error {
    background:#7f1d1d !important;color:#fecaca !important;border-color:#991b1b !important;
  }
  .rv-tekion-btn-error:hover { background:#991b1b !important; }
  .info-bar__item--stock.rv-stacked {
    display:flex !important;flex-direction:column !important;align-items:flex-start !important;
  }
  .rv-cant-move-btn:hover { background:#2a2a2a; }
  .rv-cant-move-btn.active {
    background:#7f1d1d;color:#fff;border-color:#991b1b;
  }
`);

function getCache() {
  try {
    const raw = GM_getValue('rv_bucket_cache', '{}');
    return JSON.parse(raw);
  } catch(e) { return {}; }
}

function saveCache(cache) {
  GM_setValue('rv_bucket_cache', JSON.stringify(cache));
}

// Scrape Inv# numbers + work order links from the bucket list page
function scrapeBucketRows() {
  const rows = [];
  document.querySelectorAll('.info-bar__item--inv').forEach(el => {
    const text = el.innerText.replace(/\s+/g, ' ').trim();
    const m = text.match(/WAL(\d+)/);
    if (!m) return;
    const invId = m[1];
    // Find the stock# in the same card
    const card = el.closest('#vehicle-info-bar') || el.closest('.info-bar');
    let stockEl = card ? card.querySelector('.info-bar__item--stock div') : null;
    const stock = stockEl ? stockEl.innerText.trim() : invId;
    const link = card ? card.querySelector('.work-order-link') : null;

    // The actual work order ID used in /work_orders/{id}/edit URLs is NOT
    // always the same number as the Inv# (WAL######). They happen to
    // match for some vehicles but not all -- using the Inv# number when
    // they diverge sends auto-move/Tekion-button clicks to the wrong (or
    // a nonexistent) work order, which silently redirects elsewhere in
    // RV. Pull the real ID from the link's href when available, and only
    // fall back to the Inv# number if no link/href is found.
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

// Fetch a single work order page and extract status of tracked departments
function fetchWorkOrderStatus(woId) {
  return fetch(`https://app.reconvision.com/work_orders/${woId}/edit`, { credentials: 'include' })
    .then(r => r.text())
    .then(html => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const result = {}; // key -> { exists: true, incomplete: true/false }
      TRACKED_DEPTS.forEach(dept => {
        const sections = [...doc.querySelectorAll('section.work-order-breakdown--department')]
          .filter(sec => dept.match.test(sec.className));
        if (!sections.length) return;
        let anyIncomplete = false;
        sections.forEach(sec => {
          // Look for task buttons within this section
          sec.querySelectorAll('button[id^="completed-"]').forEach(btn => {
            const txt = btn.textContent.trim().toUpperCase();
            if (txt === 'INCOMPLETE') anyIncomplete = true;
            // "TASK COMPLETED" or "COMPLETE TASK" (not yet clicked) don't count as incomplete-flag
            // but COMPLETE TASK (active, clickable) without disabled means pending -> treat as incomplete
          });
          // Also catch "COMPLETE TASK" active buttons (not yet marked complete)
          sec.querySelectorAll('a.check-for-inspection-completion, a[href*="complete_service"]').forEach(() => {
            anyIncomplete = true;
          });
        });
        result[dept.key] = { exists: true, incomplete: anyIncomplete };
      });

      // Tire mount/balance gate for the Alloy Wheel tag: if a "Mount and
      // Balance" tire line item exists anywhere on the RO and isn't
      // complete yet, Alloy Wheel work shouldn't be done before it.
      let tiresIncomplete = false;
      let tiresLineExists = false;
      doc.querySelectorAll('tr.table__row--content').forEach(row => {
        const nameInput = row.querySelector('.work-order-cell--svc input[name*="[name]"]');
        const name = nameInput ? (nameInput.value || nameInput.title || '') : '';
        if (/mount\s*(and|&)?\s*balance/i.test(name) && /tire/i.test(name)) {
          tiresLineExists = true;
          const completedBtn = row.querySelector('button[id^="completed-"]');
          if (completedBtn && completedBtn.textContent.trim().toUpperCase() === 'INCOMPLETE') {
            tiresIncomplete = true;
          }
          if (row.querySelector('a.check-for-inspection-completion, a[href*="complete_service"]')) {
            tiresIncomplete = true;
          }
        }
      });
      result._tiresBlockAlloy = tiresLineExists && tiresIncomplete;

      return result;
    })
    .catch(() => null);
}

function buildScanBar() {
  const bar = document.createElement('div');
  bar.id = 'rv-scan-bar';
  const btn = document.createElement('button');
  btn.id = 'rv-scan-btn';
  btn.textContent = 'Scan Bucket';
  const status = document.createElement('span');
  status.id = 'rv-scan-status';
  status.textContent = '';
  bar.appendChild(btn);
  bar.appendChild(status);

  const mainContent = document.querySelector('main.content') || document.body;
  mainContent.insertBefore(bar, mainContent.firstChild);

  btn.addEventListener('click', () => runScan(btn, status, false));

  return { btn, status };
}

async function runScan(btn, status, isAuto) {
  if (btn) btn.disabled = true;
  const rows = scrapeBucketRows();
  if (!rows.length) {
    if (status) status.textContent = 'No vehicles found on this page.';
    if (btn) btn.disabled = false;
    return;
  }

  let cache = getCache();
  const RESCAN_SKIP_MS = 30 * 60 * 1000; // don't re-check clean vehicles scanned in last 30 min

  // Decide which rows actually need a fetch
  const toScan = rows.filter(row => {
    const entry = cache[row.woId];
    if (!entry) return true; // never scanned -> scan it
    if (entry.depts) {
      const stillIncomplete = Object.values(entry.depts).some(d => d.incomplete);
      if (stillIncomplete) return true; // currently flagged -> always rescan to catch completion
    }
    // clean/unflagged and recently scanned -> skip
    if (entry.lastScanned && (Date.now() - entry.lastScanned) < RESCAN_SKIP_MS) return false;
    return true;
  });

  if (!toScan.length) {
    if (status) status.textContent = isAuto ? 'Up to date.' : 'Nothing new to scan.';
    if (btn) btn.disabled = false;
    return;
  }

  let scanned = 0;
  for (const row of toScan) {
    if (status) status.textContent = `Scanning ${scanned + 1} of ${toScan.length}...`;
    const result = await fetchWorkOrderStatus(row.woId);
    scanned++;

    if (!result) continue;

    // Re-read cache fresh right before writing, so a manual Can't Move toggle
    // (or PDR count edit) made while this scan was awaiting the fetch isn't
    // clobbered by a stale in-memory snapshot.
    cache = getCache();
    const cantMove = cache[row.woId] && cache[row.woId].cantMove;

    const tiresBlockAlloy = !!result._tiresBlockAlloy;
    const trackedKeys = Object.keys(result).filter(k => k !== '_tiresBlockAlloy');
    if (!trackedKeys.length) {
      // Vehicle has no tracked departments at all anymore -> fully clean,
      // clear everything including the PDR count badge.
      delete cache[row.woId];
      saveCache(cache);
      applyHighlights();
      continue;
    }

    const anyIncomplete = trackedKeys.some(k => result[k].incomplete);

    if (anyIncomplete) {
      const depts = {};
      trackedKeys.forEach(k => { depts[k] = result[k]; });
      cache[row.woId] = {
        stock: row.stock,
        depts: depts,
        cantMove: cantMove || false,
        tiresBlockAlloy: tiresBlockAlloy,
        pdrCount: (cache[row.woId] && typeof cache[row.woId].pdrCount === "number") ? cache[row.woId].pdrCount : undefined,
        lastScanned: Date.now()
      };
    } else {
      // All tracked departments are now complete -> fully clean, clear
      // the cache entry entirely (including the PDR count badge).
      delete cache[row.woId];
    }
    saveCache(cache);
    applyHighlights();

    // Small delay so this never feels like it's hammering the page
    await new Promise(r => setTimeout(r, 150));
  }

  if (status) status.textContent = `Scan complete — ${Object.keys(getCache()).length} flagged.`;
  if (btn) btn.disabled = false;
}

function applyHighlights() {
  const cache = getCache();
  scrapeBucketRows().forEach(row => {
    const entry = cache[row.woId];
    const card = row.link ? row.link.closest('#vehicle-info-bar') : null;
    if (!card) return;
    const stockEls = card.querySelectorAll('.info-bar__item--stock div');

    stockEls.forEach(stockEl => {
      if (!stockEl.isConnected) return;
      // Remove any prior flag wrapper
      stockEl.classList.remove('rv-flag-blue', 'rv-flag-red');
      const wrapper = stockEl.closest('.info-bar__item--stock') || stockEl.parentElement;
      if (!wrapper) return;
      wrapper.classList.remove('rv-stacked');
      const oldBtn = wrapper.querySelector('.rv-cant-move-btn');
      if (oldBtn) oldBtn.remove();
      const oldTags = wrapper.querySelector('.rv-dept-tags');
      if (oldTags) oldTags.remove();
      const oldNote = wrapper.querySelector('.rv-pdr-note');
      if (oldNote) oldNote.remove();
    });

    if (!entry) return; // not flagged at all, leave clean

    const isIncomplete = !!entry.depts;

    stockEls.forEach(stockEl => {
      const wrapper = stockEl.closest('.info-bar__item--stock') || stockEl.parentElement;
      if (!wrapper) return;

      if (isIncomplete) {
        stockEl.classList.add(entry.cantMove ? 'rv-flag-red' : 'rv-flag-blue');
        wrapper.classList.add('rv-stacked');

        const cantMoveBtn = document.createElement('button');
        cantMoveBtn.type = 'button';
        cantMoveBtn.className = 'rv-cant-move-btn' + (entry.cantMove ? ' active' : '');
        cantMoveBtn.textContent = entry.cantMove ? "✕ CAN'T MOVE" : "CAN'T MOVE?";
        cantMoveBtn.title = "Mark that this vehicle can't be moved right now";
        cantMoveBtn.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          e.stopImmediatePropagation();
        }, true);
        cantMoveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const c = getCache();
        if (c[row.woId]) {
          c[row.woId].cantMove = !c[row.woId].cantMove;
          saveCache(c);
          applyHighlights();
        }
        return false;
      }, true);
        wrapper.appendChild(cantMoveBtn);

        // List which tracked departments are still incomplete, as clickable tags.
        // Clicking opens the work order in a new tab and auto-clicks through
        // Actions -> Send to another dept -> the matching department button.
        const neededKeys = Object.keys(entry.depts).filter(k => entry.depts[k].incomplete);
        if (neededKeys.length) {
          const tagRow = document.createElement('div');
          tagRow.className = 'rv-dept-tags';
          neededKeys.forEach(key => {
            const isBlockedAlloy = key === 'ALLOY' && entry.tiresBlockAlloy;

            const tag = document.createElement('button');
            tag.type = 'button';
            tag.className = 'rv-dept-tag ' + key + (isBlockedAlloy ? ' rv-dept-tag-blocked' : '');
            tag.textContent = key;
            tag.title = isBlockedAlloy
              ? 'Alloy Wheel blocked: Mount and Balance tires is not complete yet'
              : `${key} still incomplete — click to move this vehicle to ${key}`;
            tag.addEventListener('mousedown', (e) => {
              e.stopPropagation();
              e.stopImmediatePropagation();
            }, true);
            tag.addEventListener('click', async (e) => {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();

              if (tag.disabled) return; // already actioned, ignore repeat clicks

              if (isBlockedAlloy) {
                alert('Alloy Wheel is blocked until Mount and Balance Tires is completed.');
                return;
              }

              // The cached flag can be stale -- the task may have been
              // completed on the work order page itself since the last
              // scan, and the bucket page has no way to know that until
              // its next scheduled rescan. Re-check the live status right
              // before acting so a stale tag can't trigger a pointless
              // (or confusing) move attempt.
              tag.disabled = true;
              const origText = tag.textContent;
              tag.textContent = '...';
              console.log('[Bucket Scanner] Live-checking', key, 'status for woId =', row.woId, 'before acting.');
              const liveResult = await fetchWorkOrderStatus(row.woId);
              console.log('[Bucket Scanner] Live check result:', liveResult);
              const stillIncomplete = liveResult && liveResult[key] && liveResult[key].incomplete;
              console.log('[Bucket Scanner] stillIncomplete for', key, '=', stillIncomplete);
              tag.textContent = origText;

              if (!stillIncomplete) {
                // Already complete -- remove this tag and don't proceed.
                tag.remove();
                alert(`${key} is already complete on this vehicle. Refreshing its status.`);
                const c = getCache();
                if (c[row.woId] && c[row.woId].depts) {
                  delete c[row.woId].depts[key];
                  if (!Object.keys(c[row.woId].depts).length) {
                    delete c[row.woId];
                  }
                  saveCache(c);
                }
                applyHighlights();
                return;
              }
              tag.disabled = false;

              // PDR has a hard cap: only move the vehicle if the current PDR
              // count entered is under 30. The count is asked every time and
              // also stored on the vehicle so it travels with it afterward.
              if (key === 'PDR') {
                const raw = prompt('Current PDR count in your bucket (required to move to PDR):', '');
                if (raw === null) return; // cancelled, do not move
                const count = parseInt(raw, 10);
                if (isNaN(count)) {
                  alert('Enter a number for the current PDR count.');
                  return;
                }
                if (count >= 30) {
                  // Still save the count so the badge reflects it, but
                  // don't lock the button out since the move never happened.
                  const c = getCache();
                  if (c[row.woId]) {
                    c[row.woId].pdrCount = count;
                    saveCache(c);
                    applyHighlights();
                  }
                  alert(`PDR is at ${count} — at or over the 30 limit. Not moving this vehicle.`);
                  return;
                }
                // Lock the button out immediately so it can't be clicked
                // again before the next scan removes it entirely once PDR
                // shows complete on the work order.
                tag.disabled = true;
                tag.classList.add('rv-dept-tag-blocked');
                tag.title = 'Move already submitted for PDR — waiting for next scan to confirm.';
                const c = getCache();
                if (c[row.woId]) {
                  c[row.woId].pdrCount = count;
                  saveCache(c);
                }
              }

              const deptId = DEPT_IDS[key];
              const url = deptId
                ? `https://app.reconvision.com/work_orders/${row.woId}/edit#rv_auto_move=${deptId}`
                : `https://app.reconvision.com/work_orders/${row.woId}/edit`;
              window.open(url, '_blank');
            }, true);
            tagRow.appendChild(tag);
          });
          wrapper.appendChild(tagRow);
        }
      }

      // Persistent PDR count badge — shown regardless of current flag state,
      // so everyone can see the last entered PDR count for this vehicle.
      // If PDR task is complete, badge is greyed out and non-clickable.
      if (typeof entry.pdrCount === 'number') {
        const pdrComplete = !entry.depts || !entry.depts.PDR || !entry.depts.PDR.incomplete;
        const noteEl = document.createElement('div');
        noteEl.className = 'rv-pdr-note';
        noteEl.textContent = 'PDR ct: ' + entry.pdrCount;
        if (pdrComplete) {
          noteEl.title = 'PDR task complete.';
          noteEl.style.opacity = '0.4';
          noteEl.style.cursor = 'default';
          noteEl.style.pointerEvents = 'none';
        } else {
          noteEl.title = 'Current PDR count entered when this vehicle was moved. Click to update.';
          noteEl.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
          }, true);
          noteEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            const c = getCache();
            if (!c[row.woId]) return;
            const raw = prompt('Update current PDR count:', String(c[row.woId].pdrCount));
            if (raw === null) return;
            const count = parseInt(raw, 10);
            if (isNaN(count)) return;
            c[row.woId].pdrCount = count;
            saveCache(c);
            applyHighlights();
          }, true);
        }
        wrapper.appendChild(noteEl);
      }
    });
  });
}

function init() {
  const { btn, status } = buildScanBar();
  applyHighlights(); // show any previously cached flags immediately on load

  // Auto-scan in the background — only fetches new or currently-flagged vehicles,
  // skips clean ones scanned recently. Doesn't block the page or require interaction.
  status.textContent = 'Auto-scanning in background...';
  runScan(null, status, true);
}

// --- Tekion button: button on the work order edit page that opens this  ---
// --- RO in Tekion's Parts Fulfillment and auto-drives the Create        ---
// --- Fulfillment flow there. Tracks the RO# field's position as the     ---
// --- page scrolls, and reuses a single named Tekion window/tab rather   ---
// --- than opening a new one every click (so it stays on whatever screen ---
// --- you've already got Tekion's Parts RO Sales open on).               ---
function injectTekionButton() {
  // RO# lives in the info bar: <p class="info-bar__item repair-order-number">
  const roEl = document.querySelector('.repair-order-number');
  let roNumber = null;
  if (roEl) {
    const spans = roEl.querySelectorAll('span');
    if (spans.length >= 2) roNumber = spans[spans.length - 1].textContent.trim();
  }
  if (!roNumber || !roEl) return; // no RO yet on this vehicle, nothing to open

  const btn = document.createElement('button');
  btn.id = 'rv-tekion-btn';
  btn.type = 'button';
  btn.textContent = '🔧 Open in Tekion';
  btn.title = `Open RO# ${roNumber} in Tekion Parts Fulfillment`;
  btn.addEventListener('click', () => {
    // Write the RO# to shared Tampermonkey storage rather than trying to
    // window.open() a specific tab. window.open can only ever "reuse" a
    // tab it itself opened previously -- it has no way to find or target
    // an existing manually-opened Tekion tab on another screen. The
    // Tekion-side script polls this value instead, so it picks up the
    // request on whatever Tekion tab is already open, wherever it is.
    const sentTs = Date.now();
    GM_setValue('rv_tekion_ro_request', { ro: roNumber, ts: sentTs });
    console.log('[Bucket Scanner] Sent RO# to Tekion:', roNumber);
    btn.classList.remove('rv-tekion-btn-error');
    btn.textContent = '✓ Sent to Tekion';

    // Poll briefly for the Tekion-side watcher to acknowledge receipt.
    // If nothing acks within ~5s, the Tekion tab's script is probably
    // stale (needs a refresh to pick up an update) or there's no Tekion
    // tab open with the watcher running at all.
    let acked = false;
    let checks = 0;
    const ackCheck = setInterval(() => {
      checks++;
      const ack = GM_getValue('rv_tekion_ack', 0);
      if (ack === sentTs) {
        acked = true;
        clearInterval(ackCheck);
        btn.classList.remove('rv-tekion-btn-error');
        btn.textContent = '✓ Sent to Tekion';
        setTimeout(() => { btn.textContent = '🔧 Open in Tekion'; }, 1500);
        return;
      }
      if (checks >= 10) { // ~5s at 500ms
        clearInterval(ackCheck);
        if (!acked) {
          btn.classList.add('rv-tekion-btn-error');
          btn.textContent = '⚠ Refresh Tekion';
          btn.title = 'No response from the Tekion tab — refresh it to pick up the latest script, then try again.';
        }
      }
    }, 500);
  });
  document.body.appendChild(btn);

  // Position the button right next to the RO# field, and keep it pinned
  // there as the page scrolls (the info bar itself isn't sticky, so we
  // reposition on every scroll/resize tick).
  function positionButton() {
    const rect = roEl.getBoundingClientRect();
    btn.style.left = rect.left + 'px';
    btn.style.top = (rect.bottom + 14) + 'px';
    // Hide the button entirely once the RO field has scrolled out of view,
    // rather than leaving it floating somewhere disconnected from context.
    const offscreen = rect.bottom < 0 || rect.top > window.innerHeight;
    btn.style.display = offscreen ? 'none' : 'flex';
  }

  positionButton();
  window.addEventListener('scroll', positionButton, { passive: true });
  window.addEventListener('resize', positionButton, { passive: true });
}


// --- Tekion side: runs on app.tekioncloud.com. Polls the shared GM value ---
// for a new RO# request from the RV button and auto-drives the Create     ---
// Fulfillment flow whenever it sees one, on whatever Tekion tab happens   ---
// to be open -- including a tab you opened manually yourself.            ---
function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value') &&
                  Object.getOwnPropertyDescriptor(proto, 'value').set;
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value.slice(-1) }));
  el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: value.slice(-1) }));
}

function runTekionFulfillment(roNumber) {
  let stage = 'navigateIfNeeded';
  let attempts = 0;
  const maxAttempts = 100; // ~25s at 250ms
  console.log('[Bucket Scanner / Tekion] Starting fulfillment flow for RO#', roNumber);

  const tick = setInterval(() => {
    attempts++;
    if (attempts > maxAttempts) {
      clearInterval(tick);
      console.warn('[Bucket Scanner / Tekion] Timed out at stage: ' + stage);
      return;
    }

    if (stage === 'navigateIfNeeded') {
      if (!location.pathname.includes('/parts/ro-sales/parts-fulfillment')) {
        console.log('[Bucket Scanner / Tekion] Navigating to Parts Fulfillment page...');
        location.href = 'https://app.tekioncloud.com/parts/ro-sales/parts-fulfillment';
        clearInterval(tick);
        // Page will reload onto the right URL; the load-time check below
        // picks the pending request back up once it lands there.
        return;
      }
      console.log('[Bucket Scanner / Tekion] Already on Parts Fulfillment page.');
      stage = 'waitForCreateFulfillment';
      return;
    }

    if (stage === 'waitForCreateFulfillment') {
      const createBtn = document.querySelector(
        '[data-test-id="@tekion-parts-partsRoSales-common-createGroupedPartRequestsModalButton"]'
      );
      if (createBtn) {
        createBtn.click();
        stage = 'waitForRoInput';
      }
      return;
    }

    if (stage === 'waitForRoInput') {
      const roInput = document.querySelector(
        '[data-test-id^="@tekion-parts-partsRoSales-common-createGroupedPartRequestsSelect"] input.ant-select-search__field, ' +
        'input.ant-select-search__field'
      );
      if (roInput) {
        roInput.focus();
        setNativeValue(roInput, roNumber);
        stage = 'waitForDropdownOption';
      }
      return;
    }

    if (stage === 'waitForDropdownOption') {
      const options = document.querySelectorAll(
        '.ant-select-item-option, .ant-select-dropdown li, [role="option"]'
      );
      let match = null;
      options.forEach(opt => {
        if (!match && opt.textContent && opt.textContent.includes(roNumber)) {
          match = opt;
        }
      });
      if (match) {
        match.click();
        stage = 'waitForSubmit';
      }
      return;
    }

    if (stage === 'waitForSubmit') {
      const submitBtn = document.querySelector(
        '[data-test-id="@tekion-parts-roSalesDetailedView-createGroupedPartRequestsModal-container-submitButton"]'
      );
      if (submitBtn && !submitBtn.disabled) {
        clearInterval(tick);
        submitBtn.click();
      }
      return;
    }
  }, 250);
}

function watchForTekionRequests() {
  console.log('[Bucket Scanner] Tekion watcher active on', location.href);
  // Tell the RV side this tab's watcher is alive at all, even before any
  // request comes in -- lets the RV button know a watcher is present.
  GM_setValue('rv_tekion_watcher_alive', Date.now());
  setInterval(() => { GM_setValue('rv_tekion_watcher_alive', Date.now()); }, 5000);

  let lastSeenTs = 0;
  setInterval(() => {
    const req = GM_getValue('rv_tekion_ro_request', null);
    if (req && req.ts !== lastSeenTs) {
      console.log('[Bucket Scanner] Tekion watcher picked up request:', req);
      lastSeenTs = req.ts;
      GM_setValue('rv_tekion_ack', req.ts); // confirm receipt back to the RV button
      runTekionFulfillment(req.ro);
    }
  }, 1000);

  // Also check immediately on load in case this tab was opened or
  // reloaded after a request was already sent (e.g. it had to navigate
  // to the right URL first).
  const initial = GM_getValue('rv_tekion_ro_request', null);
  if (initial) {
    console.log('[Bucket Scanner] Found existing request on load:', initial);
    lastSeenTs = initial.ts;
    GM_setValue('rv_tekion_ack', initial.ts);
    if (location.pathname.includes('/parts/ro-sales/parts-fulfillment')) {
      runTekionFulfillment(initial.ro);
    }
  }
}


// --- Auto-move: runs on work order edit pages opened via a dept tag click ---
// URL carries #rv_auto_move=<departmentId>. We click Actions -> Send to
// another dept -> the matching assign_to_dept_button for that ID.
function tryAutoMove() {
  const match = location.hash.match(/rv_auto_move=(\d+)/);
  if (!match) {
    console.log('[Bucket Scanner] tryAutoMove: no rv_auto_move hash found, skipping.', location.hash);
    return;
  }
  const deptId = match[1];
  console.log('[Bucket Scanner] tryAutoMove: starting, target department ID =', deptId, 'on', location.href);

  let attempts = 0;
  const maxAttempts = 40; // ~10s at 250ms

  const tick = setInterval(() => {
    attempts++;
    if (attempts > maxAttempts) {
      clearInterval(tick);
      console.warn('[Bucket Scanner] Auto-move timed out waiting for Actions panel or department button.');
      return;
    }

    // Step 1: open the Actions panel if not already open
    const actionsLink = document.querySelector('a[data-modal-target="actionsModal"][role="button"]');
    const actionsPanel = document.querySelector('.panel.panel--lg[data-work-order-form-sidebar-nav-controller-target="actionsModal"]');
    const panelOpen = actionsPanel && actionsPanel.classList.contains('is-open');

    if (!panelOpen) {
      if (attempts === 1 || attempts % 8 === 0) {
        console.log('[Bucket Scanner] tryAutoMove: Actions panel not open yet (attempt ' + attempts + '). actionsLink found:', !!actionsLink, 'actionsPanel found:', !!actionsPanel);
      }
      if (actionsLink) actionsLink.click();
      return; // wait for next tick to let it render
    }

    // Step 2: find the matching department button by data-department-id
    const deptBtn = document.querySelector(
      `.assign_to_dept_button[data-department-id="${deptId}"]`
    );

    if (deptBtn) {
      console.log('[Bucket Scanner] tryAutoMove: found department button, clicking now.', deptBtn);
      clearInterval(tick);
      deptBtn.click();
      console.log('[Bucket Scanner] tryAutoMove: click dispatched, will close tab in 1.5s.');
      setTimeout(() => {
        console.log('[Bucket Scanner] tryAutoMove: closing tab now.');
        window.close();
      }, 1500);
    } else if (attempts === 1 || attempts % 8 === 0) {
      const allDeptBtns = [...document.querySelectorAll('.assign_to_dept_button')].map(b => b.dataset.departmentId);
      console.log('[Bucket Scanner] tryAutoMove: Actions panel open but department button not found yet (attempt ' + attempts + '). Looking for ID ' + deptId + '. Buttons currently in DOM:', allDeptBtns);
    }
    // If not found yet (subnav hover-reveal not rendered), keep polling —
    // the buttons exist in the DOM once the Actions panel is open, just
    // sometimes inside a CSS-hover-revealed subnav that doesn't need a
    // separate click to access since we're targeting it directly.
  }, 250);
}

if (location.hostname === 'app.tekioncloud.com') {
  setTimeout(watchForTekionRequests, 500);
} else if (location.pathname.match(/\/work_orders\/\d+\/edit/)) {
  setTimeout(tryAutoMove, 800);
  setTimeout(injectTekionButton, 1200);
} else {
  setTimeout(init, 1000);
}

})();
