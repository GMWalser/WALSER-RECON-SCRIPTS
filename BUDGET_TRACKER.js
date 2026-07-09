// ==UserScript==
// @name         RV Recon Budget Tracker
// @namespace    http://tampermonkey.net/
// @version      1.1
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/BUDGET_TRACKER.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/BUDGET_TRACKER.js
// @description  Shows Recon Dollars (budget) vs the work order's current running Total next to the Mechanical Repairs section, so Parts can see at a glance what's been spent vs what's allowed.
// @match        https://app.reconvision.com/work_orders/*/edit
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

// CONFIRMED (7/9/26, real DOM capture): Recon Dollars lives in the
// (normally hidden, display:none until "Vehicle Information" is expanded)
// Vehicle Information form. We find it by its LABEL TEXT rather than a
// fixed field index -- the field's position inside
// active_job_filter_values_attributes[] could shift per inspection type,
// so matching a hardcoded index would be fragile. Confirmed structure:
// <div class="col-1"><label>Recon Dollars...</label><input ...></div>
function findReconDollarsInput() {
  const labels = document.querySelectorAll('#wo-vehicle-information label');
  for (const label of labels) {
    if (label.textContent.trim().toLowerCase().startsWith('recon dollars')) {
      return label.parentElement.querySelector('input');
    }
  }
  return null;
}

// CONFIRMED: the work order's running grand total is rendered as plain
// text like "$430.85" inside a real, stable element: #work-order-grand-total
function getGrandTotalEl() {
  return document.getElementById('work-order-grand-total');
}

// CONFIRMED: Walser allows spending up to $1,000 OVER the Recon Dollars
// figure before it's actually considered over budget -- this is a real
// buffer built into how the shop operates, not a rounding fudge. So the
// actual spending limit is (Recon Dollars + BUFFER), not Recon Dollars
// alone. "Left" reflects real remaining room against that true limit.
const BUFFER = 1000;

function parseMoney(str) {
  const n = parseFloat((str || '').replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function formatMoney(n) {
  const sign = n < 0 ? '-' : '';
  return sign + '$' + Math.abs(n).toFixed(2);
}

function injectStyles() {
  if (document.getElementById('rv-budget-tracker-style')) return;
  const style = document.createElement('style');
  style.id = 'rv-budget-tracker-style';
  style.textContent = `
    #rv-budget-tracker {
      display:inline-flex;gap:16px;align-items:center;margin:6px 0 6px 12px;
      background:#0d0d0d;border:1px solid #2a2a2a;border-radius:8px;
      padding:6px 14px;font-family:'Segoe UI',sans-serif;font-size:13px;
      vertical-align:middle;
    }
    #rv-budget-tracker .rv-bt-row { display:flex;gap:5px;align-items:baseline; }
    #rv-budget-tracker .rv-bt-label { color:#888;font-size:11px;text-transform:uppercase;letter-spacing:.03em; }
    #rv-budget-tracker .rv-bt-val { font-weight:700;color:#e0e0e0; }
    #rv-budget-tracker .rv-bt-val.rv-bt-over { color:#f87171; }
    #rv-budget-tracker .rv-bt-val.rv-bt-under { color:#4ade80; }
  `;
  document.head.appendChild(style);
}

function buildWidget() {
  const widget = document.createElement('div');
  widget.id = 'rv-budget-tracker';
  widget.innerHTML =
    '<div class="rv-bt-row"><span class="rv-bt-label">Budget</span><span id="rv-bt-budget" class="rv-bt-val">--</span></div>' +
    '<div class="rv-bt-row"><span class="rv-bt-label">Spent</span><span id="rv-bt-spent" class="rv-bt-val">--</span></div>' +
    '<div class="rv-bt-row"><span class="rv-bt-label">Left</span><span id="rv-bt-left" class="rv-bt-val">--</span></div>';
  return widget;
}

function updateWidget() {
  const budgetInput = findReconDollarsInput();
  const totalEl = getGrandTotalEl();
  const budgetSpan = document.getElementById('rv-bt-budget');
  const spentSpan = document.getElementById('rv-bt-spent');
  const leftSpan = document.getElementById('rv-bt-left');
  if (!budgetInput || !totalEl || !budgetSpan || !spentSpan || !leftSpan) return;

  const budget = parseMoney(budgetInput.value);
  const spent = parseMoney(totalEl.textContent);
  const effectiveLimit = budget + BUFFER;
  const left = effectiveLimit - spent;

  budgetSpan.textContent = formatMoney(budget);
  spentSpan.textContent = formatMoney(spent);
  leftSpan.textContent = formatMoney(left);
  leftSpan.title = 'Includes the $' + BUFFER + ' buffer allowed over Recon Dollars before actually being over.';
  leftSpan.classList.toggle('rv-bt-over', left < 0);
  leftSpan.classList.toggle('rv-bt-under', left >= 0);
}

function init() {
  if (document.getElementById('rv-budget-tracker')) return; // already injected

  // Mechanical Repairs section's team number varies per vehicle
  // (Team 1/2/3/4 depending on assignment) -- match generically.
  const section = document.querySelector('section[class*="work-order-mechanical-repairs"]');
  if (!section) return; // this vehicle isn't currently in a Mechanical Repairs dept

  const headerTable = section.querySelector('table.collapsible__header');
  if (!headerTable) return;

  injectStyles();
  const widget = buildWidget();
  headerTable.insertAdjacentElement('afterend', widget);
  updateWidget();

  // Live-update if Recon Dollars gets edited on this page.
  const budgetInput = findReconDollarsInput();
  if (budgetInput) budgetInput.addEventListener('input', updateWidget);

  // Watch the grand total for ANY change, regardless of what mechanism
  // updates it. We deliberately don't assume whether RV updates this live
  // via JS or only via a full page reload -- either way this stays correct:
  // a full reload re-runs this whole script fresh; an in-page update (if
  // one exists) gets picked up instantly by this observer.
  const totalEl = getGrandTotalEl();
  if (totalEl) {
    const observer = new MutationObserver(updateWidget);
    observer.observe(totalEl, { childList: true, characterData: true, subtree: true });
  }
}

function waitForReady(callback) {
  let attempts = 0;
  const maxAttempts = 20; // ~6s at 300ms
  const check = () => {
    attempts++;
    if (document.querySelector('section[class*="work-order-mechanical-repairs"]') || attempts >= maxAttempts) {
      callback();
      return;
    }
    setTimeout(check, 300);
  };
  check();
}

waitForReady(init);

})();
