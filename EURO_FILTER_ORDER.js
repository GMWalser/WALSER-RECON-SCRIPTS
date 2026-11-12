// ==UserScript==
// @name         RV Euro Filter Order
// @namespace    http://tampermonkey.net/
// @version      1.5
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/EURO_FILTER_ORDER.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/EURO_FILTER_ORDER.js
// @description  Flags European cars in the RV Picked Up bucket with a button that opens a Tekion Misc PO. Vendor buttons on the PO screen auto-fill the vendor and open a pre-filled Outlook email for filter ordering.
// @match        https://app.reconvision.com/departments/28149*
// @match        https://app.tekioncloud.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

// =============================================
// EUROPEAN MAKES TO FLAG
// =============================================
const EURO_MAKES = [
  'audi', 'bmw', 'mercedes', 'porsche', 'land rover',
  'jaguar', 'volkswagen', 'mini', 'volvo', 'genesis'
];

// =============================================
// EUROPEAN OEM DEALER VENDORS
// =============================================
// search = text typed into the Vendor react-select to filter options
// match  = substring matched against the rendered option text (case-insensitive)
// email  = address(es) for the Outlook draft; comma-separated if multiple
// v1.3: added LR (Land Rover) -- same dealer/search/email as JLR, just its
// own button since Land Rover vehicles get flagged separately from Jaguar.
const EURO_VENDORS = [
  { label: 'AUDI',    search: '3881',     match: 'AUDI RICHFIELD',            email: 'parts@audirichfield.com' },
  { label: 'BMW',     search: 'WT53',     match: 'MOTORWERKS BMW',            email: 'epeterson@penskeautomotive.com,sgroth@penskeautomotive.com' },
  { label: 'MERC',    search: 'WO1205',   match: 'SEARS IMPORTED',            email: 'william.wissbaum@searsimports.com' },
  { label: 'PORSCHE', search: 'WZA362',   match: 'PORSCHE MINNEAPOLIS',       email: 'nathan.ahern@carouselmotor.com' },
  { label: 'JLR',     search: '1264',     match: 'JAGUAR LAND ROVER',         email: 'Parts.JaguarLandRover@morries.com' },
  { label: 'LR',      search: '1264',     match: 'JAGUAR LAND ROVER',         email: 'Parts.JaguarLandRover@morries.com' },
  { label: 'VW',      search: 'WA58025',  match: 'VOLKSWAGEN OF INVER GROVE', email: 'brian@vwinvergrove.com' },
  { label: 'MINI',    search: 'WT53',     match: 'MOTORWERKS BMW',            email: 'MWminiparts@penskeautomotive.com' },
  { label: 'VOLVO',   search: 'WB935031', match: 'KLINE AUTOWORLD VOLVO',     email: 'volvoparts@klineautoworld.com' },
  { label: 'GENESIS', search: '5428',     match: 'LUTHER GENESIS',            email: 'Parts@LutherGenesis.com' },
];

const RECON_OUT_PARTS = 'reconoutparts@thewalserway.onmicrosoft.com';
const MISC_PO_URL = 'https://app.tekioncloud.com/parts/purchase-order/misc/add';
const INJECTED_MARKER = 'data-rv-euro-injected';
const EURO_SESSION_KEY = 'rv_euro_filter_data';
const SCAN_INTERVAL_MS = 30000;
const WRAPPER_ID = 'rv-euro-vendor-wrapper';

// =============================================
// SHARED HELPERS
// =============================================
function log(...args) { console.log('[Euro Filter Order]', ...args); }

function fireMouseEvent(el, type) {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
}

function nativeSetValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// v1.4: textareas need HTMLTextAreaElement's own setter, not
// HTMLInputElement's -- same prototype-mismatch gotcha hit elsewhere in
// these scripts. Used for the notes textarea.
function nativeSetTextareaValue(textarea, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function waitFor(checkFn, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      const result = checkFn();
      if (result) { clearInterval(timer); resolve(result); }
      else if (Date.now() - start > timeoutMs) { clearInterval(timer); reject(new Error('waitFor timed out')); }
    }, 150);
  });
}

function isEuropean(yearMakeModel) {
  const lower = yearMakeModel.toLowerCase();
  return EURO_MAKES.some(make => lower.includes(make));
}

