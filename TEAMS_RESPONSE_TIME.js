// ==UserScript==
// @name         Teams Response Time
// @namespace    reconclipboard
// @version      1.0
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/TEAMS_RESPONSE_TIME.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/TEAMS_RESPONSE_TIME.js
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

let panel = null, curPeriod = 'all';
function openReport() {
  if (panel) panel.remove();
  panel = document.createElement('div');
  panel.id = 'wr-teams-rt';
  panel.style.cssText = 'position:fixed;inset:5% 5% auto 50%;transform:translateX(-50%);width:min(820px,92vw);max-height:88vh;overflow:auto;z-index:2147483647;background:#0f172a;color:#e5e7eb;border:1px solid #334155;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.6);font:13px Segoe UI,sans-serif;padding:16px';
  render();
  document.body.appendChild(panel);
}
function render() {
  const list = rows(curPeriod), techs = byTech(list);
  const totalResp = list.filter(m => m.respTs != null && m.postTs);
  const overallAvg = totalResp.length ? totalResp.reduce((a, m) => a + (m.respTs - m.postTs), 0) / totalResp.length : null;
  const tracked = trackedRoom();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pBtn = (id, label) => `<button data-p="${id}" style="padding:3px 10px;border-radius:6px;border:1px solid #334155;background:${curPeriod === id ? '#2563eb' : '#1e293b'};color:#fff;cursor:pointer">${label}</button>`;
  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
    <b style="font-size:16px">📊 Teams Response Time</b>
    <div><button id="rt-close" style="padding:3px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#fff;cursor:pointer">✕ Close</button></div></div>`;
  if (!tracked) {
    html += `<div style="background:#422006;border:1px solid #b45309;border-radius:8px;padding:10px;margin-bottom:8px">No room is being tracked yet. Open the room you want to measure, then use the Tampermonkey menu → <b>📍 Track THIS Teams room</b>. Only that room is recorded.</div>`;
  } else {
    html += `<div style="opacity:.8;margin-bottom:8px">Tracking room: <b>${esc(tracked)}</b>  ·  <span>${pBtn('today', 'Today')} ${pBtn('7d', '7 days')} ${pBtn('all', 'All')}</span></div>`;
    html += `<div style="background:#111827;border:1px solid #334155;border-radius:8px;padding:10px;margin-bottom:10px">
      <b>${list.length}</b> messages · <b>${totalResp.length}</b> responded · overall average response <b style="color:#4ade80">${fmtDur(overallAvg)}</b></div>`;
    html += `<table style="width:100%;border-collapse:collapse"><tr style="text-align:left;border-bottom:1px solid #334155">
      <th style="padding:5px">Technician</th><th style="padding:5px">Messages</th><th style="padding:5px">Responded</th><th style="padding:5px">Avg response</th><th></th></tr>`;
    techs.forEach((t, i) => {
      html += `<tr data-tech="${i}" style="border-bottom:1px solid #1f2937;cursor:pointer">
        <td style="padding:5px">${esc(t.author) || '(no name)'}</td><td style="padding:5px">${t.total}</td>
        <td style="padding:5px">${t.responded}${t.total - t.responded ? ` <span style="opacity:.5">(+${t.total - t.responded} no resp)</span>` : ''}</td>
        <td style="padding:5px;color:#4ade80;font-weight:700">${fmtDur(t.avg)}</td>
        <td style="padding:5px;opacity:.6">details ▸</td></tr>
        <tr data-detail="${i}" style="display:none"><td colspan="5" style="padding:0 5px 8px"></td></tr>`;
    });
    html += `</table>`;
    if (!techs.length) html += `<div style="opacity:.7;padding:10px">Nothing recorded for this period yet. Leave the room open; new messages and the reactions you add are captured as they happen.</div>`;
  }
  html += `<div style="margin-top:12px;display:flex;gap:8px"><button id="rt-copy" style="padding:4px 12px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#fff;cursor:pointer">Copy summary</button>
    <button id="rt-clear" style="padding:4px 12px;border-radius:6px;border:1px solid #7f1d1d;background:#3b0d0d;color:#fff;cursor:pointer">Clear all data</button></div>`;
  panel.innerHTML = html;

  panel.querySelector('#rt-close').onclick = () => { panel.remove(); panel = null; };
  panel.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { curPeriod = b.getAttribute('data-p'); render(); });
  panel.querySelectorAll('[data-tech]').forEach(r => r.onclick = () => {
    const i = r.getAttribute('data-tech'), det = panel.querySelector(`[data-detail="${i}"]`);
    if (det.style.display === 'none') {
      const t = techs[i], cell = det.firstElementChild;
      cell.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:12px;background:#0b1220;border-radius:6px">' +
        t.msgs.slice().sort((a, b) => b.postTs - a.postTs).map(m => `<tr style="border-bottom:1px solid #1f2937">
          <td style="padding:4px 6px;max-width:360px">${esc(m.text).slice(0, 90)}</td>
          <td style="padding:4px 6px;white-space:nowrap">${fmtTime(m.postTs)}</td>
          <td style="padding:4px 6px;white-space:nowrap;color:${m.respTs ? '#4ade80' : '#f59e0b'}">${m.respTs ? fmtDur(m.respTs - m.postTs) + (m.respKind === 'clock' ? ' 🕐' : ' 👍') : (m.preReacted ? 'before tracking' : 'no response')}</td>
        </tr>`).join('') + '</table>';
      det.style.display = '';
    } else det.style.display = 'none';
  });
  panel.querySelector('#rt-copy').onclick = () => {
    const lines = ['Teams Response Time — ' + (trackedRoom() || '') + ' — ' + curPeriod,
      'Overall: ' + list.length + ' messages, ' + totalResp.length + ' responded, avg ' + fmtDur(overallAvg), ''];
    techs.forEach(t => lines.push(t.author + ' — ' + t.total + ' msgs, ' + t.responded + ' responded, avg ' + fmtDur(t.avg)));
    navigator.clipboard.writeText(lines.join('\n')).then(() => { panel.querySelector('#rt-copy').textContent = 'Copied ✓'; }, () => {});
  };
  panel.querySelector('#rt-clear').onclick = () => {
    if (confirm('Clear ALL recorded Teams response-time data? This cannot be undone.')) { msgs = {}; save(K_MSGS, msgs); render(); }
  };
}

GM_registerMenuCommand('📊 Teams response time report', openReport);
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
