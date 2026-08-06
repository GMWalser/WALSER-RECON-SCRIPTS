// ==UserScript==
// @name         RV-Tekion Parts Bridge
// @namespace    http://tampermonkey.net/
// @version      2.21
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/PARTS_BRIDGE.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/PARTS_BRIDGE.js
// @description  Collect parts from Tekion fulfillment, paste into RV Parts modal with auto-matched service lines, searchable dropdown, N/A skip option, and Push All.
// @match        https://app.tekioncloud.com/*
// @match        https://app.reconvision.com/work_orders/*/edit*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

const LOG = '[Parts Bridge]';
const IS_TK = location.hostname.includes('tekion');
const IS_RV = location.hostname.includes('reconvision');
const BRIDGE_KEY = 'parts_bridge_data';
const NA_LABEL = '— N/A / Skip —';
// Only the 4 statuses Gabe actually uses — values kept matched to RV's real
// option numbers (2=Backordered and 4=In Transit exist in RV but aren't offered here).
const STATUS_OPTIONS = [
  { value: '1', label: 'Action Required' },
  { value: '3', label: 'Ordered' },
  { value: '5', label: 'Arrived' },
  { value: '6', label: 'In Stock' },
];
const DEFAULT_STATUS = '1'; // Action Required

function log(...args) { console.log(LOG, ...args); }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// RV service lines that are workflow/status — parts NEVER go on these
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

// Dealership / destination codes (where the vehicle is going), not real service
// lines — a part should never be added to one of these. List sourced from the
// same vendor codes used in PO Vendor Quick-Add, plus KIA per Gabe.
const DEALER_DESTINATION_CODES = [
  'kia', 'fmp', 'napa', 'az', 'or', 'wp', '1-800',
  'bgb', 'cjd', 'dob', 'ford', 'hon', 'maz igh', 'nis', 'sub stp', 'toy',
  'aaa', 'pams', 'lkq', 'key', 'usaf',
];
// Catches destination codes not yet catalogued above, e.g. "KIA-29", "HON-14" —
// short letters followed by a dash and a number. No real service line looks like this.
const DEALER_CODE_WITH_NUMBER_PATTERN = /^[a-z]{2,6}-\d{1,4}$/i;

// Matches "Rob's Line", "Chaz's Line", "Andres Line" (no apostrophe), etc. —
// any single name followed by an optional 's and the word "Line" — so a new
// person's line is excluded automatically without needing their name added here.
const PERSONAL_LINE_PATTERN = /^[a-z]+'?s?\s+line$/i;

function isSkipLine(serviceName) {
  const normalized = (serviceName || '').toLowerCase().trim();
  if (RV_SKIP_LINES.includes(normalized)) return true;
  if (PERSONAL_LINE_PATTERN.test(normalized)) return true;
  if (DEALER_DESTINATION_CODES.includes(normalized)) return true;
  if (DEALER_CODE_WITH_NUMBER_PATTERN.test(normalized)) return true;
  return false;
}

// Oil filters, drain plug gaskets, and oil itself all belong on the "LOF"
// (Lube, Oil, Filter) line — which may or may not also say "Fast Pass".
const OIL_PART_KEYWORDS = ['oil filter', 'drain plug gasket', 'oil'];
const LOF_WORD_PATTERN = /\blof\b/i;

function isOilRelatedText(text) {
  const t = (text || '').toLowerCase();
  return OIL_PART_KEYWORDS.some(kw => t.includes(kw));
}

function getBridgeData() {
  try { return JSON.parse(GM_getValue(BRIDGE_KEY, '[]')); } catch(e) { return []; }
}
function saveBridgeData(arr) { GM_setValue(BRIDGE_KEY, JSON.stringify(arr)); }
function clearBridgeData() { GM_setValue(BRIDGE_KEY, '[]'); }

// =============================================
// FUZZY SERVICE LINE MATCHER
// =============================================
function matchScore(tekionJob, rvService) {
  const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 1);
  const tWords = normalize(tekionJob);
  const rWords = normalize(rvService);
  if (!tWords.length || !rWords.length) return 0;
  let hits = 0;
  for (const tw of tWords) {
    for (const rw of rWords) {
      if (rw.includes(tw) || tw.includes(rw)) { hits++; break; }
    }
  }
  return hits / Math.max(tWords.length, rWords.length);
}

function findBestMatch(tekionJob, rvServices, partDescription) {
  if (!tekionJob || tekionJob === '(unknown)') return -1;
  const skipJobs = ['recon fees', 'estimate parts', 'retail inspection', 'complete exterior & interior detail'];
  if (skipJobs.includes(tekionJob.toLowerCase().replace(/\*/g, '').trim())) return -1;

  // Oil filters, drain plug gaskets, and oil itself go on whichever line has
  // "LOF" in it — that's a fixed abbreviation (Lube, Oil, Filter), so normal
  // word-overlap fuzzy matching won't find it on its own (the line rarely
  // spells out "oil" or "filter"). Check this first and short-circuit if found.
  if (isOilRelatedText(partDescription)) {
    for (let idx = 0; idx < rvServices.length; idx++) {
      if (isSkipLine(rvServices[idx][0])) continue;
      if (LOF_WORD_PATTERN.test(rvServices[idx][0])) return idx;
    }
  }

  let bestIdx = -1;
  let bestScore = 0;
  rvServices.forEach((svc, idx) => {
    if (isSkipLine(svc[0])) return;
    const score = matchScore(tekionJob, svc[0]);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });
  return bestScore >= 0.2 ? bestIdx : -1;
}

