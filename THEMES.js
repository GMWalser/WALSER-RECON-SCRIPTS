// ==UserScript==
// @name         Page Themes
// @namespace    reconclipboard
// @version      1.2
// @author       Gabe
// @description  Dark themes / skins for RV, Tekion, PartsTech and the parts sites. Pick a suggested theme or make your own, click any element to recolor it, add custom CSS, share themes with a code. Tampermonkey menu -> Themes & colors.
// @match        https://*.reconvision.com/*
// @match        https://app.tekioncloud.com/*
// @match        https://app.partstech.com/*
// @match        https://shop.usautoforce.com/*
// @match        https://repairlinkshop.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// ==/UserScript==

(function () {
'use strict';

// ---------------------------------------------------------------------------
// HOW IT WORKS (simple version)
// - Settings live in THIS browser only, per website. Default = Off.
// - When a theme is on, the page is scanned once (and new parts as they
//   appear). Light backgrounds, dark text and light borders are tagged with a
//   data-wr-* attribute. One stylesheet colors those tags from the theme's
//   colors. Colored things (status chips, red/green buttons) are left alone so
//   they keep their meaning; pale highlights become a dark version of the
//   same color.
// - Picked-element colors and custom CSS come last, so they win.
// ---------------------------------------------------------------------------

const PRESETS = {
  midnight: { name: 'Midnight Blue',  bg: '#0f172a', surface: '#1e293b', text: '#e2e8f0', accent: '#3b82f6', accentText: '#ffffff', link: '#60a5fa', border: '#334155', input: '#0b1222' },
  dim:      { name: 'Soft Dim',       bg: '#22272e', surface: '#2d333b', text: '#c9d1d9', accent: '#539bf5', accentText: '#ffffff', link: '#6cb6ff', border: '#444c56', input: '#1c2128' },
  graphite: { name: 'Graphite Green', bg: '#121212', surface: '#1e1e1e', text: '#e6e6e6', accent: '#22c55e', accentText: '#04130a', link: '#4ade80', border: '#333333', input: '#181818' },
  ember:    { name: 'Ember Orange',   bg: '#1a1210', surface: '#261a16', text: '#f3e9e4', accent: '#f97316', accentText: '#1a0d05', link: '#fb923c', border: '#3d2a22', input: '#1f1512' },
  purple:   { name: 'Purple Night',   bg: '#151223', surface: '#211c33', text: '#e9e5f5', accent: '#a855f7', accentText: '#ffffff', link: '#c084fc', border: '#352d4f', input: '#1a1629' },
  contrast: { name: 'High Contrast',  bg: '#000000', surface: '#0a0a0a', text: '#ffffff', accent: '#facc15', accentText: '#000000', link: '#ffff00', border: '#777777', input: '#000000' },
};
// Built-in wallpapers: pure CSS (no image files), so no site can block them.
const WALLPAPERS = {
  aurora:    { name: 'Aurora',         css: 'radial-gradient(ellipse at 20% 20%,#0ea5e9 0%,transparent 45%),radial-gradient(ellipse at 80% 30%,#a855f7 0%,transparent 45%),radial-gradient(ellipse at 50% 90%,#22c55e 0%,transparent 50%),linear-gradient(#020617,#020617)' },
  sunset:    { name: 'Sunset',         css: 'linear-gradient(160deg,#1e1b4b 0%,#7c2d12 55%,#f97316 100%)' },
  ocean:     { name: 'Deep Ocean',     css: 'linear-gradient(180deg,#020617 0%,#0c4a6e 60%,#0e7490 100%)' },
  carbon:    { name: 'Carbon Fiber',   css: 'repeating-linear-gradient(45deg,#111 0 6px,#1c1c1c 6px 12px),linear-gradient(#111,#111)' },
  blueprint: { name: 'Blueprint Grid', css: 'repeating-linear-gradient(0deg,rgba(96,165,250,.18) 0 1px,transparent 1px 40px),repeating-linear-gradient(90deg,rgba(96,165,250,.18) 0 1px,transparent 1px 40px),linear-gradient(#0b2545,#0b2545)' },
  ember:     { name: 'Embers',         css: 'radial-gradient(circle at 30% 70%,#b91c1c 0%,transparent 40%),radial-gradient(circle at 75% 25%,#ea580c 0%,transparent 35%),linear-gradient(#0c0a09,#0c0a09)' },
  synthgrid: { name: "Synthwave Grid", css: "repeating-linear-gradient(90deg,rgba(45,226,230,.22) 0 1px,transparent 1px 60px),repeating-linear-gradient(0deg,rgba(255,42,157,.22) 0 1px,transparent 1px 60px),linear-gradient(180deg,#2b0f54 0%,#ab1f65 60%,#ff7b00 100%)" },
  neon: { name: "Neon Glow", css: "radial-gradient(circle at 15% 85%,rgba(255,0,200,.55),transparent 40%),radial-gradient(circle at 85% 15%,rgba(0,240,255,.5),transparent 40%),linear-gradient(135deg,#0d0221,#1b0f3a)" },
  lagoon: { name: "Lagoon", css: "radial-gradient(ellipse at 70% 20%,rgba(79,227,208,.45),transparent 50%),radial-gradient(ellipse at 20% 90%,rgba(255,111,89,.35),transparent 45%),linear-gradient(#04262b,#04262b)" },
  autumn: { name: "Autumn Leaves", css: "radial-gradient(circle at 80% 20%,rgba(232,163,61,.45),transparent 40%),radial-gradient(circle at 20% 80%,rgba(212,225,87,.25),transparent 40%),linear-gradient(160deg,#2a1406 0%,#5c2a0e 55%,#8a4a12 100%)" },
  golddust: { name: "Gold Dust", css: "radial-gradient(circle at 50% 0%,rgba(212,175,55,.40),transparent 55%),repeating-radial-gradient(circle at 30% 40%,rgba(212,175,55,.12) 0 2px,transparent 2px 28px),linear-gradient(#0a0f2c,#0a0f2c)" },
  amethyst: { name: "Amethyst", css: "radial-gradient(circle at 30% 30%,rgba(168,85,247,.50),transparent 45%),radial-gradient(circle at 75% 75%,rgba(251,191,36,.30),transparent 40%),linear-gradient(#160f24,#160f24)" },
  matrix: { name: "Matrix Rain", css: "repeating-linear-gradient(90deg,rgba(0,255,102,.10) 0 2px,transparent 2px 18px),repeating-linear-gradient(0deg,rgba(0,255,102,.05) 0 1px,transparent 1px 6px),linear-gradient(180deg,#000a00,#002b0d)" },
  sakura: { name: "Sakura", css: "radial-gradient(circle at 80% 20%,rgba(255,143,199,.45),transparent 40%),radial-gradient(circle at 20% 80%,rgba(126,232,200,.30),transparent 40%),linear-gradient(#1f0f1a,#1f0f1a)" },
  teal: { name: "Teal Depths", css: "radial-gradient(ellipse at 50% 0%,rgba(20,184,166,.40),transparent 60%),linear-gradient(180deg,#031c1c,#052e2e)" },
};
// Color-theory themes (each comes with a matching wallpaper; set Wallpaper to None to turn it off).
// Every one passes readability checks: text 7:1+, buttons and links 4.5:1+.
const COLOR_THEORY = {
  synthwave: { name: "Synthwave \u00b7 split-complementary", bg: '#1a0b2e', surface: '#261447', text: '#f5e9ff', accent: '#ff2a9d', accentText: '#1a0b2e', link: '#2de2e6', border: '#4b2a7a', input: '#140824', wp: WALLPAPERS.synthgrid.css, wpDim: 35, wpSee: 30 },
  cyberpunk: { name: "Cyberpunk Neon \u00b7 complementary", bg: '#0d0221', surface: '#1b0f3a', text: '#f0f0ff', accent: '#f9f002', accentText: '#0d0221', link: '#00f0ff', border: '#3c2a6e', input: '#090118', wp: WALLPAPERS.neon.css, wpDim: 35, wpSee: 30 },
  lagoon: { name: "Tropical Lagoon \u00b7 complementary", bg: '#04262b', surface: '#0a3a40', text: '#e6fffb', accent: '#ff6f59', accentText: '#2a0a05', link: '#4fe3d0', border: '#16606a', input: '#032026', wp: WALLPAPERS.lagoon.css, wpDim: 35, wpSee: 30 },
  autumn: { name: "Autumn Harvest \u00b7 analogous", bg: '#1c120b', surface: '#2a1b10', text: '#fbeedd', accent: '#e8a33d', accentText: '#1c120b', link: '#d4e157', border: '#4a3220', input: '#160e08', wp: WALLPAPERS.autumn.css, wpDim: 35, wpSee: 30 },
  aurora: { name: "Nordic Aurora \u00b7 triadic", bg: '#0b1622', surface: '#13233a', text: '#e8f1ff', accent: '#34d399', accentText: '#04221a', link: '#c4b5fd', border: '#24405e', input: '#08111b', wp: WALLPAPERS.aurora.css, wpDim: 35, wpSee: 30 },
  royal: { name: "Royal Gold \u00b7 complementary", bg: '#0a0f2c', surface: '#141b45', text: '#f4f1e6', accent: '#d4af37', accentText: '#0a0f2c', link: '#e9c46a', border: '#2c3672', input: '#070b22', wp: WALLPAPERS.golddust.css, wpDim: 35, wpSee: 30 },
  amethyst: { name: "Amethyst & Citrine \u00b7 complementary", bg: '#160f24', surface: '#241838', text: '#f3ecff', accent: '#fbbf24', accentText: '#1b1206', link: '#c4b5fd', border: '#3d2b5c', input: '#110b1c', wp: WALLPAPERS.amethyst.css, wpDim: 35, wpSee: 30 },
  oceansun: { name: "Ocean Sunset \u00b7 split-complementary", bg: '#0b1a33', surface: '#13284d', text: '#eaf2ff', accent: '#ff8c42', accentText: '#1a0d00', link: '#ff8fb8', border: '#23406e', input: '#081429', wp: WALLPAPERS.sunset.css, wpDim: 35, wpSee: 30 },
  teal: { name: "Deep Teal \u00b7 monochromatic", bg: '#031c1c', surface: '#072c2c', text: '#d9fffb', accent: '#14b8a6', accentText: '#022020', link: '#5eead4', border: '#0f4a48', input: '#021616', wp: WALLPAPERS.teal.css, wpDim: 35, wpSee: 30 },
  lava: { name: "Lava Flow \u00b7 analogous", bg: '#120808', surface: '#1f0e0c', text: '#ffece6', accent: '#ff5a1f', accentText: '#1a0500', link: '#ffb347', border: '#3d1a14', input: '#0d0505', wp: WALLPAPERS.ember.css, wpDim: 35, wpSee: 30 },
  matrix: { name: "Matrix \u00b7 monochromatic", bg: '#000a00', surface: '#031a05', text: '#b6ffb6', accent: '#00ff66', accentText: '#001a08', link: '#7dff9e', border: '#0f3d16', input: '#000700', wp: WALLPAPERS.matrix.css, wpDim: 35, wpSee: 30 },
  sakura: { name: "Sakura Night \u00b7 complementary", bg: '#1f0f1a', surface: '#2e1727', text: '#ffeef6', accent: '#ff8fc7', accentText: '#2a0b1c', link: '#7ee8c8', border: '#4d2a42', input: '#180b14', wp: WALLPAPERS.sakura.css, wpDim: 35, wpSee: 30 },
};
Object.assign(PRESETS, COLOR_THEORY);
const FIELDS = [
  ['bg', 'Page background'], ['surface', 'Panels & cards'], ['text', 'Text'],
  ['accent', 'Buttons & highlights'], ['accentText', 'Button text'], ['link', 'Links'],
  ['border', 'Borders'], ['input', 'Input boxes'],
];
const WORK_SITES = ['app.reconvision.com', 'app.tekioncloud.com', 'app.partstech.com', 'shop.usautoforce.com', 'repairlinkshop.com'];
const HOST = location.hostname;
const OUR = 'wr-theme';            // id prefix of our own elements (never themed)

// ---------- storage ----------
function load(k, d) { try { const v = GM_getValue(k); return v === undefined ? d : JSON.parse(v); } catch (e) { return d; } }
function save(k, v) { GM_setValue(k, JSON.stringify(v)); }
function getSites() { return load('sites', {}); }
function siteCfg(host) {
  return Object.assign({ theme: '', buttons: true, rules: [], css: '' }, getSites()[host || HOST] || {});
}
function saveSiteCfg(c, host) { const s = getSites(); s[host || HOST] = c; save('sites', s); }
function customThemes() { return load('custom_themes', {}); }
function allThemes() { return Object.assign({}, PRESETS, customThemes()); }

let cfg = siteCfg();
let T = allThemes()[cfg.theme] || null;     // active theme colors, or null = Off

// ---------- color math ----------
function parseColor(s) {
  const m = s && /rgba?\(([^)]+)\)/.exec(s);
  if (!m) return null;
  const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
function lum(c) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function hsl(c) {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255 }; }
function rgbToHex(c) { return '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join(''); }
function mix(h1, h2, t) {
  const a = hexToRgb(h1), b = hexToRgb(h2);
  return rgbToHex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
}
function rgba(hex, a) { const c = hexToRgb(hex); return a >= 1 ? hex : `rgba(${c.r},${c.g},${c.b},${a})`; }
const isBlue = H => H.h >= 190 && H.h <= 255;

// ---------- the one stylesheet ----------
const styleEl = document.createElement('style');
styleEl.id = OUR + '-style';
function cssText() {
  let css = '';
  if (T) {
    const s2 = mix(T.surface, T.text, 0.07);
    // With a wallpaper, panels can be see-through (wpSee %) so the picture shows.
    const a = T.wp ? 1 - (T.wpSee == null ? 25 : T.wpSee) / 100 : 1;
    css += `
:root{--wr-bg:${T.bg};--wr-surface:${rgba(T.surface, a)};--wr-surface2:${rgba(s2, a)};--wr-alpha:${a};--wr-text:${T.text};--wr-accent:${T.accent};
--wr-accentText:${T.accentText};--wr-link:${T.link};--wr-border:${T.border};--wr-input:${T.input};color-scheme:dark !important}
html,body{background-color:var(--wr-bg) !important}
[data-wr-bg=page]{background-color:var(--wr-bg) !important}
[data-wr-bg=surface]{background-color:var(--wr-surface) !important}
[data-wr-bg=surface2]{background-color:var(--wr-surface2) !important}
[data-wr-bg=input]{background-color:var(--wr-input) !important}
[data-wr-bg=tint]{background-color:var(--wr-tint) !important}
[data-wr-bg=accent]{background-color:var(--wr-accent) !important;border-color:var(--wr-accent) !important}
[data-wr-bg=accent]:hover{filter:brightness(1.15)}
[data-wr-fg=text]{color:var(--wr-text) !important}
[data-wr-fg=link]{color:var(--wr-link) !important}
[data-wr-fg=accentText]{color:var(--wr-accentText) !important}
[data-wr-fg=tint]{color:var(--wr-fgtint) !important}
[data-wr-bd=border]{border-color:var(--wr-border) !important}
::placeholder{color:${mix(T.text, T.bg, 0.45)} !important}
input,textarea,select,[contenteditable]{caret-color:${T.text}}
input[type=checkbox],input[type=radio],progress{accent-color:${T.accent}}
::selection{background:${T.accent};color:${T.accentText}}
*{scrollbar-color:${T.border} ${T.bg}}
`;
    if (T.wp) {
      const dim = (T.wpDim == null ? 50 : T.wpDim) / 100;
      const fit = T.wpFit || 'cover';
      const size = fit === 'tile' ? 'auto' : fit, rep = fit === 'tile' ? 'repeat' : 'no-repeat';
      css += `
html{background-image:linear-gradient(rgba(0,0,0,${dim}),rgba(0,0,0,${dim})),${T.wp} !important;
background-size:100% 100%,${size} !important;background-repeat:no-repeat,${rep} !important;
background-position:center,center !important;background-attachment:fixed,fixed !important}
body,[data-wr-bg=page]{background-color:transparent !important}
`;
    }
  }
  (cfg.rules || []).forEach(r => {
    const decl = (r.bg ? `background-color:${r.bg} !important;` : '') + (r.color ? `color:${r.color} !important;` : '');
    if (decl) css += `\n${r.sel}{${decl}}`;
  });
  if (cfg.css) css += '\n' + cfg.css;
  return css;
}
function applyStyle() {
  styleEl.textContent = cssText();
  if (styleEl.isConnected) return;
  const target = document.head || document.documentElement;
  if (target) target.appendChild(styleEl);
  else setTimeout(applyStyle, 5);               // page not created yet at document-start
}

// ---------- scanner ----------
const ATTRS = ['data-wr-bg', 'data-wr-fg', 'data-wr-bd'];
function isOurs(el) { return el.id && el.id.startsWith(OUR); }
function skip(el) {
  return el instanceof SVGElement || /^(SCRIPT|STYLE|LINK|META|HEAD|TITLE|IMG|VIDEO|CANVAS|IFRAME|NOSCRIPT|BR|OBJECT|EMBED|PICTURE|SOURCE)$/.test(el.tagName) || isOurs(el);
}
function isButtonLike(el) {
  const t = el.tagName;
  return t === 'BUTTON' || el.getAttribute('role') === 'button' ||
    (t === 'INPUT' && /^(button|submit)$/i.test(el.type)) ||
    (t === 'A' && /\bbtn\b|button/i.test(String(el.className)));
}
function ruleSelector() { return (cfg.rules || []).map(r => r.sel).join(','); }

function decide(el, cs, picked) {
  const d = {};
  if (picked && (() => { try { return el.matches(picked); } catch (e) { return false; } })()) return d;
  const bg = parseColor(cs.backgroundColor);
  if (bg && bg.a > 0.3 && cs.backgroundImage === 'none') {
    const L = lum(bg), H = hsl(bg);
    if (el === document.documentElement || el === document.body) { if (L > 0.4) d.bg = 'page'; }
    else if (cfg.buttons && isButtonLike(el) && H.s > 0.35 && isBlue(H) && L < 0.75) { d.bg = 'accent'; d.fg = 'accentText'; return d; }
    else if (H.s < 0.3) {
      if (L >= 0.85) d.bg = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ? 'input' : 'surface';
      else if (L >= 0.45) d.bg = 'surface2';
    } else if (L >= 0.6) { d.bg = 'tint'; d.tint = `hsla(${Math.round(H.h)}, ${Math.round(Math.min(H.s, 0.6) * 100)}%, 20%, var(--wr-alpha, 1))`; }
  }
  const c = parseColor(cs.color);
  if (c) {
    const L = lum(c), H = hsl(c);
    if (el.tagName === 'A' && H.s > 0.4 && isBlue(H)) d.fg = 'link';
    else if (L < 0.25) {
      if (H.s > 0.45) { d.fg = 'tint'; d.fgtint = `hsl(${Math.round(H.h)}, ${Math.round(H.s * 100)}%, 68%)`; }
      else d.fg = 'text';
    }
  }
  const side = ['Top', 'Bottom', 'Left', 'Right'].find(s => parseFloat(cs['border' + s + 'Width']) > 0);
  if (side) {
    const b = parseColor(cs['border' + side + 'Color']);
    if (b && b.a > 0.3 && lum(b) > 0.4 && hsl(b).s < 0.3) d.bd = 'border';
  }
  return d;
}
function clearEl(el) {
  ATTRS.forEach(a => el.removeAttribute(a));
  el.style.removeProperty('--wr-tint'); el.style.removeProperty('--wr-fgtint');
}
function scan(roots, redo) {
  if (!T) return;
  const els = [];
  roots.forEach(r => {
    if (!r.isConnected || r.nodeType !== 1) return;
    if (r.closest && r.closest('[id^="' + OUR + '"]')) return;
    if (!skip(r)) els.push(r);
    const all = r.getElementsByTagName('*');
    if (redo && all.length > 3000) return;       // big container class change: element itself only
    for (const el of all) if (!skip(el)) els.push(el);
  });
  if (redo) els.forEach(clearEl);                // 1. clear (so we read the page's own colors)
  const picked = ruleSelector();
  const ds = els.map(el => decide(el, getComputedStyle(el), picked));   // 2. read
  els.forEach((el, i) => {                        // 3. write
    const d = ds[i];
    if (!redo) clearEl(el);
    if (d.bg) el.setAttribute('data-wr-bg', d.bg);
    if (d.fg) el.setAttribute('data-wr-fg', d.fg);
    if (d.bd) el.setAttribute('data-wr-bd', d.bd);
    if (d.tint) el.style.setProperty('--wr-tint', d.tint);
    if (d.fgtint) el.style.setProperty('--wr-fgtint', d.fgtint);
  });
}
function unscanAll() {
  document.querySelectorAll('[data-wr-bg],[data-wr-fg],[data-wr-bd]').forEach(clearEl);
}

let observer = null, queue = new Set(), timer = null;
function startObserver() {
  if (observer) return;
  observer = new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'childList') m.addedNodes.forEach(n => { if (n.nodeType === 1) queue.add(n); });
      else queue.add(m.target);
    }
    if (!timer) timer = setTimeout(flush, 150);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
}
function stopObserver() { if (observer) observer.disconnect(); observer = null; queue.clear(); }
function flush() {
  timer = null;
  if (!styleEl.isConnected) applyStyle();
  const items = [...queue]; queue.clear();
  try { scan(items, true); } catch (e) { console.warn('[Page Themes]', e); }
}

