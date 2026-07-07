// ==UserScript==
// @name         PO Vendor Quick-Add
// @namespace    http://tampermonkey.net/
// @version      1.4
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/VENDOR_QUICKADD.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/VENDOR_QUICKADD.js
// @description  Quick-add buttons for the 18 most-used vendors on Tekion's PO Create Miscellaneous Order screen
// @match        https://app.tekioncloud.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const LOG_PREFIX = "[PO-Vendor-QuickAdd]";
  const WRAPPER_ID = "rv-po-vendor-btn-wrapper";

  // NOTE: search = text typed into the Vendor input to filter react-select's
  // option list. match = case-insensitive substring checked against the
  // rendered option's text to confirm we clicked the right one.
  const VENDOR_ROWS = [
    [
      { label: 'FMP',    search: 'WT29322',     match: 'FACTORY MOTOR PARTS' },
      { label: 'NAPA',   search: '1097',         match: 'NAPA AUTO PARTS' },
      { label: 'AZ',     search: 'WT44699',     match: 'AUTOZONE' },
      { label: 'OR',     search: '1390',         match: "O'REILLY AUTO PARTS" },
      { label: 'WP',     search: '5226',         match: 'WORLDPAC' },
      { label: '1-800',  search: '452',          match: '1-800-RADIATOR' },
    ],
    [
      { label: 'BGB',      search: 'LT12700',     match: 'BUICK GMC' },
      { label: 'CJD',      search: '40030WIKS',   match: 'CHRYSLER JEEP DODGE' },
      { label: 'DOB',      search: 'DODGE OF BURNSVILLE',  match: 'DODGE OF BURNSVILLE' },
      { label: 'FORD',     search: 'WB1956',      match: 'APPLE FORD' },
      { label: 'HON',      search: '1259',        match: 'WALSER HONDA' },
    ],
    [
      { label: 'MAZ IGH',  search: '5543710204',  match: 'MORRIE' },
      { label: 'NIS',      search: '1040',        match: 'WALSER NISSAN' },
      { label: 'SUB STP',  search: '4073',        match: 'SUBARU ST PAUL' },
      { label: 'TOY',      search: '1385',        match: 'WALSER TOYOTA' },
    ],
    [
      { label: 'AAA',   search: 'WT48419',  match: 'AAA SALVAGE' },
      { label: 'PAMS',  search: '1261',      match: 'PAM' },
      { label: 'LKQ',   search: '1030',      match: 'LKQ SMART PARTS' },
      { label: 'KEY',   search: '1114IL',    match: 'KEYSTONE' },
      { label: 'USAF',  search: '1279',      match: 'US AUTO FORCE' },
    ],
  ];

  const ROW_COLORS = [
    { bg: '#1d4ed8' },   // row 1 - deep blue (parts distributors)
    { bg: '#0f766e' },   // row 2 - deep teal (Walser dealerships + Ford, part 1)
    { bg: '#0f766e' },   // row 3 - deep teal (Walser dealerships, part 2)
    { bg: '#15803d' },   // row 4 - deep green (junkyards)
  ];

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  function nativeSetValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function fireMouseEvent(el, type) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }

  function waitFor(checkFn, timeoutMs, intervalMs) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        const result = checkFn();
        if (result) {
          clearInterval(timer);
          resolve(result);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(timer);
          reject(new Error("waitFor timed out"));
        }
      }, intervalMs || 100);
    });
  }

  function getVendorInput() {
    // NOTE: both the react-select container div AND the inner <input>
    // carry id="VENDOR" (duplicate ID in Tekion's markup). getElementById
    // returns the container div (first in DOM order), not the input.
    const container = document.getElementById('VENDOR');
    if (!container) return null;
    if (container.tagName === 'INPUT') return container;
    return container.querySelector('input');
  }

  async function selectVendor(vendorConfig) {
    const input = getVendorInput();
    if (!input) {
      log(`ERROR: VENDOR input not found (${vendorConfig.label}).`);
      return;
    }

    input.focus();
    fireMouseEvent(input, 'mousedown');
    nativeSetValue(input, vendorConfig.search);

    try {
      const option = await waitFor(() => {
        const candidates = document.querySelectorAll('[id^="react-select-"][id*="-option-"]');
        for (const el of candidates) {
          if (el.textContent && el.textContent.toUpperCase().includes(vendorConfig.match.toUpperCase())) {
            return el;
          }
        }
        return null;
      }, 4000, 150);

      fireMouseEvent(option, 'mousedown');
      fireMouseEvent(option, 'mouseup');
      fireMouseEvent(option, 'click');

    } catch (e) {
      log(`ERROR: Could not find matching option for ${vendorConfig.label} within timeout.`, e);
    }
  }

  function makeButton(vendorConfig, rowColor) {
    const btn = document.createElement('button');
    btn.textContent = vendorConfig.label;
    btn.type = 'button';
    btn.style.cssText = `
      padding: 8px 14px;
      font-size: 14px;
      font-weight: 700;
      border-radius: 20px;
      border: none;
      background: ${rowColor.bg};
      color: #fff;
      cursor: pointer;
      white-space: nowrap;
    `;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      try {
        selectVendor(vendorConfig);
      } catch (err) {
        log(`ERROR thrown selecting ${vendorConfig.label}:`, err);
      }
    });
    return btn;
  }

  function findScrollableAncestor(el) {
    // The PO screen's content lives inside an inner scrollable div, not the
    // window itself. Detect it by computed overflow rather than a hardcoded
    // class name, since Tekion's CSS-module class hashes change on redeploy.
    let node = el.parentElement;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        return node;
      }
      node = node.parentElement;
    }
    return document.body;
  }

  function injectButtons() {
    if (document.getElementById(WRAPPER_ID)) return; // already injected

    const vendorField = document.getElementById('VENDOR');
    if (!vendorField) return;
    const vendorSiteField = document.getElementById('VENDOR_SITE');
    if (!vendorSiteField) return;

    const scrollContainer = findScrollableAncestor(vendorSiteField);
    if (getComputedStyle(scrollContainer).position === 'static') {
      scrollContainer.style.position = 'relative';
    }

    const anchorRect = vendorSiteField.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();

    const wrapper = document.createElement('div');
    wrapper.id = WRAPPER_ID;
    wrapper.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 10px;
      position: absolute;
      top: ${anchorRect.top - containerRect.top + scrollContainer.scrollTop}px;
      left: ${anchorRect.right - containerRect.left + scrollContainer.scrollLeft + 78}px;
      z-index: 999;
    `;

    VENDOR_ROWS.forEach((rowConfigs, rowIndex) => {
      const rowEl = document.createElement('div');
      rowEl.style.cssText = `
        display: flex;
        gap: 10px;
      `;
      rowConfigs.forEach((vendorConfig) => {
        rowEl.appendChild(makeButton(vendorConfig, ROW_COLORS[rowIndex]));
      });
      wrapper.appendChild(rowEl);
    });

    scrollContainer.appendChild(wrapper);

    // Align every row's left AND right edges: find the widest row's natural
    // width, lock the wrapper to that width, then switch each row from a
    // fixed gap to space-between so the first/last button in every row
    // flush against the same edges regardless of how many buttons it has.
    const rowEls = Array.from(wrapper.children);
    const maxRowWidth = Math.max(...rowEls.map(r => r.getBoundingClientRect().width));
    wrapper.style.width = maxRowWidth + 'px';
    rowEls.forEach(r => {
      r.style.justifyContent = 'space-between';
      r.style.gap = '0';
    });

    log("Injected vendor quick-add buttons.");
  }

  function cleanupIfOrphaned() {
    const wrapper = document.getElementById(WRAPPER_ID);
    if (wrapper && !document.getElementById('VENDOR')) {
      wrapper.remove();
    }
  }

  const observer = new MutationObserver(() => {
    cleanupIfOrphaned();
    injectButtons();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  injectButtons();
})();
