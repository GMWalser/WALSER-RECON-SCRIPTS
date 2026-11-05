// ==UserScript==
// @name         Tekion Order/Fill Checkboxes
// @namespace    reconclipboard
// @version      1.0
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/ORDER_FILL_CHECKBOXES.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/ORDER_FILL_CHECKBOXES.js
// @description  On Tekion's "Order / Fill" screen, adds a checkbox to each part line. Checked = copy Sale Qty into the SOR Qty field (and zero Fill Now on "Ready to be Filled" lines). Unchecked = put it back.
// @match        https://app.tekioncloud.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

const LOG = '[OrderFill CB]';
function log(...a) { console.log(LOG, ...a); }

const TITLE_SEL = '[data-test-id="undefined-{pageSemantic}-title"]';
const HEADER_SEL = '[class*="parts_orderFillModal_partsTableHeaderContainer"]';
const ROWGROUP_SEL = '.rt-tr-group[data-test-id^="undefined-orderFillTable-rowGroup-"]';

// --- helpers --------------------------------------------------------
function setNative(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  input.focus();
  setter.call(input, String(value));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.blur();
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function sectionKind(headerEl) {
  const own = (headerEl.innerText || '').toLowerCase();
  const scope = headerEl.closest('[class*="root_fieldLayout_columnContainer"]');
  const text = own.includes('to be ordered') || own.includes('ready to be filled') ? own
    : (scope ? (scope.innerText || '').toLowerCase() : own);
  const iOrder = text.indexOf('to be ordered');
  const iReady = text.indexOf('ready to be filled');
  if (iOrder !== -1 && (iReady === -1 || iOrder < iReady)) return 'order';
  if (iReady !== -1) return 'ready';
  return null;
}

function rowParts(row) {
  const saleEl = row.querySelector('[data-test-id*="orderFillTable-saleQty-cell-"] #saleQty')
    || row.querySelector('[data-test-id*="orderFillTable-saleQty-cell-"]');
  const sorInput = row.querySelector('input#sqnpQty');
  const fillInput = row.querySelector('input[id^="deliverNow"]');
  const partCell = row.querySelector('[data-test-id*="orderFillTable-part-cell-"]');
  const saleQty = saleEl ? parseInt((saleEl.textContent || '').replace(/[^0-9-]/g, ''), 10) : NaN;
  return { saleQty, sorInput, fillInput, partCell };
}

// --- the checkbox action -------------------------------------------
async function onToggle(cb, row, kind) {
  const p = rowParts(row);
  if (!(p.saleQty >= 0) || !p.sorInput) {
    log('Could not read this line (saleQty:', p.saleQty, '| SOR input found:', !!p.sorInput, ') -- nothing changed.');
    cb.checked = !cb.checked;
    return;
  }
  const partText = p.partCell ? p.partCell.textContent.trim().slice(0, 40) : '(part)';

  if (cb.checked) {
    if (kind === 'ready' && p.fillInput) {
      cb.dataset.origFill = p.fillInput.value || '0';
      setNative(p.fillInput, 0);
      await sleep(200); // let Tekion react to the zeroed Fill Now before the SOR field
    }
    setNative(p.sorInput, p.saleQty);
    await sleep(150);
    log(kind === 'ready' ? 'Fill Now -> 0 and' : '', 'SOR Qty ->', p.saleQty, 'for', partText,
      '| SOR field now reads:', JSON.stringify(p.sorInput.value),
      p.fillInput ? '| Fill Now reads: ' + JSON.stringify(p.fillInput.value) : '');
    if (String(p.sorInput.value) !== String(p.saleQty)) {
      log('WARNING: SOR field did not keep the value (it may be locked on this line).');
    }
  } else {
    setNative(p.sorInput, 0);
    if (kind === 'ready' && p.fillInput && cb.dataset.origFill !== undefined) {
      await sleep(150);
      setNative(p.fillInput, cb.dataset.origFill);
    }
    log('Unchecked', partText, '-> SOR Qty 0' + (kind === 'ready' ? ', Fill Now restored to ' + cb.dataset.origFill : ''));
  }
}

// --- inject ---------------------------------------------------------
let loggedNoKind = false;

function inject() {
  const title = document.querySelector(TITLE_SEL);
  if (!title || !/order\s*\/\s*fill/i.test(title.textContent || '')) return;

  document.querySelectorAll(HEADER_SEL).forEach(header => {
    const kind = sectionKind(header);
    if (!kind) {
      if (!loggedNoKind) {
        loggedNoKind = true;
        log('Section header text not recognised. Header text was:', JSON.stringify((header.innerText || '').slice(0, 120)));
      }
      return;
    }
    const scope = header.parentElement;
    if (!scope) return;
    scope.querySelectorAll(ROWGROUP_SEL).forEach(row => {
      if (row.querySelector('.ofcb-box')) return;
      const { partCell } = rowParts(row);
      if (!partCell) return;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'ofcb-box';
      cb.title = kind === 'ready'
        ? 'Order this instead of filling from stock: Fill Now -> 0, SOR Qty -> Sale Qty'
        : 'Order this: SOR Qty -> Sale Qty';
      cb.style.cssText = 'width:16px;height:16px;margin-right:8px;cursor:pointer;accent-color:#16a34a;flex:0 0 auto;';
      ['mousedown', 'mouseup', 'click'].forEach(ev => cb.addEventListener(ev, e => e.stopPropagation()));
      cb.addEventListener('change', () => onToggle(cb, row, kind));
      partCell.insertBefore(cb, partCell.firstChild);
    });
  });
}

setInterval(inject, 700);
new MutationObserver(inject).observe(document.body, { childList: true, subtree: true });

log('v1.0 loaded');
})();