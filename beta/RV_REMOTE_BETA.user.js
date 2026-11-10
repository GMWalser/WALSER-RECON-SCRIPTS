// ==UserScript==
// @name         RV Remote (BETA)
// @namespace    walser-rv-remote-beta
// @version      1.1
// @author       Gabe
// @description  BETA - not part of Walser Recon Tools. Fill RV parts from Tekion. Exact job/line name matches are sent automatically; everything else: hover a Tekion part line + Alt+C, hover an RV line + Alt+V.
// @match        https://app.tekioncloud.com/parts/*
// @match        https://app.reconvision.com/*
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

// Status letters -> pick the RV dropdown option by its name (the numbers differ between RV pages)
const STATUS_NAMES = { A: /action/i, O: /order/i, R: /arriv/i, S: /stock/i };
const OLD_NUM = { '1': 'A', '3': 'O', '5': 'R', '6': 'S' };
const statusLetter = st => { const t = String(st || '').toUpperCase(); return STATUS_NAMES[t] ? t : OLD_NUM[t] || ''; };
function setStatus(sel, st) {
  const L = statusLetter(st); if (!sel || !L) return;
  const opt = [...sel.options].find(o => STATUS_NAMES[L].test(o.textContent));
  if (opt) setNative(sel, opt.value);
}
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
const HOVER_CSS = 'outline:2px solid #22d3ee;outline-offset:-1px;box-shadow:inset 0 0 0 9999px rgba(34,211,238,.10)';
let hovered = null;
function setHover(node) {
  if (hovered === node) return;
  if (hovered) { hovered.style.outline = hovered.dataset.rvrOutline || ''; hovered.style.boxShadow = hovered.dataset.rvrShadow || ''; }
  hovered = node;
  if (node) { node.dataset.rvrOutline = node.style.outline || ''; node.dataset.rvrShadow = node.style.boxShadow || ''; node.style.cssText += ';' + HOVER_CSS; }
}

// ---- right-click copy/paste: on by default, Alt+R turns it on/off (shared by both sites) ----
const rcOn = () => load('rvr_rc', true);
document.addEventListener('keydown', e => {
  if (!e.altKey || (e.key || '').toLowerCase() !== 'r') return;
  e.preventDefault(); save('rvr_rc', !rcOn());
  toast('Right-click copy/paste ' + (rcOn() ? 'ON (right-click = copy in Tekion, paste in RV)' : 'OFF (normal right-click menu)'));
}, true);
// spots Recon Clipboard already uses for right-click: never take those
const RC_RESERVED = '[data-test-id*="sellingPrice-cell"], .block.parts_icon, .add-part-to-service-btn';
const onHighlighted = t => !!(hovered && t && hovered.contains(t)) && !(t.closest && t.closest(RC_RESERVED));
const basket = () => { const c = load('rvr_clip', null); return c && c.parts && c.parts.length && Date.now() - c.ts < 15 * 60 * 1000 ? c : null; };
const freshClip = basket;
let pasting = false, pasteEnd = 0;                   // while a paste runs (and 1.5 s after) extra right-clicks are swallowed
const pasteBusy = () => pasting || Date.now() - pasteEnd < 1500;
const onHighlightedRV = t => !!(hovered && t && hovered.contains(t));   // RV: whole line, parts icon included

