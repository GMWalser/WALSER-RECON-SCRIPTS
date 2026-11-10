// ==UserScript==
// @name         Tekion to RV Parts Transfer
// @namespace    reconclipboard
// @version      1.4
// @author       Gabe
// @description  Tekion RO: one click captures every part (part#, description, qty, price, job). RV Parts page: shows them matched to the Mechanical Repairs lines (change any match), then fills them all in. You review and click Save.
// @match        https://app.tekioncloud.com/parts/*
// @match        https://app.reconvision.com/work_orders/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

const LOG = '[PartsTransfer]';
const log = (...a) => console.log(LOG, ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const load = (k, d) => { try { const v = GM_getValue(k); return v === undefined ? d : JSON.parse(v); } catch (e) { return d; } };
const save = (k, v) => GM_setValue(k, JSON.stringify(v));
const IS_TEKION = location.hostname.includes('tekion');

// ---------- small UI helpers (plain DOM, works on every site) ----------
function el(tag, css, text) { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }
function button(text, bg, onClick) {
  const b = el('button', `background:${bg};color:#fff;border:0;border-radius:6px;padding:7px 12px;font:600 13px Segoe UI,sans-serif;cursor:pointer;margin:2px`, text);
  b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); onClick(e); });
  return b;
}
let toastEl = null, toastT = 0;
function toast(msg, bad) {
  if (!toastEl) { toastEl = el('div', 'position:fixed;right:16px;bottom:70px;z-index:2147483647;color:#fff;font:600 13px Segoe UI,sans-serif;padding:9px 14px;border-radius:7px;box-shadow:0 3px 12px rgba(0,0,0,.5);pointer-events:none'); document.documentElement.appendChild(toastEl); }
  toastEl.style.background = bad ? '#b91c1c' : '#16a34a'; toastEl.textContent = msg; toastEl.style.display = 'block';
  clearTimeout(toastT); toastT = setTimeout(() => { toastEl.style.display = 'none'; }, 5000);
}
function setNative(field, value) {                // set a value the way a person typing would
  const proto = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : field.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}
const clean = t => (t || '').replace(/\s+/g, ' ').trim();
const money = t => { const m = clean(t).replace(/[$,]/g, '').match(/-?\d+(\.\d+)?/); return m ? m[0] : ''; };

