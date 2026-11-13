// ==UserScript==
// @name         Tekion -20% Price
// @namespace    reconclipboard
// @version      1.0
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/PRICE_HINT.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/PRICE_HINT.js
// @description  On Tekion's RO parts fulfillment lines, shows a price next to each Selling Price that is 20% less (selling x 0.80).
// @match        https://app.tekioncloud.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

const LOG = '[-20% Price]';
const OFF = 0.80;                 // 20% less than selling
const BADGE = 'wr-20off';

// Read the selling price out of a sellingPrice cell -- editable input first, else the shown text.
// IMPORTANT: skip our own badge (it's a child of the cell), or we'd read the price PLUS the badge text.
function readPrice(cell) {
    const input = cell.querySelector('.ant-input-number-input, input');
    let raw = '';
    if (input) raw = input.value;
    else cell.childNodes.forEach(n => { if (!(n.nodeType === 1 && n.classList && n.classList.contains(BADGE))) raw += n.textContent || n.nodeValue || ''; });
    const n = parseFloat(String(raw || '').replace(/[^0-9.]/g, ''));
    return isFinite(n) ? n : null;
}

function money(n) {
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// The badge sits as a small line under the price, so it never widens the (narrow) cell.
function badgeFor(cell) {
    let b = cell.querySelector(':scope > .' + BADGE);
    if (!b) {
        b = document.createElement('div');
        b.className = BADGE;
        b.style.cssText = 'font-size:11px;font-weight:700;line-height:1.1;margin-top:1px;color:#fbbf24;white-space:nowrap;pointer-events:none;';
        if (getComputedStyle(cell).position === 'static') cell.style.position = 'relative';
        cell.appendChild(b);
    }
    return b;
}

function scan() {
    const cells = document.querySelectorAll('[data-test-id*="sellingPrice-cell"]');
    cells.forEach(cell => {
        const price = readPrice(cell);
        const b = badgeFor(cell);
        if (price == null || price <= 0) { b.style.display = 'none'; return; }
        b.style.display = '';
        b.textContent = money(price * OFF) + '  −20%';
    });
}

// RO fulfillment detailed view only (where the sellingPrice cells live)
function onFulfillment() {
    return /\/parts\/ro-sales\/details\/parts-fulfillment/.test(location.pathname) ||
           document.querySelector('[data-test-id*="sellingPrice-cell"]');
}

let timer = 0;
function tick() {
    if (onFulfillment()) scan();
}
setInterval(tick, 1000);
tick();

// also re-run promptly right after a click / typing in a price (so it updates as you edit)
document.addEventListener('input', e => {
    if (e.target.closest && e.target.closest('[data-test-id*="sellingPrice-cell"]')) { clearTimeout(timer); timer = setTimeout(scan, 150); }
}, true);

console.log(LOG, 'v1.0 loaded');
})();
