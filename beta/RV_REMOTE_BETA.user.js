// ==UserScript==
// @name         RV Remote (BETA)
// @namespace    walser-rv-remote-beta
// @version      0.2
// @author       Gabe
// @description  BETA - not part of Walser Recon Tools. Fill RV parts from Tekion. Exact job/line name matches are sent automatically; everything else: hover a Tekion part line + Alt+C, hover an RV line + Alt+V.
// @match        https://app.tekioncloud.com/parts/*
// @match        https://app.reconvision.com/work_orders/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

// ---------------------------------------------------------------------------
// HOW IT TALKS: both tabs share Tampermonkey storage.
//   rvr_rv      RV -> Tekion: which RO is open in RV and its service lines
//   rvr_cmds    Tekion -> RV: parts to add (a list of commands)
//   rvr_results RV -> Tekion: what happened to each command
//   rvr_clip    the part copied with Alt+C
// ---------------------------------------------------------------------------
const LOG = '[RV Remote]';
const log = (...a) => console.log(LOG, ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const load = (k, d) => { try { const v = GM_getValue(k); return v === undefined ? d : JSON.parse(v); } catch (e) { return d; } };
const save = (k, v) => GM_setValue(k, JSON.stringify(v));
const clean = t => (t || '').replace(/\s+/g, ' ').trim();
const norm = t => clean(t).toLowerCase().replace(/^\*+/, '').replace(/[^a-z0-9]+/g, ' ').trim();   // for exact line matching
const money = t => { const m = clean(t).replace(/[$,]/g, '').match(/-?\d+(\.\d+)?/); return m ? m[0] : ''; };
const IS_TEKION = location.hostname.includes('tekion');

const VENDOR_MAP = {
  'F': 'FMP', 'A': 'AZ', 'O': 'OR', 'N': 'NAPA', 'B': 'SUBCHEV', 'H': 'HON',
  'D': 'DOB', 'I': 'INFINITI', 'T': 'TOY', 'LK': 'LKQ', 'AU': 'AUDI',
  'BM': 'BMW', 'MB': 'MERC', 'NI': 'NIS', 'S': 'SUB', 'P': 'PAMS',
  'AA': 'AAA', 'V': 'VW', 'VO': 'VOLVO', 'M': 'MAZ', 'L': 'LEXUS',
  'HY': 'HYU', 'E': 'EBAY', 'AC': 'ACURA', 'AV': 'FORD', 'ST': 'STOCK', 'U': 'USAF',
};
const vendorName = t => { const k = clean(t).toUpperCase(); return VENDOR_MAP[k] || clean(t); };

function el(tag, css, text) { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }
function setNative(field, value) {
  const proto = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : field.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}
let toastEl = null, toastT = 0;
function toast(msg, bad) {
  if (!toastEl) { toastEl = el('div', 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;color:#fff;font:600 13px Segoe UI,sans-serif;padding:8px 14px;border-radius:7px;box-shadow:0 3px 12px rgba(0,0,0,.5);pointer-events:none'); document.documentElement.appendChild(toastEl); }
  toastEl.style.background = bad ? '#b91c1c' : '#2563eb'; toastEl.textContent = msg; toastEl.style.display = 'block';
  clearTimeout(toastT); toastT = setTimeout(() => { toastEl.style.display = 'none'; }, 3500);
}
const HOVER_CSS = 'outline:2px dashed #22d3ee;outline-offset:2px';
let hovered = null;
function setHover(node) {
  if (hovered === node) return;
  if (hovered) hovered.style.outline = hovered.dataset.rvrOutline || '';
  hovered = node;
  if (node) { node.dataset.rvrOutline = node.style.outline || ''; node.style.cssText += ';' + HOVER_CSS; }
}

// =====================================================================
// TEKION SIDE (the remote)
// =====================================================================
function tekionRO() {
  for (const n of document.querySelectorAll('span,div,a,h1,h2,h3,p')) {
    if (n.childElementCount) continue;
    const m = clean(n.textContent).match(/^RO\s*#?\s*(7\d{6})$/i); if (m) return m[1];
  }
  const m = (document.body.textContent || '').match(/RO\s*#\s*(7\d{6})/i);
  return m ? m[1] : '';
}
function jobTitle(sec) {
  const lines = (sec.innerText || '').split('\n').map(clean).filter(Boolean);
  for (const l of lines) {
    const t = l.replace(/^job\s*\d+\s*-?\s*/i, '');
    if (/[a-z]{3}/i.test(t) && t.length < 90 && !/^(s\s*no|part|sale qty)/i.test(t)) return t;
  }
  return '';
}
// every part line on the Tekion RO, with the job it is on
function tekionLines() {
  const out = [];
  document.querySelectorAll('[data-id^="Job"]').forEach(sec => {
    const job = jobTitle(sec);
    sec.querySelectorAll('[data-test-id*="itemName-cell"]').forEach(cell => {
      const row = cell.parentElement; if (!row) return;
      const inp = cell.querySelector('input');
      const name = clean(inp && inp.value ? inp.value : cell.textContent);
      if (!name || /^select$/i.test(name)) return;
      const pc = row.querySelector('[data-test-id*="sellingPrice"]'), pi = pc && pc.querySelector('input');
      const qc = row.querySelector('[data-test-id*="requiredQuantity"]'), qi = qc && qc.querySelector('input');
      out.push({
        row, job,
        pn: clean(name.split(' - ')[0]), desc: clean(name.split(' - ').slice(1).join(' - ')),
        price: money(pi && pi.value ? pi.value : pc ? pc.textContent : ''),
        qty: money(qi && qi.value ? qi.value : qc ? qc.textContent : '') || '1',
      });
    });
  });
  return out;
}
function initTekion() {
  const opts = load('rvr_opts', { auto: true, vendor: '', status: '3' });
  const sent = load('rvr_sent', {});                 // "RO|job|pn" -> command id (never send twice)
  let lastLog = [];

  // ---- panel ----
  const box = el('div', 'position:fixed;right:14px;bottom:60px;z-index:2147483600;width:320px;background:#111827;color:#e5e7eb;border:1px solid #334155;border-radius:10px;padding:10px;font:12px Segoe UI,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.55)');
  box.id = 'rvr-panel';
  const head = el('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px');
  head.appendChild(el('b', 'font-size:13px', '🛰 RV Remote (BETA)'));
  const mini = el('button', 'background:#334155;color:#fff;border:0;border-radius:5px;cursor:pointer;padding:2px 7px', '▁');
  head.appendChild(mini); box.appendChild(head);
  const body = el('div'); box.appendChild(body);
  mini.onclick = () => { body.style.display = body.style.display === 'none' ? '' : 'none'; };
  const link = el('div', 'margin-bottom:6px'); body.appendChild(link);
  const row = (label, node) => { const r = el('div', 'display:flex;align-items:center;gap:6px;margin:4px 0'); r.appendChild(el('span', 'width:62px;opacity:.75', label)); r.appendChild(node); body.appendChild(r); return r; };
  const inCss = 'background:#0b1018;color:#e5e7eb;border:1px solid #334155;border-radius:4px;padding:3px';
  const autoChk = el('input'); autoChk.type = 'checkbox'; autoChk.checked = opts.auto;
  const autoLbl = el('label', 'display:flex;align-items:center;gap:4px'); autoLbl.appendChild(autoChk); autoLbl.appendChild(document.createTextNode('send exact line matches automatically'));
  row('Auto', autoLbl);
  const vend = el('input', inCss + ';width:70px'); vend.value = opts.vendor; vend.placeholder = 'B, F…';
  const vprev = el('span', 'color:#4ade80');
  const vwrap = el('span', 'display:flex;gap:6px;align-items:center'); vwrap.appendChild(vend); vwrap.appendChild(vprev);
  row('Vendor', vwrap);
  const st = el('select', inCss);
  [['', 'leave as is'], ['1', 'Action Req.'], ['3', 'Ordered'], ['5', 'Arrived'], ['6', 'In Stock']].forEach(([v, t]) => st.appendChild(new Option(t, v)));
  st.value = opts.status; row('Status', st);
  const saveOpts = () => { opts.auto = autoChk.checked; opts.vendor = vend.value; opts.status = st.value; save('rvr_opts', opts); vprev.textContent = vend.value ? '→ ' + vendorName(vend.value) : ''; };
  [autoChk, vend, st].forEach(x => x.addEventListener('input', saveOpts)); autoChk.addEventListener('change', saveOpts); saveOpts();
  body.appendChild(el('div', 'opacity:.6;margin:6px 0 4px', 'Manual: hover a part line + Alt+C, then hover the RV line + Alt+V.'));
  const logBox = el('div', 'max-height:110px;overflow:auto;background:#0b1018;border-radius:5px;padding:4px 6px;font:11px Consolas,monospace');
  body.appendChild(logBox);
  const note = t => { lastLog.unshift(new Date().toTimeString().slice(0, 8) + '  ' + t); lastLog = lastLog.slice(0, 30); logBox.textContent = ''; lastLog.forEach(l => logBox.appendChild(el('div', '', l))); };
  document.documentElement.appendChild(box);

  // ---- send a part to RV ----
  function send(line, svc, how) {
    const ro = tekionRO(), rv = load('rvr_rv', null);
    const key = ro + '|' + norm(line.job) + '|' + line.pn;
    const cmd = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), ro, svcId: svc.id, svcName: svc.name, how,
      part: { pn: line.pn, desc: vendorName(opts.vendor), qty: line.qty, price: line.price }, status: opts.status, ts: Date.now() };
    const cmds = load('rvr_cmds', []).filter(c => Date.now() - c.ts < 10 * 60 * 1000);   // drop anything older than 10 min
    cmds.push(cmd); save('rvr_cmds', cmds);
    sent[key] = cmd.id; save('rvr_sent', sent);
    note(`→ RV  ${line.pn}  to "${svc.name}"${how === 'auto' ? ' (auto)' : ''}`);
    if (!rv || Date.now() - rv.ts > 15000) note('   ⚠ RV tab not seen in the last 15 s. It will run when RV is open.');
    return cmd.id;
  }

  // ---- results from RV ----
  GM_addValueChangeListener('rvr_results', (k, o, n) => {
    let res = {}; try { res = JSON.parse(n || '{}'); } catch (e) {}
    const old = (() => { try { return JSON.parse(o || '{}'); } catch (e) { return {}; } })();
    const cmds = load('rvr_cmds', []);
    Object.keys(res).forEach(id => {
      if (old[id] === res[id]) return;
      const c = cmds.find(x => x.id === id), pn = c ? c.part.pn : '';
      note(res[id] === 'ok' ? `✓ ${pn} added in RV` : (res[id].startsWith('skip') ? '• ' : '✗ ') + res[id]);
    });
  });

  // ---- buttons + badges on each Tekion line; auto send ----
  function tick() {
    const ro = tekionRO(), rv = load('rvr_rv', null);
    const fresh = rv && Date.now() - rv.ts < 15000;
    const roOk = fresh && ro && rv.ro === ro;
    link.textContent = !fresh ? '🔴 RV not linked: open the RV work order Parts page (or edit page) in the other screen'
      : !ro ? '🟡 Open an RO here' : roOk ? `🟢 Linked: RO ${ro} · ${rv.services.length} RV lines` : `🟡 RV has RO ${rv.ro || '?'} open, Tekion has ${ro}. Auto paused.`;
    link.style.color = roOk ? '#4ade80' : fresh ? '#fbbf24' : '#f87171';
    const byName = {}; if (roOk) rv.services.forEach(s => { byName[norm(s.name)] = s; });
    tekionLines().forEach(line => {
      let tag = line.row.querySelector('.rvr-tag');
      if (!tag) {
        tag = el('button', 'margin-left:6px;border:0;border-radius:4px;padding:1px 6px;font:600 11px Segoe UI,sans-serif;cursor:pointer;color:#fff;background:#475569');
        tag.className = 'rvr-tag'; tag.title = 'Send this part to RV (choose the line)';
        tag.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); manualChoose(tag._line); });
        const cell = line.row.querySelector('[data-test-id*="itemName-cell"]'); (cell || line.row).appendChild(tag);
      }
      tag._line = line;
      const key = ro + '|' + norm(line.job) + '|' + line.pn, match = byName[norm(line.job)];
      if (sent[key]) { tag.textContent = '✓ RV'; tag.style.background = '#16a34a'; return; }
      if (match && !/recon\s*fees/i.test(line.job)) { tag.textContent = '⇢ RV'; tag.style.background = '#2563eb'; tag.title = 'Exact match: RV line "' + match.name + '"'; }
      else { tag.textContent = '? RV'; tag.style.background = '#b45309'; tag.title = 'No exact RV line match - hover + Alt+C, then Alt+V on the RV line'; }
      if (opts.auto && roOk && match && !/recon\s*fees/i.test(line.job) && line.pn && Number(line.price) > 0) send(line, match, 'auto');
    });
  }
  setInterval(() => { if (!document.hidden) tick(); }, 1500);

  // ---- manual: choose a line from a short list (button) ----
  function manualChoose(line) {
    const rv = load('rvr_rv', null);
    if (!rv || !rv.services.length) { toast('RV is not linked yet - open the RV work order Parts page', true); return; }
    const names = rv.services.map((s, i) => (i + 1) + '. ' + s.name).join('\n');
    const pick = prompt(`Send ${line.pn} ($${line.price || '?'} x${line.qty}) to which RV line?\n\n${names}\n\nType the number:`);
    const svc = rv.services[(parseInt(pick, 10) || 0) - 1];
    if (svc) { send(line, svc, 'button'); toast(`Sent ${line.pn} to "${svc.name}"`); }
  }

  // ---- manual: hover a line + Alt+C copies it ----
  document.addEventListener('mouseover', e => {
    const r = e.target.closest && e.target.closest('[role="row"]');
    setHover(r && r.querySelector('[data-test-id*="itemName-cell"]') ? r : null);
  }, true);
  document.addEventListener('keydown', e => {
    if (!e.altKey || (e.key || '').toLowerCase() !== 'c' || !hovered) return;
    const line = tekionLines().find(l => l.row === hovered || hovered.contains(l.row) || l.row.contains(hovered));
    if (!line) { toast('Hover a part line first', true); return; }
    e.preventDefault();
    save('rvr_clip', { ro: tekionRO(), part: { pn: line.pn, desc: vendorName(opts.vendor), qty: line.qty, price: line.price }, status: opts.status, ts: Date.now() });
    toast(`Copied ${line.pn} ($${line.price || '?'} x${line.qty}) - hover the RV line and press Alt+V`);
    note(`copied ${line.pn} for Alt+V`);
  }, true);
  log('Tekion remote ready');
}

