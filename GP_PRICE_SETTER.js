// ==UserScript==
// @name         Tekion GP% to Price
// @namespace    reconclipboard
// @version      1.0
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/GP_PRICE_SETTER.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/GP_PRICE_SETTER.js
// @description  On a Tekion RO fulfillment line you are editing, type a target Gross Profit % and it fills the Selling Price to match (Selling = Cost / (1 - GP%/100)). FILL ONLY -- it shows the price live as you type and never saves; you commit the line yourself.
// @match        https://app.tekioncloud.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

const LOG = '[GP% -> Price]';
const BOX = 'wr-gpset';

function num(txt) {
    const n = parseFloat(String(txt || '').replace(/[^0-9.]/g, ''));
    return isFinite(n) ? n : null;
}
function money(n) { return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// The one editable Selling Price input in a row (only present while the line is being edited / first added).
function sellingInput(row) {
    const cell = row.querySelector('[data-test-id*="sellingPrice-cell"]');
    return cell ? cell.querySelector('.ant-input-number-input, input') : null;
}
function readCost(row) {
    const cell = row.querySelector('[data-test-id*="costPrice-cell"]');
    if (!cell) return null;
    const input = cell.querySelector('.ant-input-number-input, input');
    return num(input ? input.value : cell.textContent);
}

// Write a value into Tekion's AntD number input the way React registers it (native setter + input/change).
function setNative(input, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    input.focus();
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur();
}

function priceForGP(cost, gp) {
    if (cost == null || cost <= 0 || gp == null || gp >= 100) return null;
    return cost / (1 - gp / 100);
}

function inject(gpCell, row) {
    if (gpCell.querySelector(':scope > .' + BOX)) return;
    const wrap = document.createElement('div');
    wrap.className = BOX;
    wrap.style.cssText = 'display:flex;align-items:center;gap:4px;margin-top:3px;font:700 11px Consolas,monospace;';
    const inp = document.createElement('input');
    inp.type = 'text'; inp.placeholder = 'GP%'; inp.title = 'Type a target Gross Profit % and press Enter -- it fills the Selling Price (does not save)';
    inp.style.cssText = 'width:44px;padding:1px 4px;border:1px solid #38bdf8;border-radius:4px;background:#0b1220;color:#eaf2ff;font:inherit;text-align:center;';
    const out = document.createElement('span');
    out.style.cssText = 'color:#38bdf8;white-space:nowrap;';
    out.textContent = '';

    const preview = () => {
        const cost = readCost(row), gp = num(inp.value), p = priceForGP(cost, gp);
        if (inp.value.trim() === '') { out.textContent = ''; return null; }
        if (cost == null) { out.textContent = 'no cost'; return null; }
        if (p == null) { out.textContent = '—'; return null; }
        out.textContent = '→ ' + money(p);
        return p;
    };
    inp.addEventListener('input', preview);
    inp.addEventListener('keydown', e => {
        e.stopPropagation();                         // keep Tekion's hotkeys out of this box
        if (e.key === 'Enter') {
            e.preventDefault();
            const p = preview();
            const sell = sellingInput(row);
            if (p == null) return;
            if (!sell) { out.textContent = 'open line to edit'; return; }
            setNative(sell, (Math.round(p * 100) / 100).toFixed(2));
            out.textContent = '✓ ' + money(p);
            out.style.color = '#22c55e'; setTimeout(() => { out.style.color = '#38bdf8'; }, 1500);
        }
    });
    wrap.appendChild(inp); wrap.appendChild(out);
    gpCell.appendChild(wrap);
}

function scan() {
    const cells = document.querySelectorAll('[data-test-id*="grossProfitPercent-cell"]');
    cells.forEach(gpCell => {
        const row = gpCell.closest('[role="row"]') || gpCell.parentElement;
        if (!row) return;
        if (!sellingInput(row)) return;               // only on a line that is being edited (price is typeable)
        inject(gpCell, row);
    });
}

function onFulfillment() {
    return /\/parts\/ro-sales\/details\/parts-fulfillment/.test(location.pathname) ||
           !!document.querySelector('[data-test-id*="grossProfitPercent-cell"]');
}
setInterval(() => { if (onFulfillment()) scan(); }, 1000);
if (onFulfillment()) scan();

console.log(LOG, 'v1.0 loaded');
})();