// =============================================
// RECONVISION SIDE — Picked Up bucket scanner
// =============================================
function rvInjectStyles() {
  if (document.getElementById('rv-euro-style')) return;
  const s = document.createElement('style');
  s.id = 'rv-euro-style';
  s.textContent = `
    .rv-euro-btn {
      display:inline-block;margin-top:4px;padding:3px 9px;
      background:#5b21b6;color:#c4b5fd;border:1px solid #7c3aed;border-radius:10px;
      font-size:11px;font-weight:700;cursor:pointer;font-family:'Segoe UI',sans-serif;
      white-space:nowrap;
    }
    .rv-euro-btn:hover { background:#6d28d9; }
    .rv-euro-filters-ordered-btn {
      display:flex;align-items:center;justify-content:center;
      width:28px;height:28px;border-radius:6px;margin-right:4px;
      background:#5b21b6;color:#fff;font-weight:700;font-size:14px;
      cursor:pointer;
    }
    .rv-euro-filters-ordered-btn:hover { background:#6d28d9; }
  `;
  document.head.appendChild(s);
}

// v1.4: "Filters Ordered" button -- sits next to the notes button on a
// flagged Euro row, opens the notes modal (shared singleton #notesmodal,
// populated per-row by clicking that row's own .info-bar__notes-button),
// types "FILTERS ORDERED" into it, and saves. Confirmed selectors: modal
// #notesmodal (visible via style.display:block or class "in"), textarea
// #comment_comment, hidden field #comment_commentable_id (confirms which
// WO's data actually loaded into the shared modal), save button #save-note.
// v1.5: you can see that it worked -- the button says SAVING... then NOTED (red) or RETRY, in words as well
// as color (one-color themes turn purple/red green), remembered in this browser. Ids start "wr-theme-" so
// Page Themes never repaints these buttons.
const EURO_DONE_KEY = 'euro_filters_done';
function euroDoneList() { try { return JSON.parse(localStorage.getItem(EURO_DONE_KEY) || '[]'); } catch (e) { return []; } }
function euroRememberDone(woId) { try { const l = euroDoneList(); if (!l.includes(String(woId))) { l.push(String(woId)); localStorage.setItem(EURO_DONE_KEY, JSON.stringify(l.slice(-500))); } } catch (e) {} }
function euroPaint(btn, state, why) {
  if (!btn) return;
  btn.style.width = 'auto'; btn.style.padding = '0 8px'; btn.style.whiteSpace = 'nowrap';
  if (state === 'busy') { btn.style.background = '#a16207'; btn.textContent = 'SAVING\u2026'; }
  if (state === 'done') { btn.style.background = '#dc2626'; btn.textContent = '\u2713 NOTED'; btn.title = 'FILTERS ORDERED note added'; }
  if (state === 'fail') { btn.style.background = '#7c2d12'; btn.textContent = '\u26a0 RETRY'; btn.title = 'Note NOT saved: ' + why + ' - click to try again'; }
}
async function markFiltersOrdered(notesBtn, woId, btn) {
  euroPaint(btn, 'busy');
  notesBtn.click();

  try {
    await waitFor(() => {
      const modal = document.getElementById('notesmodal');
      const idField = document.getElementById('comment_commentable_id');
      if (!modal || !idField) return null;
      const visible = modal.style.display === 'block' || modal.classList.contains('in');
      return (visible && idField.value === String(woId)) ? true : null;
    }, 4000);

    const textarea = document.getElementById('comment_comment');
    if (!textarea) { log('Notes textarea not found for WO', woId); euroPaint(btn, 'fail', 'notes box not found'); return; }
    nativeSetTextareaValue(textarea, 'FILTERS ORDERED');

    const saveBtn = document.getElementById('save-note');
    if (saveBtn) {
      saveBtn.click();
      log('Marked Filters Ordered for WO', woId);
      euroRememberDone(woId); euroPaint(btn, 'done');
    } else {
      log('Save note button not found for WO', woId);
      euroPaint(btn, 'fail', 'save button not found');
    }
  } catch (err) {
    log('Notes modal never opened (or loaded the wrong WO) for WO', woId);
    euroPaint(btn, 'fail', 'notes window did not open');
  }
}

function injectFiltersOrderedButton(link) {
  const notesBtn = link.querySelector('.info-bar__notes-button');
  if (!notesBtn) return;
  const buttonsContainer = notesBtn.parentElement;
  if (!buttonsContainer || buttonsContainer.querySelector('.rv-euro-filters-ordered-btn')) return;

  const woId = notesBtn.dataset.woId;
  const btn = document.createElement('div');
  btn.className = 'info-bar__button rv-euro-filters-ordered-btn';
  btn.id = 'wr-theme-euro-ordered-' + woId;      // Page Themes leaves ids starting "wr-theme" alone
  btn.title = 'Mark Filters Ordered';
  btn.textContent = '✓';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    markFiltersOrdered(notesBtn, woId, btn);
  });
  if (euroDoneList().includes(String(woId))) euroPaint(btn, 'done');
  buttonsContainer.insertBefore(btn, notesBtn);
}

