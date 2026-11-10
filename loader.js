// Loader for Walser Recon Tools. build.py inserts every script at the
// SCRIPTS marker below. Edit this file only to change how scripts are
// started, switched on/off, or imported.
(function () {
'use strict';

const LOG = '[Walser Recon]';
const _get = GM_getValue, _set = GM_setValue, _del = GM_deleteValue, _list = GM_listValues,
      _addL = GM_addValueChangeListener, _remL = GM_removeValueChangeListener;
const ALL_OFF_KEY = '__all_off';
const offKey = id => '__off::' + id;

const WR = { list: [] };
WR.add = function (id, name, version, matches, runAt, fn) {
  WR.list.push({ id, name, version, matches, runAt, fn });
};

// ---- @match pattern -> RegExp (same rules Tampermonkey uses for @match) ----
function esc(s) { return s.replace(/[.+?^${}()|[\]\\\/]/g, '\\$&'); }
function matchToRegex(p) {
  const m = /^(\*|https?):\/\/([^/]*)(\/.*)?$/.exec(p);
  if (!m) { console.warn(LOG, 'unsupported @match', p); return /$^/; }
  const scheme = m[1] === '*' ? 'https?' : m[1];
  const h = m[2];
  const host = h === '*' ? '[^/]*' : h.startsWith('*.') ? '(?:[^/]*\\.)?' + esc(h.slice(2)) : esc(h);
  const path = (m[3] || '/').split('*').map(esc).join('.*');
  return new RegExp('^' + scheme + ':\\/\\/' + host + path + '$');
}
const pageUrl = location.href.split('#')[0];
const onThisPage = s => s.matches.some(p => matchToRegex(p).test(pageUrl));

// ---- Each script gets its own saved-data area: "<id>::<key>" ----
function gmFor(id) {
  const P = id + '::';
  return [
    (k, d) => _get(P + k, d),
    (k, v) => _set(P + k, v),
    k => _del(P + k),
    () => _list().filter(k => k.startsWith(P)).map(k => k.slice(P.length)),
    (k, cb) => _addL(P + k, (name, oldV, newV, remote) => cb(k, oldV, newV, remote)),
    lid => _remL(lid),
  ];
}

/*__SCRIPTS__*/

// ---- Start the scripts that belong on this page ----
const allOff = _get(ALL_OFF_KEY, false);
// ---- Speed report: time spent in each script's timers / observers (this page) ----
const COST = {}, COST_T0 = performance.now();
function timedFns(id) {
  const c = COST[id] = COST[id] || { ms: 0, n: 0, max: 0 };
  const wrap = fn => typeof fn !== 'function' ? fn : function () {
    const t = performance.now();
    try { return fn.apply(this, arguments); }
    finally { const d = performance.now() - t; c.ms += d; c.n++; if (d > c.max) c.max = d; }
  };
  const W = window;
  return [
    (fn, ms, ...a) => W.setInterval(wrap(fn), ms, ...a),
    (fn, ms, ...a) => W.setTimeout(wrap(fn), ms, ...a),
    fn => W.requestAnimationFrame(wrap(fn)),
    class extends W.MutationObserver { constructor(cb) { super(wrap(cb)); } },
  ];
}
function speedReport() {
  const secs = Math.max(1, (performance.now() - COST_T0) / 1000);
  const rows = Object.keys(COST).map(id => ({ id, name: (WR.list.find(s => s.id === id) || {}).name || id, ...COST[id] }))
    .filter(r => r.n).sort((a, b) => b.ms - a.ms);
  const lines = rows.map(r => `${(r.ms / secs * 60 / 1000).toFixed(2)} s/min   ${r.name}   (${r.n} runs, longest ${Math.round(r.max)} ms)`);
  alert('Script speed report for this page\n(time each script kept the page busy, per minute; over ' + Math.round(secs) + ' s)\n\n' + (lines.join('\n') || 'no script work recorded yet') + '\n\nPlease send a screenshot of this.');
}

function start(s) {
  try { s.fn.apply(window, gmFor(s.id).concat(timedFns(s.id))); console.log(LOG, 'started', s.name, 'v' + s.version); }
  catch (e) { console.error(LOG, s.name + ' crashed:', e); }
}
function whenReady(cb) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', cb, { once: true });
  else cb();
}
if (allOff) {
  console.log(LOG, 'ALL scripts are turned OFF (Tampermonkey menu -> Turn ALL back on)');
} else {
  WR.list.forEach(s => {
    if (!onThisPage(s) || _get(offKey(s.id), false)) return;
    if (s.runAt === 'document-start') start(s);
    else whenReady(() => start(s));
  });
}

// ---- Tampermonkey menu (top window only, so iframes don't add copies) ----
if (window.top !== window) return;

function askReload(msg) {
  if (confirm(msg + '\n\nReload this page now so it takes effect?')) location.reload();
}
GM_registerMenuCommand(allOff ? '▶️ Turn ALL scripts back ON' : '⏹️ Turn ALL scripts OFF', () => {
  _set(ALL_OFF_KEY, !allOff);
  askReload(allOff ? 'All scripts are ON again.' : 'All scripts are now OFF.');
});
WR.list.forEach(s => {
  const off = _get(offKey(s.id), false);
  const label = (off ? '⛔ ' : '✅ ') + s.name + (onThisPage(s) ? '  ← this page' : '');
  GM_registerMenuCommand(label, () => {
    _set(offKey(s.id), !off);
    askReload(s.name + ' is now ' + (off ? 'ON' : 'OFF') + '.');
  });
});
GM_registerMenuCommand('📊 Script speed report (this page)', speedReport);
GM_registerMenuCommand('📥 Import saved data from an old script…', showImport);

// ---- Per-RO recorder: steps + speed, one log per RO (last 15 ROs kept) ----
// Steps = pages opened, buttons clicked, right-clicks, Alt/Ctrl shortcuts. Never what is typed.
// Speed = how long the page froze (browser long-frame timing) and which code caused it,
//         slow clicks/keys, time used by each of our scripts, RV Remote (BETA) self-timing.
// Menu: "📋 Speed + steps report (per RO)".
const REC_INDEX = '__rec_index', REC_KEY = ro => '__rec::' + ro, REC_CUR = '__rec_current';
const REC_MAX_RO = 15, REC_MAX_EV = 1500, REC_MAX_PERF = 300;
const recPage = () => {
  const h = location.hostname, p = location.pathname.replace(/\d{4,}/g, '#');
  const site = /tekion/.test(h) ? 'Tekion' : /reconvision/.test(h) ? 'RV' : /repairlink/.test(h) ? 'RepairLink'
    : /partstech/.test(h) ? 'PartsTech' : /usautoforce/.test(h) ? 'USAF' : /teams|microsoft/.test(h) ? 'Teams' : h;
  return site + ' ' + p;
};
// RO on this page: RV work order header / Tekion header leaf "RO#7xxxxxx"; elsewhere the RO being worked on
let recRoEl = null, recRoAt = 0, recRo = '';
function recPageRO() {
  if (recRoEl && recRoEl.isConnected) { const m = recRoEl.textContent.match(/(7\d{6})/); if (m) return m[1]; }
  if (Date.now() - recRoAt < 4000) return recRo;
  recRoAt = Date.now(); recRo = ''; recRoEl = null;
  const h = location.hostname;
  if (/reconvision/.test(h) && /\/work_orders\/\d+/.test(location.pathname)) {
    recRoEl = document.querySelector('.repair-order-number');
    const m = (recRoEl ? recRoEl.textContent : (document.body || {}).textContent || '').match(/RO#?\s*(7\d{6})/);
    if (m) recRo = m[1];
  } else if (/tekion/.test(h)) {
    for (const n of document.querySelectorAll('span,div,a,h1,h2,h3,p')) {
      if (n.childElementCount) continue;
      const m = (n.textContent || '').trim().match(/^RO\s*#?\s*(7\d{6})$/i);
      if (m) { recRoEl = n; recRo = m[1]; break; }
    }
  }
  return recRo;
}
function recRO() {
  const own = recPageRO();
  if (own) { const c = _get(REC_CUR, {}); if (c.ro !== own || Date.now() - c.t > 60000) _set(REC_CUR, { ro: own, t: Date.now() }); return own; }
  const c = _get(REC_CUR, null);
  return c && Date.now() - c.t < 45 * 60 * 1000 ? c.ro : 'no RO';
}
let recEv = [], recPerf = [];
const recNow = () => Date.now();
function recAdd(k, x) { recEv.push({ t: recNow(), ro: recRO(), pg: recPage(), k, x }); }
function recFlush() {
  if (!recEv.length && !recPerf.length) return;
  const byRo = {};
  recEv.forEach(e => { (byRo[e.ro] = byRo[e.ro] || { ev: [], perf: [] }).ev.push(e); });
  recPerf.forEach(p => { (byRo[p.ro] = byRo[p.ro] || { ev: [], perf: [] }).perf.push(p); });
  recEv = []; recPerf = [];
  let idx = _get(REC_INDEX, []);
  Object.keys(byRo).forEach(ro => {
    const d = _get(REC_KEY(ro), { ro, ev: [], perf: [] });
    d.ev = d.ev.concat(byRo[ro].ev).slice(-REC_MAX_EV);
    d.perf = d.perf.concat(byRo[ro].perf).slice(-REC_MAX_PERF);
    _set(REC_KEY(ro), d);
    const it = idx.find(i => i.ro === ro);
    const first = (d.ev[0] || d.perf[0] || {}).t || recNow();
    if (it) it.last = recNow(); else idx.push({ ro, first, last: recNow() });
  });
  idx.sort((a, b) => a.last - b.last);
  while (idx.length > REC_MAX_RO) { const old = idx.shift(); _del(REC_KEY(old.ro)); }
  _set(REC_INDEX, idx);
}
setInterval(recFlush, 15000);
addEventListener('pagehide', recFlush);
document.addEventListener('visibilitychange', () => { if (document.hidden) recFlush(); });

// steps
function recDescribe(el) {
  if (!el || !el.tagName) return '?';
  const t = el.closest('button, a, [role="button"], [role="tab"], [role="option"], [role="menuitem"], [role="row"], label, td, th, li') || el;
  const dt = t.getAttribute('data-test-id') || t.getAttribute('data-test') || t.id || '';
  const txt = (t.getAttribute('aria-label') || t.title || (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ? '' : t.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return t.tagName.toLowerCase() + (dt ? '[' + String(dt).slice(-45) + ']' : '') + (txt ? ' "' + txt + '"' : '');
}
document.addEventListener('click', e => { if (!e.target.closest || !e.target.closest('#wr-rec')) recAdd('click', recDescribe(e.target)); }, true);
document.addEventListener('contextmenu', e => recAdd('right-click' + (e.altKey ? ' (Alt)' : ''), recDescribe(e.target)), true);
document.addEventListener('keydown', e => {
  if (!(e.altKey || e.ctrlKey) || !e.key || e.key.length > 1 && !/^F\d/.test(e.key)) return;   // shortcuts only, never typing
  if (e.ctrlKey && /^[vcxa]$/i.test(e.key)) recAdd('key', 'Ctrl+' + e.key.toUpperCase());
  else recAdd('key', (e.ctrlKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + e.key.toUpperCase());
}, true);
let recHref = location.href;
setInterval(() => { if (location.href !== recHref) { recHref = location.href; recAdd('page', location.pathname.replace(/\d{4,}/g, '#')); } }, 1000);

// speed: one summary per minute
const recSnap = () => { const o = {}; Object.keys(COST).forEach(k => { o[k] = COST[k].ms; }); return o; };
const recBeta = () => { try { return JSON.parse(document.documentElement.getAttribute('data-rvr-speed') || '{}'); } catch (e) { return {}; } };
let recB = null;
function recNewBucket() { recB = { t: recNow(), frames: 0, frameMs: 0, blockMs: 0, worst: [], src: {}, slow: [], cost0: recSnap(), beta0: recBeta() }; }
recNewBucket();
function recSrc(sc) {
  const u = sc.sourceURL || '';
  if (!u) return 'unknown/extension' + (sc.invoker ? ' · ' + String(sc.invoker).slice(0, 40) : '');
  if (/userscript|tampermonkey|^chrome-extension|^moz-extension/i.test(u)) return 'Tampermonkey scripts (ours)';
  try { const x = new URL(u); return x.hostname + ' ' + (x.pathname.split('/').pop() || '').slice(0, 40); } catch (e) { return u.slice(0, 60); }
}
try {
  const types = PerformanceObserver.supportedEntryTypes || [];
  if (types.includes('long-animation-frame')) {
    new PerformanceObserver(list => list.getEntries().forEach(f => {
      recB.frames++; recB.frameMs += f.duration; recB.blockMs += f.blockingDuration || 0;
      const scripts = (f.scripts || []).map(sc => { const n = recSrc(sc); recB.src[n] = (recB.src[n] || 0) + sc.duration; return { n, ms: Math.round(sc.duration), inv: String(sc.invoker || '').slice(0, 50), fn: sc.sourceFunctionName || '' }; });
      recB.worst.push({ t: recNow(), ms: Math.round(f.duration), s: scripts.sort((a, b) => b.ms - a.ms).slice(0, 3) });
      recB.worst.sort((a, b) => b.ms - a.ms); recB.worst.length = Math.min(recB.worst.length, 4);
    })).observe({ type: 'long-animation-frame', buffered: false });
  } else if (types.includes('longtask')) {
    new PerformanceObserver(list => list.getEntries().forEach(f => {
      recB.frames++; recB.frameMs += f.duration; recB.blockMs += Math.max(0, f.duration - 50);
      recB.worst.push({ t: recNow(), ms: Math.round(f.duration), s: [] }); recB.worst.sort((a, b) => b.ms - a.ms); recB.worst.length = Math.min(recB.worst.length, 4);
    })).observe({ type: 'longtask', buffered: false });
  }
  if (types.includes('event')) {
    new PerformanceObserver(list => list.getEntries().forEach(ev => {
      if (!/^(click|dblclick|keydown|contextmenu)$/.test(ev.name)) return;   // real actions only, not hover
      recB.slow.push({ t: recNow(), ms: Math.round(ev.duration), what: ev.name + ' ' + recDescribe(ev.target) });
      recB.slow.sort((a, b) => b.ms - a.ms); recB.slow.length = Math.min(recB.slow.length, 5);
    })).observe({ type: 'event', durationThreshold: 104, buffered: false });
  }
} catch (e) { console.warn(LOG, 'speed recorder not available:', e); }
setInterval(() => {
  const b = recB, now = recSnap(), beta = recBeta(), ours = {}, betaD = {};
  Object.keys(now).forEach(k => { const d = now[k] - (b.cost0[k] || 0); if (d >= 1) ours[k] = Math.round(d); });
  Object.keys(beta).forEach(k => { const d = beta[k].ms - ((b.beta0[k] || {}).ms || 0); if (d >= 1) betaD[k] = Math.round(d); });
  if (!document.hidden || b.frames || Object.keys(ours).length) {
    const src = {}; Object.keys(b.src).forEach(k => { src[k] = Math.round(b.src[k]); });
    recPerf.push({ t: b.t, ro: recRO(), pg: recPage(), hid: document.hidden ? 1 : 0, frames: b.frames, frameMs: Math.round(b.frameMs), blockMs: Math.round(b.blockMs), src, worst: b.worst, slow: b.slow, ours, beta: betaD });
  }
  recNewBucket();
}, 60000);
recAdd('page', location.pathname.replace(/\d{4,}/g, '#'));

// ---- report ----
const recTime = t => new Date(t).toTimeString().slice(0, 8);
const scriptName = id => (WR.list.find(s => s.id === id) || {}).name || id;
function recReport(ro) {
  recFlush();
  const d = _get(REC_KEY(ro), null); if (!d) return 'No log for RO ' + ro;
  const ev = d.ev, pf = d.perf, out = [];
  const t0 = Math.min((ev[0] || {}).t || Infinity, (pf[0] || {}).t || Infinity), t1 = Math.max((ev[ev.length - 1] || {}).t || 0, (pf[pf.length - 1] || {}).t || 0);
  out.push('WALSER SPEED + STEPS REPORT · RO ' + ro + ' · ' + recTime(t0) + ' to ' + recTime(t1) + ' (' + Math.round((t1 - t0) / 60000) + ' min) · ' + new Date(t0).toDateString());
  out.push('', '== SPEED ==');
  const vis = pf.filter(p => !p.hid);
  const sum = (a, f) => a.reduce((x, p) => x + f(p), 0);
  const bySite = {}; pf.forEach(p => { const s = p.pg.split(' ')[0]; bySite[s] = (bySite[s] || 0) + 1; });
  out.push('Minutes recorded: ' + pf.length + ' (' + Object.keys(bySite).map(k => k + ' ' + bySite[k]).join(', ') + ')');
  const fms = sum(vis, p => p.frameMs), bms = sum(vis, p => p.blockMs), nf = sum(vis, p => p.frames);
  out.push('Page frozen (frames over 50 ms): ' + nf + ' frames, ' + (fms / 1000).toFixed(1) + ' s total, ' + (bms / 1000).toFixed(1) + ' s blocking = ' + (vis.length ? (bms / vis.length / 1000).toFixed(2) : '0') + ' s per minute');
  const src = {}; pf.forEach(p => Object.keys(p.src || {}).forEach(k => { src[k] = (src[k] || 0) + p.src[k]; }));
  const srcL = Object.keys(src).sort((a, b) => src[b] - src[a]).slice(0, 10);
  if (srcL.length) { out.push('Who caused the frozen time (script time inside those frames):'); srcL.forEach(k => out.push('  ' + (src[k] / 1000).toFixed(1).padStart(6) + ' s  ' + k)); }
  const ours = {}; pf.forEach(p => Object.keys(p.ours || {}).forEach(k => { ours[k] = (ours[k] || 0) + p.ours[k]; }));
  const oursL = Object.keys(ours).sort((a, b) => ours[b] - ours[a]).slice(0, 10);
  if (oursL.length) { out.push('Walser Recon Tools, time each script used (timers/observers):'); oursL.forEach(k => out.push('  ' + (ours[k] / 1000).toFixed(2).padStart(6) + ' s  ' + scriptName(k) + '  (' + (ours[k] / Math.max(1, pf.length) / 1000).toFixed(3) + ' s/min)')); }
  const beta = {}; pf.forEach(p => Object.keys(p.beta || {}).forEach(k => { beta[k] = (beta[k] || 0) + p.beta[k]; }));
  const betaL = Object.keys(beta).sort((a, b) => beta[b] - beta[a]);
  if (betaL.length) { out.push('RV Remote (BETA), time used:'); betaL.forEach(k => out.push('  ' + (beta[k] / 1000).toFixed(2).padStart(6) + ' s  ' + k)); }
  const worst = [].concat(...pf.map(p => (p.worst || []).map(w => Object.assign({ pg: p.pg }, w)))).sort((a, b) => b.ms - a.ms).slice(0, 8);
  if (worst.length) { out.push('Worst frozen moments:'); worst.forEach(w => out.push('  ' + recTime(w.t) + '  ' + w.ms + ' ms  ' + w.pg + (w.s.length ? '  <- ' + w.s.map(s => s.n + (s.fn ? ' ' + s.fn : '') + (s.inv ? ' [' + s.inv + ']' : '') + ' ' + s.ms + 'ms').join(' | ') : ''))); }
  const slow = [].concat(...pf.map(p => (p.slow || []).map(w => Object.assign({ pg: p.pg }, w)))).sort((a, b) => b.ms - a.ms).slice(0, 10);
  if (slow.length) { out.push('Slow clicks / keys (over 0.1 s until the screen updated):'); slow.forEach(w => out.push('  ' + recTime(w.t) + '  ' + w.ms + ' ms  ' + w.pg + '  ' + w.what)); }
  out.push('', '== STEPS (' + ev.length + ') ==');
  let lastPg = '';
  ev.slice(-400).forEach(e => { out.push(recTime(e.t) + '  ' + (e.pg !== lastPg ? e.pg + '  ' : '') + e.k + (e.x ? '  ' + e.x : '')); lastPg = e.pg; });
  return out.join('\n');
}
function recShow() {
  recFlush();
  document.querySelectorAll('#wr-rec').forEach(x => x.remove());
  const idx = _get(REC_INDEX, []).slice().reverse();
  if (!idx.length) { alert('Nothing recorded yet. Work an RO, then open this again.'); return; }
  const box = document.createElement('div'); box.id = 'wr-rec';
  box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font:14px Segoe UI,sans-serif';
  const cur = recRO();
  box.innerHTML = '<style>#wr-rec *{color:#000 !important;background:#fff;font-family:Segoe UI,sans-serif}#wr-rec button{border:1px solid #888;border-radius:4px;padding:6px 14px;cursor:pointer}#wr-rec #wr-rec-copy{background:#2563eb !important;color:#fff !important;border-color:#2563eb}</style>' +
    '<div style="background:#fff;padding:14px;border-radius:8px;width:min(900px,94vw)"><b>Speed + steps report</b> &nbsp; RO: <select id="wr-rec-ro"></select>' +
    '<p style="margin:6px 0;font-size:12px">Click Copy, then paste it in the chat with Claude.</p>' +
    '<textarea id="wr-rec-txt" readonly style="width:100%;height:55vh;font:12px Consolas,monospace;border:1px solid #888;white-space:pre"></textarea>' +
    '<div style="text-align:right;margin-top:8px"><button id="wr-rec-clear">Clear all logs</button> <button id="wr-rec-close">Close</button> <button id="wr-rec-copy" style="font-weight:bold">Copy</button></div></div>';
  document.body.appendChild(box);
  const sel = box.querySelector('#wr-rec-ro'), txt = box.querySelector('#wr-rec-txt');
  idx.forEach(i => sel.appendChild(new Option(i.ro + '  (' + recTime(i.first) + ' - ' + recTime(i.last) + ')', i.ro)));
  sel.value = idx.some(i => i.ro === cur) ? cur : idx[0].ro;
  const show = () => { txt.value = recReport(sel.value); };
  sel.onchange = show; show();
  box.querySelector('#wr-rec-close').onclick = () => box.remove();
  box.querySelector('#wr-rec-copy').onclick = () => {
    txt.select();
    const done = () => { box.querySelector('#wr-rec-copy').textContent = '✓ Copied'; };
    try { navigator.clipboard.writeText(txt.value).then(done, () => { document.execCommand('copy'); done(); }); } catch (e) { document.execCommand('copy'); done(); }
  };
  box.querySelector('#wr-rec-clear').onclick = () => {
    if (!confirm('Delete all speed + steps logs?')) return;
    _get(REC_INDEX, []).forEach(i => _del(REC_KEY(i.ro))); _set(REC_INDEX, []); box.remove();
  };
}
GM_registerMenuCommand('📋 Speed + steps report (per RO)', recShow);

// ---- One-time import of an old script's saved data ----
// Paste the contents of "<Script Name>.storage.json" from a Tampermonkey
// export zip (Dashboard -> Utilities -> Export). Also accepts a plain
// { "key": value } object.
function decodeTM(v) {
  if (typeof v !== 'string' || !v) return v;
  const t = v[0], rest = v.slice(1);
  if (t === 's') return rest;
  if (t === 'n') return Number(rest);
  if (t === 'b') return rest === 'true';
  if (t === 'o') { try { return JSON.parse(rest); } catch (e) { return rest; } }
  return v;
}
function showImport() {
  if (document.getElementById('wr-import')) return;
  const box = document.createElement('div');
  box.id = 'wr-import';
  box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.6);display:flex;' +
    'align-items:center;justify-content:center;font:14px Segoe UI,sans-serif';
  const opts = WR.list.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  box.innerHTML =
    '<style>#wr-import *{color:#000 !important;background:#fff;font-family:Segoe UI,sans-serif}' +
    '#wr-import button{border:1px solid #888;border-radius:4px;padding:6px 14px;cursor:pointer}' +
    '#wr-import #wr-imp-go{background:#16a34a !important;color:#fff !important;border-color:#16a34a}</style>' +
    '<div style="background:#fff;color:#000;padding:16px;border-radius:8px;width:min(600px,92vw)">' +
    '<b>Import saved data from an old script</b>' +
    '<p style="margin:8px 0">1. Pick the script. 2. Open its <i>.storage.json</i> file from the Tampermonkey export in Notepad, ' +
    'copy everything, paste below. 3. Click Import.</p>' +
    `<select id="wr-imp-id" style="width:100%;margin-bottom:8px">${opts}</select>` +
    '<textarea id="wr-imp-txt" style="width:100%;height:200px;font:12px monospace;border:1px solid #888" placeholder="Paste here"></textarea>' +
    '<div style="text-align:right;margin-top:8px"><button id="wr-imp-cancel">Cancel</button> ' +
    '<button id="wr-imp-go" style="font-weight:bold">Import</button></div></div>';
  document.body.appendChild(box);
  const sel = box.querySelector('#wr-imp-id');
  const pd = WR.list.find(s => s.id === 'parts_database');
  if (pd) sel.value = pd.id;
  box.querySelector('#wr-imp-cancel').onclick = () => box.remove();
  box.querySelector('#wr-imp-go').onclick = () => {
    let obj;
    try { obj = JSON.parse(box.querySelector('#wr-imp-txt').value); }
    catch (e) { alert('That is not valid JSON. Copy the whole .storage.json file and try again.'); return; }
    const data = obj && typeof obj.data === 'object' ? obj.data : obj;
    const keys = Object.keys(data || {}).filter(k => !/_(claimed|result)_\d+$/.test(k));
    if (!keys.length) { alert('Nothing to import.'); return; }
    const s = WR.list.find(x => x.id === sel.value);
    if (!confirm(`Import ${keys.length} saved values into "${s.name}"?\nExisting values with the same name will be replaced.`)) return;
    const set = gmFor(s.id)[1];
    keys.forEach(k => set(k, obj.data ? decodeTM(data[k]) : data[k]));
    box.remove();
    askReload(`Imported ${keys.length} values into ${s.name}.`);
  };
}
})();
