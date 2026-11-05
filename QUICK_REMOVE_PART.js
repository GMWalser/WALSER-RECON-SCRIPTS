// ==UserScript==
// @name         Tekion Quick Remove Part
// @namespace    reconclipboard
// @version      1.3
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/QUICK_REMOVE_PART.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/QUICK_REMOVE_PART.js
// @description  Adds a red X button next to the three dots on each RO part line. One click = three dots -> Remove -> Lost Sale qty 0 -> Submit.
// @match        https://app.tekioncloud.com/parts/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

const LOG = '[RowRemove]';
function log(...a) { console.log(LOG, ...a); }

// Confirmed from real DOM screenshots:
const ACTION_CELL_SEL = '[data-test-id*="requestTable-action-cell-"]';
const SELECT_CELL_SEL = '[data-test-id*="requestTable-selectPart-cell-"]';
const TRIGGER_SEL = '.ant-v5-dropdown-trigger';
const REMOVE_ITEM_SEL = 'li[data-test-id="removeConfirmation"], li[value="REMOVE_RESOLVED_PART_CONFIRMATION_ACTION"]';
const LOST_QTY_SEL = 'input#lostSaleQty, input[data-test-id*="lostSaleQtyNumberInput"]';
const SUBMIT_SEL = 'button[data-test-id="undefined-submitButton"]';

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

// Tekion buttons need a real mousedown/mouseup/click sequence (a plain .click() is
// sometimes ignored). No `view:` property -- it throws in the Tampermonkey sandbox.
function realClick(el) {
  ['mousedown', 'mouseup', 'click'].forEach(type =>
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })));
}

function setNative(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  input.focus();
  setter.call(input, String(value));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.blur();
}

function visibleMenu() {
  return document.querySelector('.ant-v5-dropdown:not(.ant-v5-dropdown-hidden) ul[role="menu"]');
}

let busy = false;

async function removeRow(cell, btn) {
  if (busy) { log('Another removal is still running -- ignored.'); return; }
  busy = true;
  btn.disabled = true;
  try {
    // 1. three dots
    const trigger = cell.querySelector(TRIGGER_SEL);
    if (!trigger) { log('Three-dots trigger not found in this row.'); return; }
    realClick(trigger);
    const menu = await waitFor(visibleMenu, 3000);
    if (!menu) { log('Three-dots menu never opened -- nothing changed.'); return; }

    // 2. Remove
    const item = menu.querySelector(REMOVE_ITEM_SEL)
      || [...menu.querySelectorAll('li')].find(li => li.textContent.trim() === 'Remove');
    if (!item) {
      log('This line has no "Remove" option. Menu items were:', [...menu.querySelectorAll('li')].map(li => li.textContent.trim()));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      return;
    }
    realClick(item);
    log('Clicked Remove');

    // 3. Lost Sale quantity -> 0
    const qty = await waitFor(() => {
      const q = document.querySelector(LOST_QTY_SEL);
      return q && q.isConnected ? q : null;
    }, 6000);
    if (!qty) { log('Lost Sale quantity box never appeared -- stopped before Submit.'); return; }
    const before = qty.value;
    setNative(qty, 0);
    await sleep(250);
    log('Lost Sale qty:', JSON.stringify(before), '->', JSON.stringify(qty.value));
    if (String(qty.value) !== '0') { log('Quantity did not accept 0 -- stopped before Submit.'); return; }

    // 4. Submit
    const submit = await waitFor(() => {
      const s = document.querySelector(SUBMIT_SEL);
      return (s && s.isConnected && !s.disabled) ? s : null;
    }, 3000);
    if (!submit) { log('Submit button not found or disabled (maybe a required field, like Reason) -- stopped before Submit.'); return; }
    realClick(submit);
    log('Clicked Submit');
  } catch (e) {
    log('Error:', e);
  } finally {
    setTimeout(() => { busy = false; btn.disabled = false; }, 1500);
  }
}

let lastLoggedCount = -1;
function injectButtons() {
  // v1.3: the button now lives in the sticky checkbox column (far left of the row), which never
  // gets cut off. It still drives the three dots in the row's action cell.
  const boxCells = document.querySelectorAll(SELECT_CELL_SEL);
  if (boxCells.length !== lastLoggedCount) {
    lastLoggedCount = boxCells.length;
    log('Found', boxCells.length, 'checkbox cell(s) on this page.');
  }
  boxCells.forEach(boxCell => {
    if (boxCell.querySelector('.qrm-btn')) return;
    if (!boxCell.querySelector('input[type="checkbox"]')) return;   // skip blank "add part" rows
    const row = boxCell.closest('[role="row"]');
    const cell = row && row.querySelector(ACTION_CELL_SEL);
    if (!cell || !cell.querySelector(TRIGGER_SEL)) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'qrm-btn';
    b.textContent = '\u2715';
    b.title = 'Remove this part (three dots > Remove > Lost Sale qty 0 > Submit)';
    b.style.cssText = 'width:20px;height:20px;line-height:18px;padding:0;margin-left:4px;flex:0 0 auto;border:none;'
      + 'border-radius:4px;background:#d600d6;color:#fff;font:700 12px Segoe UI,sans-serif;cursor:pointer;';
    ['mousedown', 'mouseup'].forEach(ev => b.addEventListener(ev, e => e.stopPropagation()));
    b.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      removeRow(cell, b);
    });
    boxCell.appendChild(b);
  });
}

setInterval(injectButtons, 800);
new MutationObserver(injectButtons).observe(document.body, { childList: true, subtree: true });

log('v1.3 loaded');
})();