// =====================================================================
// RV SIDE (the screen)
// =====================================================================
const woId = () => (location.pathname.match(/work_orders\/(\d+)/) || [])[1] || '';
function rvRO() {
  const m = (document.body.textContent || '').match(/RO#\s*(7\d{6})/);
  if (m) { const all = load('rvr_wo_ro', {}); if (all[woId()] !== m[1]) { all[woId()] = m[1]; save('rvr_wo_ro', all); } return m[1]; }
  return load('rvr_wo_ro', {})[woId()] || '';
}
function rvEditServices() {                        // the work order (edit) page
  const out = [], seen = new Set();
  document.querySelectorAll('[data-service-id]').forEach(r => {
    const id = r.getAttribute('data-service-id'); if (!id || seen.has(id)) return;
    const inp = r.querySelector('input[name*="line_items_attributes"][name$="[name]"]');
    const name = clean(inp ? inp.value : ''); if (!name) return;
    seen.add(id); out.push({ id, name });
  });
  return out;
}
function rvServices() {
  const out = [];
  document.querySelectorAll('.section-header[data-service-id]').forEach(h => {
    const id = h.getAttribute('data-service-id');
    const name = clean((h.textContent || '').replace(/^\W*Service:\s*/i, '').replace(/\d+\s*Parts?\s*Add Part to Service[\s\S]*$/i, ''));
    const btn = h.querySelector('.add-part-to-service-btn') || [...h.querySelectorAll('button,a')].find(x => /add part to service/i.test(x.textContent));
    if (btn) out.push({ id, name, btn, header: h });
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
async function addPart(svc, part, status) {
  const section = document.getElementById('parts-section-' + svc.id);
  if (!section) return 'error: RV line section not found';
  const have = [...section.querySelectorAll('textarea[id*="part_number"], input[id*="part_number"]')].some(f => clean(f.value).toUpperCase() === part.pn.toUpperCase());
  if (have) return 'skip: ' + part.pn + ' already on "' + svc.name + '"';
  const before = new Set(section.querySelectorAll('tr'));
  svc.btn.click();
  const row = await waitEmptyRow(section, before, 4000);
  if (!row) return 'error: new row did not appear on "' + svc.name + '"';
  const q = s => row.querySelector(s);
  setNative(q('textarea[id*="part_number"], input[id*="part_number"]'), part.pn);
  const desc = q('td.save_value.description textarea, textarea[data-field-name="description"]'); if (desc && part.desc) setNative(desc, part.desc);
  const qty = q('input[data-field-name="quantity"]'); if (qty) setNative(qty, part.qty || '1');
  const price = q('input[id*="part_price"], input[data-field-name="partPrice"]'); if (price && part.price) setNative(price, part.price);
  const stt = q('td.save_value.status select, select[data-field-name="status"]'); if (stt && status) setNative(stt, status);
  row.style.transition = 'background .6s'; row.style.background = 'rgba(37,99,235,.35)'; setTimeout(() => { row.style.background = ''; }, 1500);
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return 'ok';
}
function initRv() {
  const onParts = /\/parts_overview/.test(location.pathname);
  const publish = () => {
    if (document.hidden && !onParts) return;
    const ro = rvRO();
    const services = onParts ? rvServices().map(s => ({ id: s.id, name: s.name })) : rvEditServices();
    save('rvr_rv', { ro, woId: woId(), onParts, services, ts: Date.now() });
  };
  publish(); setInterval(publish, 3000);
  // small badge so you can see the beta is running on RV
  const badge = el('div', 'position:fixed;left:12px;bottom:12px;z-index:2147483600;background:#111827;color:#e5e7eb;border:1px solid #334155;border-radius:8px;padding:5px 9px;font:600 12px Segoe UI,sans-serif;box-shadow:0 3px 10px rgba(0,0,0,.5);pointer-events:none');
  badge.id = 'rvr-rv-badge'; document.documentElement.appendChild(badge);
  const showBadge = () => {
    const ro = rvRO(), n = (onParts ? rvServices() : rvEditServices()).length;
    badge.textContent = '🛰 RV Remote (BETA) · RO ' + (ro || '?') + ' · ' + n + ' lines · ' + (onParts ? 'Parts page: Alt+V to paste' : 'waiting for Tekion');
  };
  showBadge(); setInterval(showBadge, 3000);

  // run commands from Tekion, one at a time
  let busy = false;
  async function runCmds() {
    if (busy) return; busy = true;
    try {
      const results = load('rvr_results', {});
      const todo = load('rvr_cmds', []).filter(c => !results[c.id]);
      if (todo.length && !onParts) {                              // go to the Parts page; commands wait in storage
        toast('Tekion sent parts - opening this work order\'s Parts page…');
        await sleep(800);
        location.href = '/work_orders/' + woId() + '/parts_overview?limited_access=false';
        return;
      }
      const ro = rvRO();
      for (const c of todo) {
        let res;
        if (c.how === 'auto' && ro && c.ro && c.ro !== ro) res = 'skip: RO ' + c.ro + ' is not the RO open in RV (' + ro + ')';
        else {
          const svc = rvServices().find(s => s.id === c.svcId) || rvServices().find(s => norm(s.name) === norm(c.svcName));
          res = svc ? await addPart(svc, c.part, c.status) : 'error: RV line "' + c.svcName + '" not on this page';
        }
        results[c.id] = res; save('rvr_results', results);
        if (res !== 'ok') toast(res, !res.startsWith('skip'));
        else toast('Added ' + c.part.pn + ' to "' + c.svcName + '" - review, then Save');
        await sleep(300);
      }
      const ids = Object.keys(results); if (ids.length > 200) { ids.slice(0, ids.length - 200).forEach(i => delete results[i]); save('rvr_results', results); }
    } finally { busy = false; }
  }
  GM_addValueChangeListener('rvr_cmds', () => runCmds());
  setTimeout(runCmds, 1200);

  // manual paste: hover an RV line + Alt+V
  if (onParts) {
    const findSvc = node => {
      const h = node.closest && node.closest('.section-header[data-service-id]');
      if (h) return h;
      const t = node.closest && node.closest('[id^="parts-section-"]');
      return t ? document.querySelector('.section-header[data-service-id="' + t.id.replace('parts-section-', '') + '"]') : null;
    };
    document.addEventListener('mouseover', e => setHover(findSvc(e.target)), true);
    document.addEventListener('keydown', async e => {
      if (!e.altKey || (e.key || '').toLowerCase() !== 'v' || !hovered) return;
      e.preventDefault();
      const clip = load('rvr_clip', null);
      if (!clip) { toast('Nothing copied - hover a Tekion part line and press Alt+C first', true); return; }
      const svc = rvServices().find(s => s.header === hovered);
      if (!svc) return;
      const res = await addPart(svc, clip.part, clip.status);
      toast(res === 'ok' ? 'Pasted ' + clip.part.pn + ' to "' + svc.name + '" - review, then Save' : res, res !== 'ok' && !res.startsWith('skip'));
    }, true);
  }
  log('RV screen ready', onParts ? '(Parts page)' : '(work order page)');
}

if (IS_TEKION) setTimeout(initTekion, 1200);
else if (/\/work_orders\/\d+/.test(location.pathname)) setTimeout(initRv, 800);
})();
