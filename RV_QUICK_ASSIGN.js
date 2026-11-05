// ==UserScript==
// @name         RV Quick Assign
// @namespace    reconclipboard
// @version      1.3
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/RV_QUICK_ASSIGN.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/RV_QUICK_ASSIGN.js
// @description  Adds "assign to me" and "unassign" buttons next to the assign-technician icon on every RO in RV department buckets.
// @match        https://app.reconvision.com/departments/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

const LOG = '[RV Quick Assign]';
function log(...a) { console.log(LOG, ...a); }

// UNASSIGN = radio value -1 (confirmed). The logged-in user's name is not
// exposed anywhere on the RV page, so each person types their name once
// (exactly as it shows in the assign list); it is saved in THEIR browser only.
const UNASSIGN_ID = '-1';
const NAME_KEY = 'rv_quick_assign_my_name';

function getSavedName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; }
}
function saveName(n) { try { localStorage.setItem(NAME_KEY, n); } catch (e) {} }

function labelFor(r) {
  const lab = r.id ? document.querySelector('.mfp-content label[for="' + r.id + '"]') : null;
  return lab ? lab.textContent.trim() : '';
}

// One-time picker: shows every name from the assign list, user clicks theirs.
function pickName(radios) {
  return new Promise(resolve => {
    const names = [...radios].filter(r => r.value !== UNASSIGN_ID).map(labelFor).filter(Boolean);
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font-family:Segoe UI,sans-serif;';
    const box = document.createElement('div');
    box.style.cssText = 'background:#1a1a1a;color:#fff;border:2px solid #16a34a;border-radius:10px;padding:16px;width:340px;max-height:80vh;display:flex;flex-direction:column;gap:8px;';
    box.innerHTML = '<div style="font-weight:700;font-size:14px;">Which one is you?</div><div style="font-size:12px;color:#9ca3af;">One-time setup. Saved in this browser only. Alt+click Me later to change it.</div>';
    const search = document.createElement('input');
    search.placeholder = 'Type to filter...';
    search.style.cssText = 'padding:6px;border-radius:6px;border:1px solid #444;background:#0d0d0d;color:#fff;';
    const list = document.createElement('div');
    list.style.cssText = 'overflow:auto;display:flex;flex-direction:column;gap:4px;';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.textContent = 'Cancel';
    cancel.style.cssText = 'padding:6px;border-radius:6px;border:none;background:#444;color:#fff;cursor:pointer;';
    const done = v => { ov.remove(); resolve(v); };
    const items = names.map(n => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = n;
      b.style.cssText = 'text-align:left;padding:6px 8px;border-radius:6px;border:1px solid #333;background:#262626;color:#fff;cursor:pointer;';
      b.addEventListener('click', () => done(n));
      list.appendChild(b);
      return b;
    });
    search.addEventListener('input', () => {
      const q = search.value.toLowerCase();
      items.forEach(b => { b.style.display = b.textContent.toLowerCase().includes(q) ? '' : 'none'; });
    });
    cancel.addEventListener('click', () => done(''));
    box.append(search, list, cancel);
    ov.appendChild(box);
    // The open RV popup (Magnific) steals focus from anything outside its own
    // wrapper, so the picker lives INSIDE that wrapper and keeps events from
    // reaching the popup's own handlers.
    ['mousedown', 'mouseup', 'click', 'keydown', 'keyup', 'keypress', 'focusin'].forEach(ev =>
      ov.addEventListener(ev, e => e.stopPropagation()));
    (document.querySelector('.mfp-wrap') || document.body).appendChild(ov);
    setTimeout(() => search.focus(), 50);
  });
}
function clearMyName() { try { localStorage.removeItem(NAME_KEY); } catch (e) {} }

const RADIO_SEL = 'input[type="radio"][name="assigne[technicians][]"]';