// =============================================
// TEKION SIDE — Collect parts from fulfillment
// =============================================
if (IS_TK) {

  const PANEL_ID = 'pb-tk-panel';
  const PILL_ID = 'pb-tk-pill';

  function tkScrapeJobs() {
    const parts = [];

    const jobPositions = [];
    const allText = document.body.innerText;
    const jobRegex = /Job\s+(\d+)\s*-\s*([^\n]+)/g;
    let match;
    const jobNames = [];
    while ((match = jobRegex.exec(allText)) !== null) {
      jobNames.push(match[2].trim());
    }
    log('Jobs found from text:', jobNames);

    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      if (el.children.length > 3) continue;
      const text = el.textContent.trim();
      const jm = text.match(/^Job\s+\d+\s*-\s*(.+)$/);
      if (jm && text.length < 200) {
        const rect = el.getBoundingClientRect();
        if (rect.height > 0 && rect.height < 100) {
          jobPositions.push({ name: jm[1].trim(), y: rect.top });
          log('Job heading found at y=' + Math.round(rect.top) + ':', jm[1].trim());
        }
      }
    }
    jobPositions.sort((a, b) => a.y - b.y);

    const partCells = document.querySelectorAll('[data-test-id*="itemName-cell"]');
    log('Part cells found (itemName-cell):', partCells.length);

    partCells.forEach((cell) => {
      let rawText = cell.textContent.trim();
      if (!rawText || rawText === 'Select') {
        // Freshly-typed rows show a live, still-editable combobox instead of
        // static text — the part# + description sits in the input's value
        // property, which textContent can't see at all. Fall back to it.
        const liveInput = cell.querySelector('input[data-test-id*="partSelect"]');
        if (liveInput && liveInput.value) {
          rawText = liveInput.value.trim();
        }
      }
      if (!rawText || rawText === 'Select' || rawText.length < 3) return;
      if (rawText.toUpperCase().includes('PULSE')) return;

      const dashIdx = rawText.indexOf(' - ');
      const partNumber = dashIdx > 0 ? rawText.substring(0, dashIdx).trim() : rawText;
      const description = dashIdx > 0 ? rawText.substring(dashIdx + 3).trim() : '';

      const testId = cell.getAttribute('data-test-id') || '';
      const rowMatch = testId.match(/cell-(\d+)-(\d+)/);
      let sellingPrice = '';
      let qty = '1';

      if (rowMatch) {
        const rowPrefix = rowMatch[1];
        // Scope to this part's own job section — each Job section has its own table
        // that restarts row numbering at 0, so a document-wide query can grab a
        // different job's row with the same index. closest() keeps the lookup local.
        const scope = cell.closest('[class*="root_section_container"]') || document;
        const priceCell = scope.querySelector(`[data-test-id*="sellingPrice-cell-${rowPrefix}-"]`);
        if (priceCell) {
          sellingPrice = priceCell.textContent.trim().replace(/[$,P\s]/g, '').trim();
        }
        const qtyCell = scope.querySelector(`[data-test-id*="saleQty-cell-${rowPrefix}-"]`) ||
                        scope.querySelector(`[data-test-id*="requiredQuantity-cell-${rowPrefix}-"]`);
        if (qtyCell) {
          const qVal = qtyCell.textContent.trim();
          if (/^\d+$/.test(qVal)) qty = qVal;
        }
      }

      const cellY = cell.getBoundingClientRect().top;
      let tekionJob = '(unknown)';
      for (let i = jobPositions.length - 1; i >= 0; i--) {
        if (jobPositions[i].y < cellY) {
          tekionJob = jobPositions[i].name;
          break;
        }
      }

      log('  Part:', partNumber, '|', description, '| $' + sellingPrice, '| Job:', tekionJob);
      parts.push({ partNumber, description, qty, sellingPrice, tekionJob });
    });

    log('Total parts scraped:', parts.length);
    return parts;
  }

  function tkBuildFullPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const parts = tkScrapeJobs();
    if (!parts.length) { tkEnsureEntryPoint(); return; }

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = `
      position:fixed;top:60px;right:16px;z-index:99999;width:320px;max-height:70vh;
      background:#0d0d0d;border:2px solid #3b82f6;border-radius:10px;
      font-family:'Segoe UI',sans-serif;font-size:12px;color:#e0e0e0;
      box-shadow:0 4px 20px rgba(0,0,0,.6);overflow:hidden;
      display:flex;flex-direction:column;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      padding:10px 14px;background:#1a1a1a;border-bottom:1px solid #222;
      display:flex;justify-content:space-between;align-items:center;
    `;
    header.innerHTML = `<span style="font-weight:700;color:#3b82f6;">📋 Parts to RV</span>`;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '─'; // minimize back to pill, not a full close
    closeBtn.title = 'Minimize';
    closeBtn.style.cssText = 'background:none;border:none;color:#666;font-size:14px;cursor:pointer;';
    closeBtn.onclick = () => { panel.remove(); tkEnsureEntryPoint(); };
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const controls = document.createElement('div');
    controls.style.cssText = 'padding:6px 14px;background:#111;border-bottom:1px solid #222;display:flex;gap:8px;align-items:center;';
    const selectAll = document.createElement('input');
    selectAll.type = 'checkbox';
    selectAll.checked = true;
    selectAll.id = 'pb-select-all';
    const selectLabel = document.createElement('label');
    selectLabel.htmlFor = 'pb-select-all';
    selectLabel.textContent = `Select all (${parts.length})`;
    selectLabel.style.cssText = 'color:#888;font-size:11px;cursor:pointer;';
    controls.appendChild(selectAll);
    controls.appendChild(selectLabel);
    panel.appendChild(controls);

    const list = document.createElement('div');
    list.style.cssText = 'overflow-y:auto;flex:1;padding:6px 0;';

    const checkboxes = [];
    let currentJob = '';
    parts.forEach((part, idx) => {
      if (part.tekionJob !== currentJob) {
        currentJob = part.tekionJob;
        const jobDiv = document.createElement('div');
        jobDiv.style.cssText = 'padding:4px 14px;font-size:10px;color:#666;font-weight:700;text-transform:uppercase;margin-top:4px;';
        jobDiv.textContent = currentJob;
        list.appendChild(jobDiv);
      }

      const row = document.createElement('div');
      row.style.cssText = 'padding:4px 14px;display:flex;align-items:center;gap:8px;';
      row.onmouseenter = () => row.style.background = '#1a1a1a';
      row.onmouseleave = () => row.style.background = 'transparent';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.dataset.idx = idx;
      checkboxes.push(cb);

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0;';
      info.innerHTML = `
        <div style="font-weight:700;color:#60a5fa;font-family:monospace;font-size:11px;">${part.partNumber}</div>
        <div style="color:#888;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${part.description}</div>
      `;

      const priceSpan = document.createElement('span');
      priceSpan.style.cssText = 'color:#4ade80;font-weight:700;font-size:11px;white-space:nowrap;';
      priceSpan.textContent = part.sellingPrice ? '$' + part.sellingPrice : '';

      row.appendChild(cb);
      row.appendChild(info);
      row.appendChild(priceSpan);
      list.appendChild(row);
    });

    panel.appendChild(list);

    selectAll.onchange = () => checkboxes.forEach(cb => cb.checked = selectAll.checked);

    const footer = document.createElement('div');
    footer.style.cssText = 'padding:10px 14px;background:#1a1a1a;border-top:1px solid #222;';

    const sendBtn = document.createElement('button');
    sendBtn.textContent = '📤 Send to RV';
    sendBtn.style.cssText = `
      width:100%;padding:10px;font-weight:700;font-size:13px;border-radius:6px;
      border:none;background:#3b82f6;color:#fff;cursor:pointer;
    `;
    sendBtn.onmouseenter = () => sendBtn.style.background = '#2563eb';
    sendBtn.onmouseleave = () => sendBtn.style.background = '#3b82f6';
    sendBtn.onclick = () => {
      const selected = [];
      checkboxes.forEach(cb => {
        if (cb.checked) selected.push(parts[parseInt(cb.dataset.idx)]);
      });

      // Re-scan right before sending — if a part was added to Tekion after this
      // panel opened, this catches it automatically instead of sending a stale
      // snapshot. New parts are included by default (nothing to uncheck yet).
      const freshParts = tkScrapeJobs();
      const alreadyKnown = new Set(parts.map(p => p.partNumber));
      const newlyFound = freshParts.filter(fp => !alreadyKnown.has(fp.partNumber));
      if (newlyFound.length) {
        log('Found', newlyFound.length, 'new part(s) added since this panel opened — including automatically:', newlyFound.map(p => p.partNumber).join(', '));
      }

      const toSend = selected.concat(newlyFound);
      if (!toSend.length) { alert('No parts selected.'); return; }
      saveBridgeData(toSend);
      GM_setValue('pb_open_request', JSON.stringify({ ts: Date.now() }));

      // Small easter egg: on exactly the 5th time this button has ever been
      // clicked (persisted across reloads), swap the confirmation label once.
      // Easy to remove later — just delete this block.
      const clickCount = (parseInt(GM_getValue('pb_send_click_count', '0'), 10) || 0) + 1;
      GM_setValue('pb_send_click_count', String(clickCount));
      sendBtn.textContent = clickCount === 5
        ? 'Just Gonna Send It!'
        : `✓ ${toSend.length} parts sent!` + (newlyFound.length ? ` (${newlyFound.length} new)` : '');

      sendBtn.style.background = '#14532d';
      sendBtn.style.color = '#4ade80';
      log('Sent', toSend.length, 'parts to bridge storage.');
      setTimeout(() => { panel.remove(); tkEnsureEntryPoint(); }, 1500);
    };

    footer.appendChild(sendBtn);
    panel.appendChild(footer);
    document.body.appendChild(panel);
    log('Parts panel opened with', parts.length, 'parts.');
  }

  // Minimized entry point — shown instead of the full panel until clicked.
  // Every RO starts collapsed; the full panel only opens on click.
  function tkShowPill(count) {
    const existing = document.getElementById(PILL_ID);
    if (existing) {
      const countSpan = existing.querySelector('.pb-pill-count');
      if (countSpan) countSpan.textContent = count;
      return;
    }
    const pill = document.createElement('button');
    pill.id = PILL_ID;
    pill.title = 'Open Parts to RV';
    pill.innerHTML = `📋 Parts to RV <span class="pb-pill-count" style="background:#1e40af;padding:2px 6px;border-radius:10px;margin-left:6px;">${count}</span>`;
    pill.onclick = () => { pill.remove(); tkBuildFullPanel(); };

    // Preferred spot: inside the real totals bar (the row showing "Total: $X.XX"),
    // in the empty space to its right. This is a flex row, so margin-left:auto
    // pushes the pill to the far right without disturbing the existing content.
    const totalsBar = document.querySelector('[class*="fulfillmentDetailedViewHeader"]');
    if (totalsBar) {
      pill.style.cssText = `
        margin-left:24px;background:#3b82f6;color:#fff;border:none;border-radius:8px;
        padding:6px 14px;font-weight:700;font-size:12px;cursor:pointer;white-space:nowrap;
        font-family:'Segoe UI',sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3);
      `;
      totalsBar.appendChild(pill);
    } else {
      // Fallback only — keeps the pill from disappearing entirely if Tekion's
      // layout hasn't rendered that row yet (or changes on a future page state).
      pill.style.cssText = `
        position:fixed;top:110px;right:16px;z-index:99998;
        background:#3b82f6;color:#fff;border:none;border-radius:8px;
        padding:8px 14px;font-weight:700;font-size:12px;cursor:pointer;
        font-family:'Segoe UI',sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.4);
      `;
      document.body.appendChild(pill);
    }
  }

  function tkHidePill() {
    const p = document.getElementById(PILL_ID);
    if (p) p.remove();
  }

  // Decides whether to show the pill, update its count, or hide it — never
  // touches the full panel if it's already open.
  function tkEnsureEntryPoint() {
    if (document.getElementById(PANEL_ID)) return; // full panel open, leave it alone
    if (!location.pathname.includes('/parts/ro-sales/')) { tkHidePill(); return; }
    const parts = tkScrapeJobs();
    if (!parts.length) { tkHidePill(); return; }
    tkShowPill(parts.length);
  }

  let tkEntryDebounce = null;
  function tkScheduleEntryCheck() {
    clearTimeout(tkEntryDebounce);
    tkEntryDebounce = setTimeout(tkEnsureEntryPoint, 800);
  }

  const tkObs = new MutationObserver(() => {
    if (document.getElementById(PANEL_ID)) return; // full panel open, don't rescan
    tkScheduleEntryCheck();
  });
  // characterData catches cases where Tekion updates existing row text in place
  // rather than adding/removing DOM nodes, which plain childList would miss.
  tkObs.observe(document.body, { childList: true, subtree: true, characterData: true });

  // Safety net: re-check every 3s regardless of whether a mutation fired at all.
  // Without a console capture of exactly how Tekion renders a newly-added part
  // row, this is the reliable fix rather than a guess at the precise mutation
  // pattern — it guarantees the pill's count catches up shortly either way.
  setInterval(() => {
    if (document.getElementById(PANEL_ID)) return; // full panel open, don't rescan
    tkEnsureEntryPoint();
  }, 3000);

  setTimeout(tkEnsureEntryPoint, 2000);
}