function rvScanRows() {
  document.querySelectorAll('a.work-order-link').forEach(link => {
    if (link.hasAttribute(INJECTED_MARKER)) return;

    const makeEl = link.querySelector('.info-bar__item--make');
    const yearMakeModel = makeEl ? makeEl.innerText.trim() : '';
    if (!yearMakeModel || !isEuropean(yearMakeModel)) return;

    const firstNine = link.querySelector('.first-nine-vin');
    const restVin = link.querySelector('.rest-of-vin');
    const vin = (firstNine ? firstNine.innerText.trim() : '') +
                (restVin ? restVin.innerText.trim() : '');
    if (!vin || vin.length !== 17) return;

    const stockContainer = link.querySelector('.info-bar__item--stock');
    if (!stockContainer) return;

    link.setAttribute(INJECTED_MARKER, '1');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rv-euro-btn';
    btn.id = 'wr-theme-euro-order-' + vin;       // keeps its purple under any theme
    btn.textContent = '🇪🇺 Order Filters';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const data = JSON.stringify({ vin: vin, label: yearMakeModel });
      const url = MISC_PO_URL + '#rv_euro=' + encodeURIComponent(data);
      window.open(url, 'rv_euro_po_tab');
      log('Opened Misc PO for', yearMakeModel, vin);
    });

    // Stack under existing buttons if Filter Scanner also added one
    if (!stockContainer.classList.contains('rv-fs-stacked')) {
      stockContainer.style.display = 'flex';
      stockContainer.style.flexDirection = 'column';
      stockContainer.style.alignItems = 'flex-start';
    }
    stockContainer.appendChild(btn);

    injectFiltersOrderedButton(link);
  });
}

function initReconVisionSide() {
  rvInjectStyles();
  // Wait for rows to render before first scan
  let attempts = 0;
  const check = () => {
    attempts++;
    if (document.querySelector('a.work-order-link') || attempts >= 20) {
      rvScanRows();
      setInterval(rvScanRows, SCAN_INTERVAL_MS);
      return;
    }
    setTimeout(check, 300);
  };
  check();
}

// =============================================
// TEKION SIDE — Misc PO vendor buttons + email
// =============================================
function tkInjectStyles() {
  if (document.getElementById('rv-euro-tk-style')) return;
  const s = document.createElement('style');
  s.id = 'rv-euro-tk-style';
  s.textContent = `
    #rv-euro-vendor-wrapper {
      display:flex;flex-direction:column;gap:10px;
      position:absolute;z-index:999;
    }
    .rv-euro-vendor-row {
      display:flex;gap:10px;
    }
    .rv-euro-vendor-btn {
      padding:8px 14px;font-size:14px;font-weight:700;border-radius:20px;
      border:none;background:#5b21b6;color:#fff;cursor:pointer;white-space:nowrap;
    }
    .rv-euro-vendor-btn:hover { background:#6d28d9; }
    #rv-euro-vin-banner {
      position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:99999;
      background:#1a1a1a;border:2px solid #7c3aed;border-radius:10px;
      padding:8px 18px;font-family:'Segoe UI',sans-serif;font-size:13px;
      color:#c4b5fd;font-weight:700;box-shadow:0 4px 20px rgba(0,0,0,.6);
    }
    #rv-euro-vin-banner span { color:#e9d5ff; }
  `;
  document.head.appendChild(s);
}

function tkGetEuroData() {
  // Check hash first (fresh click from RV), then sessionStorage (page survived a SPA nav)
  const hash = window.location.hash;
  if (hash.startsWith('#rv_euro=')) {
    try {
      const data = JSON.parse(decodeURIComponent(hash.slice('#rv_euro='.length)));
      sessionStorage.setItem(EURO_SESSION_KEY, JSON.stringify(data));
      // Strip hash so it doesn't linger in the URL
      history.replaceState(null, '', window.location.pathname + window.location.search);
      log('Parsed euro data from hash:', data);
      return data;
    } catch (e) { log('Failed to parse hash:', e); }
  }
  const stored = sessionStorage.getItem(EURO_SESSION_KEY);
  if (stored) {
    try { return JSON.parse(stored); } catch (e) { /* ignore */ }
  }
  return null;
}

