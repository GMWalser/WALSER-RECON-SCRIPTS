// ==UserScript==
// @name         Teams Response Time
// @namespace    reconclipboard
// @version      1.8
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/TEAMS_RESPONSE_TIME.user.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/TEAMS_RESPONSE_TIME.user.js
// @description  Watches ONE Teams room (you pick it) and measures how fast the team responds to each message -- a response = the first clock or thumbs-up reaction landing on it. Menu report: average response time per technician (who asked), with a click-through to each message and its own response time. Keep the room open in a tab (works minimized); reactions are timed as they land.
// @match        https://teams.microsoft.com/*
// @match        https://teams.cloud.microsoft/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

// ---- keep Teams live while the tab is minimized ----
// Teams slows/pauses updating a room when it thinks the tab is hidden, so a minimized tab often
// shows a message and its reaction TOGETHER when it finally catches up -- we never see the gap, so
// it reads as "reacted (time n/a)". Report that the page is always visible so Teams keeps rendering
// new messages and reactions in real time; the DOM watcher below then times them.
// (A deeply-minimized tab can still lag up to ~a minute because the browser itself slows background
//  timers. For exact times, leave the Teams window visible on screen.)
(function keepLive() {
  try {
    const no = () => false, vis = () => 'visible';
    [['hidden', no], ['webkitHidden', no], ['msHidden', no],
     ['visibilityState', vis], ['webkitVisibilityState', vis], ['msVisibilityState', vis]
    ].forEach(([k, g]) => { try { Object.defineProperty(document, k, { configurable: true, get: g }); } catch (e) {} });
    const swallow = e => { try { e.stopImmediatePropagation(); } catch (x) {} };
    ['visibilitychange', 'webkitvisibilitychange', 'msvisibilitychange'].forEach(ev => {
      try { document.addEventListener(ev, swallow, true); } catch (e) {}
    });
  } catch (e) {}
})();

const LOG = '[Teams RT]';
const K_MSGS = 'teams_rt_msgs';     // { id: {author, room, text, postTs, firstSeen, respTs, respKind, preReacted} }
const K_ROOM = 'teams_rt_room';     // the one room name we track

