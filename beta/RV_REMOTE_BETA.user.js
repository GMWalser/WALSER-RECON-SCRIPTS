// ==UserScript==
// @name         RV Remote (BETA)
// @namespace    walser-rv-remote-beta
// @version      3.0
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
const STATUS_NAMES = { A: /^(?!.*no action).*action/i, O: /^(?!.*back).*order/i, R: /arriv/i, S: /stock/i };   // O never picks Backordered
const OLD_NUM = { '1': 'A', '3': 'O', '5': 'R', '6': 'S' };
const statusLetter = st => { const t = String(st || '').toUpperCase(); return STATUS_NAMES[t] ? t : OLD_NUM[t] || ''; };
function setStatus(sel, st) {
  if (sel && String(st).startsWith('v:')) { setNative(sel, String(st).slice(2)); return; }
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
  toast('Right-click copy/paste ' + (rcOn() ? 'ON (right-click = copy in Tekion, Alt+right-click = paste in RV)' : 'OFF (normal right-click menu)'));
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
// catch-all lines: never suggested or batch-sent (still pickable with "0 = show all")
const CATCH_ALL = /additional parts|parts needed|parts ordered|estimate parts|pre-?order|\bmisc\b|rob'?s line/i;
const DRAIN_GASKETS = ['803916010', '11126AA000', '90430-12031', '11026-01M02', '94109-14000'].map(x => x.replace(/[^A-Z0-9]/gi, ''));
const pnKey = pn => String(pn || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const RULES = [                                     // first match wins; part text -> RV line name
  { part: /cabin/i, line: /cabin/i },
  { part: /oil filter|drain ?plug|plug gasket|drain gasket/i, line: /\blof\b|oil change|oil (&|and) filter/i, gasket: true },
  { part: /air filter|air cleaner|air element/i, line: /air filter/i, not: /cabin/i },
  { part: /wiper|blade/i, line: /wiper/i },
  { part: /batt/i, line: /batt/i },
  { part: /spark ?plug/i, line: /spark/i },
  { part: /\btires?\b|\d{3}\/\d{2}r\d{2}/i, line: /\btires?\b/i, not: /measure/i },
  { part: /brake|\bpads?\b|rotor|caliper|\bshoes?\b|\bdrums?\b/i, line: /brake/i, brake: true },
];
const hasParts = s => !!s && (Number(s.parts) > 0 || s.parts === 'yes');   // quoted = has a price
const isDone = s => !!s && (s.state === 'green' || s.state === 'yellow');
const FRONT = /\b(front|frt|fr|fnt)\b/i, REAR = /\b(rear|rr|rer)\b/i;
// -> { pick: the suggested line or null, why: text, list: lines ordered best first }
const STOP_WORDS = new Set('replace repl per diag with and the for front rear left right install team fast pass line part parts each kit assy assembly genuine oem upro filter filters additional needed misc'.split(' '));
const partWords = t => [...new Set(String(t || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !/^\d+$/.test(w) && !STOP_WORDS.has(w)))];
function wordHit(part, lines) {
  const ws = partWords(part.desc); if (!ws.length) return null;
  const scored = lines.map(s => { const n = ' ' + norm(s.name) + ' '; return { s, n: ws.filter(w => n.includes(' ' + w + ' ') || n.includes(' ' + w + 's ')).length }; }).filter(x => x.n);
  if (!scored.length) return null;
  scored.sort((a, b) => b.n - a.n);
  return scored.length === 1 || scored[0].n > scored[1].n ? { s: scored[0].s, w: ws.find(w => (' ' + norm(scored[0].s.name) + ' ').includes(' ' + w)) } : null;
}
function suggestLine(part, job, services) {
  const lines = partsLines(services).filter(s => !CATCH_ALL.test(s.name)), text = part.pn + ' ' + (part.desc || '');
  const learned = load('rvr_learn', {})[pnKey(part.pn)];
  const quoted = lines.filter(x => x.state === 'red' && hasParts(x));
  const ordered = first => { const l = first.concat(quoted.filter(s => !first.includes(s))); return l.length ? l : lines; };
  const exact = !/recon\s*fees/i.test(job || '') && lines.find(x => norm(x.name) === norm(job));
  if (exact) return { pick: exact, why: 'same name as the Tekion job', list: ordered([exact]) };
  const qh = wordHit(part, lines.filter(x => x.state === 'red' && hasParts(x)));
  if (qh) return { pick: qh.s, why: 'quoted line, part says ' + qh.w, list: ordered([qh.s]) };
  if (learned) { const s = lines.find(x => norm(x.name) === learned); if (s) return { pick: s, why: 'last time ' + part.pn + ' went here', list: ordered([s]) }; }
  const rule = RULES.find(r => r.part.test(text) || (r.gasket && DRAIN_GASKETS.includes(pnKey(part.pn))));
  if (!rule) { const wh = wordHit(part, lines); return wh ? { pick: wh.s, why: 'part says ' + wh.w, list: ordered([wh.s]) } : { pick: null, why: '', list: ordered([]) }; }
  let hits = lines.filter(s => rule.line.test(s.name) && !(rule.not && rule.not.test(s.name)));
  if (rule.brake) {
    const where = (FRONT.test(text) || FRONT.test(job)) ? FRONT : (REAR.test(text) || REAR.test(job)) ? REAR : null;
    if (where) { const h = hits.filter(s => where.test(s.name)); if (h.length) hits = h; }
    else if (hits.length > 1) return { pick: null, why: 'brakes: front or rear? (pick once, it remembers this part #)', list: ordered(hits), amb: hits.some(hasParts) };
  }
  return hits.length === 1 ? { pick: hits[0], why: (text.match(rule.part) ? 'part says ' + text.match(rule.part)[0].toLowerCase() : 'drain plug gasket'), list: ordered(hits) }
    : { pick: null, why: hits.length ? 'pick one' : '', list: ordered(hits), amb: hits.length > 1 && hits.some(hasParts) };
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
    const away = e => { if (!box.contains(e.target)) finish(null); };   // click outside = cancel
    const finish = v => { box.remove(); document.removeEventListener('keydown', key, true); document.removeEventListener('mousedown', away, true); resolve(v); };
    const draw = () => {
      box.textContent = '';
      box.appendChild(el('div', 'font-size:11px;font-weight:700;color:#60a5fa;text-transform:uppercase;margin-bottom:5px', title));
      if (sug.pick) box.appendChild(el('div', 'color:#4ade80;margin-bottom:6px', '💡 Enter = ' + sug.pick.name + (sug.why ? '  (' + sug.why + ')' : '')));
      else if (sug.why) box.appendChild(el('div', 'color:#fbbf24;margin-bottom:6px', '💡 ' + sug.why));
      list.forEach((s, i) => {
        const dot = { green: '🟢 ', yellow: '🟡 ', red: '🔴 ' }[s.state] || '⚪ ';
        const r = el('div', 'padding:3px 6px;border-radius:5px;cursor:pointer;' + (s === sug.pick ? 'background:#14532d;' : ''), (i + 1) + '. ' + dot + s.name + (Number(s.parts) > 0 ? '  $' + s.parts : ''));
        r.addEventListener('mouseenter', () => { r.style.background = '#1e3a8a'; });
        r.addEventListener('mouseleave', () => { r.style.background = s === sug.pick ? '#14532d' : ''; });
        r.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); finish(s); });
        box.appendChild(r);
      });
      box.appendChild(el('div', 'opacity:.55;font-size:11px;margin-top:6px', '🔴 quoted / action req. · 🟡 ordered · 🟢 done · ⚪ no parts'));
      box.appendChild(el('div', 'opacity:.55;font-size:11px;margin-top:2px', (typed ? 'typed: ' + typed + ' (Enter) · ' : '') + (all ? '' : '0 = show all lines · ') + 'Esc / click away = cancel'));
    };
    const key = e => {
      if (e.ctrlKey || e.altKey) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') return finish(null);
      if (e.key === 'Enter') { const n = parseInt(typed, 10); return finish(n ? list[n - 1] || null : sug.pick); }
      if (e.key === 'Backspace') { typed = typed.slice(0, -1); draw(); return; }
      if (!/^\d$/.test(e.key)) return;
      if (e.key === '0' && !typed && !all) { all = true; list = sug.list.concat(partsLines(allServices).filter(x => !sug.list.includes(x)), allServices.filter(x => NO_PARTS.test(x.name.replace(/^\*+\s*/, '')) && !sug.list.includes(x))); draw(); return; }
      typed += e.key;
      const n = parseInt(typed, 10);
      if (list.length < 10 || n * 10 > list.length) return finish(list[n - 1] || null);   // no 2-digit number possible: pick now
      draw();
    };
    document.documentElement.appendChild(box); draw();
    document.addEventListener('keydown', key, true); document.addEventListener('mousedown', away, true);
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
      const tg = cell.querySelector('.rvr-tag');
      const name = clean(inp && inp.value ? inp.value : tg ? cell.textContent.replace(tg.textContent, '') : cell.textContent);
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

  // ---- thin bar in the page, above the first job: linked? · basket · Clear ----
  const bar = el('div', 'display:flex;align-items:center;gap:10px;margin:6px 0;padding:4px 10px;border-radius:6px;background:rgba(37,99,235,.12);border:1px solid rgba(37,99,235,.45);font:600 12px Segoe UI,sans-serif;color:inherit');
  bar.id = 'rvr-bar';
  const link = el('span', 'white-space:nowrap'); bar.appendChild(link);
  const rcBtn = el('button', 'border:0;border-radius:5px;padding:2px 8px;cursor:pointer;font:700 11px Segoe UI,sans-serif;color:#fff;white-space:nowrap'); bar.appendChild(rcBtn);
  const showRc = () => { const on = rcOn(); rcBtn.textContent = '🖱 Right-click ' + (on ? 'ON' : 'OFF'); rcBtn.style.background = on ? '#16a34a' : '#dc2626'; rcBtn.title = (on ? 'Right-click a part row = add to basket' : 'Right-click is normal (Windows menu)') + ' · click or Alt+R to switch'; };
  rcBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); save('rvr_rc', !rcOn()); showRc(); });
  showRc(); GM_addValueChangeListener('rvr_rc', showRc);
  const bTxt = el('span', 'flex:1;color:#f59e0b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'); bar.appendChild(bTxt);
  const bClr = el('button', 'background:#7f1d1d;color:#fff;border:0;border-radius:5px;padding:2px 8px;cursor:pointer;font:600 11px Segoe UI,sans-serif', '🗑 Empty basket'); bar.appendChild(bClr);
  let batchList = [];
  const bAll = el('button', 'background:#7c3aed;color:#fff;border:0;border-radius:5px;padding:2px 8px;cursor:pointer;font:600 11px Segoe UI,sans-serif;display:none'); bar.insertBefore(bAll, bTxt);
  bAll.addEventListener('click', async e => {
    e.preventDefault(); e.stopPropagation();
    const list = batchList.slice(); if (!list.length) return;
    const last = load('rvr_lastpaste', { vendor: '', status: 'O' });
    const NAMES = { A: 'Action Req.', O: 'Ordered', R: 'Arrived', S: 'In Stock' };
    const what = list.map(x => x.line.pn + ' → ' + x.svc.name.replace(/^\*+\s*/, '') + (x.quoted ? ' (quoted)' : '')).join(' · ');
    const nNew = list.filter(x => !x.quoted).length;
    const vendor = !nNew ? '' : await askStep('Send ' + list.length + ' parts: ' + what + ' · Vendor for the ' + nNew + ' new part' + (nNew > 1 ? 's' : '') + ' (quoted parts keep theirs)', last.vendor, x => (x ? '→ ' + vendorName(x) : '(none)') + '   · B=SUBCHEV F=FMP N=NAPA O=OR A=AZ ST=STOCK');
    if (vendor === null) return;
    const sDef = vendorName(vendor) === 'STOCK' ? 'S' : last.status;
    const stk = await askStep((nNew ? '' : 'Send ' + list.length + ' quoted parts: ' + what + ' · ') + 'Status for all ' + list.length + ' · press A / O / R / S', '', () => 'Enter = ' + (NAMES[sDef] || 'leave as is'), true);
    if (stk === null) return;
    const status = statusLetter(stk) || sDef;
    if (vendor && vendorName(vendor) !== 'STOCK') save('rvr_lastpaste', { vendor, status });
    list.filter(x => x.quoted).forEach(x => {              // quoted: set vendor + status on the part already there
      learnLine(x.line.pn, x.svc.name);
      send(x.line, x.svc, 'status', { part: { pn: x.line.pn, desc: '', qty: x.line.qty, price: x.line.price }, status });
    });
    const adds = list.filter(x => !x.quoted);
    adds.sort((a, b) => String(a.svc.id).localeCompare(String(b.svc.id)));
    adds.forEach((x, i, list) => {
      const lastOfLine = !list[i + 1] || list[i + 1].svc.id !== x.svc.id;      // save once per RV line
      learnLine(x.line.pn, x.svc.name);
      send(x.line, x.svc, 'button', { part: { pn: x.line.pn, desc: vendorName(vendor), qty: x.line.qty, price: x.line.price }, status, saveAfter: lastOfLine });
    });
    toast('Sent ' + list.length + ' parts to RV');
  });
  const bUndo = el('button', 'background:#334155;color:#fff;border:0;border-radius:5px;padding:2px 8px;cursor:pointer;font:600 11px Segoe UI,sans-serif;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'); bar.appendChild(bUndo);
  const showUndo = () => { const u = load('rvr_undo', []).slice(-1)[0]; bUndo.style.display = u ? '' : 'none'; if (u) { bUndo.textContent = '↶ Undo: ' + u.label; bUndo.title = 'Undo the last change in RV (Alt+Z): ' + u.label; } };
  const undo = () => {
    const u = load('rvr_undo', []).slice(-1)[0]; if (!u) { toast('Nothing to undo'); return; }
    const cmds = load('rvr_cmds', []).filter(c => Date.now() - c.ts < 10 * 60 * 1000);
    cmds.push({ id: Date.now() + '-u' + Math.random().toString(36).slice(2, 6), ro: tekionRO(), how: 'undo', ts: Date.now() }); save('rvr_cmds', cmds);
    toast('Undo: ' + u.label);
  };
  bUndo.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); undo(); });
  document.addEventListener('keydown', e => { if (e.altKey && (e.key || '').toLowerCase() === 'z') { e.preventDefault(); undo(); } }, true);
  showUndo(); GM_addValueChangeListener('rvr_undo', showUndo);
  const showBasket = () => { const bk = basket(); bTxt.textContent = bk ? '🧺 ' + bk.parts.length + ' in basket: ' + bk.parts.map(x => x.pn).join(', ') : '🧺 basket empty'; bClr.disabled = !bk; bClr.style.opacity = bk ? '1' : '.45'; bClr.style.cursor = bk ? 'pointer' : 'default'; };
  bClr.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); save('rvr_clip', null); showBasket(); });
  showBasket(); GM_addValueChangeListener('rvr_clip', showBasket); setInterval(showBasket, 10000);
  const placeBar = () => {                            // Tekion redraws: put it back above the first job
    const job = document.querySelector('[data-id^="Job"]');
    if (!job) { if (bar.isConnected) bar.remove(); return; }
    if (bar.nextElementSibling !== job) job.parentElement.insertBefore(bar, job);
  };
  const note = t => log(t);

  // ---- send a part to RV ----
  function send(line, svc, how, ans) {
    const ro = tekionRO(), rv = load('rvr_rv', null);
    const key = ro + '|' + norm(line.job) + '|' + line.pn;
    const cmd = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), ro, svcId: svc.id, svcName: svc.name, how,
      part: ans ? ans.part : { pn: line.pn, desc: vendorName(opts.vendor), qty: line.qty, price: line.price }, status: ans ? ans.status : opts.status, ts: Date.now() };
    if (ans && ans.saveAfter === false) cmd.saveAfter = false;
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
      const c = cmds.find(x => x.id === id), pn = c && c.part ? c.part.pn : '';
      note(res[id] === 'ok' ? `✓ ${pn} added in RV` : (res[id].startsWith('skip') ? '• ' : '✗ ') + res[id]);
    });
  });

  // ---- buttons + badges on each Tekion line; auto send ----
  function tick() {
    const ro = tekionRO(), rv = load('rvr_rv', null);
    const age = rv ? Date.now() - rv.ts : 1e12;
    const fresh = age < 30 * 60 * 1000;
    const roOk = fresh && ro && rv.ro === ro;
    placeBar(); showRc();
    const ago = age < 90000 ? '' : ' (RV last seen ' + Math.round(age / 60000) + ' min ago)';
    link.textContent = !fresh ? '🛰 🔴 RV not linked (open the RO in RV)' : !ro ? '🛰 🟡 open an RO' : roOk ? '🛰 🟢 RV linked · RO ' + ro + ago : '🛰 🟡 RV has RO ' + (rv.ro || '?') + ' open';
    link.style.color = roOk ? '#16a34a' : fresh ? '#d97706' : '#dc2626';
    const byName = {}; if (roOk) rv.services.forEach(s => { byName[norm(s.name)] = s; });
    const batch = [];
    tekionLines().forEach(line => {
      let tag = line.row.querySelector('.rvr-tag');
      if (!tag) {
        tag = el('button', 'margin-left:6px;border:0;border-radius:4px;padding:1px 6px;font:600 11px Segoe UI,sans-serif;cursor:pointer;color:#fff;background:#475569');
        tag.className = 'rvr-tag'; tag.title = 'Send this part to RV (choose the line)';
        tag.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); manualChoose(tag._line); });
        const cell = line.row.querySelector('[data-test-id*="itemName-cell"]'); (cell || line.row).appendChild(tag);
      }
      tag._line = line;
      let qb = line.row.querySelector('.rvr-qbtns');
      if (!qb) {
        qb = el('span', 'margin-left:6px;display:inline-flex;gap:4px'); qb.className = 'rvr-qbtns';
        [['A', '#b45309', 'Action Required'], ['R', '#16a34a', 'Arrived'], ['S', '#0d9488', 'In Stock'], ['O', '#2563eb', 'Ordered'], ['🗑', '#7f1d1d', 'Delete this part from RV']].forEach(([k, c, t]) => {
          const b = el('button', 'border:0;border-radius:4px;padding:3px 0;min-width:24px;font:700 13px Segoe UI,sans-serif;cursor:pointer;color:#fff;background:' + c, k);
          b.title = k === '🗑' ? t : 'Set RV status: ' + t;
          b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); k === '🗑' ? quickDelete(tag._line) : quickStatus(tag._line, k); });
          qb.appendChild(b);
        });
        tag.after(qb);
      }
      const key = ro + '|' + norm(line.job) + '|' + line.pn, match = byName[norm(line.job)];
      if (sent[key]) { tag.textContent = '✓ RV'; tag.style.background = '#16a34a'; tag.title = 'Sent to RV - use O S R A to change status, 🗑 to delete'; qb.style.display = 'inline-flex'; return; }
      const sgx = fresh ? suggestLine(line, line.job, rv.services) : { pick: null };
      const target = match || sgx.pick;
      tag._target = target && (hasParts(target) || isDone(target)) ? target : null;
      qb.style.display = 'inline-flex';                                     // O S R A 🗑 always shown (no known line = it asks which)
      if (isDone(target)) { tag.textContent = '✓ RV'; tag.style.background = '#15803d'; tag.title = '"' + target.name + '" is already ' + target.state + ' in RV - nothing to add (click to change)'; return; }
      if (target && hasParts(target)) { tag.textContent = '⚡ RV'; tag.style.background = '#dc2626'; tag.title = '"' + target.name + '" is quoted in RV - click to set status (Ordered / In Stock / Arrived)'; if (roOk && line.pn) batch.push({ line, svc: target, quoted: true }); return; }
      if (!target && sgx.amb) { tag.textContent = '⚡ RV'; tag.style.background = '#dc2626'; tag.title = 'Quoted in RV on one of: ' + sgx.list.filter(hasParts).map(x => x.name).join(' / ') + ' - click to pick front/rear'; return; }
      if (match && !/recon\s*fees/i.test(line.job)) { tag.textContent = '⇢ RV'; tag.style.background = '#2563eb'; tag.title = 'Exact match: RV line "' + match.name + '"'; }
      else {
        const sg = fresh ? suggestLine(line, line.job, rv.services) : { pick: null };
        if (sg.pick) { tag.textContent = '💡 RV'; tag.style.background = '#7c3aed'; tag.title = 'Click: suggested "' + sg.pick.name + '" (you confirm)'; if (roOk && line.pn) batch.push({ line, svc: sg.pick }); }
        else { tag.textContent = '? RV'; tag.style.background = '#b45309'; tag.title = 'Click to choose the RV line'; }
      }
      if (opts.auto && roOk && match && !/recon\s*fees/i.test(line.job) && line.pn && Number(line.price) > 0) send(line, match, 'auto');
    });
    batchList = batch;
    bAll.style.display = batch.length ? '' : 'none';
    const nq = batch.filter(x => x.quoted).length;
    bAll.textContent = '📤 Send all ' + batch.length + (nq ? ' (' + nq + ' quoted)' : '');
    bAll.title = batch.map(x => x.line.pn + ' → ' + x.svc.name + (x.quoted ? ' (quoted: set vendor + status)' : ' (add)')).join('\n');
  }
  setInterval(() => { if (!document.hidden) tick(); }, 1500);

  // ---- manual: choose a line from a short list (button) ----
  async function manualChoose(line) {
    const rv = load('rvr_rv', null);
    if (!rv || !rv.services.length) { toast('RV is not linked yet - open the RV work order Parts page', true); return; }
    const part = { pn: line.pn, desc: line.desc, qty: line.qty, price: line.price, oh: line.oh };
    const svc = await pickLine('Send ' + line.pn + (line.desc ? ' - ' + line.desc : '') + ' to which RV line?', suggestLine(part, line.job, rv.services), rv.services);
    if (!svc) return;
    if (hasParts(svc)) { orderQuoted(line, svc); return; }   // quoted line: Vendor, then Status
    const a = await askPaste(part); if (!a) return;
    learnLine(line.pn, svc.name);
    send(line, svc, 'button', withAnswers(part, a)); toast(`Sent ${line.pn} to "${svc.name}"`);
  }

  // quoted part: Vendor (Enter = leave as is), then Status A/O/R/S; RV fills both and saves
  async function orderQuoted(line, svc) {
    const NAMES = { A: 'Action Req.', O: 'Ordered', R: 'Arrived', S: 'In Stock' };
    const k = await askStep('Status · ' + line.pn + ' on "' + svc.name + '" (quoted - vendor & qty stay as quoted)', '', () => 'press O = Ordered · S = In Stock · R = Arrived · A = Action · Enter = Ordered', true);
    if (k === null) return;
    const status = statusLetter(k) || 'O';
    learnLine(line.pn, svc.name);
    send(line, svc, 'status', { part: { pn: line.pn, desc: '', qty: line.qty, price: line.price }, status });
    toast(line.pn + ' → ' + NAMES[status] + ' on "' + svc.name + '"');
  }
  // the RV line a Tekion part belongs to (or ask)
  async function lineFor(line) {
    const rv = load('rvr_rv', null);
    if (!rv || !rv.services.length) { toast('RV is not linked yet - open the RO in RV', true); return null; }
    const t = line.row.querySelector('.rvr-tag'), known = t && t._target;
    if (known) return rv.services.find(s => s.id === known.id) || known;
    const part = { pn: line.pn, desc: line.desc, qty: line.qty, price: line.price, oh: line.oh };
    return pickLine('Which RV line is ' + line.pn + ' on?', suggestLine(part, line.job, rv.services), rv.services);
  }
  // O / S / R / A buttons: just the status (check-in); 🗑 = delete from RV (asks first)
  async function quickStatus(line, k) {
    const svc = await lineFor(line); if (!svc) return;
    const NAMES = { A: 'Action Req.', O: 'Ordered', R: 'Arrived', S: 'In Stock' };
    learnLine(line.pn, svc.name);
    send(line, svc, 'status', { part: { pn: line.pn, desc: '', qty: line.qty, price: line.price }, status: k });
    toast(line.pn + ' → ' + NAMES[k] + ' on "' + svc.name + '"');
  }
  async function quickDelete(line) {
    const svc = await lineFor(line); if (!svc) return;
    const y = await askStep('Delete ' + line.pn + ' from "' + svc.name + '" in RV?', '', () => 'press Y = yes, delete it · Esc = no', 'Y');
    if (y !== 'Y') return;
    send(line, svc, 'delete', { part: { pn: line.pn, desc: '', qty: line.qty, price: line.price }, status: '' });
    toast('Deleting ' + line.pn + ' from "' + svc.name + '"… (↶ Undo puts it back)');
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
    toast(`Basket: ${b.parts.length} part${b.parts.length > 1 ? 's' : ''} (${b.parts.map(x => x.pn).join(', ')}) - Alt+right-click the RV line to paste all`);
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
    const away = e => { if (!box.contains(e.target)) finish(null); };   // click outside = cancel
    const finish = v => { box.remove(); document.removeEventListener('keydown', key, true); document.removeEventListener('mousedown', away, true); resolve(v); };
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); return; }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(inp.value.trim()); return; }
      const keys = typeof singleKey === 'string' ? singleKey : 'AORS';
      if (singleKey && e.key.length === 1 && keys.includes(e.key.toUpperCase()) && !e.ctrlKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); finish(e.key.toUpperCase()); }
    };
    document.addEventListener('keydown', key, true); document.addEventListener('mousedown', away, true);
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
// color of the parts icon's little badge: green check / yellow / red "!" (read from the colors on screen)
function iconState(trigger) {
  if (!trigger) return '';
  const ic = trigger.querySelector('[data-statuscolor]');
  if (ic) {                                          // RV says it directly
    const c = (ic.getAttribute('data-statuscolor') || '').toLowerCase(), t = ic.getAttribute('title') || '';
    if (/green/.test(c)) return 'green';
    if (/yellow|orange|amber|gold/.test(c)) return 'yellow';
    if (/red/.test(c)) return 'red';
    if (/grey|gray/.test(c)) return '';
    if (/no action/i.test(t)) return '';
    if (/action/i.test(t)) return 'red';
    if (/order/i.test(t)) return 'yellow';
    if (/arriv|stock|complete|received/i.test(t)) return 'green';
    return '';
  }
  let best = '', bestSat = 0;
  [trigger, ...trigger.querySelectorAll('*')].forEach(n => {
    const cs = getComputedStyle(n);
    [cs.color, cs.backgroundColor, cs.fill, cs.stroke].forEach(c => {
      const m = (c || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/); if (!m || (m[4] !== undefined && +m[4] < 0.3)) return;
      const r = +m[1], g = +m[2], b = +m[3], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx < 90) return; const sat = (mx - mn) / mx; if (sat < 0.35 || sat <= bestSat) return;
      let h = mx === r ? ((g - b) / (mx - mn)) * 60 : mx === g ? (2 + (b - r) / (mx - mn)) * 60 : (4 + (r - g) / (mx - mn)) * 60; if (h < 0) h += 360;
      const st = (h < 20 || h > 335) ? 'red' : (h >= 25 && h <= 65) ? 'yellow' : (h >= 75 && h <= 170) ? 'green' : '';
      if (st) { best = st; bestSat = sat; }
    });
  });
  return best;
}
// the "Parts" $ on a main-page line = the last $ amount before the parts icon
function linePartsMoney(r, trigger) {
  const pp = trigger && trigger.querySelector('.part_price');
  if (pp) return money(pp.textContent);
  let last = '';
  const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) {
    if (trigger && (trigger.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
    const m = t.textContent.match(/\$\s*([\d,]+\.\d\d)/); if (m) last = m[1].replace(/,/g, '');
  }
  return last;
}
const seenColors = new Set();
function rvEditServices() {                        // the work order (edit) page
  const out = [], seen = new Set();
  document.querySelectorAll('[data-service-id]').forEach(r => {
    const id = r.getAttribute('data-service-id'); if (!id || seen.has(id)) return;
    const inp = r.querySelector('input[name*="line_items_attributes"][name$="[name]"]');
    const trigger = r.querySelector('[data-target="#parts_modal"]');
    let name = clean(inp ? inp.value : '');
    if (!name && trigger) name = clean(trigger.getAttribute('data-modaltitle') || (r.innerText || '').split('\n').map(clean).find(x => /[a-z]{3}/i.test(x)) || '');   // locked lines
    if (!name) return;
    const rej = r.querySelector('input[name$="[rejected]"]');
    if (r.querySelector('.checkbox-holder.rejected') || (rej && rej.value === '1')) return;   // thumbs down: parts removed
    const ic = trigger && trigger.querySelector('[data-statuscolor]');
    if (ic) { const k = ic.getAttribute('data-statuscolor') + ' / ' + ic.getAttribute('title'); if (!seenColors.has(k)) { seenColors.add(k); log('icon color seen:', k, '->', iconState(trigger) || 'none'); } }
    seen.add(id); out.push({ id, name, parts: linePartsMoney(r, trigger), state: iconState(trigger) });
  });
  return out;
}
function rvServices() {
  const out = [];
  document.querySelectorAll('.section-header[data-service-id]').forEach(h => {
    const id = h.getAttribute('data-service-id');
    const name = clean((h.textContent || '').replace(/^\W*Service:\s*/i, '').replace(/\d+\s*Parts?\s*Add Part to Service[\s\S]*$/i, ''));
    const btn = h.querySelector('.add-part-to-service-btn') || [...h.querySelectorAll('button,a')].find(x => /add part to service/i.test(x.textContent));
    if (!btn) return;
    const sec = document.getElementById('parts-section-' + id);
    const sts = sec ? [...sec.querySelectorAll('td.save_value.status select, select[data-field-name="status"]')].map(x => (x.options[x.selectedIndex] || {}).textContent || '') : [];
    const state = !sts.length ? '' : sts.some(t => /action/i.test(t)) ? 'red' : sts.some(t => /order/i.test(t)) ? 'yellow' : 'green';
    out.push({ id, name, btn, header: h, parts: sts.length ? 'yes' : '', state });
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
  const closeWin = async msg => {                    // nothing added: click Save so the window does not stay open
    const sb = document.querySelector('[id^="desktop-save-button-"]');
    if (saveAfter && sb && modalOpen()) { sb.click(); await waitFor(() => !modalOpen(), 6000); await sleep(600); }
    return msg;
  };
  const have = [...modal.querySelectorAll('textarea[id*="part_number"], input[id*="part_number"]')].some(f => clean(f.value).toUpperCase() === part.pn.toUpperCase());
  if (have) return closeWin('skip: ' + part.pn + ' already on "' + svcName + '"');
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
// set the status of parts already on a line (quoted parts): the part # that matches, else the Action Required ones
function setRowsStatus(container, pn, status, vendor) {
  const rows = [...container.querySelectorAll('tr')].filter(r => r.querySelector('textarea[id*="part_number"], input[id*="part_number"]'));
  const pnOf = r => pnKey((r.querySelector('textarea[id*="part_number"], input[id*="part_number"]') || {}).value);
  const stOf = r => r.querySelector('td.save_value.status select, select[data-field-name="status"]');
  const k = pnKey(pn);
  let hit = rows.filter(r => k && pnOf(r) && (pnOf(r) === k || pnOf(r).includes(k) || k.includes(pnOf(r))));
  const stText = r => { const s = stOf(r); return s ? ((s.options[s.selectedIndex] || {}).textContent || '').trim() : ''; };
  const descOf = r => r.querySelector('td.save_value.description textarea, textarea[data-field-name="description"]');
  if (!hit.length) hit = rows.filter(r => /action/i.test(stText(r)) && !/no action/i.test(stText(r)));          // Action Required rows
  if (!hit.length) hit = rows.filter(r => !/order|arriv|stock/i.test(stText(r)));                               // rows not ordered/arrived/stock yet
  if (!hit.length && rows.length === 1) hit = rows;
  const prev = hit.map(r => ({ pn: (r.querySelector('textarea[id*="part_number"], input[id*="part_number"]') || {}).value, value: (stOf(r) || {}).value, desc: (descOf(r) || {}).value }));
  hit.forEach(r => { if (status) setStatus(stOf(r), status); const d = descOf(r); if (vendor && d) setNative(d, vendor); });
  const has = rows.map(r => ((r.querySelector('textarea[id*="part_number"], input[id*="part_number"]') || {}).value || '?') + ' (' + (stText(r) || '?') + ')').join(', ');
  return { n: hit.length, prev, has };
}
async function statusViaModal(svcId, svcName, pn, status, vendor) {
  const line = document.querySelector('[data-service-id="' + svcId + '"]');
  const trigger = line && line.querySelector('[data-target="#parts_modal"]');
  if (!trigger) return 'error: parts icon not found on "' + svcName + '"';
  if (modalOpen() && openSvc && openSvc !== String(svcId)) {
    const sb = document.querySelector('[id^="desktop-save-button-"]'); if (sb) { sb.click(); await waitFor(() => !modalOpen(), 6000); await sleep(600); }
  }
  if (!modalOpen()) { trigger.click(); openSvc = String(svcId); if (!(await waitFor(modalOpen, 5000))) return 'error: parts window did not open for "' + svcName + '"'; await sleep(700); }
  const r = setRowsStatus(document.getElementById('parts_modal'), pn, status, vendor);
  await sleep(400);
  await saveWin();
  if (!r.n) { log('no match for', pn, 'on', svcName, '- rows:', r.has); return 'error: ' + pn + ' not found on "' + svcName + '" - it has: ' + (r.has || 'no parts'); }
  pushUndo({ kind: 'status', svcId, svcName, prev: r.prev, label: (r.prev.map(x => x.pn).join(', ') || pn) + ' → ' + (({ A: 'Action', O: 'Ordered', R: 'Arrived', S: 'In Stock' })[statusLetter(status)] || 'status') + ' on "' + svcName + '"' });
  return 'ok';
}
// ---- shared helpers for the parts window ----
const PN_SEL = 'textarea[id*="part_number"], input[id*="part_number"]', ST_SEL = 'td.save_value.status select, select[data-field-name="status"]';
async function saveWin() {
  const sb = document.querySelector('[id^="desktop-save-button-"]');
  if (sb && modalOpen()) { sb.click(); await waitFor(() => !modalOpen(), 6000); await sleep(800); }
}
async function openWin(svcId, svcName) {
  const line = document.querySelector('[data-service-id="' + svcId + '"]');
  const trigger = line && line.querySelector('[data-target="#parts_modal"]');
  if (!trigger) return 'error: parts icon not found on "' + svcName + '"';
  if (modalOpen() && openSvc && openSvc !== String(svcId)) await saveWin();
  if (!modalOpen()) { trigger.click(); openSvc = String(svcId); if (!(await waitFor(modalOpen, 5000))) return 'error: parts window did not open for "' + svcName + '"'; await sleep(700); }
  return '';
}
// undo list (newest last), shared with Tekion so its Undo button can show what it will undo
function pushUndo(u) { const l = load('rvr_undo', []); l.push(Object.assign(u, { ts: Date.now() })); save('rvr_undo', l.slice(-20)); }
// delete a part (exact part # only) from a line, then save
async function deleteViaModal(svcId, svcName, pn, noUndo) {
  const err = await openWin(svcId, svcName); if (err) return err;
  const modal = document.getElementById('parts_modal'), k = pnKey(pn);
  const rows = [...modal.querySelectorAll('tr')].filter(r => { const f = r.querySelector(PN_SEL); return f && k && pnKey(f.value) === k && r.offsetParent !== null; });
  if (!rows.length) { await saveWin(); return 'error: ' + pn + ' is not on "' + svcName + '"'; }
  const kept = [];
  for (const r of rows) {
    const val = sel => { const f = r.querySelector(sel); return f ? f.value : ''; };
    kept.push({ pn: val(PN_SEL), desc: val('td.save_value.description textarea, textarea[data-field-name="description"]'), qty: val('input[data-field-name="quantity"]'), price: val('input[id*="part_price"], input[data-field-name="partPrice"]'), st: (r.querySelector(ST_SEL) || {}).value });
    const destroy = r.querySelector('input[name$="[_destroy]"]');
    const trash = r.querySelector('[class*="trash"], [class*="delete"], [class*="remove"], [title*="elete"], [title*="emove"], [aria-label*="elete"], a[data-method="delete"], [data-action*="remove"], [data-action*="delete"], [data-action*="destroy"]');
    if (trash) (trash.closest('a,button') || trash).click();
    else if (destroy) { if (destroy.type === 'checkbox') destroy.checked = true; setNative(destroy, destroy.type === 'checkbox' ? destroy.value : '1'); r.style.display = 'none'; }
    else { log('DELETE: no delete control found in this row - send this to fix it:', r.outerHTML.slice(0, 1500)); await saveWin(); return 'error: could not find the delete button for ' + pn + ' (row code is in the console)'; }
    await sleep(500);
  }
  await saveWin();
  if (!noUndo) pushUndo({ kind: 'delete', svcId, svcName, rows: kept, label: 'deleted ' + pn + ' from "' + svcName + '"' });
  return 'ok';
}
// undo the newest entry
async function runUndo() {
  const l = load('rvr_undo', []); const u = l.pop(); if (!u) return 'skip: nothing to undo';
  save('rvr_undo', l);
  if (u.kind === 'add') return deleteViaModal(u.svcId, u.svcName, u.pn, true);
  if (u.kind === 'status') {
    const err = await openWin(u.svcId, u.svcName); if (err) return err;
    const modal = document.getElementById('parts_modal');
    u.prev.forEach(x => { const r = [...modal.querySelectorAll('tr')].find(t => { const f = t.querySelector(PN_SEL); return f && f.value === x.pn; }); const sel = r && r.querySelector(ST_SEL); if (sel && x.value != null) setNative(sel, x.value); const d = r && r.querySelector('td.save_value.description textarea, textarea[data-field-name="description"]'); if (d && x.desc != null && d.value !== x.desc) setNative(d, x.desc); });
    await sleep(400); await saveWin(); return 'ok';
  }
  if (u.kind === 'delete') {
    for (const x of u.rows) { const res = await addPartViaModal(u.svcId, u.svcName, { pn: x.pn, desc: x.desc, qty: x.qty, price: x.price }, 'v:' + x.st, true); if (res !== 'ok') return res; }
    return 'ok';
  }
  return 'skip: unknown undo';
}
const rvTab = Math.random().toString(36).slice(2, 8);
function initRv() {
  const onParts = /\/parts_overview/.test(location.pathname);
  const publish = () => {
    const ro = rvRO();
    const services = onParts ? rvServices().map(s => ({ id: s.id, name: s.name, parts: s.parts, state: s.state })) : rvEditServices();
    save('rvr_rv', { ro, woId: woId(), onParts, services, ts: Date.now() });
  };
  publish(); setInterval(publish, 3000);
  // small badge so you can see the beta is running on RV
  const badge = el('div', 'position:fixed;left:12px;bottom:12px;z-index:2147483600;background:#111827;color:#e5e7eb;border:1px solid #334155;border-radius:8px;padding:5px 9px;font:600 12px Segoe UI,sans-serif;box-shadow:0 3px 10px rgba(0,0,0,.5);pointer-events:none');
  badge.id = 'rvr-rv-badge'; document.documentElement.appendChild(badge);
  const showBadge = () => {
    const ro = rvRO(), n = (onParts ? rvServices() : rvEditServices()).length;
    const b = basket();
    badge.textContent = '🛰 RV Remote (BETA) · RO ' + (ro || '?') + ' · ' + n + ' lines · ' + (b ? '🧺 ' + b.parts.map(x => x.pn).join(' + ') + ' · ' : '🧺 empty · ') + (rcOn() ? '🖱 right-click ON: Alt+right-click a line to paste' : '🖱 right-click OFF (Alt+R to turn on) · Alt+V to paste');
    badge.style.borderColor = rcOn() ? '#334155' : '#dc2626';
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
      const me = rvTab;
      for (const c of todo) {
        if (c.ro && ro && c.ro !== ro) continue;                // another RO: leave it for that RV tab
        save('rvr_claim', { id: c.id, tab: me }); await sleep(250);
        const cl = load('rvr_claim', {}); if (cl.id !== c.id || cl.tab !== me) continue;   // another RV tab took it
        if (load('rvr_results', {})[c.id]) continue;
        let res;
        if (c.how === 'auto' && ro && c.ro && c.ro !== ro) res = 'skip: RO ' + c.ro + ' is not the RO open in RV (' + ro + ')';
        else {
          if (c.how === 'undo' || c.how === 'delete') {
            res = onParts ? 'error: undo / delete work on the RV work order page (not the Parts page)'
              : c.how === 'undo' ? await runUndo() : await deleteViaModal(c.svcId, c.svcName, c.part.pn);
          } else if (c.how === 'status') {                       // change status of parts already quoted on the line
            if (onParts) { const sec = document.getElementById('parts-section-' + c.svcId); const r = sec && setRowsStatus(sec, c.part.pn, c.status, c.part.desc); res = !sec ? 'error: RV line "' + c.svcName + '" not on this page' : r.n ? 'ok' : 'error: ' + c.part.pn + ' not found on "' + c.svcName + '" - it has: ' + (r.has || 'no parts'); }
            else res = await statusViaModal(c.svcId, c.svcName, c.part.pn, c.status, c.part.desc);
          } else if (onParts) {
            const svc = rvServices().find(s => s.id === c.svcId) || rvServices().find(s => norm(s.name) === norm(c.svcName));
            res = svc ? await addPart(svc, c.part, c.status) : 'error: RV line "' + c.svcName + '" not on this page';
          } else {                                                 // main page: through that line's parts icon
            const id = document.querySelector('[data-service-id="' + c.svcId + '"]') ? c.svcId
              : ((rvEditServices().find(s => norm(s.name) === norm(c.svcName)) || {}).id || '');
            res = id ? await addPartViaModal(id, c.svcName, c.part, c.status, c.saveAfter !== false) : 'error: RV line "' + c.svcName + '" not on this page';
            if (res === 'ok') pushUndo({ kind: 'add', svcId: id, svcName: c.svcName, pn: c.part.pn, label: 'added ' + c.part.pn + ' to "' + c.svcName + '"' });
          }
        }
        results[c.id] = res; save('rvr_results', results);
        if (res !== 'ok') toast(res, !res.startsWith('skip'));
        else toast(c.how === 'undo' ? 'Undone' : c.how === 'delete' ? 'Deleted ' + c.part.pn + ' from "' + c.svcName + '"' : (c.how === 'status' ? 'Status set on ' : 'Added ' + c.part.pn + ' to ') + '"' + c.svcName + '"');
        await sleep(300);
      }
      const ids = Object.keys(results); if (ids.length > 200) { ids.slice(0, ids.length - 200).forEach(i => delete results[i]); save('rvr_results', results); }
    } finally { busy = false; }
  }
  GM_addValueChangeListener('rvr_cmds', () => runCmds());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) runCmds(); });
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
    window.addEventListener('contextmenu', e => {          // ALT + right-click the highlighted line (parts icon too) to paste
      if (!e.altKey || !rcOn()) return;                    // plain right-click: RV / Recon Clipboard as normal
      if (pasteBusy()) { e.preventDefault(); e.stopImmediatePropagation(); return; }   // double click: ignore
      if (inOpenWindow(e.target) && openLine()) {
        if (!freshClip()) return;                          // empty basket: Recon Clipboard's Alt+right-click in the window
        e.preventDefault(); e.stopImmediatePropagation(); pasteLine(openLine()); return;
      }
      if (!onHighlightedRV(e.target)) return;
      e.preventDefault(); e.stopImmediatePropagation(); pasteLine(hovered);   // empty basket -> "basket empty" message
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
    window.addEventListener('contextmenu', e => {          // ALT + right-click the highlighted line to paste
      if (!e.altKey || !rcOn()) return;
      if (pasteBusy()) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (!onHighlightedRV(e.target)) return;
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
