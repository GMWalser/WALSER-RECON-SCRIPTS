// ==UserScript==
// @name         PO Vendor Quick-Add
// @namespace    http://tampermonkey.net/
// @version      2.0
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/VENDOR_QUICKADD.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/VENDOR_QUICKADD.js
// @description  Quick-add buttons for the 18 most-used vendors on Tekion's PO Create Miscellaneous Order screen. Selecting a vendor with a known email opens a pre-filled Outlook draft (To/Subject only) using the VIN read directly from Tekion's own RO header.
// @match        https://app.tekioncloud.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const LOG_PREFIX = "[PO-Vendor-QuickAdd]";
  const WRAPPER_ID = "rv-po-vendor-btn-wrapper";

  // v2.0: VIN now comes straight from Tekion's own RO/fulfillment header
  // (the "1FTFW1ED6NFB60477" shown next to the vehicle name), captured
  // continuously whenever it's visible on screen. This is always the
  // vehicle actually being worked, so the old bug where a previous
  // vehicle's VIN (held over in Recon Clipboard's rv_last_vin_seen)
  // ended up in the email can no longer happen. Clipboard's stored VIN
  // is no longer read at all.
  let currentVin = '';

  // Standard VIN: 17 chars, A-Z and 0-9, never contains I, O, or Q.
  const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/;

  function captureVinFromHeader() {
    // The VIN in the RO header sits in its own small element whose entire
    // text content is exactly the 17-char VIN. Scan for that rather than a
    // hardcoded class name, since Tekion's CSS-module hashes change on
    // redeploy. Only leaf-ish elements with short text are checked, so
    // this stays cheap.
    const els = document.querySelectorAll('span, div, p, a, h1, h2, h3, h4');
    for (const el of els) {
      if (el.children.length > 0) continue;       // leaf elements only
      const text = (el.textContent || '').trim();
      if (text.length !== 17) continue;
      if (VIN_REGEX.test(text)) {
        if (currentVin !== text) {
          currentVin = text;
          log('Captured VIN from RO header:', currentVin);
        }
        return;
      }
    }
  }

  // NOTE: search = text typed into the Vendor input to filter react-select's
  // option list. match = case-insensitive substring checked against the
  // rendered option's text to confirm we clicked the right one.
  // TODO(Gabe): fill in the real email address for each vendor below.
  // Leave blank ('') for any vendor you don't have an address for yet --
  // the button will still select the vendor normally, it just won't try
  // to open an email for that one until an address is added.
  const VENDOR_ROWS = [
    [
      { label: 'FMP',    search: 'WT29322',     match: 'FACTORY MOTOR PARTS',   email: '' },
      { label: 'NAPA',   search: '1097',         match: 'NAPA AUTO PARTS',      email: '' },
      { label: 'AZ',     search: 'WT44699',     match: 'AUTOZONE',              email: '' },
      { label: 'OR',     search: '1390',         match: "O'REILLY AUTO PARTS", email: '' },
      { label: 'WP',     search: '5226',         match: 'WORLDPAC',             email: '' },
      { label: '1-800',  search: '452',          match: '1-800-RADIATOR',       email: '' },
    ],
    [
      { label: 'BGB',      search: 'LT12700',     match: 'BUICK GMC',                    email: 'bgbparts@walser.com' },
      { label: 'CJD',      search: '40030WIKS',   match: 'CHRYSLER JEEP DODGE',           email: 'cjdparts@walser.com' },
      { label: 'DOB',      search: 'DODGE OF BURNSVILLE',  match: 'DODGE OF BURNSVILLE', email: 'gtidrick@dodgeofburnsville.com' },
      { label: 'FORD',     search: 'WB1956',      match: 'APPLE FORD',                    email: 'WalserReconParts@appleautos.com' },
      { label: 'HON',      search: '1259',        match: 'WALSER HONDA',                  email: 'HONParts@walser.com' },
    ],
    [
      { label: 'MAZ IGH',  search: '5543710204',  match: 'MORRIE',              email: 'parts.invergrovemazda@morries.com' },
      { label: 'NIS',      search: '1040',        match: 'WALSER NISSAN',       email: 'NISParts@walser.com' },
      { label: 'SUB STP',  search: '4073',        match: 'SUBARU ST PAUL',      email: 'SPMNSUParts@walser.com' },
      { label: 'TOY',      search: '1385',        match: 'WALSER TOYOTA',       email: 'TOYParts@walser.com' },
    ],
    [
      { label: 'AAA',   search: 'WT48419',  match: 'AAA SALVAGE',     email: '' },
      { label: 'PAMS',  search: '1261',      match: 'PAM',            email: '' },
      { label: 'LKQ',   search: '1030',      match: 'LKQ SMART PARTS',email: '' },
      { label: 'KEY',   search: '1114IL',    match: 'KEYSTONE',       email: '' },
      { label: 'USAF',  search: '1279',      match: 'US AUTO FORCE',  email: '' },
    ],
  ];

  // Recon Out Parts CC address
  const RECON_OUT_PARTS_CC = 'reconoutparts@thewalserway.onmicrosoft.com';

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
    // CONFIRMED (7/9/26): including view:window here throws "Failed to
    // convert value to 'Window'" in this Tampermonkey sandbox -- same
    // issue documented elsewhere in these scripts. Must omit it entirely
    // (it's an optional property). This was silently crashing every
    // single vendor click before either vendor-select or email-open could
    // ever run.
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
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

  function openVendorEmail(vendorConfig) {
    if (!vendorConfig.email) {
      log(`No email address set for ${vendorConfig.label} yet -- skipping email, vendor was still selected normally.`);
      return;
    }
    // v2.0: VIN comes from Tekion's own RO header (captured continuously
    // by captureVinFromHeader), NOT from Recon Clipboard's stored value.
    const vin = currentVin;
    if (!vin) {
      log(`No VIN captured from RO header yet -- skipping email for ${vendorConfig.label}.`);
      return;
    }
    const subject = 'PARTS ORDER - ' + vin;
    // CONFIRMED (7/9/26): Outlook Web's compose deep link does not support
    // a cc parameter at all -- this is a documented limitation of Outlook
    // itself (multiple independent reports confirm cc/bcc are simply not
    // implemented on this link, unlike Gmail's compose links). Adding
    // Recon Out Parts as a second comma-separated address in "to" instead,
    // since that's the only field Outlook actually honors here.
    let toField = vendorConfig.email;
    if (RECON_OUT_PARTS_CC) {
      toField += ',' + RECON_OUT_PARTS_CC;
    }
    const composeUrl = 'https://outlook.cloud.microsoft/mail/deeplink/compose?to='
      + encodeURIComponent(toField)
      + '&subject=' + encodeURIComponent(subject);
    log(`Opening Outlook Web compose for ${vendorConfig.label} -- VIN: ${vin}`);
    window.open(composeUrl, '_blank');
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

      // Vendor successfully selected -- now open the pre-filled email.
      openVendorEmail(vendorConfig);

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
    captureVinFromHeader();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  injectButtons();
  captureVinFromHeader();
})();