const style = document.createElement('style');
style.textContent = `
  .rv-qa-btn {
    width:26px;height:26px;border-radius:50%;border:none;cursor:pointer;
    color:#fff;font-weight:700;font-size:12px;line-height:26px;padding:0;
    margin-left:6px;flex:0 0 auto;
  }
  .rv-qa-me   { background:#16a34a; }
  .rv-qa-me:hover   { background:#15803d; }
  .rv-qa-un   { background:#dc2626; }
  .rv-qa-un:hover   { background:#b91c1c; }
  .rv-qa-btn:disabled { background:#555;cursor:wait; }
`;
document.head.appendChild(style);

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

async function assign(dispatchBtn, mode, btn, forceAsk) {
  btn.disabled = true;
  try {
    // Open the same modal the normal assign icon opens.
    dispatchBtn.click();

    const radios = await waitFor(() => {
      const list = document.querySelectorAll('.mfp-content ' + RADIO_SEL);
      return list.length > 1 ? list : null;
    }, 8000);
    if (!radios) { log('Assign list never loaded -- nothing changed.'); return; }

    let radio = null;
    if (mode === 'unassign') {
      radio = [...radios].find(r => r.value === UNASSIGN_ID);
    } else {
      let myName = getSavedName();
      if (!myName || forceAsk) {
        myName = await pickName(radios);
        if (!myName) { const x = document.querySelector('.mfp-close'); if (x) x.click(); return; }
        saveName(myName);
      }
      const want = myName.toLowerCase();
      radio = [...radios].find(r => labelFor(r).toLowerCase() === want);
      if (!radio) {
        clearMyName();
        log('Saved name "' + myName + '" not in the list -- cleared.');
        const x = document.querySelector('.mfp-close'); if (x) x.click();
        alert('Your saved name was not found in the assign list. Click Me again to pick your name.');
        return;
      }
    }
    if (!radio) { log('Radio not found for', mode); return; }

    radio.click();
    log('Selected', mode, '(value ' + radio.value + ')');

    const form = radio.closest('form');
    if (!form) { log('No <form> around the radio -- selected it but could not submit.'); return; }

    const submitBtn = form.querySelector('.button-area button, .button-area input[type="submit"], button[type="submit"], input[type="submit"]');
    if (submitBtn) {
      log('Clicking form submit button:', submitBtn.outerHTML.slice(0, 160));
      submitBtn.click();
    } else {
      log('No submit button found, using form.requestSubmit()');
      form.requestSubmit();
    }
  } catch (e) {
    log('Error:', e);
  } finally {
    setTimeout(() => { btn.disabled = false; }, 2500);
  }
}

function makeBtn(cls, text, title, handler) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'rv-qa-btn ' + cls;
  b.textContent = text;
  b.title = title;
  // These buttons sit inside the RO's <a> link -- stop clicks from opening the RO.
  ['mousedown', 'mouseup'].forEach(ev =>
    b.addEventListener(ev, e => { e.stopPropagation(); }, true));
  b.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    handler(b, e);
  }, true);
  return b;
}

function injectButtons() {
  document.querySelectorAll('.info-bar__button.info-bar__dispatch-button').forEach(dispatchBtn => {
    const parent = dispatchBtn.parentElement;
    if (!parent || parent.querySelector('.rv-qa-btn')) return;
    const me = makeBtn('rv-qa-me', 'Me', 'Assign this RO to me (Alt+click to change your saved name)', (b, e) => assign(dispatchBtn, 'me', b, e.altKey));
    const un = makeBtn('rv-qa-un', '✕', 'Unassign this RO', b => assign(dispatchBtn, 'unassign', b));
    dispatchBtn.insertAdjacentElement('afterend', un);
    dispatchBtn.insertAdjacentElement('afterend', me);
  });
}

setInterval(injectButtons, 1500);
injectButtons();
new MutationObserver(injectButtons).observe(document.body, { childList: true, subtree: true });

log('v1.3 loaded');
})();