function load(k, d) { try { const v = GM_getValue(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function save(k, v) { GM_setValue(k, JSON.stringify(v)); }

let msgs = load(K_MSGS, {}); if (!msgs || typeof msgs !== 'object') msgs = {};
// v1.2 migration: the message id is the exact post time; recompute postTs from it so old records that parsed a
// timezone-less datetime (which read as a FUTURE time -> negative, blank "response") are corrected.
(function () { let ch = false; Object.keys(msgs).forEach(id => { const n = Number(id); if (/^\d{12,14}$/.test(id) && n >= 15e11 && n <= Date.now() + 864e5 && msgs[id].postTs !== n) { msgs[id].postTs = n; ch = true; } }); if (ch) save(K_MSGS, msgs); })();
let dirty = false;

// ---- Teams DOM (confirmed from real markup) ----
function roomName() { const h = document.querySelector('h2[data-tid="channelTitle-text"]'); return h ? h.textContent.trim() : ''; }
function trackedRoom() { return load(K_ROOM, ''); }
function items() { return document.querySelectorAll('div[data-tid="chat-pane-item"]'); }
function idOf(item) {
  const t = item.querySelector('time[id^="timestamp-"]');
  if (t && t.id) return t.id.replace('timestamp-', '');
  const a = item.querySelector('[data-tid="message-author-name"][id^="author-"]');
  return a && a.id ? a.id.replace('author-', '') : '';
}
function authorOf(item) { const a = item.querySelector('[data-tid="message-author-name"]'); return a ? a.textContent.trim() : ''; }
function idEpoch(id) { const n = Number(id); return (/^\d{12,14}$/.test(id) && n >= 15e11 && n <= Date.now() + 864e5) ? n : null; }  // Teams ids ARE the post time in ms
function postTsOf(item, id) {
  const fromId = idEpoch(id); if (fromId) return fromId;               // id is exact epoch ms -- timezone-proof
  const t = item.querySelector('time[datetime]'); const d = t && t.getAttribute('datetime'); const ms = d ? Date.parse(d) : NaN;
  return isFinite(ms) ? ms : null;
}
function textOf(item) {
  const h = item.querySelector('[role="heading"]');
  let t = (h ? h.textContent : item.textContent) || '';
  return t.replace(/\s+/g, ' ').trim().slice(0, 240);
}
// A response is a clock reaction (started) or a thumbs-up (done). Teams gives each reaction
// a different id/image, and the clock the techs use is NOT always "23f2_timerclock" -- any
// clock emoji counts. So match on the id, the label (alt/title/aria-label), AND the actual
// emoji character, for both the clock family and the thumbs-up.
const CLOCK_CHARS = /[⌚⌛⏰-⏳\u{1F550}-\u{1F567}\u{1F570}]/u; // watch, alarm, hourglass, all clock faces, mantel clock
const THUMB_CHARS = /\u{1F44D}/u;                                               // thumbs up
function reactionsOf(item) {
  let clock = false, thumb = false;
  item.querySelectorAll('button[data-tid="diverse-reaction-pill-button"]').forEach(btn => {
    const img = btn.querySelector('img');
    const id = ((img && img.getAttribute('itemid')) || '').toLowerCase();
    const label = (((img && (img.getAttribute('alt') || img.getAttribute('title'))) || '')
      + ' ' + (btn.getAttribute('title') || '') + ' ' + (btn.getAttribute('aria-label') || '')).toLowerCase();
    const glyph = ((img && (img.getAttribute('alt') || img.getAttribute('title'))) || btn.textContent || '');
    if (/clock|timer|watch|alarm/.test(id) || /clock|timer|watch|alarm/.test(label) || CLOCK_CHARS.test(glyph)) clock = true;
    if (id === 'yes' || /thumb|\blike\b|thumbsup/.test(id) || /thumb|\blike\b|thumbsup/.test(label) || THUMB_CHARS.test(glyph)) thumb = true;
  });
  return { clock, thumb };
}

// ---- capture ----
function scan() {
  const room = roomName(), tracked = trackedRoom();
  if (!tracked || room !== tracked) return;         // only the one room you picked
  items().forEach(item => {
    const id = idOf(item); if (!id) return;
    const r = reactionsOf(item);
    const anyR = r.clock || r.thumb;
    let rec = msgs[id];
    if (!rec) {
      rec = { author: authorOf(item), room, text: textOf(item), postTs: null,
              firstSeen: Date.now(), respTs: null, respKind: null,
              preReacted: !!anyR, reacted: !!anyR, observedBare: !anyR };
      rec.postTs = postTsOf(item, id);
      msgs[id] = rec; dirty = true;
    }
    if (!anyR && !rec.observedBare) { rec.observedBare = true; dirty = true; }   // we have seen it with NO reaction
    if (anyR && !rec.reacted) { rec.reacted = true; dirty = true; }              // a reaction exists (even if we can't time it)
    // Real time only when we WITNESSED the response on a message we caught LIVE -- first seen within a
    // few minutes of when it was actually posted. This stops Teams redrawing an OLD message (its text
    // paints first, then its reactions a beat later) from looking like a brand-new response, which was
    // producing bogus ~20h times for yesterday's messages.
    const caughtLive = rec.postTs && rec.firstSeen && Math.abs(rec.firstSeen - rec.postTs) < 300000;
    if (rec.respTs == null && rec.observedBare && anyR && caughtLive) {
      rec.respTs = Date.now(); rec.respKind = r.clock ? 'clock' : 'thumb'; dirty = true;
    }
  });
  if (dirty) { save(K_MSGS, msgs); dirty = false; }
}
// Capture that keeps working when the tab is MINIMIZED.
// Minimized/background tabs slow down timers (setInterval/setTimeout), so a timer-only
// scan can miss when a reaction actually appeared. A MutationObserver fires the instant
// Teams changes the page -- it is NOT slowed by background-tab throttling -- so we run the
// scan right then, stamping the reaction when it really shows up. We gate with Date.now()
// (not a timer) so bursts of DOM changes don't cause more than one scan per 300ms.
// The interval stays as a fallback in case Teams renders without a mutation we catch.
var lastScan = 0;
function maybeScan() {
  var t = Date.now();
  if (t - lastScan < 300) return;
  lastScan = t;
  try { scan(); } catch (e) {}
}
try {
  var mo = new MutationObserver(maybeScan);
  mo.observe(document.body, { childList: true, subtree: true });
} catch (e) {}
setInterval(maybeScan, 2500);
setTimeout(maybeScan, 1500);

// ---- report ----
// Response time = when we SAW the reaction minus when we FIRST SAW the message (one clock, so sender/receiver
// clock skew can't make it negative). We only trust this for a message caught LIVE: first seen within 5 min of
// its real post time (the message id). A message loaded from history (first seen long after it was posted) is
// NOT timed -- the "reaction landing" we saw there is just Teams redrawing it, which produced bogus ~20h times.
// We only trust a message caught LIVE: first seen within 5 min of its real post time (the id).
// - EXACT: we watched the message sit with no reaction, then the clock/thumbs land -> respTs-firstSeen
//   (one clock, no skew). Shown as a plain time.
// - ESTIMATE: the reaction was already there the first time we saw the message (Teams batched the draw
//   -- common when its window isn't the focused one). We can't see the exact gap, so we use post time ->
//   first-seen as an upper bound. Shown with a leading ~. Capped by the 5-min live window so it can
//   never blow up to hours.
function responseMs(m) {
  if (!m.postTs || !m.firstSeen) return null;
  if (Math.abs(m.firstSeen - m.postTs) >= 300000) return null;   // not caught live -> can't be timed
  if (m.respTs != null) { const d = m.respTs - m.firstSeen; return d >= 0 ? d : 0; }  // exact
  if (m.reacted) { const d = m.firstSeen - m.postTs; return d >= 0 ? d : 0; }         // estimate
  return null;
}
function isEstimate(m) {
  return m.respTs == null && m.reacted && m.postTs && m.firstSeen && Math.abs(m.firstSeen - m.postTs) < 300000;
}
function fmtDur(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return m + 'm ' + String(r).padStart(2, '0') + 's';
  const h = Math.floor(m / 60); return h + 'h ' + String(m % 60).padStart(2, '0') + 'm';
}
function fmtTime(ms) { if (!ms) return '—'; const d = new Date(ms); return d.toLocaleDateString([], { month: 'numeric', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }

function rows(period) {
  const now = Date.now(), cut = period === 'today' ? new Date().setHours(0, 0, 0, 0) : period === '7d' ? now - 7 * 864e5 : 0;
  const out = [];
  Object.keys(msgs).forEach(id => {
    const m = msgs[id];
    if (!m.postTs || m.postTs < cut) return;
    out.push(m);
  });
  return out;
}
function byTech(list) {
  const map = {};
  list.forEach(m => {
    const t = map[m.author] || (map[m.author] = { author: m.author, total: 0, responded: 0, sum: 0, msgs: [] });
    t.total++; t.msgs.push(m);
    const d = responseMs(m); if (d != null) { t.responded++; t.sum += d; }
  });
  return Object.values(map).map(t => ({ ...t, avg: t.responded ? t.sum / t.responded : null }))
    .sort((a, b) => b.total - a.total);
}

function esc(x){return String(x==null?'':x).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function overallAvg(list){const d=list.map(responseMs).filter(x=>x!=null);return d.length?d.reduce((a,x)=>a+x,0)/d.length:null;}

// The report is a DOWNLOADED standalone HTML file. We build a string and download it -- nothing is injected into
// Teams' page, so Teams' Trusted-Types security policy (which blocks innerHTML on the page) does not apply.
function buildReportHtml(){
  const room=trackedRoom()||'(no room set)', now=new Date();
  const all=rows('all'), techs=byTech(all);
  const respAll=all.filter(m=>m.respTs!=null&&m.postTs).length;
  const avgAll=fmtDur(overallAvg(all)), avg7=fmtDur(overallAvg(rows('7d'))), avgToday=fmtDur(overallAvg(rows('today')));
  const rowsHtml=techs.map(t=>`<tr><td>${esc(t.author)||'(no name)'}</td><td class=n>${t.total}</td><td class=n>${t.responded}</td><td class=n>${esc(fmtDur(t.avg))}</td></tr>`).join('')
    ||'<tr><td colspan=4 class=dim>Nothing recorded yet.</td></tr>';
  const detail=techs.map(t=>{
    const items=t.msgs.slice().sort((a,b)=>(b.postTs||0)-(a.postTs||0)).map(m=>{
      const d=responseMs(m); const est=isEstimate(m); const icon=m.respKind==='clock'?' \u{1F550}':m.respKind==='thumb'?' \u{1F44D}':'';
      const rt=d!=null?(est?'~':'')+esc(fmtDur(d))+icon:(m.preReacted?'<span class=dim>before tracking</span>':'<span class=no>no response</span>');
      return `<tr><td>${esc(m.text).slice(0,120)}</td><td class=t>${esc(fmtTime(m.postTs))}</td><td class=t>${rt}</td></tr>`;
    }).join('');
    return `<details><summary><b>${esc(t.author)||'(no name)'}</b> — ${t.total} messages, ${t.responded} responded, avg ${esc(fmtDur(t.avg))}</summary>`
      +`<table class=sub><tr><th>Message</th><th>Asked</th><th>Response</th></tr>${items}</table></details>`;
  }).join('')||'<p class=dim>Nothing recorded yet. Keep the room open so new messages and reactions are captured.</p>';
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">`
    +`<title>Teams Response Time — ${esc(room)}</title><style>`
    +`body{font:15px/1.5 "Segoe UI",Arial,sans-serif;color:#1f2937;background:#f8fafc;margin:0;padding:28px}`
    +`h1{margin:0 0 4px;font-size:24px}h2{margin:22px 0 8px;font-size:17px}.meta{color:#64748b;margin:0 0 18px}`
    +`.cards{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px}.card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;min-width:130px}`
    +`.card .big{font-size:22px;font-weight:700;color:#16a34a}.card .lbl{color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.04em}`
    +`table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden}`
    +`th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #eef2f7}th{background:#f1f5f9;font-size:13px}td.n{text-align:right;font-variant-numeric:tabular-nums}td.t{white-space:nowrap;color:#475569;font-size:13px}`
    +`details{background:#fff;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:8px;padding:6px 12px}summary{cursor:pointer;padding:6px 0}`
    +`table.sub{margin:6px 0 10px}table.sub th{background:#f8fafc}.dim{color:#94a3b8}.no{color:#d97706}`
    +`@media print{body{padding:0}details{break-inside:avoid}}`
    +`</style></head><body><h1>Teams Response Time</h1>`
    +`<p class=meta>Room: <b>${esc(room)}</b> · Generated ${esc(now.toLocaleString())}</p>`
    +`<p class=meta style="margin-top:-12px">A plain time was watched exactly. A <b>~</b> time is approximate (post time &rarr; when the tab first saw it) &mdash; used when the Teams window isn't focused and draws the message and its reaction together.</p>`
    +`<div class=cards><div class=card><div class=lbl>Avg response (all)</div><div class=big>${esc(avgAll)}</div></div>`
    +`<div class=card><div class=lbl>Last 7 days</div><div class=big>${esc(avg7)}</div></div>`
    +`<div class=card><div class=lbl>Today</div><div class=big>${esc(avgToday)}</div></div>`
    +`<div class=card><div class=lbl>Messages</div><div class=big style="color:#1f2937">${all.length}</div></div>`
    +`<div class=card><div class=lbl>Responded</div><div class=big style="color:#1f2937">${respAll}</div></div></div>`
    +`<h2>By technician (all time)</h2><table><tr><th>Technician</th><th class=n>Messages</th><th class=n>Responded</th><th class=n>Avg response</th></tr>${rowsHtml}</table>`
    +`<h2>Breakdown</h2>${detail}</body></html>`;
}
function toast(txt){
  const d=document.createElement('div');
  d.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;background:#16a34a;color:#fff;font:600 14px "Segoe UI",sans-serif;padding:10px 18px;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.4)';
  d.textContent=txt; document.body.appendChild(d); setTimeout(()=>d.remove(),4500);
}
function downloadReport(){
  try{
    const html=buildReportHtml(), blob=new Blob([html],{type:'text/html'}), url=URL.createObjectURL(blob);
    const a=document.createElement('a'), d=new Date(), p=n=>String(n).padStart(2,'0');
    a.href=url; a.download='teams-response-time-'+d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'.html';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),10000);
    toast('\u{1F4E5} Report downloaded — open the HTML file to view it.');
  }catch(e){ console.error(LOG,'download failed',e); alert('Could not build the report: '+(e&&e.message||e)); }
}
GM_registerMenuCommand('📥 Download response-time report (HTML)', downloadReport);
GM_registerMenuCommand('📍 Track THIS Teams room (' + (trackedRoom() || 'none set') + ')', () => {
  const r = roomName();
  if (!r) { alert('Open a Teams room first (the channel title must be visible), then run this again.'); return; }
  save(K_ROOM, r);
  alert('Now tracking response times in: ' + r + '\n\nKeep this room open in a tab. New messages and the clock/thumbs reactions you add will be timed.');
});
GM_registerMenuCommand('🗑 Clear Teams response-time data', () => {
  if (confirm('Clear ALL recorded Teams response-time data?')) { msgs = {}; save(K_MSGS, msgs); }
});

console.log(LOG, 'v1.8 loaded; tracking room:', trackedRoom() || '(none set)');
})();
