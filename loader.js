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