// =====================================================================
// TEKION: capture every part on the RO, grouped by job
// =====================================================================
function tekionRO() {
  for (const n of document.querySelectorAll('span,div,a,h1,h2,h3,p')) {
    if (n.childElementCount) continue;
    const m = clean(n.textContent).match(/^RO\s*#?\s*(7\d{6})$/i); if (m) return m[1];
  }
  const m = (document.body.innerText || '').match(/RO\s*#\s*(7\d{6})/i);
  return m ? m[1] : '';
}
function jobTitle(sec) {
  const lines = (sec.innerText || '').split('\n').map(clean).filter(Boolean);
  return lines.find(l => /[a-z]{3}/i.test(l) && !/^job\s*\d+$/i.test(l) && l.length < 80) || 'Job';
}
function capturePartsTekion() {
  const jobs = [...document.querySelectorAll('[data-id^="Job"]')];
  const parts = [];
  jobs.forEach(sec => {
    const title = jobTitle(sec);
    sec.querySelectorAll('[data-test-id*="itemName-cell"]').forEach(cell => {
      const row = cell.parentElement; if (!row) return;
      const inp = cell.querySelector('input');
      const name = clean(inp && inp.value ? inp.value : cell.innerText);
      if (!name || /^select/i.test(name)) return;             // empty "Select part" row
      const pn = clean(name.split(' - ')[0]), desc = clean(name.split(' - ').slice(1).join(' - '));
      const pc = row.querySelector('[data-test-id*="sellingPrice"]');
      const pInp = pc && pc.querySelector('input');
      const price = money(pInp && pInp.value ? pInp.value : pc ? pc.innerText : '');
      const qc = row.querySelector('[data-test-id*="requiredQuantity"]')        // Tekion's "Qty" column (confirmed)
        || row.querySelector('[data-test-id*="uantity"]:not([data-test-id*="onHand"]):not([data-test-id*="hold"]):not([data-test-id*="delivered"])');
      const qInp = qc && qc.querySelector('input');
      const qty = money(qInp && qInp.value ? qInp.value : qc ? qc.innerText : '') || '1';
      parts.push({ pn, desc, qty, price, job: title });
    });
  });
  return { jobs: jobs.length, parts };
}
function initTekion() {
  const b = button('📤 Send parts to RV', '#2563eb', () => {
    const ro = tekionRO();
    const { jobs, parts } = capturePartsTekion();
    log('RO', ro, '| jobs', jobs, '| parts', parts);
    if (!jobs) { toast('No RO jobs found on this page', true); return; }
    if (!parts.length) { toast('No parts found on this RO', true); return; }
    if (!ro) { toast('Could not read the RO number on this page', true); return; }
    const all = load('captures', {}); all[ro] = { ts: Date.now(), parts };
    Object.keys(all).sort((a, z) => all[z].ts - all[a].ts).slice(30).forEach(k => delete all[k]);   // keep the newest 30 ROs
    save('captures', all);
    toast(`Captured ${parts.length} parts for RO ${ro}. Open the RV Parts page for this RO.`);
  });
  b.id = 'wr-pt-send';
  b.style.cssText += ';position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:2147483600;box-shadow:0 3px 12px rgba(0,0,0,.45)';
  const place = () => {                                  // only show on a page that has RO jobs
    const show = !!document.querySelector('[data-id^="Job"]');
    if (show && !b.isConnected) document.documentElement.appendChild(b);
    if (!show && b.isConnected) b.remove();
  };
  place(); setInterval(place, 2000);
}

// =====================================================================
// RV: remember the RO# and the Mechanical Repairs lines (edit page)
// =====================================================================
const woId = () => (location.pathname.match(/work_orders\/(\d+)/) || [])[1] || '';
// Fast: uses textContent (no page re-measuring) and runs only on load / when the work order
// changes. The old version re-measured big parts of the page every 5 s and froze RV for seconds.
function rememberWorkOrder() {
  const id = woId(); if (!id) return;
  const ro = ((document.body.textContent || '').match(/RO#\s*(7\d{6})/) || [])[1] || '';
  const mech = [];
  for (const h of document.querySelectorAll('h1,h2,h3,h4,h5,h6,span,div,a,b,strong,p')) {
    if (h.childElementCount || !/^\s*mechanical repairs/i.test(h.textContent || '')) continue;
    let card = h.parentElement, hops = 0;
    while (card && card !== document.body && hops++ < 12 && !card.querySelector('[data-service-id]')) card = card.parentElement;
    if (!card || card === document.body) continue;
    if (((card.textContent || '').match(/DEPT\.?\s*TOTAL/gi) || []).length > 1) continue;   // went too far up (several departments)
    card.querySelectorAll('[data-service-id]').forEach(r => { const sid = r.getAttribute('data-service-id'); if (sid && !mech.includes(sid)) mech.push(sid); });
  }
  if (!ro && !mech.length) return;
  const all = load('workorders', {}); const prev = all[id] || {};
  all[id] = { ro: ro || prev.ro || '', mech: mech.length ? mech : (prev.mech || []), ts: Date.now() };
  save('workorders', all);
}

// =====================================================================
// RV Parts Overview: preview, match, fill
// =====================================================================
const STOP = new Set(['replace', 'both', 'per', 'diag', 'the', 'and', 'with', 'for', 'team', 'line', 'install', 'new', 'assy', 'kit', 'set', 'part', 'parts', 'service', 'synthetic']);
const words = t => clean(t).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(w => w.length >= 3 && !STOP.has(w)).map(w => w.replace(/s$/, ''));
function bestService(part, services) {
  let best = null, score = 0;
  const jw = words(part.job), dw = words(part.desc);
  services.forEach(s => {
    const sw = words(s.name); if (sw.includes('lof')) sw.push('oil', 'filter');   // LOF = lube, oil & filter
    let sc = sw.filter(w => jw.includes(w)).length * 2 + sw.filter(w => dw.includes(w)).length;
    if (clean(part.job).toLowerCase() === clean(s.name).replace(/^\*/, '').toLowerCase()) sc += 10;
    if (sc > score) { score = sc; best = s; }
  });
  return score > 0 ? best : null;
}
function rvServices() {
  const out = [];
  document.querySelectorAll('.section-header[data-service-id]').forEach(h => {
    const id = h.getAttribute('data-service-id');
    const name = clean((h.innerText || '').replace(/^\W*Service:\s*/i, '').split('\n')[0].replace(/\d+\s*Parts?\s*Add Part to Service.*$/i, ''));
    const btn = h.querySelector('.add-part-to-service-btn') || [...h.querySelectorAll('button,a')].find(x => /add part to service/i.test(x.textContent));
    if (btn) out.push({ id, name: name.replace(/^Service:\s*/i, ''), btn });
  });
  return out;
}
async function waitEmptyRow(section, before, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    for (const r of section.querySelectorAll('tr')) {
      if (before.has(r)) continue;
      const pn = r.querySelector('textarea[id*="part_number"], input[id*="part_number"]');
      if (pn && !pn.value) return r;
    }
    await sleep(150);
  }
  return null;
}
async function fillOne(svc, part, status) {
  const section = document.getElementById('parts-section-' + svc.id);
  if (!section) return 'no section on page';
  const before = new Set(section.querySelectorAll('tr'));
  svc.btn.click();
  const row = await waitEmptyRow(section, before, 4000);
  if (!row) return 'new row did not appear';
  const pn = row.querySelector('textarea[id*="part_number"], input[id*="part_number"]');
  const desc = row.querySelector('td.save_value.description textarea, textarea[data-field-name="description"]');
  const qty = row.querySelector('input[data-field-name="quantity"]');
  const price = row.querySelector('input[id*="part_price"], input[data-field-name="partPrice"]');
  const st = row.querySelector('td.save_value.status select, select[data-field-name="status"]');
  setNative(pn, part.pn);
  if (desc && part.desc) setNative(desc, part.desc);
  if (qty) setNative(qty, part.qty || '1');
  if (price && part.price) setNative(price, part.price);
  if (st && status) setNative(st, status);
  await sleep(350);
  return price || !part.price ? 'ok' : 'ok (no price box found)';
}
// Same vendor shortcuts as Recon Clipboard's quick part add (type B -> SUBCHEV, F -> FMP ...).
// Anything not in the list is used exactly as typed.
const VENDOR_MAP = {
  'F': 'FMP', 'A': 'AZ', 'O': 'OR', 'N': 'NAPA', 'B': 'SUBCHEV', 'H': 'HON',
  'D': 'DOB', 'I': 'INFINITI', 'T': 'TOY', 'LK': 'LKQ', 'AU': 'AUDI',
  'BM': 'BMW', 'MB': 'MERC', 'NI': 'NIS', 'S': 'SUB', 'P': 'PAMS',
  'AA': 'AAA', 'V': 'VW', 'VO': 'VOLVO', 'M': 'MAZ', 'L': 'LEXUS',
  'HY': 'HYU', 'E': 'EBAY', 'AC': 'ACURA', 'AV': 'FORD', 'ST': 'STOCK', 'U': 'USAF',
};
const vendorName = t => { const k = (t || '').trim().toUpperCase(); return VENDOR_MAP[k] || (t || '').trim(); };
function initRvParts() {
  const id = woId(), wo = load('workorders', {})[id] || {}, caps = load('captures', {});
  const ro = wo.ro || '';
  const cap = ro && caps[ro];
  const box = el('div', 'position:fixed;left:16px;bottom:16px;z-index:2147483600;width:min(760px,94vw);max-height:70vh;overflow:auto;background:#141a24;color:#e5e7eb;border:1px solid #334155;border-radius:10px;padding:12px;font:13px Segoe UI,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.6)');
  box.id = 'wr-pt-panel';
  const head = el('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px');
  head.appendChild(el('b', 'font-size:14px', '📥 Parts from Tekion' + (ro ? '  ·  RO ' + ro : '')));
  head.appendChild(button('✕', '#334155', () => box.remove()));
  box.appendChild(head);
  if (!ro) { box.appendChild(el('div', '', 'Open this work order\'s main RV page first (it reads the RO# there), then come back to Parts.')); document.documentElement.appendChild(box); return; }
  if (!cap) { box.appendChild(el('div', '', `No parts captured for RO ${ro} yet. In Tekion, open RO ${ro} and click "📤 Send parts to RV".`)); document.documentElement.appendChild(box); return; }

  let services = rvServices();
  const mechOnly = wo.mech && wo.mech.length ? services.filter(s => wo.mech.includes(s.id)) : [];
  if (mechOnly.length) services = mechOnly;
  box.appendChild(el('div', 'opacity:.75;margin-bottom:6px', `${cap.parts.length} parts captured ${new Date(cap.ts).toLocaleTimeString()} · lines: ${mechOnly.length ? 'Mechanical Repairs only' : 'all services (open the main RV page once to limit to Mechanical Repairs)'}`));

  const tbl = el('table', 'width:100%;border-collapse:collapse');
  const hdr = el('tr');
  const allChk = el('input'); allChk.type = 'checkbox'; allChk.checked = true; allChk.title = 'Select / deselect all';
  const th0 = el('th', 'text-align:left;padding:3px 5px;border-bottom:1px solid #334155'); th0.appendChild(allChk); hdr.appendChild(th0);
  ['Part #', 'Vendor (B = SUBCHEV, F = FMP…)', 'Qty', 'Price', 'From Tekion job', 'Put on RV line'].forEach(h => hdr.appendChild(el('th', 'text-align:left;padding:3px 5px;border-bottom:1px solid #334155;font-size:12px;opacity:.8', h)));
  tbl.appendChild(hdr);
  const rows = cap.parts.map(part => {
    const tr = el('tr');
    const chk = el('input'); chk.type = 'checkbox'; chk.checked = true;
    const cell = (node) => { const td = el('td', 'padding:3px 5px;border-bottom:1px solid #1f2937'); td.appendChild(node); tr.appendChild(td); return td; };
    const inp = (v, w) => { const i = el('input', `width:${w}px;background:#0b1018;color:#e5e7eb;border:1px solid #334155;border-radius:4px;padding:3px`); i.value = v || ''; return i; };
    cell(chk);
    const pn = inp(part.pn, 120), qty = inp(part.qty, 42), price = inp(part.price, 70);
    pn.title = part.desc || '';                                   // Tekion's part description, on hover
    const desc = inp('', 80); desc.placeholder = 'type B, F…';
    const vprev = el('span', 'margin-left:4px;font-size:11px;color:#4ade80');
    const showV = () => { const v = desc.value.trim(); vprev.textContent = v && VENDOR_MAP[v.toUpperCase()] ? '→ ' + VENDOR_MAP[v.toUpperCase()] : ''; };
    desc.addEventListener('input', showV);
    const vwrap = el('span'); vwrap.appendChild(desc); vwrap.appendChild(vprev);
    cell(pn); cell(vwrap); cell(qty); cell(price);
    cell(el('span', /recon\s*fees/i.test(part.job) ? 'color:#fbbf24' : 'opacity:.8', part.job));
    const sel = el('select', 'max-width:200px;background:#0b1018;color:#e5e7eb;border:1px solid #334155;border-radius:4px;padding:3px');
    sel.appendChild(new Option('— choose line —', ''));
    services.forEach(s => sel.appendChild(new Option(s.name, s.id)));
    const m = bestService(part, services); if (m) sel.value = m.id;
    if (!m) sel.style.borderColor = '#fbbf24';
    cell(sel);
    tbl.appendChild(tr);
    return { chk, pn, desc, qty, price, sel, showV };
  });
  box.appendChild(tbl);
  // header box: select / deselect all; it follows the row boxes (partly checked = dash)
  const syncAll = () => { const n = rows.filter(r => r.chk.checked).length; allChk.checked = n === rows.length; allChk.indeterminate = n > 0 && n < rows.length; };
  allChk.addEventListener('change', () => { rows.forEach(r => { r.chk.checked = allChk.checked; }); syncAll(); });
  rows.forEach(r => r.chk.addEventListener('change', syncAll));

  const foot = el('div', 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px');
  const status = el('select', 'background:#0b1018;color:#e5e7eb;border:1px solid #334155;border-radius:4px;padding:4px');
  [['', 'Status: leave as is'], ['1', 'Status: Action Req.'], ['3', 'Status: Ordered'], ['5', 'Status: Arrived'], ['6', 'Status: In Stock']].forEach(([v, t]) => status.appendChild(new Option(t, v)));
  const msg = el('span', 'opacity:.85');
  // one vendor for every checked part (type the shortcut, it fills each row's Vendor box)
  const allV = el('input', 'width:90px;background:#0b1018;color:#e5e7eb;border:1px solid #334155;border-radius:4px;padding:4px');
  allV.placeholder = 'Vendor for all';
  allV.addEventListener('input', () => { rows.forEach(r => { if (r.chk.checked) { r.desc.value = allV.value; r.showV(); } }); });
  const go = button('Fill parts into RV', '#16a34a', async () => {
    const jobs = rows.filter(r => r.chk.checked);
    const noLine = jobs.filter(r => !r.sel.value);
    if (noLine.length) { msg.textContent = `⚠ ${noLine.length} checked part(s) have no RV line chosen (yellow).`; return; }
    go.disabled = true; let ok = 0, bad = [];
    for (const r of jobs) {
      const svc = services.find(s => s.id === r.sel.value);
      msg.textContent = `Filling ${ok + bad.length + 1} of ${jobs.length}…`;
      const res = await fillOne(svc, { pn: r.pn.value.trim(), desc: vendorName(r.desc.value), qty: r.qty.value.trim(), price: r.price.value.trim() }, status.value);
      if (res.startsWith('ok')) { ok++; r.chk.checked = false; } else bad.push(r.pn.value + ': ' + res);
      syncAll();
    }
    go.disabled = false;
    msg.textContent = `✓ Filled ${ok}. ${bad.length ? '⚠ ' + bad.join(' · ') : ''}  Review, then click Save (or Alt+S).`;
    log('fill done', ok, bad);
  });
  foot.appendChild(allV); foot.appendChild(status); foot.appendChild(go); foot.appendChild(msg);
  box.appendChild(foot);
  document.documentElement.appendChild(box);
}

// ---------- start ----------
if (IS_TEKION) initTekion();
else if (/\/work_orders\/\d+\/parts_overview/.test(location.pathname)) setTimeout(initRvParts, 1200);
else if (/\/work_orders\/\d+/.test(location.pathname)) {
  setTimeout(rememberWorkOrder, 1500); setTimeout(rememberWorkOrder, 6000);          // on load (lines can load a bit late)
  let lastPath = location.pathname;                                                  // and when you move to another work order
  setInterval(() => { if (location.pathname !== lastPath) { lastPath = location.pathname; setTimeout(rememberWorkOrder, 1500); } }, 2000);
}
log('v1.4 loaded on', location.hostname);
})();
