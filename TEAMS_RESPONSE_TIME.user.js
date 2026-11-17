// ==UserScript==
// @name         Teams Response Time
// @namespace    reconclipboard
// @version      1.1
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/TEAMS_RESPONSE_TIME.user.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/TEAMS_RESPONSE_TIME.user.js
// @description  Watches ONE Teams room (you pick it) and measures how fast the team responds to each message -- a response = the first clock or thumbs-up reaction landing on it. Menu report: average response time per technician (who asked), with a click-through to each message and its own response time. Keep the room open in a tab; reactions are timed as the tab sees them happen.
// @match        https://teams.microsoft.com/*
// @match        https://teams.cloud.microsoft/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

const LOG = '[Teams RT]';
const K_MSGS = 'teams_rt_msgs';     // { id: {author, room, text, postTs, firstSeen, respTs, respKind, preReacted} }
const K_ROOM = 'teams_rt_room';     // the one room name we track

function load(k, d) { try { const v = GM_getValue(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function save(k, v) { GM_setValue(k, JSON.stringify(v)); }

let msgs = load(K_MSGS, {}); if (!msgs || typeof msgs !== 'object') msgs = {};
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
function postTsOf(item) { const t = item.querySelector('time[datetime]'); const d = t && t.getAttribute('datetime'); const ms = d ? Date.parse(d) : NaN; return isFinite(ms) ? ms : null; }
function textOf(item) {
  const h = item.querySelector('[role="heading"]');
  let t = (h ? h.textContent : item.textContent) || '';
  return t.replace(/\s+/g, ' ').trim().slice(0, 240);
}
// clock = itemid "23f2_timerclock", thumbs/like = itemid "yes"
function reactionsOf(item) {
  let clock = false, thumb = false;
  item.querySelectorAll('button[data-tid="diverse-reaction-pill-button"] img[itemid]').forEach(img => {
    const k = img.getAttribute('itemid');
    if (k === '23f2_timerclock') clock = true;
    if (k === 'yes') thumb = true;
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
    let rec = msgs[id];
    if (!rec) {
      rec = { author: authorOf(item), room, text: textOf(item), postTs: postTsOf(item),
              firstSeen: Date.now(), respTs: null, respKind: null, preReacted: !!(r.clock || r.thumb) };
      msgs[id] = rec; dirty = true;
    }
    // a response = the first clock/thumbs we WATCH land (one we did not already see on this message at first sight)
    if (rec.respTs == null && !rec.preReacted && (r.clock || r.thumb)) {
      rec.respTs = Date.now(); rec.respKind = r.clock ? 'clock' : 'thumb'; dirty = true;
    }
  });
  if (dirty) { save(K_MSGS, msgs); dirty = false; }
}
setInterval(scan, 2500);
setTimeout(scan, 1500);

// ---- report ----
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
    if (m.respTs != null && m.postTs) { t.responded++; t.sum += (m.respTs - m.postTs); }
  });
  return Object.values(map).map(t => ({ ...t, avg: t.responded ? t.sum / t.responded : null }))
    .sort((a, b) => b.total - a.total);
}

function esc(x){return String(x==null?'':x).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function overallAvg(list){const r=list.filter(m=>m.respTs!=null&&m.postTs);return r.length?r.reduce((a,m)=>a+(m.respTs-m.postTs),0)/r.length:null;}

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
      const rt=m.respTs?esc(fmtDur(m.respTs-m.postTs))+(m.respKind==='clock'?' \u{1F550}':' \u{1F44D}'):(m.preReacted?'<span class=dim>before tracking</span>':'<span class=no>no response</span>');
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

console.log(LOG, 'v1.0 loaded; tracking room:', trackedRoom() || '(none set)');
})();