function tkShowVinBanner(data) {
  if (document.getElementById('rv-euro-vin-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'rv-euro-vin-banner';
  banner.innerHTML = '🇪🇺 Filter Order — <span>' + data.label + '</span> — ' + data.vin;
  document.body.appendChild(banner);
}

function tkOpenEmail(vendor, vin) {
  const toAddresses = vendor.email + ',' + RECON_OUT_PARTS;
  const subject = 'FILTER ORDER - ' + vin;
  const body = 'NEED TO ORDER\n\nAIR/OIL/CABIN FILTERS\n\nPO: ';
  const url = 'https://outlook.cloud.microsoft/mail/deeplink/compose?to='
    + encodeURIComponent(toAddresses)
    + '&subject=' + encodeURIComponent(subject)
    + '&body=' + encodeURIComponent(body);
  log('Opening email for', vendor.label, '— VIN:', vin);
  window.open(url, '_blank');
}

function tkGetVendorInput() {
  const container = document.getElementById('VENDOR');
  if (!container) return null;
  if (container.tagName === 'INPUT') return container;
  return container.querySelector('input');
}

async function tkSelectVendor(vendor) {
  const input = tkGetVendorInput();
  if (!input) { log('ERROR: VENDOR input not found'); return false; }

  input.focus();
  fireMouseEvent(input, 'mousedown');
  nativeSetValue(input, vendor.search);

  try {
    const option = await waitFor(() => {
      const candidates = document.querySelectorAll('[id^="react-select-"][id*="-option-"]');
      for (const el of candidates) {
        if (el.textContent && el.textContent.toUpperCase().includes(vendor.match.toUpperCase())) return el;
      }
      return null;
    }, 4000);

    fireMouseEvent(option, 'mousedown');
    fireMouseEvent(option, 'mouseup');
    fireMouseEvent(option, 'click');
    log('Selected vendor:', vendor.label);
    return true;
  } catch (e) {
    log('ERROR: Could not find option for', vendor.label, e);
    return false;
  }
}

function tkFindScrollableAncestor(el) {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    if (style.overflowY === 'auto' || style.overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return document.body;
}

function tkInjectButtons(data) {
  if (document.getElementById(WRAPPER_ID)) return;

  const vendorField = document.getElementById('VENDOR');
  if (!vendorField) return;
  const vendorSiteField = document.getElementById('VENDOR_SITE') || document.querySelector('[data-field-id="SITES"]');
  if (!vendorSiteField) return;

  const scrollContainer = tkFindScrollableAncestor(vendorSiteField);
  if (getComputedStyle(scrollContainer).position === 'static') {
    scrollContainer.style.position = 'relative';
  }

  const anchorRect = vendorSiteField.getBoundingClientRect();
  const containerRect = scrollContainer.getBoundingClientRect();

  const wrapper = document.createElement('div');
  wrapper.id = WRAPPER_ID;
  wrapper.style.top = (anchorRect.top - containerRect.top + scrollContainer.scrollTop) + 'px';
  wrapper.style.left = (anchorRect.right - containerRect.left + scrollContainer.scrollLeft + 78) + 'px';

  // Row 1: AUDI, BMW, MERC, PORSCHE
  // Row 2: JLR, LR, VW, MINI, VOLVO, GENESIS
  const rows = [
    EURO_VENDORS.slice(0, 4),
    EURO_VENDORS.slice(4),
  ];

  rows.forEach(rowVendors => {
    const rowEl = document.createElement('div');
    rowEl.className = 'rv-euro-vendor-row';
    rowVendors.forEach(vendor => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rv-euro-vendor-btn';
      btn.textContent = vendor.label;
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ok = await tkSelectVendor(vendor);
        if (ok) tkOpenEmail(vendor, data.vin);
      });
      rowEl.appendChild(btn);
    });
    wrapper.appendChild(rowEl);
  });

  scrollContainer.appendChild(wrapper);

  // Align rows like Quick-Add does
  const rowEls = Array.from(wrapper.children);
  const maxRowWidth = Math.max(...rowEls.map(r => r.getBoundingClientRect().width));
  wrapper.style.width = maxRowWidth + 'px';
  rowEls.forEach(r => { r.style.justifyContent = 'space-between'; r.style.gap = '0'; });

  log('Injected Euro vendor buttons.');
}

function tkCleanup() {
  const wrapper = document.getElementById(WRAPPER_ID);
  if (wrapper && !document.getElementById('VENDOR')) wrapper.remove();
  const banner = document.getElementById('rv-euro-vin-banner');
  // Clear banner + session data when leaving the misc PO page
  if (banner && !window.location.pathname.includes('/purchase-order/misc/add')) {
    banner.remove();
    sessionStorage.removeItem(EURO_SESSION_KEY);
  }
}

function initTekionSide() {
  const data = tkGetEuroData();
  if (!data) return; // No euro filter data — nothing to do on this page

  tkInjectStyles();
  tkShowVinBanner(data);

  const observer = new MutationObserver(() => {
    tkCleanup();
    if (window.location.pathname.includes('/purchase-order/misc/add')) {
      tkInjectButtons(data);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial attempt
  if (window.location.pathname.includes('/purchase-order/misc/add')) {
    tkInjectButtons(data);
  }
}

// =============================================
// ENTRY POINT
// =============================================
if (location.hostname === 'app.reconvision.com') {
  initReconVisionSide();
} else if (location.hostname === 'app.tekioncloud.com') {
  initTekionSide();
}

})();