// Re-apply everything (after any settings change)
function refresh(rescan) {
  cfg = siteCfg();
  T = allThemes()[cfg.theme] || null;
  applyStyle();
  if (!document.body) return;
  if (!T) { stopObserver(); unscanAll(); return; }
  if (rescan) { unscanAll(); scan([document.documentElement], false); }
  startObserver();
}

// ---------- start ----------
applyStyle();                                   // early: avoids a white flash
function onReady() { if (T) { scan([document.documentElement], false); startObserver(); } }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once: true });
else onReady();

if (window.top !== window) return;              // menu + panel only in the main window
GM_registerMenuCommand('🎨 Themes & colors…', openPanel);

// ---------- settings panel (shadow DOM so page styles can't touch it) ----------
let host = null;
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function openPanel() {
  if (host) { host.remove(); host = null; }
  host = document.createElement('div');
  host.id = OUR + '-host';
  host.style.cssText = 'all:initial;position:fixed;top:12px;right:12px;z-index:2147483647';
  const pos = load('panel_pos', null);           // where the user last dragged it
  if (pos) placePanel(pos.x, pos.y);
  const root = host.attachShadow({ mode: 'open' });
  document.documentElement.appendChild(host);
  render(root);
}
function placePanel(x, y) {                       // keep at least the header on screen
  x = Math.max(0, Math.min(x, window.innerWidth - 120));
  y = Math.max(0, Math.min(y, window.innerHeight - 40));
  Object.assign(host.style, { left: x + 'px', top: y + 'px', right: 'auto' });
}
function makeDraggable(root) {
  const handle = root.querySelector('#drag');
  handle.onpointerdown = e => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const r = host.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = ev => placePanel(ev.clientX - dx, ev.clientY - dy);
    const up = () => {
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true);
      const r2 = host.getBoundingClientRect(); save('panel_pos', { x: r2.left, y: r2.top });
    };
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true);
  };
}
// Save a change to the current theme. Editing a suggested theme makes a "My ..." copy.
function updateTheme(changes) {
  const c = customThemes();
  let id = cfg.theme;
  if (PRESETS[id]) {
    id = 'my_' + id;
    if (!c[id]) c[id] = Object.assign({}, PRESETS[cfg.theme], { name: 'My ' + PRESETS[cfg.theme].name });
  }
  c[id] = Object.assign({}, c[id], changes);
  try { save('custom_themes', c); }
  catch (e) { alert('Could not save (picture too big?). Try a smaller picture.'); return false; }
  const switched = cfg.theme !== id;
  cfg.theme = id; saveSiteCfg(cfg); refresh(false);
  return switched;
}
// Shrink an uploaded picture so it saves fast and small (max 1920px wide, JPEG).
function shrinkImage(file, cb) {
  const fr = new FileReader();
  fr.onload = () => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1920 / img.width, 1200 / img.height);
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      let q = 0.82, url = cv.toDataURL('image/jpeg', q);
      while (url.length > 900000 && q > 0.4) { q -= 0.1; url = cv.toDataURL('image/jpeg', q); }
      cb(url);
    };
    img.onerror = () => cb(null);               // not a picture, or this site blocks pictures
    img.src = fr.result;
  };
  fr.readAsDataURL(file);
}
// Can this site show this picture? (Some sites block outside pictures.)
function testImage(url, cb) {
  const m = /^url\("(.*)"\)$/.exec(url);
  if (!m) { cb(true); return; }
  const img = new Image();
  img.onload = () => cb(true); img.onerror = () => cb(false);
  img.src = m[1];
}
function render(root) {
  cfg = siteCfg();
  const themes = allThemes(), custom = customThemes();
  const cur = themes[cfg.theme] || null;
  const opts = ['<option value="">Off (site\'s normal look)</option>',
    '<optgroup label="Classic">', ...Object.keys(PRESETS).filter(k => !COLOR_THEORY[k]).map(k => `<option value="${k}">${esc(PRESETS[k].name)}</option>`), '</optgroup>',
    '<optgroup label="Color theory (with wallpaper)">', ...Object.keys(COLOR_THEORY).map(k => `<option value="${k}">${esc(PRESETS[k].name)}</option>`), '</optgroup>',
    Object.keys(custom).length ? '<optgroup label="My themes">' + Object.keys(custom).map(k => `<option value="${esc(k)}">★ ${esc(custom[k].name)}</option>`).join('') + '</optgroup>' : ''
  ].join('');
  const base = cur || PRESETS.midnight;
  root.innerHTML = `
<style>
  *{box-sizing:border-box;font:13px "Segoe UI",Arial,sans-serif}
  .p{width:330px;max-height:92vh;overflow:auto;background:#1b1f27;color:#e5e7eb;border:1px solid #3b4252;border-radius:10px;padding:12px;box-shadow:0 8px 30px rgba(0,0,0,.6)}
  h3{margin:0 0 8px;font-size:15px;display:flex;justify-content:space-between;align-items:center}
  h4{margin:12px 0 6px;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:.04em}
  select,textarea,input[type=text]{width:100%;background:#0f1218;color:#e5e7eb;border:1px solid #3b4252;border-radius:6px;padding:6px}
  textarea{font:12px Consolas,monospace;height:70px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
  label.c{display:flex;align-items:center;gap:6px;font-size:12px}
  input[type=color]{width:32px;height:24px;border:none;background:none;padding:0;cursor:pointer}
  button{background:#2b3240;color:#e5e7eb;border:1px solid #3b4252;border-radius:6px;padding:6px 10px;cursor:pointer;margin:2px 0}
  button:hover{background:#364052}
  button.pri{background:#2563eb;border-color:#2563eb;color:#fff}
  .x{background:none;border:none;font-size:16px;padding:0 4px}
  .row{display:flex;gap:6px;flex-wrap:wrap}
  .note{font-size:11px;color:#9ca3af;margin-top:8px}
  .dis{opacity:.4;pointer-events:none}
  #drag{cursor:move;user-select:none}
  .min .body{display:none}
  .min{width:auto}
  input[type=range]{width:100%}
</style>
<div class="p ${load('panel_min', false) ? 'min' : ''}">
  <h3 id="drag" title="Drag to move">🎨 Themes & colors <span><button class="x" id="minbtn" title="Shrink / expand">▁</button><button class="x" id="close" title="Close">✕</button></span></h3>
  <div class="body">
  <div class="note" style="margin:0 0 8px">Site: <b>${esc(HOST)}</b> · drag the title bar to move this box</div>
  <h4>Theme</h4>
  <select id="theme">${opts}</select>
  <div class="row" style="margin-top:6px">
    <button id="allsites">Use on all work sites</button>
    ${custom[cfg.theme] ? '<button id="del">Delete this theme</button>' : ''}
  </div>
  <h4>Colors ${cur ? '' : '(pick a theme first)'}</h4>
  <div class="grid ${cur ? '' : 'dis'}">
    ${FIELDS.map(([k, label]) => `<label class="c"><input type="color" data-k="${k}" value="${base[k]}">${label}</label>`).join('')}
  </div>
  <label class="c ${cur ? '' : 'dis'}" style="margin-top:6px"><input type="checkbox" id="buttons" ${cfg.buttons ? 'checked' : ''}> Blue buttons use my button color</label>
  <div class="note">Changing a suggested theme's colors saves it as your own ★ theme.</div>
  <h4>Wallpaper ${cur ? '' : '(pick a theme first)'}</h4>
  <div class="${cur ? '' : 'dis'}">
    <select id="wpsel">
      <option value="">None</option>
      <optgroup label="Built-in (work on every site)">${Object.keys(WALLPAPERS).map(k => `<option value="b:${k}">${esc(WALLPAPERS[k].name)}</option>`).join('')}</optgroup>
      ${base.wp && !Object.values(WALLPAPERS).some(w => w.css === base.wp) ? '<option value="mine">My picture</option>' : ''}
    </select>
    <div class="row" style="margin-top:6px">
      <button id="wpfile">📁 Upload picture…</button>
      <button id="wplink">🔗 Use picture link…</button>
      <input type="file" id="wpinput" accept="image/*" style="display:none">
    </div>
    <div id="wpmsg" class="note" style="margin-top:2px"></div>
    <label class="c" style="margin-top:6px">Darken picture <b id="dimv">${base.wpDim == null ? 50 : base.wpDim}%</b></label>
    <input type="range" id="wpdim" min="0" max="90" value="${base.wpDim == null ? 50 : base.wpDim}">
    <label class="c">See-through panels <b id="seev">${base.wpSee == null ? 25 : base.wpSee}%</b></label>
    <input type="range" id="wpsee" min="0" max="80" value="${base.wpSee == null ? 25 : base.wpSee}">
    <label class="c" style="margin-top:4px">Fit
      <select id="wpfit" style="width:auto">
        <option value="cover">Fill screen</option><option value="contain">Whole picture</option><option value="tile">Tile (repeat)</option>
      </select></label>
  </div>
  <h4>Recolor one thing</h4>
  <div class="row">
    <button id="pick" class="pri">🎯 Click an element to recolor</button>
    <button id="clearpicks">Clear picked colors (${(cfg.rules || []).length})</button>
  </div>
  <div id="ruleform"></div>
  <h4>Custom CSS (this site)</h4>
  <textarea id="css" placeholder="Advanced: e.g. button { border-radius: 12px !important; }">${esc(cfg.css || '')}</textarea>
  <button id="savecss">Apply CSS</button>
  <h4>Share with a coworker</h4>
  <textarea id="share" placeholder="Click Copy to get a code, or paste a code here and click Load"></textarea>
  <div class="row"><button id="copy">Copy my theme code</button><button id="loadcode">Load code</button></div>
  <div class="note">Saved in this browser only. Each person picks their own look.
  If Chrome's "Auto Dark Mode" flag is on, a theme here tells Chrome this page is already dark.</div>
  </div>
</div>`;
  const $ = s => root.querySelector(s);
  $('#theme').value = cfg.theme;
  makeDraggable(root);
  $('#minbtn').onclick = () => { const p = $('.p'); p.classList.toggle('min'); save('panel_min', p.classList.contains('min')); };
  $('#close').onclick = () => { host.remove(); host = null; };
  // ---- wallpaper ----
  const wpKey = Object.keys(WALLPAPERS).find(k => WALLPAPERS[k].css === base.wp);
  $('#wpsel').value = !base.wp ? '' : wpKey ? 'b:' + wpKey : 'mine';
  $('#wpfit').value = base.wpFit || 'cover';
  const setWp = (wp, msg) => {
    updateTheme({ wp }); render(root);
    if (msg) root.querySelector('#wpmsg').textContent = msg;
  };
  const blocked = msg => { $('#wpmsg').textContent = msg; };
  $('#wpsel').onchange = e => {
    const v = e.target.value;
    if (v === 'mine') return;
    setWp(v ? WALLPAPERS[v.slice(2)].css : '', '');
  };
  $('#wpfile').onclick = () => $('#wpinput').click();
  $('#wpinput').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    $('#wpmsg').textContent = 'Loading picture…';
    shrinkImage(f, url => {
      if (!url) { blocked('⚠ Could not use that picture here. Either the file is not a picture, or this site blocks pictures (use a built-in wallpaper here).'); return; }
      const wp = `url("${url}")`;
      testImage(wp, ok => ok ? setWp(wp, 'Picture set.') : blocked('⚠ This site blocks pictures. Use a built-in wallpaper here.'));
    });
  };
  $('#wplink').onclick = () => {
    const u = prompt('Paste a picture link (must start with https://):');
    if (!u) return;
    if (!/^https:\/\/[^\s"()]+$/.test(u.trim())) { alert('That link does not look right. It must start with https:// and have no spaces.'); return; }
    const wp = `url("${u.trim()}")`;
    $('#wpmsg').textContent = 'Checking picture…';
    testImage(wp, ok => ok ? setWp(wp, 'Picture set.') : blocked('⚠ The picture did not load here (bad link, or this site blocks outside pictures). Try Upload, or a built-in wallpaper.'));
  };
  const slider = (id, key, label) => {
    $(id).oninput = e => {                     // live preview
      $(label).textContent = e.target.value + '%';
      if (!T) return;
      T = Object.assign({}, T, { [key]: Number(e.target.value) });
      styleEl.textContent = cssText();
    };
    $(id).onchange = e => { if (updateTheme({ [key]: Number(e.target.value) })) render(root); };
  };
  slider('#wpdim', 'wpDim', '#dimv');
  slider('#wpsee', 'wpSee', '#seev');
  $('#wpfit').onchange = e => { if (updateTheme({ wpFit: e.target.value })) render(root); };
  $('#theme').onchange = e => { cfg.theme = e.target.value; saveSiteCfg(cfg); refresh(true); render(root); };
  $('#allsites').onclick = () => {
    WORK_SITES.forEach(h => { const c = siteCfg(h); c.theme = cfg.theme; saveSiteCfg(c, h); });
    alert('This theme is now set for: ' + WORK_SITES.join(', ') + '\nOther tabs change after a reload.');
  };
  if ($('#del')) $('#del').onclick = () => {
    if (!confirm('Delete this theme?')) return;
    const c = customThemes(); delete c[cfg.theme]; save('custom_themes', c);
    cfg.theme = ''; saveSiteCfg(cfg); refresh(true); render(root);
  };
  root.querySelectorAll('input[type=color]').forEach(inp => {
    inp.oninput = () => {                       // live preview
      if (!T) return;
      T = Object.assign({}, T, { [inp.dataset.k]: inp.value });
      styleEl.textContent = cssText();
    };
    inp.onchange = () => { if (updateTheme({ [inp.dataset.k]: inp.value })) render(root); };
  });
  $('#buttons').onchange = e => { cfg.buttons = e.target.checked; saveSiteCfg(cfg); refresh(true); };
  $('#pick').onclick = () => startPicker(root);
  $('#clearpicks').onclick = () => { cfg.rules = []; saveSiteCfg(cfg); refresh(true); render(root); };
  $('#savecss').onclick = () => { cfg.css = $('#css').value; saveSiteCfg(cfg); refresh(false); };
  $('#copy').onclick = () => {
    const code = JSON.stringify({ wrTheme: 1, theme: themes[cfg.theme] || null, rules: cfg.rules || [], css: cfg.css || '', site: HOST });
    $('#share').value = code; $('#share').select();
    try { navigator.clipboard.writeText(code).catch(() => {}); } catch (e) {}
  };
  $('#loadcode').onclick = () => {
    let o; try { o = JSON.parse($('#share').value); } catch (e) { alert('That code is not valid.'); return; }
    if (!o || o.wrTheme !== 1) { alert('That is not a theme code.'); return; }
    if (o.theme) {
      const c = customThemes(); const id = 'shared_' + Date.now();
      c[id] = Object.assign({}, o.theme, { name: (o.theme.name || 'Shared theme') }); save('custom_themes', c);
      cfg.theme = id;
    }
    if (o.site === HOST && (o.rules.length || o.css) && confirm('Also load the picked colors and custom CSS for this site?')) {
      cfg.rules = o.rules; cfg.css = o.css;
    }
    saveSiteCfg(cfg); refresh(true); render(root);
  };
}

// ---------- click-to-recolor picker ----------
function goodClasses(el) {
  return [...el.classList].filter(c => /^[A-Za-z_-][\w-]*$/.test(c) && !/\d{3,}|^css-|^sc-|^jsx-|^ng-|_[A-Za-z0-9]{5,}$/.test(c)).slice(0, 3);
}
function selectorFor(el) {
  for (const a of ['data-test-id', 'data-testid', 'data-field-name']) {
    const v = el.getAttribute(a);
    if (v) return `[${a}="${v.replace(/"/g, '\\"')}"]`;
  }
  if (el.id && /^[A-Za-z][\w-]*$/.test(el.id) && !/\d{3,}/.test(el.id)) return '#' + el.id;
  const tag = el.tagName.toLowerCase(), cls = goodClasses(el);
  if (cls.length) return tag + '.' + cls.join('.');
  const p = el.parentElement;
  return p && p !== document.body && p !== document.documentElement ? selectorFor(p) + ' > ' + tag : tag;
}
function toHex(s, fallback) { const c = parseColor(s); return c && c.a > 0 ? rgbToHex(c) : fallback; }

function startPicker(root) {
  host.style.display = 'none';
  const box = document.createElement('div');
  box.id = OUR + '-pickbox';
  box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;outline:3px dashed #f59e0b;background:rgba(245,158,11,.12);transition:all .05s';
  const tip = document.createElement('div');
  tip.id = OUR + '-picktip';
  tip.textContent = '🎯 Click the thing you want to recolor   ·   Esc = cancel';
  tip.style.cssText = 'all:initial;position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#f59e0b;color:#000;font:bold 13px Segoe UI,sans-serif;padding:6px 12px;border-radius:6px';
  document.documentElement.append(box, tip);
  let target = null;
  const move = e => {
    const el = e.target;
    if (!el || isOurs(el)) return;
    target = el;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  };
  const block = e => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  const done = () => {
    document.removeEventListener('mousemove', move, true);
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach(t => document.removeEventListener(t, block, true));
    document.removeEventListener('click', click, true);
    document.removeEventListener('keydown', key, true);
    box.remove(); tip.remove(); host.style.display = '';
  };
  const click = e => { block(e); const el = target; done(); if (el) ruleForm(root, el); };
  const key = e => { if (e.key === 'Escape') { block(e); done(); } };
  document.addEventListener('mousemove', move, true);
  ['mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach(t => document.addEventListener(t, block, true));
  document.addEventListener('click', click, true);
  document.addEventListener('keydown', key, true);
}

function ruleForm(root, el) {
  const cs = getComputedStyle(el);
  const sel = selectorFor(el);
  const f = root.querySelector('#ruleform');
  f.innerHTML = `
  <div style="background:#0f1218;border:1px solid #3b4252;border-radius:6px;padding:8px;margin-top:6px">
    <div class="note" style="margin:0 0 4px">Which elements (advanced users can edit):</div>
    <input type="text" id="rsel" value="${esc(sel)}">
    <div class="note" id="rcount" style="margin:2px 0 6px"></div>
    <label class="c"><input type="checkbox" id="rbgon" checked><input type="color" id="rbg" value="${toHex(cs.backgroundColor, '#334155')}"> Background</label>
    <label class="c"><input type="checkbox" id="rfgon" checked><input type="color" id="rfg" value="${toHex(cs.color, '#ffffff')}"> Text</label>
    <div class="row" style="margin-top:6px"><button class="pri" id="rsave">Save</button><button id="rcancel">Cancel</button></div>
  </div>`;
  const $ = s => root.querySelector(s);
  const count = () => {
    try { const n = document.querySelectorAll($('#rsel').value).length; $('#rcount').textContent = `Matches ${n} element${n === 1 ? '' : 's'} on this page.`; }
    catch (e) { $('#rcount').textContent = 'Not a valid selector.'; }
  };
  count();
  $('#rsel').oninput = count;
  $('#rcancel').onclick = () => { f.innerHTML = ''; };
  $('#rsave').onclick = () => {
    const s = $('#rsel').value.trim();
    try { document.querySelector(s); } catch (e) { alert('Not a valid selector.'); return; }
    const rule = { sel: s, bg: $('#rbgon').checked ? $('#rbg').value : '', color: $('#rfgon').checked ? $('#rfg').value : '' };
    if (!rule.bg && !rule.color) { f.innerHTML = ''; return; }
    cfg = siteCfg();
    cfg.rules = (cfg.rules || []).filter(r => r.sel !== s).concat([rule]);
    saveSiteCfg(cfg); refresh(true); render(root);
  };
}
})();
