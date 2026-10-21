// ==UserScript==
// @name         PO Vendor Quick-Add
// @namespace    http://tampermonkey.net/
// @version      3.0
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/VENDOR_QUICKADD.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/VENDOR_QUICKADD.js
// @description  Quick-add buttons for the most-used vendors on Tekion's PO Create Miscellaneous Order screen (now including the European OEM dealers and Hyundai/Kia). Selecting a vendor with a known email opens a pre-filled Outlook draft (To/Subject only) using the VIN read directly from Tekion's own RO header.
// @match        https://app.tekioncloud.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const LOG_PREFIX = "[PO-Vendor-QuickAdd]";
  const WRAPPER_ID = "rv-po-vendor-btn-wrapper";

  // v2.3: The VIN header is visible on the Orders/Fulfillment screen but
  // disappears when the PO form opens. So we continuously read it while
  // it's visible (via MutationObserver), and hold onto the last value
  // when it's gone. The targeted selector (copyToClipboard_labelContent)
  // only matches Tekion's real header VIN element — can't grab stale
  // VINs from other DOM nodes.
  let lastKnownVin = '';
  const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/;

  function refreshVin() {
    const candidates = document.querySelectorAll('span[class*="copyToClipboard_labelContent"]');
    for (const el of candidates) {
      const text = (el.textContent || '').trim();
      if (text.length === 17 && VIN_REGEX.test(text)) {
        if (lastKnownVin !== text) {
          lastKnownVin = text;
          log('VIN updated from header:', lastKnownVin);
        }
        return;
      }
    }
    // Header not visible (PO screen) — keep existing cached value
  }

  // NOTE: search = text typed into the Vendor input to filter react-select's
  // option list. match = case-insensitive substring checked against the
  // rendered option's text to confirm we clicked the right one.
  // TODO(Gabe): fill in the real email address for each vendor below.
  // Leave blank ('') for any vendor you don't have an address for yet --
  // the button will still select the vendor normally, it just won't try
  // to open an email for that one until an address is added.
  //
  // v2.4 (10/20/26): added the European OEM dealer vendors (row 4, purple --
  // same vendor list/search/match/email values as RV Euro Filter Order's
  // EURO_VENDORS) and Hyundai + Kia (added into the Walser-dealer teal row
  // alongside Mazda/Nissan/Subaru/Toyota). Row order is now: blue
  // (distributors), teal x2 (Walser dealerships), purple (Euro dealerships),
  // green (junkyards).
  // v2.4: each row below is in alphabetical order by its button label.
  const VENDOR_ROWS = [
    [
      { label: '1-800',  search: '452',          match: '1-800-RADIATOR',       email: '' },
      { label: 'AZ',     search: 'WT44699',     match: 'AUTOZONE',              email: '' },
      { label: 'FMP',    search: 'WT29322',     match: 'FACTORY MOTOR PARTS',   email: '' },
      { label: 'NAPA',   search: '1097',         match: 'NAPA AUTO PARTS',      email: '' },
      { label: 'OR',     search: '1390',         match: "O'REILLY AUTO PARTS", email: '' },
      { label: 'WP',     search: '5226',         match: 'WORLDPAC',             email: '' },
    ],
    [
      { label: 'BGB',      search: 'LT12700',     match: 'BUICK GMC',                    email: 'bgbparts@walser.com' },
      { label: 'CJD',      search: '40030WIKS',   match: 'CHRYSLER JEEP DODGE',           email: 'cjdparts@walser.com' },
      { label: 'DOB',      search: 'DODGE OF BURNSVILLE',  match: 'DODGE OF BURNSVILLE', email: 'gtidrick@dodgeofburnsville.com' },
      { label: 'FORD',     search: 'WB1956',      match: 'APPLE FORD',                    email: 'WalserReconParts@appleautos.com' },
      { label: 'HON',      search: '1259',        match: 'WALSER HONDA',                  email: 'HONParts@walser.com' },
    ],
    [
      { label: 'HYU',      search: '1364',        match: 'WALSER HYUNDAI',      email: 'HYUParts@walser.com' },
      { label: 'KIA',      search: '1143',        match: 'LUTHER NISSAN KIA',   email: 'parts@luthernissankia.com' },
      { label: 'MAZ IGH',  search: '5543710204',  match: 'MORRIE',              email: 'parts.invergrovemazda@morries.com' },
      { label: 'NIS',      search: '1040',        match: 'WALSER NISSAN',       email: 'NISParts@walser.com' },
      { label: 'SUB STP',  search: '4073',        match: 'SUBARU ST PAUL',      email: 'SPMNSUParts@walser.com' },
      { label: 'TOY',      search: '1385',        match: 'WALSER TOYOTA',       email: 'TOYParts@walser.com' },
    ],
    [
      { label: 'AUDI',    search: '3881',     match: 'AUDI RICHFIELD',            email: 'parts@audirichfield.com' },
      { label: 'BMW',     search: 'WT53',     match: 'MOTORWERKS BMW',            email: 'epeterson@penskeautomotive.com,sgroth@penskeautomotive.com' },
      { label: 'GENESIS', search: '5428',     match: 'LUTHER GENESIS',            email: 'Parts@LutherGenesis.com' },
      { label: 'JLR',     search: '1264',     match: 'JAGUAR LAND ROVER',         email: 'Parts.JaguarLandRover@morries.com' },
      { label: 'MERC',    search: 'WO1205',   match: 'SEARS IMPORTED',            email: 'william.wissbaum@searsimports.com' },
    ],
    [
      { label: 'MINI',    search: 'WT53',     match: 'MOTORWERKS BMW',            email: 'MWminiparts@penskeautomotive.com' },
      { label: 'PORSCHE', search: 'WZA362',   match: 'PORSCHE MINNEAPOLIS',       email: 'nathan.ahern@carouselmotor.com' },
      { label: 'VOLVO',   search: 'WB935031', match: 'KLINE AUTOWORLD VOLVO',     email: 'volvoparts@klineautoworld.com' },
      { label: 'VW',      search: 'WA58025',  match: 'VOLKSWAGEN OF INVER GROVE', email: 'brian@vwinvergrove.com' },
    ],
    [
      { label: 'AAA',   search: 'WT48419',  match: 'AAA SALVAGE',     email: '' },
      { label: 'KEY',   search: '1114IL',    match: 'KEYSTONE',       email: '' },
      { label: 'LKQ',   search: '1030',      match: 'LKQ SMART PARTS',email: '' },
      { label: 'PAMS',  search: '1261',      match: 'PAM',            email: '' },
      { label: 'USAF',  search: '1279',      match: 'US AUTO FORCE',  email: '' },
    ],
  ];

  // Recon Out Parts CC address
  const RECON_OUT_PARTS_CC = 'reconoutparts@thewalserway.onmicrosoft.com';

  const ROW_COLORS = [
    { bg: '#1d4ed8' },   // row 1 - deep blue (parts distributors)
    { bg: '#0f766e' },   // row 2 - deep teal (Walser dealerships + Ford, part 1)
    { bg: '#0f766e' },   // row 3 - deep teal (Walser dealerships, part 2 + Hyundai/Kia)
    { bg: '#5b21b6' },   // row 4 - deep purple (European OEM dealerships, part 1)
    { bg: '#5b21b6' },   // row 5 - deep purple (European OEM dealerships, part 2)
    { bg: '#15803d' },   // row 6 - deep green (junkyards)
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
    // v2.3: VIN read fresh from header when visible, cached for PO screen.
    const vin = lastKnownVin;
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
      padding: 7px 12px;
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

    // v3.0: "RV Euro Filter Order" (separate script) opens the Misc PO via
    // its own flow and injects its OWN exclusive purple Euro-vendor buttons
    // at this same anchor spot, tracked by its sessionStorage key
    // 'rv_euro_filter_data'. When that's present, this is a Euro Filter
    // order -- skip injecting our buttons entirely so theirs is the only
    // set shown (confirmed via their EURO_FILTER_ORDER.js source).
    if (sessionStorage.getItem('rv_euro_filter_data')) return;

    const vendorField = document.getElementById('VENDOR');
    if (!vendorField) return;
    // v2.9: id="VENDOR_SITE" only exists on the regular PO screen. The Misc
    // PO screen has the same "Vendor Site" field in the same spot, but its
    // wrapper carries data-field-id="SITES" instead (confirmed via DOM
    // screenshot) -- no id of its own. Check both so buttons anchor off the
    // right-column Vendor Site field on either screen; only fall back to
    // VENDOR itself if neither is found.
    const vendorSiteField = document.getElementById('VENDOR_SITE')
      || document.querySelector('[data-field-id="SITES"]');
    const anchorField = vendorSiteField || vendorField;

    const scrollContainer = findScrollableAncestor(anchorField);
    if (getComputedStyle(scrollContainer).position === 'static') {
      scrollContainer.style.position = 'relative';
    }

    const anchorRect = anchorField.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();

    const wrapper = document.createElement('div');
    wrapper.id = WRAPPER_ID;
    wrapper.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 6px;
      position: absolute;
      top: ${anchorRect.top - containerRect.top + scrollContainer.scrollTop}px;
      left: ${anchorRect.right - containerRect.left + scrollContainer.scrollLeft + 78}px;
      z-index: 999;
    `;

    // v2.4: rows are a plain tight left-aligned grid (fixed small gap, no
    // stretch-to-match-widest-row) -- that stretch trick looked fine when
    // every row had a similar button count, but the 9-button Euro row made
    // the shorter rows spread out loose. Tight and left-aligned looks right
    // regardless of how many buttons are in any given row.
    VENDOR_ROWS.forEach((rowConfigs, rowIndex) => {
      const rowEl = document.createElement('div');
      rowEl.style.cssText = `
        display: flex;
        gap: 6px;
      `;
      rowConfigs.forEach((vendorConfig) => {
        rowEl.appendChild(makeButton(vendorConfig, ROW_COLORS[rowIndex]));
      });
      wrapper.appendChild(rowEl);
    });

    scrollContainer.appendChild(wrapper);

    log("Injected vendor quick-add buttons.");
  }

  function cleanupIfOrphaned() {
    const wrapper = document.getElementById(WRAPPER_ID);
    if (wrapper && !document.getElementById('VENDOR')) {
      wrapper.remove();
    }
  }

  // v2.7: On the Miscellaneous PO create screen, the first Items List row
  // starts totally blank (no part#, qty, or price) -- confirmed via DOM
  // screenshot (row data-test-id ends in "-row-0", each cell has a
  // data-column-id, inputs found inside via that). Prefill it with a
  // placeholder part, qty 1, cost $1.00 so the row is never left empty.
  // Only fills if still empty, and only once per row (flagged on the row
  // element itself) so it doesn't fight the user retyping.
  const MISC_PO_FILLED_FLAG = 'rvMiscPoDefaultsFilled';

  function nativeSetNumberValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillMiscPoDefaults() {
    if (!location.pathname.includes('/parts/purchase-order/misc/')) return;

    const row0 = document.querySelector('[data-test-id="@tekion-parts-purchaseOrder-partsPOFormPage-partsListTable-row-0"]');
    if (!row0 || row0.dataset[MISC_PO_FILLED_FLAG]) return;

    const itemNameInput = row0.querySelector('[data-column-id="itemName"] input');
    const qtyInput = row0.querySelector('[data-column-id="requiredQuantity"] input');
    const priceInput = row0.querySelector('[data-column-id="partPrice"] input');
    if (!itemNameInput || !qtyInput || !priceInput) return;

    if (!itemNameInput.value) nativeSetValue(itemNameInput, 'PART');
    if (!qtyInput.value) nativeSetNumberValue(qtyInput, '1');
    if (!priceInput.value) nativeSetNumberValue(priceInput, '1.00');

    row0.dataset[MISC_PO_FILLED_FLAG] = '1';
    log('Misc PO: filled default Part/Qty/Cost on first row.');
  }

  const observer = new MutationObserver(() => {
    cleanupIfOrphaned();
    injectButtons();
    refreshVin();
    fillMiscPoDefaults();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  injectButtons();
  refreshVin();
  fillMiscPoDefaults();
})();