// ---- SMART: which RV line a part belongs on. Only SUGGESTS - you always confirm. ----
// RV lines that never take parts (hidden from the RV button list; "0" shows all)
const NO_PARTS = /ready for pick ?up|measure all|^at recon|body shop review|pre-?order parts|inspection form/i;
const partsLines = list => list.filter(s => !NO_PARTS.test(s.name.replace(/^\*+\s*/, '')));
const DRAIN_GASKETS = ['803916010', '11126AA000', '90430-12031', '11026-01M02', '94109-14000'].map(x => x.replace(/[^A-Z0-9]/gi, ''));
const pnKey = pn => String(pn || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const RULES = [                                     // first match wins; part text -> RV line name
  { part: /cabin/i, line: /cabin/i },
  { part: /oil filter|drain ?plug|plug gasket|drain gasket/i, line: /\blof\b|oil change/i, gasket: true },
  { part: /air filter|air cleaner|air element/i, line: /air filter/i, not: /cabin/i },
  { part: /wiper|blade/i, line: /wiper/i },
  { part: /batt/i, line: /batt/i },
  { part: /spark ?plug/i, line: /spark/i },
  { part: /\btires?\b|\d{3}\/\d{2}r\d{2}/i, line: /\btires?\b/i, not: /measure/i },
  { part: /brake|\bpads?\b|rotor|caliper|\bshoes?\b|\bdrums?\b/i, line: /brake/i, brake: true },
];
const FRONT = /\b(front|frt|fr|fnt)\b/i, REAR = /\b(rear|rr|rer)\b/i;
// -> { pick: the suggested line or null, why: text, list: lines ordered best first }
function suggestLine(part, job, services) {
  const lines = partsLines(services), text = part.pn + ' ' + (part.desc || '');
  const learned = load('rvr_learn', {})[pnKey(part.pn)];
  const ordered = first => first.concat(lines.filter(s => !first.includes(s)));
  if (learned) { const s = lines.find(x => norm(x.name) === learned); if (s) return { pick: s, why: 'last time ' + part.pn + ' went here', list: ordered([s]) }; }
  const rule = RULES.find(r => r.part.test(text) || (r.gasket && DRAIN_GASKETS.includes(pnKey(part.pn))));
  if (!rule) return { pick: null, why: '', list: lines };
  let hits = lines.filter(s => rule.line.test(s.name) && !(rule.not && rule.not.test(s.name)));
  if (rule.brake) {
    const where = (FRONT.test(text) || FRONT.test(job)) ? FRONT : (REAR.test(text) || REAR.test(job)) ? REAR : null;
    if (where) { const h = hits.filter(s => where.test(s.name)); if (h.length) hits = h; }
    else if (hits.length > 1) return { pick: null, why: 'brakes: front or rear? (pick once, it remembers this part #)', list: ordered(hits) };
  }
  return hits.length === 1 ? { pick: hits[0], why: (text.match(rule.part) ? 'part says ' + text.match(rule.part)[0].toLowerCase() : 'drain plug gasket'), list: ordered(hits) }
    : { pick: null, why: hits.length ? 'pick one' : '', list: ordered(hits) };
}
function learnLine(pn, lineName) {
  if (!pn || !lineName) return;
  const m = load('rvr_learn', {}); m[pnKey(pn)] = norm(lineName);
  const k = Object.keys(m); if (k.length > 800) k.slice(0, k.length - 800).forEach(x => delete m[x]);
  save('rvr_learn', m);
}
// small menu next to the mouse: Enter = suggested line, a number key = that line, 0 = show all lines, Esc = cancel
function pickLine(title, sug, allServices) {
  return new Promise(resolve => {
    document.querySelectorAll('#rvr-ask').forEach(x => x.remove());
    let list = sug.list, all = false, typed = '';
    const box = el('div', 'position:fixed;z-index:2147483647;background:#0d0d0d;border:2px solid #2563eb;border-radius:10px;padding:9px 12px;font:13px Segoe UI,sans-serif;color:#e5e7eb;box-shadow:0 4px 20px rgba(0,0,0,.7);width:330px;max-height:70vh;overflow:auto');
    box.id = 'rvr-ask';
    box.style.left = Math.max(8, Math.min(innerWidth - 350, lastMouse.x + 12)) + 'px'; box.style.top = Math.max(8, Math.min(innerHeight - 380, lastMouse.y + 12)) + 'px';
    const finish = v => { box.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
    const draw = () => {
      box.textContent = '';
      box.appendChild(el('div', 'font-size:11px;font-weight:700;color:#60a5fa;text-transform:uppercase;margin-bottom:5px', title));
      if (sug.pick) box.appendChild(el('div', 'color:#4ade80;margin-bottom:6px', '💡 Enter = ' + sug.pick.name + (sug.why ? '  (' + sug.why + ')' : '')));
      else if (sug.why) box.appendChild(el('div', 'color:#fbbf24;margin-bottom:6px', '💡 ' + sug.why));
      list.forEach((s, i) => {
        const r = el('div', 'padding:3px 6px;border-radius:5px;cursor:pointer;' + (s === sug.pick ? 'background:#14532d;' : ''), (i + 1) + '. ' + s.name);
        r.addEventListener('mouseenter', () => { r.style.background = '#1e3a8a'; });
        r.addEventListener('mouseleave', () => { r.style.background = s === sug.pick ? '#14532d' : ''; });
        r.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); finish(s); });
        box.appendChild(r);
      });
      box.appendChild(el('div', 'opacity:.55;font-size:11px;margin-top:6px', (typed ? 'typed: ' + typed + ' (Enter) · ' : '') + (all ? '' : '0 = show all lines · ') + 'Esc = cancel'));
    };
    const key = e => {
      if (e.ctrlKey || e.altKey) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') return finish(null);
      if (e.key === 'Enter') { const n = parseInt(typed, 10); return finish(n ? list[n - 1] || null : sug.pick); }
      if (e.key === 'Backspace') { typed = typed.slice(0, -1); draw(); return; }
      if (!/^\d$/.test(e.key)) return;
      if (e.key === '0' && !typed && !all) { all = true; list = sug.list.concat(allServices.filter(x => !sug.list.includes(x))); draw(); return; }
      typed += e.key;
      const n = parseInt(typed, 10);
      if (list.length < 10 || n * 10 > list.length) return finish(list[n - 1] || null);   // no 2-digit number possible: pick now
      draw();
    };
    document.documentElement.appendChild(box); draw();
    document.addEventListener('keydown', key, true);
  });
}
// on-hand qty in a Tekion row ("OH Qty" column)
function ohQty(row, sec) {
  const c = row.querySelector('[data-test-id*="onHand"]');
  if (c) { const i = c.querySelector('input'); return money(i && i.value ? i.value : c.textContent); }
  const h = sec && [...sec.querySelectorAll('div,span,th')].find(n => !n.childElementCount && /^oh\s*qty$/i.test(clean(n.textContent)));
  if (!h) return '';
  let cell = h; while (cell.parentElement && cell.parentElement.children.length < 4) cell = cell.parentElement;
  const idx = [...cell.parentElement.children].indexOf(cell), rc = row.children[idx];
  return rc ? money(rc.textContent) : '';
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
        oh: ohQty(row, sec),
      });
    });
  });
  return out;
}
function initTekion() {
  const opts = load('rvr_opts', { auto: true, vendor: '', status: 'O' });
  opts.status = statusLetter(opts.status) || '';
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
  row('Auto vendor', vwrap);
  const st = el('select', inCss);
  [['', 'leave as is'], ['A', 'A - Action Req.'], ['O', 'O - Ordered'], ['R', 'R - Arrived'], ['S', 'S - In Stock']].forEach(([v, t]) => st.appendChild(new Option(t, v)));
  st.value = opts.status; row('Auto status', st);
  const saveOpts = () => { opts.auto = autoChk.checked; opts.vendor = vend.value; opts.status = st.value; save('rvr_opts', opts); vprev.textContent = vend.value ? '→ ' + vendorName(vend.value) : ''; };
  [autoChk, vend, st].forEach(x => x.addEventListener('input', saveOpts)); autoChk.addEventListener('change', saveOpts); saveOpts();
  const bRow = el('div', 'display:flex;align-items:center;gap:6px;margin:6px 0'); body.appendChild(bRow);
  const bTxt = el('span', 'flex:1;color:#fbbf24;font-weight:600'); bRow.appendChild(bTxt);
  const bClr = el('button', 'background:#7f1d1d;color:#fff;border:0;border-radius:5px;padding:2px 8px;cursor:pointer;font:600 11px Segoe UI,sans-serif', 'Clear basket'); bRow.appendChild(bClr);
  const showBasket = () => { const b = basket(); bTxt.textContent = b ? '🧺 ' + b.parts.length + ': ' + b.parts.map(x => x.pn).join(', ') : '🧺 basket empty'; };
  bClr.addEventListener('click', () => { save('rvr_clip', null); showBasket(); });
  showBasket(); GM_addValueChangeListener('rvr_clip', showBasket); setInterval(showBasket, 10000);
  const tip = el('div', 'opacity:.6;margin:6px 0 4px'); body.appendChild(tip);
  const showTip = () => { tip.textContent = rcOn() ? 'Manual: right-click each part (adds to basket), then ONE right-click on the RV line pastes them all. Alt+R = right-click off.'
    : 'Manual: hover + Alt+C, then hover the RV line + Alt+V. Right-click copy is OFF (Alt+R to turn on).'; };
  showTip(); GM_addValueChangeListener('rvr_rc', showTip);
  const logBox = el('div', 'max-height:110px;overflow:auto;background:#0b1018;border-radius:5px;padding:4px 6px;font:11px Consolas,monospace');
  body.appendChild(logBox);
  const note = t => { lastLog.unshift(new Date().toTimeString().slice(0, 8) + '  ' + t); lastLog = lastLog.slice(0, 30); logBox.textContent = ''; lastLog.forEach(l => logBox.appendChild(el('div', '', l))); };
  document.documentElement.appendChild(box);

  // ---- send a part to RV ----
  function send(line, svc, how, ans) {
    const ro = tekionRO(), rv = load('rvr_rv', null);
    const key = ro + '|' + norm(line.job) + '|' + line.pn;
    const cmd = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), ro, svcId: svc.id, svcName: svc.name, how,
      part: ans ? ans.part : { pn: line.pn, desc: vendorName(opts.vendor), qty: line.qty, price: line.price }, status: ans ? ans.status : opts.status, ts: Date.now() };
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
      else {
        const sg = fresh ? suggestLine(line, line.job, rv.services) : { pick: null };
        if (sg.pick) { tag.textContent = '💡 RV'; tag.style.background = '#7c3aed'; tag.title = 'Click: suggested "' + sg.pick.name + '" (you confirm)'; }
        else { tag.textContent = '? RV'; tag.style.background = '#b45309'; tag.title = 'Click to choose the RV line'; }
      }
      if (opts.auto && roOk && match && !/recon\s*fees/i.test(line.job) && line.pn && Number(line.price) > 0) send(line, match, 'auto');
    });
  }
  setInterval(() => { if (!document.hidden) tick(); }, 1500);

  // ---- manual: choose a line from a short list (button) ----
  async function manualChoose(line) {
    const rv = load('rvr_rv', null);
    if (!rv || !rv.services.length) { toast('RV is not linked yet - open the RV work order Parts page', true); return; }
    const part = { pn: line.pn, desc: line.desc, qty: line.qty, price: line.price, oh: line.oh };
    const svc = await pickLine('Send ' + line.pn + (line.desc ? ' - ' + line.desc : '') + ' to which RV line?', suggestLine(part, line.job, rv.services), rv.services);
    if (!svc) return;
    const a = await askPaste(part); if (!a) return;
    learnLine(line.pn, svc.name);
    send(line, svc, 'button', withAnswers(part, a)); toast(`Sent ${line.pn} to "${svc.name}"`);
  }

  // ---- manual: hover a line + Alt+C copies it ----
  document.addEventListener('mouseover', e => {
    const r = e.target.closest && e.target.closest('[role="row"]');
    setHover(r && r.querySelector('[data-test-id*="itemName-cell"]') ? r : null);
  }, true);
  function copyLine(rowEl) {
    const line = tekionLines().find(l => l.row === rowEl || rowEl.contains(l.row) || l.row.contains(rowEl));
    if (!line) { toast('Hover a part line first', true); return false; }
    const b = basket() || { ro: tekionRO(), parts: [] };
    if (b.parts.some(x => x.pn === line.pn)) { toast(`${line.pn} is already in the basket (${b.parts.length} part${b.parts.length > 1 ? 's' : ''})`); return true; }
    b.parts.push({ pn: line.pn, desc: line.desc, qty: line.qty, price: line.price, oh: line.oh }); b.ts = Date.now();
    save('rvr_clip', b);
    toast(`Basket: ${b.parts.length} part${b.parts.length > 1 ? 's' : ''} (${b.parts.map(x => x.pn).join(', ')}) - right-click the RV line to paste all`);
    note(`basket + ${line.pn} (${b.parts.length})`);
    return true;
  }
  document.addEventListener('keydown', e => {
    if (!e.altKey || (e.key || '').toLowerCase() !== 'c' || !hovered) return;
    e.preventDefault(); copyLine(hovered);
  }, true);
  document.addEventListener('contextmenu', e => {          // right-click on the highlighted line copies it
    if (!rcOn() || !onHighlighted(e.target)) return;
    if (copyLine(hovered)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  log('Tekion remote ready');
}

// =====================================================================
// RV SIDE (the screen)
// =====================================================================
// Quick prompts, one at a time, next to the mouse (like Recon Clipboard's quick part add):
//   Qty (Enter keeps it) -> Vendor shortcut (Enter) -> Status: one key A / O / R / S.
let lastMouse = { x: innerWidth / 2, y: innerHeight / 3 };
document.addEventListener('mousemove', e => { lastMouse = { x: e.clientX, y: e.clientY }; }, true);
function askStep(title, value, hint, singleKey) {
  return new Promise(resolve => {
    document.querySelectorAll('#rvr-ask').forEach(x => x.remove());
    const box = el('div', 'position:fixed;z-index:2147483647;background:#0d0d0d;border:2px solid #2563eb;border-radius:10px;padding:9px 12px;font:13px Segoe UI,sans-serif;color:#e5e7eb;box-shadow:0 4px 20px rgba(0,0,0,.7);min-width:230px');
    box.id = 'rvr-ask';
    box.style.left = Math.min(innerWidth - 260, lastMouse.x + 12) + 'px'; box.style.top = Math.min(innerHeight - 140, lastMouse.y + 12) + 'px';
    box.appendChild(el('div', 'font-size:11px;font-weight:700;color:#60a5fa;text-transform:uppercase;margin-bottom:5px', title));
    const inp = el('input', 'width:100%;box-sizing:border-box;background:#1a1a1a;color:#fff;border:1px solid #333;border-radius:6px;padding:5px 8px;font:13px Consolas,monospace');
    inp.value = value || ''; box.appendChild(inp);
    const h = el('div', 'margin-top:5px;font-size:12px;color:#4ade80;min-height:15px'); box.appendChild(h);
    const showH = () => { h.textContent = hint(inp.value); }; showH(); inp.addEventListener('input', showH);
    document.documentElement.appendChild(box); inp.focus(); inp.select();
    const finish = v => { box.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); return; }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(inp.value.trim()); return; }
      if (singleKey && /^[aorsAORS]$/.test(e.key) && !e.ctrlKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); finish(e.key.toUpperCase()); }
    };
    document.addEventListener('keydown', key, true);
  });
}
async function askPaste(part, n, m) {
  const last = load('rvr_lastpaste', { vendor: '', status: 'O' });
  const tag = m > 1 ? ' · part ' + n + ' of ' + m : '';
  const onHand = Number(part.oh) > 0;
  const defV = onHand ? 'ST' : last.vendor, defS = onHand ? 'S' : last.status;
  const qty = await askStep('Qty · ' + part.pn + ' ($' + (part.price || '?') + ')' + tag, part.qty || '1', () => 'Enter = keep · Esc = cancel');
  if (qty === null) return null;
  const vendor = await askStep('Vendor' + (onHand ? ' · 💡 OH qty ' + part.oh + ' - stock? (type F for FMP)' : ''), defV, x => (x ? '→ ' + vendorName(x) : '(none)') + '   · B=SUBCHEV F=FMP N=NAPA O=OR A=AZ ST=STOCK');
  if (vendor === null) return null;
  const NAMES = { A: 'Action Req.', O: 'Ordered', R: 'Arrived', S: 'In Stock' };
  const sDef = vendorName(vendor) === 'STOCK' ? 'S' : vendorName(vendor) === vendorName(defV) ? defS : last.status;
  const status = await askStep('Status · press A / O / R / S', '', () => 'Enter = ' + (NAMES[sDef] || 'leave as is'), true);
  if (status === null) return null;
  const res = { qty: qty || '1', vendor, status: statusLetter(status) || sDef };
  if (vendorName(vendor) !== 'STOCK') save('rvr_lastpaste', { vendor: res.vendor, status: res.status });   // stock never becomes the default
  return res;
}
const withAnswers = (part, a) => ({ part: { pn: part.pn, desc: vendorName(a.vendor), qty: a.qty, price: part.price }, status: a.status });
// ask Qty / Vendor / Status for every part in the basket; Esc cancels the whole paste
async function askAll(b) {
  const out = [];
  for (let i = 0; i < b.parts.length; i++) {
    const a = await askPaste(b.parts[i], i + 1, b.parts.length); if (!a) return null;
    out.push(withAnswers(b.parts[i], a));
  }
  return out;
}
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
  const stt = q('td.save_value.status select, select[data-field-name="status"]'); setStatus(stt, status);
  row.style.transition = 'background .6s'; row.style.background = 'rgba(37,99,235,.35)'; setTimeout(() => { row.style.background = ''; }, 1500);
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return 'ok';
}
// ---- main work order page: add through the line's parts icon (#parts_modal) ----
let openSvc = '';                                     // which line's parts window is open
document.addEventListener('click', e => {
  const t = e.target.closest && e.target.closest('[data-target="#parts_modal"]');
  const r = t && t.closest('[data-service-id]'); if (r) openSvc = r.getAttribute('data-service-id');
}, true);
const modalOpen = () => { const m = document.getElementById('parts_modal'); return !!(m && (m.style.display === 'block' || m.classList.contains('in') || m.classList.contains('show'))); };
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(150); } return null; }
async function addPartViaModal(svcId, svcName, part, status, saveAfter) {
  const line = document.querySelector('[data-service-id="' + svcId + '"]');
  const trigger = line && line.querySelector('.inner[data-target="#parts_modal"], [data-target="#parts_modal"]');
  if (!trigger) return 'error: parts icon not found on "' + svcName + '"';
  if (modalOpen() && openSvc && openSvc !== String(svcId)) {      // window open on another line: save + close it first
    const sb = document.querySelector('[id^="desktop-save-button-"]'); if (sb) { sb.click(); await waitFor(() => !modalOpen(), 6000); await sleep(600); }
  }
  if (!modalOpen()) { trigger.click(); openSvc = String(svcId); if (!(await waitFor(modalOpen, 5000))) return 'error: parts window did not open for "' + svcName + '"'; await sleep(500); }
  const modal = document.getElementById('parts_modal');
  const have = [...modal.querySelectorAll('textarea[id*="part_number"], input[id*="part_number"]')].some(f => clean(f.value).toUpperCase() === part.pn.toUpperCase());
  if (have) return 'skip: ' + part.pn + ' already on "' + svcName + '"';
  const add = modal.querySelector('.button-outline[data-action*="addNewPart"], [data-action*="parts-modal-controller#addNewPart"]') || document.querySelector('.button-outline[data-action*="parts-modal-controller#addNewPart"]');
  if (!add) return 'error: "+ Add Part" not found in the parts window';
  const before = new Set(modal.querySelectorAll('tr'));
  add.click();
  const row = await waitEmptyRow(modal, before, 4000);
  if (!row) return 'error: new part row did not appear';
  const q = sel => row.querySelector(sel);
  setNative(q('textarea[id*="part_number"], input[id*="part_number"]'), part.pn);
  const desc = q('td.save_value.description textarea, textarea[data-field-name="description"]'); if (desc && part.desc) setNative(desc, part.desc);
  const qty = q('input[data-field-name="quantity"]'); if (qty) setNative(qty, part.qty || '1');
  const price = q('input[id*="part_price"], input[data-field-name="partPrice"]'); if (price && part.price) setNative(price, part.price);
  const stt = q('td.save_value.status select, select[data-field-name="status"]'); setStatus(stt, status);
  if (!saveAfter) return 'ok';
  await sleep(400);
  const saveBtn = document.querySelector('[id^="desktop-save-button-"]');
  if (!saveBtn) return 'ok (filled, but Save button not found - please save)';
  saveBtn.click();
  await waitFor(() => !modalOpen(), 6000);
  await sleep(800);
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
    const b = basket();
    badge.textContent = '🛰 RV Remote (BETA) · RO ' + (ro || '?') + ' · ' + n + ' lines · ' + (b ? '🧺 ' + b.parts.map(x => x.pn).join(' + ') + ' · ' : '🧺 empty · ') + (rcOn() ? 'right-click a line to paste (Alt+R off)' : 'Alt+V to paste (right-click OFF)');
  };
  showBadge(); setInterval(showBadge, 3000); GM_addValueChangeListener('rvr_clip', showBadge);

  // run commands from Tekion, one at a time
  let busy = false;
  async function runCmds() {
    if (busy) return; busy = true;
    try {
      const results = load('rvr_results', {});
      const todo = load('rvr_cmds', []).filter(c => !results[c.id]);
      const ro = rvRO();
      for (const c of todo) {
        let res;
        if (c.how === 'auto' && ro && c.ro && c.ro !== ro) res = 'skip: RO ' + c.ro + ' is not the RO open in RV (' + ro + ')';
        else {
          if (onParts) {
            const svc = rvServices().find(s => s.id === c.svcId) || rvServices().find(s => norm(s.name) === norm(c.svcName));
            res = svc ? await addPart(svc, c.part, c.status) : 'error: RV line "' + c.svcName + '" not on this page';
          } else {                                                 // main page: through that line's parts icon
            const id = document.querySelector('[data-service-id="' + c.svcId + '"]') ? c.svcId
              : ((rvEditServices().find(s => norm(s.name) === norm(c.svcName)) || {}).id || '');
            res = id ? await addPartViaModal(id, c.svcName, c.part, c.status, c.saveAfter !== false) : 'error: RV line "' + c.svcName + '" not on this page';
          }
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

  // manual paste on the WORK ORDER page: hover a line + Alt+V -> queued, then the Parts page adds it
  if (!onParts) {
    const lineOf = node => {
      const r = node.closest && node.closest('[data-service-id]');
      return r && (r.querySelector('input[name*="line_items_attributes"][name$="[name]"]') || r.querySelector('[data-target="#parts_modal"], .parts_icon')) ? r : null;
    };
    document.addEventListener('mouseover', e => setHover(lineOf(e.target)), true);
    const pasteLine = async lineEl => {
      if (pasting) return;
      const b = basket();
      if (!b) { toast('Basket empty - right-click (or Alt+C) the Tekion part lines first', true); return; }
      pasting = true;
      try {
        const list = await askAll(b); if (!list) { toast('Paste cancelled - basket kept'); return; }
        const id = lineEl.getAttribute('data-service-id');
        const inp = lineEl.querySelector('input[name*="line_items_attributes"][name$="[name]"]');
        const cmds = load('rvr_cmds', []);
        list.forEach((c, i) => cmds.push({ id: Date.now() + '-' + i + '-' + Math.random().toString(36).slice(2, 6), ro: rvRO(), svcId: id, svcName: clean(inp ? inp.value : ''), how: 'paste', part: c.part, status: c.status, saveAfter: i === list.length - 1, ts: Date.now() }));
        save('rvr_cmds', cmds);
        list.forEach(c => learnLine(c.part.pn, clean(inp ? inp.value : '')));
        save('rvr_clip', null);                               // basket used up
        toast('Adding ' + list.map(c => c.part.pn).join(' + ') + ' to "' + clean(inp ? inp.value : '') + '" and saving…');
        await runCmds();
      } finally { pasting = false; pasteEnd = Date.now(); }
    };
    document.addEventListener('keydown', e => {
      if (!e.altKey || (e.key || '').toLowerCase() !== 'v') return;
      const target = modalOpen() && openSvc && openLine() ? openLine() : hovered;
      if (!target) return;
      e.preventDefault(); pasteLine(target);
    }, true);
    const inOpenWindow = t => { const m = document.getElementById('parts_modal'); return modalOpen() && openSvc && m && m.contains(t); };
    const openLine = () => document.querySelector('[data-service-id="' + openSvc + '"]');
    window.addEventListener('contextmenu', e => {          // right-click the highlighted line (parts icon too) to paste
      if (rcOn() && pasteBusy()) { e.preventDefault(); e.stopImmediatePropagation(); return; }   // double right-click: ignore
      if (!rcOn() || !freshClip()) return;
      if (inOpenWindow(e.target) && openLine()) { e.preventDefault(); e.stopImmediatePropagation(); pasteLine(openLine()); return; }
      if (!onHighlightedRV(e.target)) return;
      e.preventDefault(); e.stopImmediatePropagation(); pasteLine(hovered);
    }, true);
  }
  // manual paste: hover an RV line + Alt+V
  if (onParts) {
    const findSvc = node => {
      const h = node.closest && node.closest('.section-header[data-service-id]');
      if (h) return h;
      const t = node.closest && node.closest('[id^="parts-section-"]');
      return t ? document.querySelector('.section-header[data-service-id="' + t.id.replace('parts-section-', '') + '"]') : null;
    };
    document.addEventListener('mouseover', e => setHover(findSvc(e.target)), true);
    const pasteSvc = async header => {
      if (pasting) return;
      const b = basket();
      if (!b) { toast('Basket empty - right-click (or Alt+C) the Tekion part lines first', true); return; }
      const svc = rvServices().find(s => s.header === header);
      if (!svc) return;
      pasting = true;
      try {
        const list = await askAll(b); if (!list) { toast('Paste cancelled - basket kept'); return; }
        let bad = '';
        for (const c of list) { const res = await addPart(svc, c.part, c.status); if (res !== 'ok') { bad = res; break; } await sleep(300); }
        if (!bad) { list.forEach(c => learnLine(c.part.pn, svc.name)); save('rvr_clip', null); }
        toast(bad || 'Pasted ' + list.map(c => c.part.pn).join(' + ') + ' to "' + svc.name + '" - review, then Save', !!bad && !bad.startsWith('skip'));
      } finally { pasting = false; pasteEnd = Date.now(); }
    };
    document.addEventListener('keydown', e => {
      if (!e.altKey || (e.key || '').toLowerCase() !== 'v' || !hovered) return;
      e.preventDefault(); pasteSvc(hovered);
    }, true);
    window.addEventListener('contextmenu', e => {
      if (rcOn() && pasteBusy()) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (!rcOn() || !freshClip() || !onHighlightedRV(e.target)) return;
      e.preventDefault(); e.stopImmediatePropagation(); pasteSvc(hovered);
    }, true);
  }
  log('RV screen ready', onParts ? '(Parts page)' : '(work order page)');
}

// any other RV page (buckets, search...): show a badge; if Tekion sends parts for an RO
// listed on this page, open that work order's Parts page
function initRvOther() {
  const badge = el('div', 'position:fixed;left:12px;bottom:12px;z-index:2147483600;background:#111827;color:#e5e7eb;border:1px solid #334155;border-radius:8px;padding:5px 9px;font:600 12px Segoe UI,sans-serif;box-shadow:0 3px 10px rgba(0,0,0,.5);pointer-events:none');
  badge.textContent = '🛰 RV Remote (BETA) · open a work order (or send parts from Tekion)';
  document.documentElement.appendChild(badge);
  const roToWo = () => {
    const map = {};
    document.querySelectorAll('a.work-order-link').forEach(a => {
      const wo = ((a.getAttribute('href') || '').match(/\/work_orders\/(\d+)/) || [])[1];
      const c = a.querySelector('.info-bar__item--repair-order-number'), d = c && c.querySelectorAll(':scope > div');
      const ro = d && d.length ? clean(d[d.length - 1].textContent) : '';
      if (wo && /^7\d{6}$/.test(ro)) map[ro] = wo;
    });
    return map;
  };
  const check = () => {
    const results = load('rvr_results', {}), todo = load('rvr_cmds', []).filter(c => !results[c.id] && Date.now() - c.ts < 10 * 60 * 1000);
    if (!todo.length) return;
    const wo = roToWo()[todo[0].ro];
    if (wo) { toast('Tekion sent parts for RO ' + todo[0].ro + ' - opening its Parts page…'); location.href = '/work_orders/' + wo + '/parts_overview?limited_access=false'; }
  };
  GM_addValueChangeListener('rvr_cmds', check); setTimeout(check, 1500);
}

if (IS_TEKION) setTimeout(initTekion, 1200);
else if (/\/work_orders\/\d+/.test(location.pathname)) setTimeout(initRv, 800);
else setTimeout(initRvOther, 800);
})();