// =============================================
// RECONVISION SIDE — Paste parts into Parts modal
// =============================================
if (IS_RV) {

  const PASTE_BTN_ID = 'pb-rv-paste-btn';
  const IMPORT_PANEL_ID = 'pb-rv-import-panel';
  const ADD_PART_SELECTOR = '.button-outline[data-action*="parts-modal-controller#addNewPart"]';

  function rvGetServiceLines() {
    const el = document.querySelector('#partsLineItems');
    if (!el) return [];
    try { return JSON.parse(el.value); } catch(e) { return []; }
  }

  function rvIsPartsModalOpen() {
    const modal = document.getElementById('parts_modal');
    return modal && modal.style.display === 'block';
  }

  function rvBuildSearchableSelect(services, selectedIdx, onSelect, partDesc, tekionJob) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;width:100%;';

    const keywords = ((partDesc || '') + ' ' + (tekionJob || ''))
      .toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);

    const oilRelated = isOilRelatedText(partDesc);

    const scored = services.map((svc, idx) => {
      if (isSkipLine(svc[0])) return { svc, idx, score: 0 };
      const svcLower = svc[0].toLowerCase();
      if (oilRelated && LOF_WORD_PATTERN.test(svcLower)) return { svc, idx, score: 999 }; // guaranteed top suggestion
      let score = 0;
      for (const kw of keywords) {
        if (svcLower.includes(kw)) score++;
      }
      return { svc, idx, score };
    });
    const relevant = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = relevant.length ? `${relevant.length} suggested lines` : 'Search all lines...';
    input.value = selectedIdx >= 0 ? services[selectedIdx][0] : '';
    input.style.cssText = `
      width:100%;padding:4px 8px;background:#1a1a1a;color:#e0e0e0;
      border:1px solid ${selectedIdx >= 0 ? '#22c55e' : (relevant.length ? '#f59e0b' : '#f59e0b')};border-radius:4px;font-size:11px;
      font-family:'Segoe UI',sans-serif;box-sizing:border-box;
    `;

    const dropdown = document.createElement('div');
    dropdown.style.cssText = `
      position:absolute;top:100%;left:0;right:0;z-index:100000;
      background:#1a1a1a;border:1px solid #333;border-radius:4px;
      max-height:250px;overflow-y:auto;display:none;
    `;

    function selectNA() {
      input.value = NA_LABEL;
      input.style.borderColor = '#666';
      dropdown.style.display = 'none';
      onSelect(-1); // -1 = explicit skip, serviceId will be ''
    }

    function addNAOption() {
      const opt = document.createElement('div');
      opt.textContent = NA_LABEL;
      opt.style.cssText = `
        padding:4px 8px;cursor:pointer;font-size:11px;
        color:#999;font-style:italic;
        border-bottom:1px solid #333;
      `;
      opt.onmouseenter = () => opt.style.background = '#2a2a2a';
      opt.onmouseleave = () => opt.style.background = 'transparent';
      opt.onclick = selectNA;
      dropdown.appendChild(opt);
    }

    function addOption(svc, idx, highlighted) {
      const opt = document.createElement('div');
      opt.textContent = svc[0];
      opt.style.cssText = `
        padding:4px 8px;cursor:pointer;font-size:11px;
        color:${highlighted ? '#4ade80' : '#ccc'};
        font-weight:${highlighted ? '700' : '400'};
        border-bottom:1px solid #222;
      `;
      opt.onmouseenter = () => opt.style.background = '#2a2a2a';
      opt.onmouseleave = () => opt.style.background = 'transparent';
      opt.onclick = () => {
        input.value = svc[0];
        input.style.borderColor = '#22c55e';
        dropdown.style.display = 'none';
        onSelect(idx);
      };
      dropdown.appendChild(opt);
    }

    function renderOptions(filter) {
      dropdown.innerHTML = '';
      const lf = (filter || '').toLowerCase();

      // N/A always available at the very top
      if (!lf || NA_LABEL.toLowerCase().includes(lf)) addNAOption();

      if (lf) {
        services.forEach((svc, idx) => {
          if (isSkipLine(svc[0])) return; // never selectable, not just deprioritized
          if (!svc[0].toLowerCase().includes(lf)) return;
          addOption(svc, idx);
        });
        return;
      }

      if (relevant.length) {
        const label = document.createElement('div');
        label.textContent = '★ Suggested';
        label.style.cssText = 'padding:4px 8px;font-size:9px;color:#4ade80;font-weight:700;text-transform:uppercase;';
        dropdown.appendChild(label);

        relevant.forEach(r => addOption(r.svc, r.idx, true));

        const divider = document.createElement('div');
        divider.style.cssText = 'border-top:1px solid #333;margin:4px 0;';
        dropdown.appendChild(divider);

        const allLabel = document.createElement('div');
        allLabel.textContent = 'All lines (type to search)';
        allLabel.style.cssText = 'padding:4px 8px;font-size:9px;color:#555;font-weight:700;text-transform:uppercase;';
        dropdown.appendChild(allLabel);
      }

      services.forEach((svc, idx) => {
        if (isSkipLine(svc[0])) return; // never selectable, not just deprioritized
        if (relevant.some(r => r.idx === idx)) return;
        addOption(svc, idx, false);
      });
    }

    input.onfocus = () => { renderOptions(''); dropdown.style.display = 'block'; };
    input.oninput = () => { renderOptions(input.value); dropdown.style.display = 'block'; };
    input.onblur = () => setTimeout(() => dropdown.style.display = 'none', 200);

    wrapper.appendChild(input);
    wrapper.appendChild(dropdown);
    return wrapper;
  }

  function rvFillPartRow(part, serviceId, statusValue, miscValue) {
    const modal = document.getElementById('parts_modal');
    if (!modal) { log('Parts modal not found'); return false; }

    const rows = modal.querySelectorAll('tr[data-id^="new-row-"]');
    let newRow = null;
    for (const r of rows) {
      const pnField = r.querySelector('textarea[id*="part_number"], input[id*="part_number"]');
      if (pnField && !pnField.value) { newRow = r; break; }
    }
    if (!newRow) {
      log('No empty new row found — click + Add Part first');
      return false;
    }
    log('Found empty row:', newRow.getAttribute('data-id'));

    const partField = newRow.querySelector('textarea[id*="part_number"], input[id*="part_number"]');
    if (!partField) { log('Part number field not found in row'); return false; }

    const textSetter = Object.getOwnPropertyDescriptor(
      partField.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
      'value'
    ).set;
    partField.focus();
    textSetter.call(partField, part.partNumber);
    partField.dispatchEvent(new Event('input', { bubbles: true }));
    partField.dispatchEvent(new Event('change', { bubbles: true }));
    partField.dispatchEvent(new Event('keyup', { bubbles: true }));
    log('Set part number:', part.partNumber);

    const descField = newRow.querySelector('td.save_value.description textarea');
    if (descField && part.description) {
      const descSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      descField.focus();
      descSetter.call(descField, part.description);
      descField.dispatchEvent(new Event('input', { bubbles: true }));
      descField.dispatchEvent(new Event('change', { bubbles: true }));
      log('Set description:', part.description);
    } else if (!descField) {
      log('Description field not found in row');
    }

    setTimeout(() => {
      const priceField = newRow.querySelector('td.save_value.part_price input, td.part_price input, input[id*="part_price"]');
      if (priceField && part.sellingPrice) {
        const priceSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        priceField.focus();
        priceSetter.call(priceField, part.sellingPrice);
        priceField.dispatchEvent(new Event('input', { bubbles: true }));
        priceField.dispatchEvent(new Event('change', { bubbles: true }));
        log('Set price:', part.sellingPrice);
      }

      const qtyField = newRow.querySelector('td.save_value.quantity input, input[id*="quantity"]');
      if (qtyField) {
        const qtySetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        qtyField.focus();
        qtySetter.call(qtyField, part.qty || '1');
        qtyField.dispatchEvent(new Event('input', { bubbles: true }));
        qtyField.dispatchEvent(new Event('change', { bubbles: true }));
        log('Set qty:', part.qty);
      }

      if (serviceId) {
        const serviceSelect = newRow.querySelector('td.save_value.service select, select[id*="line_item_id"]');
        if (serviceSelect) {
          serviceSelect.value = serviceId;
          serviceSelect.dispatchEvent(new Event('change', { bubbles: true }));
          const select2Display = newRow.querySelector('.select2-selection__rendered, .select2-selection span');
          if (select2Display) {
            const selectedOpt = serviceSelect.querySelector(`option[value="${serviceId}"]`);
            if (selectedOpt) select2Display.textContent = selectedOpt.textContent;
          }
          log('Set service line:', serviceId);
        } else {
          log('Service select not found in row');
        }
      }

      if (statusValue) {
        const statusSelect = newRow.querySelector('td.save_value.status select, select[data-field-name="status"]');
        if (statusSelect) {
          statusSelect.value = statusValue;
          statusSelect.dispatchEvent(new Event('change', { bubbles: true }));
          log('Set status:', statusValue);
        } else {
          log('Status select not found in row');
        }
      }

      if (miscValue) {
        const miscField = newRow.querySelector('td.save_value.misc input');
        if (miscField) {
          const miscSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          miscField.focus();
          miscSetter.call(miscField, miscValue);
          miscField.dispatchEvent(new Event('input', { bubbles: true }));
          miscField.dispatchEvent(new Event('change', { bubbles: true }));
          log('Set source (misc):', miscValue);
        } else {
          log('Misc/source field not found in row');
        }
      }
    }, 200);

    return true;
  }

  function rvClickAddPart() {
    const addBtn = document.querySelector(ADD_PART_SELECTOR);
    if (!addBtn) { log('Add Part button not found'); return false; }
    addBtn.click();
    return true;
  }

  // Poll for a new empty part-number row to actually appear after clicking Add Part,
  // instead of assuming a fixed delay is always long enough.
  async function rvWaitForEmptyRow(maxMs) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const modal = document.getElementById('parts_modal');
      if (modal) {
        const rows = modal.querySelectorAll('tr[data-id^="new-row-"]');
        for (const r of rows) {
          const pnField = r.querySelector('textarea[id*="part_number"], input[id*="part_number"]');
          if (pnField && !pnField.value) return true;
        }
      }
      await delay(150);
    }
    return false;
  }

  async function rvPushAll(matches, rowEls) {
    let pushed = 0;
    let skipped = 0;
    let failed = 0;
    let disarmed = 0;

    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      if (m.done) continue; // already imported individually

      if (!m.checked) {
        disarmed++;
        continue; // unchecked = already added to RO previously, never touch it
      }

      if (!m.serviceId) {
        skipped++;
        if (rowEls[i]) rowEls[i].style.opacity = '0.35';
        continue;
      }

      const clicked = rvClickAddPart();
      if (!clicked) break;

      const rowReady = await rvWaitForEmptyRow(3000); // poll up to 3s for the new row to render
      if (!rowReady) {
        failed++;
        log('Push All: new row never appeared for', m.part.partNumber, '— skipped, not added to RO.');
        if (rowEls[i]) rowEls[i].style.opacity = '0.35';
        continue;
      }

      const ok = rvFillPartRow(m.part, m.serviceId, m.statusValue, m.miscValue);
      if (ok) {
        pushed++;
        m.done = true;
        if (rowEls[i]) {
          rowEls[i].style.opacity = '0.4';
          const marker = rowEls[i].querySelector('.pb-row-marker');
          if (marker) { marker.textContent = '✓'; marker.style.color = '#4ade80'; }
        }
      } else {
        failed++;
        log('Push All: fill failed for', m.part.partNumber, '— skipped, not added to RO.');
      }
      await delay(400); // let field fills settle before next Add Part click
    }

    const disarmedLine = disarmed ? `\nUnchecked (not sent, left alone): ${disarmed}` : '';
    const failLine = failed ? `\nFailed (row never rendered in time): ${failed}` : '';
    alert(`Push All complete.\n\nAdded to RO: ${pushed}\nSkipped (no service line selected): ${skipped}${disarmedLine}${failLine}`);
    log('Push All done. Pushed:', pushed, 'Skipped:', skipped, 'Failed:', failed);
  }

  function rvShowImportPanel() {
    if (document.getElementById(IMPORT_PANEL_ID)) return;

    const parts = getBridgeData();
    if (!parts.length) {
      alert('No parts waiting. Go to Tekion fulfillment first and click "Send to RV".');
      return;
    }

    const services = rvGetServiceLines();
    if (!services.length) {
      alert('Could not read service lines from this work order.');
      return;
    }

    const matches = parts.map(p => {
      log('Matching tekionJob:', JSON.stringify(p.tekionJob), 'against', services.length, 'RV services');
      const bestIdx = findBestMatch(p.tekionJob, services, p.description);
      if (bestIdx >= 0) {
        log('  → MATCHED:', services[bestIdx][0], '(id:', services[bestIdx][1], ')');
      } else {
        log('  → NO MATCH found — leave for user to pick or N/A');
      }
      return {
        part: p,
        serviceIdx: bestIdx,
        serviceId: bestIdx >= 0 ? String(services[bestIdx][1]) : '',
        serviceName: bestIdx >= 0 ? services[bestIdx][0] : '',
        statusValue: DEFAULT_STATUS,
        miscValue: '',
        checked: true,
        done: false,
      };
    });

    const panel = document.createElement('div');
    panel.id = IMPORT_PANEL_ID;
    panel.style.cssText = `
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      z-index:999999;width:950px;max-height:90vh;
      background:#0d0d0d;border:2px solid #3b82f6;border-radius:12px;
      font-family:'Segoe UI',sans-serif;font-size:12px;color:#e0e0e0;
      box-shadow:0 8px 40px rgba(0,0,0,.8);overflow:hidden;
      display:flex;flex-direction:column;
    `;

    const header = document.createElement('div');
    header.style.cssText = 'padding:12px 16px;background:#1a1a1a;border-bottom:1px solid #222;display:flex;justify-content:space-between;align-items:center;';
    header.innerHTML = `<span style="font-weight:700;color:#3b82f6;font-size:14px;">📋 Import ${parts.length} Parts from Tekion</span>`;
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:none;border:none;color:#666;font-size:16px;cursor:pointer;';
    closeBtn.onclick = () => panel.remove();
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const controls = document.createElement('div');
    controls.style.cssText = 'padding:6px 16px;background:#111;border-bottom:1px solid #222;display:flex;gap:8px;align-items:center;';
    const selectAllCb = document.createElement('input');
    selectAllCb.type = 'checkbox';
    selectAllCb.checked = true;
    selectAllCb.id = 'pb-rv-select-all';
    const selectAllLabel = document.createElement('label');
    selectAllLabel.htmlFor = 'pb-rv-select-all';
    selectAllLabel.textContent = `Select all (${parts.length}) — uncheck parts already added to skip re-adding them`;
    selectAllLabel.style.cssText = 'color:#888;font-size:11px;cursor:pointer;';
    controls.appendChild(selectAllCb);
    controls.appendChild(selectAllLabel);
    panel.appendChild(controls);

    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'overflow-y:auto;flex:1;padding:8px 0;';

    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:grid;grid-template-columns:28px 130px 1fr 90px 120px 60px 90px 50px;gap:8px;padding:4px 16px;color:#666;font-size:10px;font-weight:700;text-transform:uppercase;border-bottom:1px solid #222;';
    headerRow.innerHTML = '<span></span><span>Part#</span><span>Service Line</span><span>Source</span><span>Status</span><span>Qty</span><span>Price</span><span></span>';
    tableWrap.appendChild(headerRow);

    const rowEls = [];
    const rowCheckboxes = [];

    matches.forEach((m, idx) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:28px 130px 1fr 90px 120px 60px 90px 50px;gap:8px;padding:6px 16px;align-items:center;border-bottom:1px solid #111;';
      rowEls[idx] = row;

      const rowCb = document.createElement('input');
      rowCb.type = 'checkbox';
      rowCb.checked = true;
      rowCheckboxes[idx] = rowCb;

      const partDiv = document.createElement('div');
      partDiv.innerHTML = `<div style="font-weight:700;color:#60a5fa;font-family:monospace;font-size:11px;">${m.part.partNumber}</div><div style="color:#555;font-size:9px;">${m.part.description}</div>`;

      const serviceDiv = rvBuildSearchableSelect(services, m.serviceIdx, (newIdx) => {
        if (newIdx === -1) {
          m.serviceIdx = -1;
          m.serviceId = '';
          m.serviceName = NA_LABEL;
        } else {
          m.serviceIdx = newIdx;
          m.serviceId = String(services[newIdx][1]);
          m.serviceName = services[newIdx][0];
        }
      }, m.part.description, m.part.tekionJob);

      const sourceInput = document.createElement('input');
      sourceInput.type = 'text';
      sourceInput.placeholder = 'FMP, AZ...';
      sourceInput.value = m.miscValue;
      sourceInput.style.cssText = 'width:100%;padding:4px;background:#1a1a1a;color:#e0e0e0;border:1px solid #333;border-radius:4px;font-size:11px;box-sizing:border-box;';
      sourceInput.onchange = () => { m.miscValue = sourceInput.value; };

      const statusSelect = document.createElement('select');
      statusSelect.style.cssText = 'width:100%;padding:4px;background:#1a1a1a;color:#e0e0e0;border:1px solid #333;border-radius:4px;font-size:11px;box-sizing:border-box;';
      STATUS_OPTIONS.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.value === m.statusValue) o.selected = true;
        statusSelect.appendChild(o);
      });
      statusSelect.onchange = () => { m.statusValue = statusSelect.value; };

      const qtyInput = document.createElement('input');
      qtyInput.type = 'text';
      qtyInput.value = m.part.qty;
      qtyInput.style.cssText = 'width:100%;padding:4px;background:#1a1a1a;color:#e0e0e0;border:1px solid #333;border-radius:4px;font-size:11px;text-align:center;box-sizing:border-box;';
      qtyInput.onchange = () => { m.part.qty = qtyInput.value; };

      const priceInput = document.createElement('input');
      priceInput.type = 'text';
      priceInput.value = m.part.sellingPrice || '';
      priceInput.style.cssText = 'width:100%;padding:4px;background:#1a1a1a;color:#4ade80;border:1px solid #333;border-radius:4px;font-size:11px;text-align:right;box-sizing:border-box;';
      priceInput.onchange = () => { m.part.sellingPrice = priceInput.value; };

      const importOne = document.createElement('button');
      importOne.className = 'pb-row-marker';
      importOne.textContent = '➜';
      importOne.title = 'Import this part';
      importOne.style.cssText = 'background:#1a3a1a;color:#4ade80;border:1px solid #22c55e;border-radius:4px;cursor:pointer;font-size:12px;padding:2px 6px;';
      importOne.onclick = () => {
        if (!m.checked) { alert('This part is unchecked (disarmed) — check it first if you want to import it.'); return; }
        if (!m.serviceId) { alert('Pick a service line or N/A first.'); return; }
        const clicked = rvClickAddPart();
        if (!clicked) { alert('Add Part button not found.'); return; }
        setTimeout(() => {
          const ok = rvFillPartRow(m.part, m.serviceId, m.statusValue, m.miscValue);
          if (ok) {
            importOne.textContent = '✓';
            importOne.style.background = '#14532d';
            row.style.opacity = '0.4';
            m.done = true;
          }
        }, 400);
      };

      rowCb.onchange = () => {
        m.checked = rowCb.checked;
        row.style.opacity = m.checked ? '1' : '0.3';
      };

      row.appendChild(rowCb);
      row.appendChild(partDiv);
      row.appendChild(serviceDiv);
      row.appendChild(sourceInput);
      row.appendChild(statusSelect);
      row.appendChild(qtyInput);
      row.appendChild(priceInput);
      row.appendChild(importOne);
      tableWrap.appendChild(row);
    });

    panel.appendChild(tableWrap);

    selectAllCb.onchange = () => {
      rowCheckboxes.forEach((cb, idx) => {
        cb.checked = selectAllCb.checked;
        matches[idx].checked = selectAllCb.checked;
        rowEls[idx].style.opacity = selectAllCb.checked ? '1' : '0.3';
      });
    };

    const footer = document.createElement('div');
    footer.style.cssText = 'padding:10px 16px;background:#1a1a1a;border-top:1px solid #222;color:#666;font-size:11px;';
    footer.innerHTML = `
      <div>Click ➜ to import one part, or use Push All below to import every checked part with a service line selected.</div>
      <div>Uncheck a part if it's already been added to the RO — unchecked parts are never touched by Push All.</div>
      <div>Parts left as <b>${NA_LABEL}</b> or with no line picked are skipped and NOT added to the RO.</div>
      <div style="margin-top:8px;display:flex;gap:8px;">
        <button id="pb-push-all" style="flex:1;background:#3b82f6;color:#fff;border:none;border-radius:4px;padding:8px;cursor:pointer;font-size:12px;font-weight:700;">⚡ Push All</button>
        <button id="pb-clear-bridge" style="background:#7f1d1d;color:#fca5a5;border:none;border-radius:4px;padding:8px 10px;cursor:pointer;font-size:11px;font-weight:700;">🗑 Clear All & Close</button>
      </div>
    `;
    panel.appendChild(footer);

    document.body.appendChild(panel);

    document.getElementById('pb-clear-bridge').onclick = () => {
      clearBridgeData();
      panel.remove();
      log('Bridge data cleared.');
    };

    document.getElementById('pb-push-all').onclick = async () => {
      const btn = document.getElementById('pb-push-all');
      btn.disabled = true;
      btn.textContent = 'Pushing...';
      await rvPushAll(matches, rowEls); // blocks here until the completion alert's OK is clicked
      panel.remove(); // then close this whole import panel automatically
    };

    log('Import panel built with', matches.length, 'parts.');
  }

  function rvInjectPasteButton() {
    if (!rvIsPartsModalOpen()) {
      const btn = document.getElementById(PASTE_BTN_ID);
      if (btn) btn.remove();
      const panel = document.getElementById(IMPORT_PANEL_ID);
      if (panel) panel.remove();
      return;
    }

    if (document.getElementById(PASTE_BTN_ID)) return;

    const bridgeData = getBridgeData();

    const importBtn = document.querySelector('.pull-part-list button, button[data-action*="getImportFile"]');
    if (!importBtn) return;

    const btn = document.createElement('button');
    btn.id = PASTE_BTN_ID;
    btn.textContent = bridgeData.length ? `📋 Paste from Tekion (${bridgeData.length})` : '📋 Paste from Tekion';
    btn.style.cssText = `
      padding:8px 16px;font-weight:700;font-size:12px;border-radius:6px;
      border:none;cursor:pointer;margin-left:10px;
      background:${bridgeData.length ? '#3b82f6' : '#333'};
      color:${bridgeData.length ? '#fff' : '#666'};
    `;
    btn.onclick = rvShowImportPanel;
    importBtn.parentElement.appendChild(btn);
    log('Paste button injected. Bridge has', bridgeData.length, 'parts.');
  }

  const rvObs = new MutationObserver(() => rvInjectPasteButton());
  rvObs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  rvInjectPasteButton();

  // Auto-open flow: when Tekion's "Send to RV" writes a fresh pb_open_request
  // signal, this tab (if it's already on a work order edit page) opens the
  // Parts modal itself and shows the import panel — no manual click needed.
  // Only reacts to requests newer than what was already seen at page load,
  // so it never re-fires for a request this tab already handled.
  let rvLastSeenOpenTs = 0;
  try {
    const initial = JSON.parse(GM_getValue('pb_open_request', '{}'));
    rvLastSeenOpenTs = initial.ts || 0;
  } catch (e) { /* ignore malformed/missing value on first run */ }

  function rvOpenPartsModalIfNeeded() {
    return new Promise((resolve) => {
      if (rvIsPartsModalOpen()) { resolve(true); return; }
      const toggleBtn = document.getElementById('wo-parts-toggle');
      if (!toggleBtn) { resolve(false); return; }
      toggleBtn.click();
      let attempts = 0;
      const poll = setInterval(() => {
        attempts++;
        if (rvIsPartsModalOpen()) {
          clearInterval(poll);
          resolve(true);
        } else if (attempts > 20) { // ~4s max wait
          clearInterval(poll);
          resolve(false);
        }
      }, 200);
    });
  }

  function rvCheckForOpenRequest() {
    let req;
    try { req = JSON.parse(GM_getValue('pb_open_request', '{}')); } catch (e) { return; }
    if (!req.ts || req.ts <= rvLastSeenOpenTs) return;
    rvLastSeenOpenTs = req.ts;
    log('Received auto-open signal from Tekion — opening Parts modal.');
    rvOpenPartsModalIfNeeded().then((opened) => {
      if (opened) {
        setTimeout(rvShowImportPanel, 300); // let the modal fully render first
      } else {
        log('Could not auto-open Parts modal (no wo-parts-toggle button found on this page) — open it manually and click Paste from Tekion.');
      }
    });
  }

  setInterval(rvCheckForOpenRequest, 1000);

  // Small cosmetic easter egg: on click N of Bucket Scanner's "Open in
  // Tekion" button (id="rv-tekion-btn" — we don't own it, just piggyback an
  // extra listener alongside its real one), the little progress-meter car
  // drives fast off the right edge, "explodes" on impact, and the debris
  // falls to the bottom. We never touch the real #car element or its
  // position logic — this animates a visual clone instead, so the actual
  // progress meter is never at risk of breaking.
  function rvSpawnCarFlyby() {
    const realCar = document.querySelector('#progress-meter-bin #car img, #car img');
    if (!realCar) return;
    const rect = realCar.getBoundingClientRect();
    const startTop = rect.top;
    const startLeft = rect.left;
    const w = rect.width;
    const h = rect.height;

    const clone = document.createElement('img');
    clone.src = realCar.src;
    clone.style.cssText = `
      position:fixed;top:${startTop}px;left:${startLeft}px;
      width:${w}px;height:${h}px;
      z-index:2147483647;pointer-events:none;user-select:none;
      animation:pbCarDriveOff 0.45s cubic-bezier(.55,0,.85,.35) forwards;
    `;
    const driveDist = window.innerWidth - startLeft + 60;
    const driveStyle = document.createElement('style');
    driveStyle.textContent = `
      @keyframes pbCarDriveOff {
        0%   { transform:translateX(0); }
        100% { transform:translateX(${driveDist}px); }
      }
    `;
    document.head.appendChild(driveStyle);
    document.body.appendChild(clone);

    setTimeout(() => {
      clone.remove();
      driveStyle.remove();
      rvSpawnExplosion(window.innerWidth - 15, startTop + h / 2);
    }, 450);
  }

  function rvSpawnExplosion(x, y) {
    // Impact flash
    const flash = document.createElement('div');
    flash.style.cssText = `
      position:fixed;top:${y - 25}px;left:${x - 25}px;width:50px;height:50px;
      border-radius:50%;z-index:2147483647;pointer-events:none;
      background:radial-gradient(circle, #fff7c0 0%, #ff8a3d 45%, transparent 72%);
      animation:pbFlash 0.35s ease-out forwards;
    `;
    const flashStyle = document.createElement('style');
    flashStyle.textContent = `
      @keyframes pbFlash {
        0%   { transform:scale(0.3); opacity:1; }
        100% { transform:scale(2.4); opacity:0; }
      }
    `;
    document.head.appendChild(flashStyle);
    document.body.appendChild(flash);

    // Debris: bursts outward first, then gravity pulls it down to the bottom
    const colors = ['#ff5533', '#ffaa33', '#ffe066', '#9aa0a6', '#c7cbd0'];
    const count = 14;
    const particles = [];
    const particleStyle = document.createElement('style');
    let keyframes = '';

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() * 0.5 - 0.25);
      const burstDist = 35 + Math.random() * 55;
      const burstX = Math.cos(angle) * burstDist;
      const burstY = Math.sin(angle) * burstDist;
      const fallY = window.innerHeight - y + 40 + Math.random() * 60;
      const rot = (Math.random() * 720 - 360).toFixed(0);
      const size = (6 + Math.random() * 10).toFixed(1);
      const color = colors[i % colors.length];
      const name = `pbDebris${i}`;

      keyframes += `
        @keyframes ${name} {
          0%   { transform:translate(0,0) rotate(0deg); opacity:1; }
          25%  { transform:translate(${burstX.toFixed(1)}px, ${burstY.toFixed(1)}px) rotate(${(rot / 2).toFixed(0)}deg); opacity:1; }
          100% { transform:translate(${(burstX * 1.3).toFixed(1)}px, ${fallY.toFixed(1)}px) rotate(${rot}deg); opacity:0; }
        }
      `;

      const p = document.createElement('div');
      p.style.cssText = `
        position:fixed;top:${y}px;left:${x}px;
        width:${size}px;height:${size}px;background:${color};
        border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
        z-index:2147483647;pointer-events:none;
        animation:${name} 1.1s cubic-bezier(.3,.7,.4,1) forwards;
      `;
      particles.push(p);
    }

    particleStyle.textContent = keyframes;
    document.head.appendChild(particleStyle);
    particles.forEach(p => document.body.appendChild(p));

    setTimeout(() => {
      flash.remove();
      flashStyle.remove();
      particles.forEach(p => p.remove());
      particleStyle.remove();
    }, 1300);
  }

  function rvAttachTekionBtnWatcher() {
    const btn = document.getElementById('rv-tekion-btn');
    if (!btn || btn.dataset.pbListenerAttached) return;
    btn.dataset.pbListenerAttached = 'true';
    btn.addEventListener('click', () => {
      const count = (parseInt(GM_getValue('pb_tekion_btn_click_count', '0'), 10) || 0) + 1;
      GM_setValue('pb_tekion_btn_click_count', String(count));
      if (count % 20 === 0) { // fires every 20th click, forever
        rvSpawnCarFlyby();
      }
    });
  }

  setInterval(rvAttachTekionBtnWatcher, 1000);
}

})();
