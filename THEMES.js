// ==UserScript==
// @name         Page Themes
// @namespace    reconclipboard
// @version      3.8
// @author       Gabe
// @description  Dark themes / skins for RV, Tekion, PartsTech and the parts sites. Pick a suggested theme or make your own, click any element to recolor it, add custom CSS, share themes with a code. Tampermonkey menu -> Themes & colors.
// @match        https://*.reconvision.com/*
// @match        https://app.tekioncloud.com/*
// @match        https://app.partstech.com/*
// @match        https://shop.usautoforce.com/*
// @match        https://repairlinkshop.com/*
// @match        https://teams.microsoft.com/*
// @match        https://teams.cloud.microsoft/*
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
  ct_ultraviolet: { name: "Ultraviolet", css: "radial-gradient(ellipse at 20% 25%,rgba(124,255,79,0.4),transparent 45%),radial-gradient(ellipse at 80% 80%,rgba(255,106,213,0.3),transparent 45%),linear-gradient(160deg,#0e0420,#1c0b3a)" },
  ct_mojave: { name: "Mojave Desert", css: "radial-gradient(circle at 85% 15%,rgba(63,193,176,0.3),transparent 40%),linear-gradient(135deg,#1d140e 0%,#2b1e15 55%,#1d140e 100%)" },
  ct_glacier: { name: "Glacier", css: "radial-gradient(ellipse at 20% 25%,rgba(125,211,252,0.4),transparent 45%),radial-gradient(ellipse at 80% 80%,rgba(186,230,253,0.3),transparent 45%),linear-gradient(160deg,#06141f,#0c2233)" },
  ct_volcano: { name: "Volcano Ash", css: "repeating-linear-gradient(135deg,rgba(255,122,26,0.1) 0 14px,transparent 14px 44px),radial-gradient(circle at 15% 85%,rgba(143,179,255,0.25),transparent 40%),linear-gradient(#15171c,#15171c)" },
  ct_rainforest: { name: "Rainforest Orchid", css: "radial-gradient(ellipse at 20% 25%,rgba(255,79,163,0.4),transparent 45%),radial-gradient(ellipse at 80% 80%,rgba(110,231,168,0.3),transparent 45%),linear-gradient(160deg,#07170e,#0e2618)" },
  ct_racing: { name: "Midnight Racing", css: "repeating-linear-gradient(135deg,rgba(255,159,28,0.1) 0 14px,transparent 14px 44px),radial-gradient(circle at 15% 85%,rgba(92,200,255,0.25),transparent 40%),linear-gradient(#071226,#071226)" },
  ct_bubblegum: { name: "Bubblegum Pop", css: "radial-gradient(circle at 44% 21%,rgba(95,242,226,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 77% 66%,rgba(255,95,193,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 19% 49%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 10% 2%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 31% 59%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 26% 66%,rgba(95,242,226,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 47% 2%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 48% 16%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 88% 55%,rgba(255,95,193,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 42% 21%,rgba(95,242,226,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 80% 36%,rgba(95,242,226,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 76% 80%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 54% 63%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 27% 60%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 84% 67%,rgba(95,242,226,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 77% 88%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 86% 93%,rgba(95,242,226,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 32% 11%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 69% 75%,rgba(255,95,193,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 6% 81%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 23% 5%,rgba(95,242,226,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 11% 55%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(ellipse at 70% 30%,rgba(95,242,226,0.25),transparent 50%),linear-gradient(160deg,#1b0f24,#2a1838)" },
  ct_copper: { name: "Copper Patina", css: "radial-gradient(circle at 85% 15%,rgba(208,138,78,0.3),transparent 40%),linear-gradient(135deg,#10191a 0%,#182527 55%,#10191a 100%)" },
  ct_galaxy: { name: "Galaxy", css: "radial-gradient(circle at 38% 31%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 17% 16%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 70% 19%,rgba(255,209,102,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 52% 74%,rgba(255,209,102,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 57% 61%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 12% 60%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 84% 48%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 91% 33%,rgba(239,122,192,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 38% 94%,rgba(239,122,192,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 67% 48%,rgba(255,209,102,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 81% 15%,rgba(239,122,192,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 63% 25%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 15% 81%,rgba(255,209,102,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 98% 76%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 94% 75%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 70% 26%,rgba(239,122,192,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 98% 21%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 23% 61%,rgba(255,209,102,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 13% 90%,rgba(255,209,102,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 92% 38%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 67% 44%,rgba(255,209,102,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 72% 45%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(ellipse at 70% 30%,rgba(239,122,192,0.25),transparent 50%),linear-gradient(160deg,#0a0820,#15123a)" },
  ct_slatemint: { name: "Slate & Mint", css: "repeating-linear-gradient(0deg,rgba(94,234,212,0.14) 0 1px,transparent 1px 48px),repeating-linear-gradient(90deg,rgba(147,197,253,0.14) 0 1px,transparent 1px 48px),radial-gradient(ellipse at 50% 0%,rgba(94,234,212,0.25),transparent 55%),linear-gradient(#12181d,#12181d)" },
  ct_peacock: { name: "Peacock", css: "radial-gradient(ellipse at 20% 25%,rgba(0,180,216,0.4),transparent 45%),radial-gradient(ellipse at 80% 80%,rgba(244,196,48,0.3),transparent 45%),linear-gradient(160deg,#04141f,#0a2233)" },
  ct_grape: { name: "Grape Soda", css: "radial-gradient(circle at 22% 16%,rgba(198,255,107,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 95% 2%,rgba(198,255,107,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 19% 20%,rgba(198,255,107,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 95% 55%,rgba(198,255,107,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 95% 25%,rgba(179,136,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 31% 21%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 40% 87%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 76% 61%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 98% 96%,rgba(198,255,107,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 63% 23%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 23% 75%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 64% 24%,rgba(179,136,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 34% 40%,rgba(198,255,107,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 80% 29%,rgba(179,136,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 73% 90%,rgba(198,255,107,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 73% 55%,rgba(198,255,107,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 40% 81%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 46% 51%,rgba(198,255,107,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 54% 92%,rgba(179,136,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 11% 5%,rgba(179,136,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 88% 76%,rgba(179,136,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 82% 17%,rgba(179,136,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(ellipse at 70% 30%,rgba(198,255,107,0.25),transparent 50%),linear-gradient(160deg,#170a26,#25123d)" },
  ct_espresso: { name: "Espresso", css: "radial-gradient(circle at 85% 15%,rgba(200,162,122,0.3),transparent 40%),linear-gradient(135deg,#17100c 0%,#231912 55%,#17100c 100%)" },
  ct_tokyo: { name: "Neon Tokyo", css: "repeating-linear-gradient(0deg,rgba(0,229,255,0.14) 0 1px,transparent 1px 48px),repeating-linear-gradient(90deg,rgba(255,62,201,0.14) 0 1px,transparent 1px 48px),radial-gradient(ellipse at 50% 0%,rgba(0,229,255,0.25),transparent 55%),linear-gradient(#08050f,#08050f)" },
  ct_mintchoc: { name: "Mint Chocolate", css: "repeating-linear-gradient(135deg,rgba(110,231,183,0.1) 0 14px,transparent 14px 44px),radial-gradient(circle at 15% 85%,rgba(167,243,208,0.25),transparent 40%),linear-gradient(#1a120e,#1a120e)" },
  ct_lavender: { name: "Twilight Lavender", css: "radial-gradient(ellipse at 20% 25%,rgba(165,180,252,0.4),transparent 45%),radial-gradient(ellipse at 80% 80%,rgba(240,171,252,0.3),transparent 45%),linear-gradient(160deg,#141326,#1f1d3a)" },
  ct_solar: { name: "Solar Flare", css: "radial-gradient(ellipse at 20% 25%,rgba(255,195,0,0.4),transparent 45%),radial-gradient(ellipse at 80% 80%,rgba(255,140,66,0.3),transparent 45%),linear-gradient(160deg,#120d04,#1e1608)" },
  ct_arctic: { name: "Arctic Night", css: "radial-gradient(circle at 31% 70%,rgba(76,201,240,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 37% 38%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 78% 55%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 19% 7%,rgba(255,126,182,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 35% 67%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 7% 77%,rgba(255,126,182,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 72% 92%,rgba(255,126,182,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 21% 35%,rgba(76,201,240,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 92% 14%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 3% 64%,rgba(76,201,240,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 46% 68%,rgba(76,201,240,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 44% 28%,rgba(76,201,240,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 44% 89%,rgba(76,201,240,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 45% 46%,rgba(76,201,240,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 70% 14%,rgba(255,255,255,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 80% 58%,rgba(255,126,182,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 76% 23%,rgba(255,126,182,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 79% 69%,rgba(76,201,240,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 85% 78%,rgba(76,201,240,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 49% 80%,rgba(76,201,240,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 42% 23%,rgba(76,201,240,0.85) 0 1.5px,transparent 2.5px),radial-gradient(circle at 75% 58%,rgba(255,126,182,0.85) 0 1.5px,transparent 2.5px),radial-gradient(ellipse at 70% 30%,rgba(255,126,182,0.25),transparent 50%),linear-gradient(160deg,#0a1018,#121b28)" },
  ct_cabin: { name: "Forest Cabin", css: "radial-gradient(circle at 85% 15%,rgba(224,122,47,0.3),transparent 40%),linear-gradient(135deg,#0f140c 0%,#182014 55%,#0f140c 100%)" },
  ct_reef: { name: "Coral Reef", css: "radial-gradient(ellipse at 20% 25%,rgba(255,127,110,0.4),transparent 45%),radial-gradient(ellipse at 80% 80%,rgba(79,209,197,0.3),transparent 45%),linear-gradient(160deg,#0a1626,#11223a)" },
  th_neonnoir: { name: "Neon Noir", css: "radial-gradient(ellipse at 10% 90%,rgba(255,46,151,.55),transparent 45%),radial-gradient(ellipse at 90% 10%,rgba(0,245,212,.45),transparent 45%),linear-gradient(135deg,#0a0614,#1a0b2e)" },
  th_nightrain: { name: "Night City Rain", css: "repeating-linear-gradient(100deg,rgba(61,245,255,.10) 0 1px,transparent 1px 9px),radial-gradient(ellipse at 50% 100%,rgba(255,46,151,.45),transparent 55%),linear-gradient(180deg,#05070f,#140a2a)" },
  th_vaporwave: { name: "Vaporwave", css: "repeating-linear-gradient(0deg,rgba(1,205,254,.25) 0 1px,transparent 1px 40px),repeating-linear-gradient(90deg,rgba(255,113,206,.25) 0 1px,transparent 1px 40px),linear-gradient(180deg,#1a0b2a 0%,#b967ff 70%,#ff71ce 100%)" },
  th_hologrid: { name: "Holo Grid", css: "repeating-linear-gradient(0deg,rgba(46,242,208,.18) 0 1px,transparent 1px 32px),repeating-linear-gradient(90deg,rgba(46,242,208,.18) 0 1px,transparent 1px 32px),radial-gradient(circle at 75% 25%,rgba(255,62,165,.45),transparent 40%),linear-gradient(#03100f,#03100f)" },
  th_glitch: { name: "Glitch Arcade", css: "linear-gradient(90deg,rgba(0,245,255,.25) 0 2px,transparent 2px),linear-gradient(270deg,rgba(255,46,151,.25) 0 2px,transparent 2px),repeating-linear-gradient(0deg,rgba(255,255,255,.04) 0 1px,transparent 1px 3px),linear-gradient(135deg,#08080c 0%,#1b0a24 50%,#06202a 100%)" },
  th_hyperspace: { name: "Hyperspace", css: "repeating-conic-gradient(from 0deg at 50% 50%,rgba(200,230,255,.18) 0deg .6deg,transparent .6deg 7deg),radial-gradient(circle at 50% 50%,rgba(76,201,240,.35),transparent 35%),linear-gradient(#020308,#020308)" },
  th_twinsuns: { name: "Twin Suns Desert", css: "radial-gradient(circle at 30% 30%,rgba(255,200,120,.55) 0 4%,transparent 14%),radial-gradient(circle at 42% 26%,rgba(255,170,90,.45) 0 3%,transparent 11%),linear-gradient(180deg,#3a1f3d 0%,#b5562b 55%,#e2a45a 75%,#3b2614 76%,#1a120a 100%)" },
  th_darkempire: { name: "Dark Empire", css: "repeating-linear-gradient(0deg,rgba(255,255,255,.03) 0 2px,transparent 2px 60px),radial-gradient(ellipse at 50% 120%,rgba(225,6,0,.45),transparent 55%),linear-gradient(#060606,#111214)" },
  th_saberduel: { name: "Saber Duel", css: "linear-gradient(135deg,transparent 46%,rgba(62,166,255,.9) 49%,rgba(255,255,255,.9) 50%,rgba(62,166,255,.9) 51%,transparent 54%),linear-gradient(45deg,transparent 46%,rgba(255,60,60,.9) 49%,rgba(255,255,255,.9) 50%,rgba(255,60,60,.9) 51%,transparent 54%),radial-gradient(circle at 50% 50%,rgba(150,120,255,.35),transparent 40%),linear-gradient(#05060c,#05060c)" },
  th_typesblue: { name: "TL Type-S Blue Pearl", css: "repeating-linear-gradient(45deg,rgba(255,255,255,.035) 0 3px,transparent 3px 6px),repeating-linear-gradient(-45deg,rgba(0,0,0,.25) 0 3px,transparent 3px 6px),radial-gradient(ellipse at 30% 20%,rgba(80,140,255,.45),transparent 50%),linear-gradient(160deg,#081530,#0a1f4a 50%,#050a16)" },
  th_typescarbon: { name: "TL Type-S Carbon", css: "repeating-linear-gradient(45deg,#16181b 0 4px,#0d0e10 4px 8px),repeating-linear-gradient(-45deg,rgba(255,255,255,.03) 0 4px,transparent 4px 8px),radial-gradient(ellipse at 80% 100%,rgba(215,38,46,.35),transparent 50%)" },
  th_screenprint: { name: "Screenprint Poster", css: "radial-gradient(circle,rgba(201,162,39,.22) 0 1.3px,transparent 1.8px)" },
  th_inkbone: { name: "Ink & Bone", css: "repeating-linear-gradient(45deg,rgba(239,233,220,.07) 0 1px,transparent 1px 7px),repeating-linear-gradient(-45deg,rgba(239,233,220,.05) 0 1px,transparent 1px 11px),radial-gradient(circle at 70% 30%,rgba(179,0,27,.30),transparent 35%),linear-gradient(#070707,#070707)" },
  th_bmx80s: { name: "80s Haro Green", css: "linear-gradient(115deg,transparent 0 58%,rgba(6,65,205,.55) 58% 62%,rgba(6,169,246,.55) 62% 65%,transparent 65%),linear-gradient(115deg,transparent 0 68%,rgba(244,114,96,.45) 68% 69%,transparent 69%),linear-gradient(115deg,transparent 0 20%,rgba(255,255,255,.10) 20% 21%,transparent 21%),radial-gradient(ellipse at 25% 30%,rgba(16,225,86,.40),transparent 50%),linear-gradient(#050a06,#0a160c)" },
  th_bmx80sblue: { name: "80s Haro Blue", css: "repeating-linear-gradient(170deg,transparent 0 40px,rgba(255,255,255,.10) 40px 43px,transparent 43px 52px,rgba(255,255,255,.07) 52px 54px,transparent 54px 120px),linear-gradient(115deg,transparent 0 60%,rgba(6,65,205,.45) 60% 64%,transparent 64%),radial-gradient(ellipse at 30% 30%,rgba(28,202,203,.42),transparent 50%),linear-gradient(#041314,#082022)" },
  th_crawl: { name: "Opening Crawl", css: "radial-gradient(ellipse at 50% 120%,rgba(255,232,31,.18),transparent 55%),linear-gradient(#000,#000)" },
  th_iceplanet: { name: "Ice Planet Outpost", css: "linear-gradient(180deg,#1b2a3a 0%,#3b5570 60%,#c9dcec 61%,#8fa9c0 100%)" },
  th_forestmoon: { name: "Forest Moon", css: "repeating-linear-gradient(90deg,rgba(60,35,20,.55) 0 26px,transparent 26px 70px,rgba(40,25,15,.5) 70px 84px,transparent 84px 150px),radial-gradient(ellipse at 50% 0%,rgba(155,219,112,.25),transparent 60%),linear-gradient(#0a1108,#0f1a0b)" },
  th_cloudcity: { name: "Cloud City Sunset", css: "radial-gradient(ellipse at 50% 80%,rgba(255,180,140,.55),transparent 50%),radial-gradient(ellipse at 20% 60%,rgba(255,255,255,.14),transparent 30%),radial-gradient(ellipse at 80% 65%,rgba(255,255,255,.12),transparent 30%),linear-gradient(180deg,#2b1450 0%,#a0466e 55%,#ff9a76 100%)" },
  th_imperialbridge: { name: "Imperial Bridge", css: "repeating-linear-gradient(90deg,rgba(255,59,59,.55) 0 4px,transparent 4px 46px,rgba(125,255,154,.45) 46px 50px,transparent 50px 120px),linear-gradient(180deg,transparent 0 92%,rgba(0,0,0,.9) 92%),repeating-linear-gradient(0deg,rgba(255,255,255,.035) 0 2px,transparent 2px 70px),linear-gradient(#0b0c0e,#14161a)" },
  th_crimsonsaber: { name: "Crimson Saber", css: "linear-gradient(120deg,transparent 47%,rgba(255,40,60,.95) 49.4%,rgba(255,255,255,.95) 50%,rgba(255,40,60,.95) 50.6%,transparent 53%),radial-gradient(circle at 50% 50%,rgba(255,26,46,.35),transparent 45%),linear-gradient(#070203,#070203)" },
  th_digitalrain: { name: "Digital Rain", css: "radial-gradient(ellipse at 50% 0%,rgba(0,255,65,.12),transparent 60%),linear-gradient(#000300,#000300)" },
  th_mainframe: { name: "Mainframe", css: "repeating-linear-gradient(0deg,rgba(51,255,51,.06) 0 1px,transparent 1px 3px),radial-gradient(ellipse at 50% 50%,rgba(51,255,51,.14),transparent 70%),linear-gradient(#010801,#010801)" },
  ar_tw_mask: { name: "Skull Mask Inks", css: "repeating-radial-gradient(circle at 50% 40%,rgba(91,74,110,.45) 0 2px,transparent 2px 9px),radial-gradient(circle at 50% 40%,rgba(240,138,42,.35),transparent 35%),linear-gradient(#120d14,#120d14)" },
  ar_tw_teal: { name: "Teal & Burnt Orange", css: "repeating-radial-gradient(circle at 50% 35%,rgba(111,154,160,.35) 0 2px,transparent 2px 10px),radial-gradient(circle at 50% 35%,rgba(226,98,42,.35),transparent 35%),linear-gradient(#0d1416,#0d1416)" },
  ar_tw_phoenix: { name: "Phoenix Feathers", css: "radial-gradient(ellipse at 30% 30%,rgba(232,166,54,.35),transparent 40%),radial-gradient(ellipse at 70% 70%,rgba(31,138,160,.30),transparent 40%),radial-gradient(circle at 60% 20%,rgba(154,61,26,.40),transparent 35%),linear-gradient(#1a1714,#211d18)" },
  ar_tw_tree: { name: "Twisted Tree Sunset", css: "repeating-linear-gradient(0deg,rgba(0,0,0,.28) 0 2px,transparent 2px 5px),linear-gradient(180deg,#4a2449 0%,#7a3f6b 35%,#e0794a 72%,#f2b16e 100%)" },
  ar_tw_slime: { name: "Blower & Slime", css: "radial-gradient(ellipse at 50% 105%,rgba(57,230,57,.50),transparent 40%),repeating-radial-gradient(circle at 50% 100%,rgba(57,230,57,.12) 0 6px,transparent 6px 22px),radial-gradient(ellipse at 50% 0%,rgba(255,90,31,.45),transparent 60%),linear-gradient(#120a06,#120a06)" },
  ar_vd_ballpoint: { name: "Ballpoint Blue", css: "repeating-linear-gradient(35deg,rgba(111,125,255,.14) 0 1px,transparent 1px 5px),repeating-linear-gradient(-55deg,rgba(111,125,255,.09) 0 1px,transparent 1px 8px),linear-gradient(#0c0f24,#0c0f24)" },
  ar_vd_hatch: { name: "Crosshatch Engraving", css: "repeating-linear-gradient(0deg,rgba(255,255,255,.07) 0 1px,transparent 1px 4px),repeating-linear-gradient(90deg,rgba(255,255,255,.05) 0 1px,transparent 1px 6px),repeating-linear-gradient(45deg,rgba(255,255,255,.05) 0 1px,transparent 1px 9px),linear-gradient(#080808,#080808)" },
  ar_mg_speed: { name: "Speed Lines", css: "repeating-conic-gradient(from 0deg at 85% 45%,rgba(255,255,255,.10) 0 3deg,transparent 3deg 9deg,rgba(255,255,255,.05) 9deg 11deg,transparent 11deg 16deg),linear-gradient(#1a1a1a,#2a2a2a)" },
  ar_mg_green: { name: "Atomic Green", css: "repeating-conic-gradient(from 0deg at 50% 0%,rgba(198,244,50,.16) 0 5deg,transparent 5deg 10deg),linear-gradient(180deg,#1a2a0a,#0f1a05)" },
  ar_mg_blue: { name: "Atomic Blue", css: "repeating-conic-gradient(from 0deg at 80% 15%,rgba(255,255,255,.14) 0 4deg,transparent 4deg 10deg),radial-gradient(circle at 80% 15%,rgba(255,255,255,.45),transparent 12%),linear-gradient(180deg,#0d2150,#071433)" },
  ar_mg_flames: { name: "Hot Rod Flames", css: "radial-gradient(ellipse at 20% 110%,rgba(255,138,31,.65),transparent 35%),radial-gradient(ellipse at 50% 115%,rgba(255,214,79,.55),transparent 35%),radial-gradient(ellipse at 80% 110%,rgba(255,138,31,.65),transparent 35%),repeating-linear-gradient(90deg,rgba(255,255,255,.04) 0 30px,transparent 30px 60px),linear-gradient(#141414,#1d1d1d)" },
  ar_mg_saucer: { name: "Saucer Attack", css: "repeating-linear-gradient(0deg,rgba(125,220,74,.16) 0 40px,rgba(241,236,181,.08) 40px 80px),repeating-conic-gradient(from 0deg at 50% 30%,rgba(255,255,255,.05) 0 4deg,transparent 4deg 12deg),linear-gradient(#101410,#101410)" },
  th_vikings: { name: "Vikings Purple & Gold", css: "linear-gradient(115deg,transparent 0 62%,rgba(255,198,47,.55) 62% 64%,transparent 64% 67%,rgba(255,198,47,.35) 67% 68%,transparent 68%),radial-gradient(ellipse at 25% 25%,rgba(79,38,131,.85),transparent 55%),linear-gradient(160deg,#12081f,#2a1150)" },
  th_wolves: { name: "Timberwolves Blue & Green", css: "radial-gradient(ellipse at 30% 20%,rgba(120,190,32,.45),transparent 45%),radial-gradient(ellipse at 70% 15%,rgba(35,97,146,.65),transparent 50%),linear-gradient(180deg,transparent 0 78%,rgba(158,162,162,.18) 78% 80%,transparent 80%),linear-gradient(180deg,#0c2340,#07111f)" },
  th_thermal: { name: "Thermal Vision", css: "radial-gradient(circle at 50% 50%,rgba(255,255,255,.55) 0 3%,rgba(255,220,0,.6) 8%,rgba(255,90,0,.55) 16%,rgba(220,0,40,.45) 24%,rgba(120,0,160,.40) 34%,rgba(20,40,200,.35) 46%,transparent 62%),linear-gradient(#05030f,#05030f)" },
  th_hunter: { name: "Jungle Hunter", css: "radial-gradient(ellipse at 15% 20%,rgba(60,110,40,.55),transparent 35%),radial-gradient(ellipse at 85% 30%,rgba(40,90,30,.5),transparent 35%),radial-gradient(ellipse at 50% 90%,rgba(30,70,25,.55),transparent 40%),repeating-linear-gradient(75deg,rgba(0,0,0,.25) 0 6px,transparent 6px 22px),linear-gradient(#050c06,#081409)" },
  th_xenohive: { name: "Xeno Hive", css: "repeating-radial-gradient(ellipse at 50% 120%,rgba(160,175,170,.10) 0 3px,transparent 3px 14px),repeating-linear-gradient(90deg,rgba(0,0,0,.45) 0 8px,rgba(120,135,130,.07) 8px 11px,transparent 11px 26px),radial-gradient(ellipse at 50% 100%,rgba(156,255,46,.15),transparent 50%),linear-gradient(#050607,#0b0d0e)" },
  th_tracker: { name: "Motion Tracker", css: "repeating-radial-gradient(circle at 50% 50%,rgba(57,255,136,.14) 0 1px,transparent 1px 70px),linear-gradient(90deg,transparent 49.9%,rgba(57,255,136,.12) 50%,transparent 50.1%),linear-gradient(0deg,transparent 49.9%,rgba(57,255,136,.12) 50%,transparent 50.1%),linear-gradient(#000a04,#000a04)" },
  th_marine: { name: "Colonial Marine", css: "repeating-linear-gradient(135deg,rgba(242,169,0,.18) 0 14px,rgba(0,0,0,.35) 14px 28px),radial-gradient(ellipse at 30% 40%,rgba(85,90,50,.55),transparent 35%),radial-gradient(ellipse at 70% 60%,rgba(60,65,35,.55),transparent 35%),linear-gradient(#0e0f0a,#0e0f0a)" },
};
// Color-theory themes (each comes with a matching wallpaper; set Wallpaper to None to turn it off).
// Every one passes readability checks: text 7:1+, buttons and links 4.5:1+.
const COLOR_THEORY = {
  synthwave: { name: "Synthwave \u00b7 split-complementary", bg: '#1a0b2e', surface: '#261447', text: '#f5e9ff', accent: '#ff2a9d', accentText: '#1a0b2e', link: '#2de2e6', border: '#4b2a7a', input: '#140824', wp: WALLPAPERS.synthgrid.css, wpDim: 35, wpSee: 30, glow: true },
  cyberpunk: { name: "Cyberpunk Neon \u00b7 complementary", bg: '#0d0221', surface: '#1b0f3a', text: '#f0f0ff', accent: '#f9f002', accentText: '#0d0221', link: '#00f0ff', border: '#3c2a6e', input: '#090118', wp: WALLPAPERS.neon.css, wpDim: 35, wpSee: 30, glow: true, fx: 'pulse', fxColor: '#ff00c8' },
  lagoon: { name: "Tropical Lagoon \u00b7 complementary", bg: '#04262b', surface: '#0a3a40', text: '#e6fffb', accent: '#ff6f59', accentText: '#2a0a05', link: '#4fe3d0', border: '#16606a', input: '#032026', wp: WALLPAPERS.lagoon.css, wpDim: 35, wpSee: 30 },
  autumn: { name: "Autumn Harvest \u00b7 analogous", bg: '#1c120b', surface: '#2a1b10', text: '#fbeedd', accent: '#e8a33d', accentText: '#1c120b', link: '#d4e157', border: '#4a3220', input: '#160e08', wp: WALLPAPERS.autumn.css, wpDim: 35, wpSee: 30 },
  aurora: { name: "Nordic Aurora \u00b7 triadic", bg: '#0b1622', surface: '#13233a', text: '#e8f1ff', accent: '#34d399', accentText: '#04221a', link: '#c4b5fd', border: '#24405e', input: '#08111b', wp: WALLPAPERS.aurora.css, wpDim: 35, wpSee: 30 },
  royal: { name: "Royal Gold \u00b7 complementary", bg: '#0a0f2c', surface: '#141b45', text: '#f4f1e6', accent: '#d4af37', accentText: '#0a0f2c', link: '#e9c46a', border: '#2c3672', input: '#070b22', wp: WALLPAPERS.golddust.css, wpDim: 35, wpSee: 30 },
  amethyst: { name: "Amethyst & Citrine \u00b7 complementary", bg: '#160f24', surface: '#241838', text: '#f3ecff', accent: '#fbbf24', accentText: '#1b1206', link: '#c4b5fd', border: '#3d2b5c', input: '#110b1c', wp: WALLPAPERS.amethyst.css, wpDim: 35, wpSee: 30 },
  oceansun: { name: "Ocean Sunset \u00b7 split-complementary", bg: '#0b1a33', surface: '#13284d', text: '#eaf2ff', accent: '#ff8c42', accentText: '#1a0d00', link: '#ff8fb8', border: '#23406e', input: '#081429', wp: WALLPAPERS.sunset.css, wpDim: 35, wpSee: 30 },
  teal: { name: "Deep Teal \u00b7 monochromatic", bg: '#031c1c', surface: '#072c2c', text: '#d9fffb', accent: '#14b8a6', accentText: '#022020', link: '#5eead4', border: '#0f4a48', input: '#021616', wp: WALLPAPERS.teal.css, wpDim: 35, wpSee: 30 },
  lava: { name: "Lava Flow \u00b7 analogous", bg: '#120808', surface: '#1f0e0c', text: '#ffece6', accent: '#ff5a1f', accentText: '#1a0500', link: '#ffb347', border: '#3d1a14', input: '#0d0505', wp: WALLPAPERS.ember.css, wpDim: 35, wpSee: 30 },
  matrix: { name: "Matrix \u00b7 monochromatic", bg: '#000a00', surface: '#031a05', text: '#b6ffb6', accent: '#00ff66', accentText: '#001a08', link: '#7dff9e', border: '#0f3d16', input: '#000700', wp: WALLPAPERS.matrix.css, wpDim: 35, wpSee: 30, glow: true, fx: 'code', fxColor: '#00ff66' },
  sakura: { name: "Sakura Night \u00b7 complementary", bg: '#1f0f1a', surface: '#2e1727', text: '#ffeef6', accent: '#ff8fc7', accentText: '#2a0b1c', link: '#7ee8c8', border: '#4d2a42', input: '#180b14', wp: WALLPAPERS.sakura.css, wpDim: 35, wpSee: 30 },
  ultraviolet: { name: "Ultraviolet \u00b7 tetradic", bg: '#0e0420', surface: '#1c0b3a', text: '#f3eaff', accent: '#7cff4f', accentText: '#0e0420', link: '#ff6ad5', border: '#3a1f6b', input: '#0a0318', wp: WALLPAPERS.ct_ultraviolet.css, wpDim: 30, wpSee: 30, glow: true },
  mojave: { name: "Mojave Desert \u00b7 complementary", bg: '#1d140e', surface: '#2b1e15', text: '#fbefe2', accent: '#3fc1b0', accentText: '#062420', link: '#f0a35e', border: '#4d3727', input: '#170f0a', wp: WALLPAPERS.ct_mojave.css, wpDim: 30, wpSee: 30 },
  glacier: { name: "Glacier \u00b7 monochromatic", bg: '#06141f', surface: '#0c2233', text: '#e6f6ff', accent: '#7dd3fc', accentText: '#062033', link: '#bae6fd', border: '#1b3d57', input: '#041019', wp: WALLPAPERS.ct_glacier.css, wpDim: 30, wpSee: 30 },
  volcano: { name: "Volcano Ash \u00b7 complementary", bg: '#15171c', surface: '#20242c', text: '#eef0f4', accent: '#ff7a1a', accentText: '#1a0c00', link: '#8fb3ff', border: '#363c48', input: '#101216', wp: WALLPAPERS.ct_volcano.css, wpDim: 30, wpSee: 30 },
  rainforest: { name: "Rainforest Orchid \u00b7 complementary", bg: '#07170e', surface: '#0e2618', text: '#e8fff0', accent: '#ff4fa3', accentText: '#26051a', link: '#6ee7a8', border: '#1d4a31', input: '#05110a', wp: WALLPAPERS.ct_rainforest.css, wpDim: 30, wpSee: 30 },
  racing: { name: "Midnight Racing \u00b7 complementary", bg: '#071226', surface: '#0f1f3d', text: '#eef4ff', accent: '#ff9f1c', accentText: '#1a0d00', link: '#5cc8ff', border: '#233b66', input: '#050d1c', wp: WALLPAPERS.ct_racing.css, wpDim: 30, wpSee: 30 },
  bubblegum: { name: "Bubblegum Pop \u00b7 triadic", bg: '#1b0f24', surface: '#2a1838', text: '#fff0fb', accent: '#ff5fc1', accentText: '#24061a', link: '#5ff2e2', border: '#4a2c5f', input: '#140b1b', wp: WALLPAPERS.ct_bubblegum.css, wpDim: 30, wpSee: 30 },
  copper: { name: "Copper Patina \u00b7 complementary", bg: '#10191a', surface: '#182527', text: '#effaf7', accent: '#d08a4e', accentText: '#1a0d04', link: '#6fd3b8', border: '#2d4245', input: '#0c1314', wp: WALLPAPERS.ct_copper.css, wpDim: 30, wpSee: 30 },
  galaxy: { name: "Galaxy \u00b7 split-complementary", bg: '#0a0820', surface: '#15123a', text: '#eeeaff', accent: '#ffd166', accentText: '#1a1400', link: '#ef7ac0', border: '#2e2866', input: '#070617', wp: WALLPAPERS.ct_galaxy.css, wpDim: 30, wpSee: 30 },
  slatemint: { name: "Slate & Mint \u00b7 analogous", bg: '#12181d', surface: '#1b242b', text: '#e9f1f5', accent: '#5eead4', accentText: '#06201c', link: '#93c5fd', border: '#2f3d47', input: '#0e1317', wp: WALLPAPERS.ct_slatemint.css, wpDim: 30, wpSee: 30 },
  peacock: { name: "Peacock \u00b7 analogous + gold", bg: '#04141f', surface: '#0a2233', text: '#e8f8ff', accent: '#00b4d8', accentText: '#021a24', link: '#f4c430', border: '#17405a', input: '#030f17', wp: WALLPAPERS.ct_peacock.css, wpDim: 30, wpSee: 30 },
  grape: { name: "Grape Soda \u00b7 complementary", bg: '#170a26', surface: '#25123d', text: '#f4ebff', accent: '#b388ff', accentText: '#170a26', link: '#c6ff6b', border: '#43266b', input: '#11071c', wp: WALLPAPERS.ct_grape.css, wpDim: 30, wpSee: 30 },
  espresso: { name: "Espresso \u00b7 monochromatic", bg: '#17100c', surface: '#231912', text: '#f6ece2', accent: '#c8a27a', accentText: '#1a1009', link: '#e6c9a8', border: '#3e2d22', input: '#120c09', wp: WALLPAPERS.ct_espresso.css, wpDim: 30, wpSee: 30 },
  tokyo: { name: "Neon Tokyo \u00b7 tetradic", bg: '#08050f', surface: '#140d22', text: '#f4f0ff', accent: '#00e5ff', accentText: '#001a1f', link: '#ff3ec9', border: '#2f2150', input: '#06040b', wp: WALLPAPERS.ct_tokyo.css, wpDim: 30, wpSee: 30, glow: true },
  mintchoc: { name: "Mint Chocolate \u00b7 complementary", bg: '#1a120e', surface: '#261a14', text: '#f2fff9', accent: '#6ee7b7', accentText: '#08251a', link: '#a7f3d0', border: '#43302a', input: '#140d0a', wp: WALLPAPERS.ct_mintchoc.css, wpDim: 30, wpSee: 30 },
  lavender: { name: "Twilight Lavender \u00b7 analogous", bg: '#141326', surface: '#1f1d3a', text: '#efeeff', accent: '#a5b4fc', accentText: '#141326', link: '#f0abfc', border: '#39366a', input: '#0f0e1c', wp: WALLPAPERS.ct_lavender.css, wpDim: 30, wpSee: 30 },
  solar: { name: "Solar Flare \u00b7 analogous", bg: '#120d04', surface: '#1e1608', text: '#fff6e0', accent: '#ffc300', accentText: '#1a1200', link: '#ff8c42', border: '#3d2f12', input: '#0d0903', wp: WALLPAPERS.ct_solar.css, wpDim: 30, wpSee: 30 },
  arctic: { name: "Arctic Night \u00b7 complementary", bg: '#0a1018', surface: '#121b28', text: '#ecf3ff', accent: '#4cc9f0', accentText: '#04161d', link: '#ff7eb6', border: '#24344a', input: '#070b11', wp: WALLPAPERS.ct_arctic.css, wpDim: 30, wpSee: 30 },
  cabin: { name: "Forest Cabin \u00b7 complementary", bg: '#0f140c', surface: '#182014', text: '#eef5e6', accent: '#e07a2f', accentText: '#1a0b00', link: '#a3d977', border: '#2e3a24', input: '#0b0f09', wp: WALLPAPERS.ct_cabin.css, wpDim: 30, wpSee: 30 },
  reef: { name: "Coral Reef \u00b7 split-complementary", bg: '#0a1626', surface: '#11223a', text: '#edf6ff', accent: '#ff7f6e', accentText: '#1f0806', link: '#4fd1c5', border: '#21395c', input: '#07111d', wp: WALLPAPERS.ct_reef.css, wpDim: 30, wpSee: 30 },
};
// Themed looks: cyberpunk, space opera, car, and art-inspired. Original palettes and patterns
// (no logos, characters or artwork copied). All pass the same readability checks.
const THEMED = {
  neonnoir: { name: "Neon Noir", about: "cyberpunk teal + pink", bg: '#0a0614', surface: '#160c26', text: '#f2f0ff', accent: '#00f5d4', accentText: '#04201b', link: '#ff5fae', border: '#33205a', input: '#07040f', wp: WALLPAPERS.th_neonnoir.css, wpDim: 25, wpSee: 30, glow: true, fx: 'pulse', fxColor: '#ff2e97' },
  nightrain: { name: "Night City Rain", about: "cyberpunk cyan + magenta", bg: '#05070f', surface: '#0d1224', text: '#eaf6ff', accent: '#ff2e97', accentText: '#1a0010', link: '#3df5ff', border: '#22305a', input: '#04050b', wp: WALLPAPERS.th_nightrain.css, wpDim: 25, wpSee: 30, glow: true, fx: 'rain', fxColor: '#3df5ff' },
  vaporwave: { name: "Vaporwave", about: "cyberpunk pink + teal + purple", bg: '#1a0b2a', surface: '#2a1342', text: '#fff0fb', accent: '#01cdfe', accentText: '#08142a', link: '#ff71ce', border: '#4b2a6e', input: '#13081f', wp: WALLPAPERS.th_vaporwave.css, wpDim: 25, wpSee: 30, glow: true },
  hologrid: { name: "Holo Grid", about: "cyberpunk teal grid + magenta", bg: '#03100f', surface: '#08201e', text: '#e6fffb', accent: '#ff3ea5', accentText: '#25001a', link: '#2ef2d0', border: '#134540', input: '#020b0a', wp: WALLPAPERS.th_hologrid.css, wpDim: 25, wpSee: 30, glow: true, fx: 'scan', fxColor: '#2ef2d0' },
  glitch: { name: "Glitch Arcade", about: "cyberpunk split teal / pink", bg: '#08080c', surface: '#13131c', text: '#f5f5ff', accent: '#5cf2ff', accentText: '#041a1f', link: '#ff6ec7', border: '#2b2b40', input: '#060609', wp: WALLPAPERS.th_glitch.css, wpDim: 25, wpSee: 30, glow: true, fx: 'scan', fxColor: '#ff6ec7' },
  hyperspace: { name: "Hyperspace", about: "space opera: light-speed streaks", bg: '#020308', surface: '#0b0f1c', text: '#eef3ff', accent: '#4cc9f0', accentText: '#021219', link: '#ffd166', border: '#1f2a44', input: '#010206', wp: WALLPAPERS.th_hyperspace.css, wpDim: 25, wpSee: 30, fx: 'stars', fxColor: '#cfe8ff' },
  twinsuns: { name: "Twin Suns Desert", about: "space opera: desert planet at dusk", bg: '#1a120a', surface: '#2a1d12', text: '#fbeedb', accent: '#f2a541', accentText: '#1a0f00', link: '#8ecae6', border: '#4a3420', input: '#140d07', wp: WALLPAPERS.th_twinsuns.css, wpDim: 25, wpSee: 30 },
  darkempire: { name: "Dark Empire", about: "space opera: black, steel and red", bg: '#060606', surface: '#121315', text: '#eceef0', accent: '#c8ccd2', accentText: '#060606', link: '#ff4d4d', border: '#2c2f33', input: '#040404', wp: WALLPAPERS.th_darkempire.css, wpDim: 25, wpSee: 30, fx: 'scan', fxColor: '#ff3b3b' },
  saberduel: { name: "Saber Duel", about: "space opera: blue vs red glow", bg: '#05060c', surface: '#0f1120', text: '#eef2ff', accent: '#3ea6ff', accentText: '#021426', link: '#ff6b6b', border: '#232845', input: '#030409', wp: WALLPAPERS.th_saberduel.css, wpDim: 25, wpSee: 30, glow: true },
  typesblue: { name: "TL Type-S Blue Pearl", about: "car: deep blue pearl + Type-S red", bg: '#060c18', surface: '#0d1a33', text: '#eaf1ff', accent: '#2f6fe4', accentText: '#ffffff', link: '#ff5a5a', border: '#1d3a6b', input: '#040914', wp: WALLPAPERS.th_typesblue.css, wpDim: 25, wpSee: 30 },
  typescarbon: { name: "TL Type-S Carbon", about: "car: anthracite, carbon fiber, red S", bg: '#0c0d0f', surface: '#17191c', text: '#eceef1', accent: '#c9d1da', accentText: '#0c0d0f', link: '#ff5a5a', border: '#2e3238', input: '#08090a', wp: WALLPAPERS.th_typescarbon.css, wpDim: 25, wpSee: 30 },
  screenprint: { name: "Screenprint Poster", about: "art: vintage limited-ink screen print (Tidwell-inspired)", bg: '#17120d', surface: '#231b13', text: '#f3e6c8', accent: '#c9a227', accentText: '#17120d', link: '#7cc3b6', border: '#4a3a26', input: '#120e0a', wp: WALLPAPERS.th_screenprint.css, wpDim: 25, wpSee: 30, wpFit: 'tile', wpTile: '9px 9px' },
  inkbone: { name: "Ink & Bone", about: "art: stark pen and ink, one red spot color (Van Dyke-inspired)", bg: '#070707', surface: '#121212', text: '#efe9dc', accent: '#efe9dc', accentText: '#070707', link: '#ff4d5e', border: '#3a3a3a', input: '#050505', wp: WALLPAPERS.th_inkbone.css, wpDim: 25, wpSee: 30 },
  bmx80s: { name: "80s Haro Green", about: "80s freestyle BMX: green frame color sampled from photos, blue/light-blue/coral decal stripes", bg: '#050a06', surface: '#0e1810', text: '#f2fff4', accent: '#10e156', accentText: '#02160a', link: '#4fc3ff', border: '#1f4a2a', input: '#040805', wp: WALLPAPERS.th_bmx80s.css, wpDim: 20, wpSee: 30, glow: true, fx: '', fxColor: '#10e156' },
  bmx80sblue: { name: "80s Haro Blue", about: "80s freestyle BMX: teal/aqua frame color sampled from photos, white stripes, coral accents", bg: '#041314', surface: '#0a2224', text: '#effefe', accent: '#1ccacb', accentText: '#021a1a', link: '#ff8a7a', border: '#1a4547', input: '#030e0f', wp: WALLPAPERS.th_bmx80sblue.css, wpDim: 20, wpSee: 30, glow: true, fx: '', fxColor: '#1ccacb' },
  crawl: { name: "Opening Crawl", about: "space opera: yellow title text on a drifting starfield", bg: '#000000', surface: '#07080d', text: '#ffe81f', accent: '#ffe81f', accentText: '#000000', link: '#9fd8ff', border: '#2a2a18', input: '#000000', wp: WALLPAPERS.th_crawl.css, wpDim: 20, wpSee: 30, glow: false, fx: 'stars', fxColor: '#ffffff' },
  iceplanet: { name: "Ice Planet Outpost", about: "space opera: frozen rebel-style base, falling snow", bg: '#0a121a', surface: '#122030', text: '#eef6ff', accent: '#9ad7ff', accentText: '#06202f', link: '#ffb36b', border: '#27405a', input: '#08101a', wp: WALLPAPERS.th_iceplanet.css, wpDim: 20, wpSee: 30, glow: false, fx: 'snow', fxColor: '#ffffff' },
  forestmoon: { name: "Forest Moon", about: "space opera: giant redwood forest moon, fireflies", bg: '#0a1108', surface: '#132010', text: '#eef7e4', accent: '#d4a373', accentText: '#1a0f05', link: '#9bdb70', border: '#2d4224', input: '#070d06', wp: WALLPAPERS.th_forestmoon.css, wpDim: 20, wpSee: 30, glow: false, fx: 'fireflies', fxColor: '#d9ff8a' },
  cloudcity: { name: "Cloud City Sunset", about: "space opera: city above the clouds at sunset", bg: '#1c1020', surface: '#2a1830', text: '#fff1ea', accent: '#ffb38a', accentText: '#2a0f05', link: '#f5d0fe', border: '#4b2d52', input: '#160c19', wp: WALLPAPERS.th_cloudcity.css, wpDim: 20, wpSee: 30, glow: false, fx: 'pulse', fxColor: '#ff9a76' },
  imperialbridge: { name: "Imperial Bridge", about: "space opera: dark command bridge, red and green console lights", bg: '#0b0c0e', surface: '#16181c', text: '#e9ecef', accent: '#c8ccd2', accentText: '#0b0c0e', link: '#7dff9a', border: '#30343a', input: '#08090a', wp: WALLPAPERS.th_imperialbridge.css, wpDim: 20, wpSee: 30, glow: false, fx: 'scan', fxColor: '#ff3b3b' },
  crimsonsaber: { name: "Crimson Saber", about: "space opera: dark side red glow", bg: '#070203', surface: '#140608', text: '#ffeef0', accent: '#ffd6da', accentText: '#3a0008', link: '#ff6b7a', border: '#3a1218', input: '#050102', wp: WALLPAPERS.th_crimsonsaber.css, wpDim: 20, wpSee: 30, glow: true, fx: 'pulse', fxColor: '#ff1a2e' },
  digitalrain: { name: "Digital Rain", about: "Matrix-style falling green code", bg: '#000300', surface: '#020d04', text: '#c2ffcf', accent: '#00ff41', accentText: '#001a07', link: '#8dff9f', border: '#0d3314', input: '#000200', wp: WALLPAPERS.th_digitalrain.css, wpDim: 20, wpSee: 30, glow: true, fx: 'code', fxColor: '#00ff41' },
  mainframe: { name: "Mainframe", about: "Matrix-style green phosphor CRT with scanlines", bg: '#010801', surface: '#041204', text: '#9cff9c', accent: '#33ff33', accentText: '#001a00', link: '#d4ffd4', border: '#0f3a0f', input: '#010601', wp: WALLPAPERS.th_mainframe.css, wpDim: 20, wpSee: 30, glow: true, fx: 'scan', fxColor: '#33ff33' },
  vikings: { name: "Vikings Purple & Gold", about: "sports: Minnesota Vikings team colors (purple #4F2683, gold #FFC62F)", bg: '#12081f', surface: '#1e1033', text: '#f6f0ff', accent: '#ffc62f', accentText: '#1a0f00', link: '#d0b0ff', border: '#4f2683', input: '#0e0618', wp: WALLPAPERS.th_vikings.css, wpDim: 20, wpSee: 30, glow: true, fx: '', fxColor: '#ffc62f' },
  wolves: { name: "Timberwolves Blue & Green", about: "sports: Minnesota Timberwolves colors (midnight blue, lake blue, aurora green, moonlight grey)", bg: '#07111f', surface: '#0c2340', text: '#eef5ff', accent: '#78be20', accentText: '#0a1a00', link: '#8fc4ff', border: '#236192', input: '#050d18', wp: WALLPAPERS.th_wolves.css, wpDim: 20, wpSee: 30, glow: false, fx: 'pulse', fxColor: '#78be20' },
  thermal: { name: "Thermal Vision", about: "movie-inspired: alien hunter heat vision", bg: '#05030f', surface: '#0e0a24', text: '#fff4e8', accent: '#ffb000', accentText: '#1a0d00', link: '#5ad1ff', border: '#2a2050', input: '#04020b', wp: WALLPAPERS.th_thermal.css, wpDim: 20, wpSee: 30, glow: true, fx: 'pulse', fxColor: '#ff3b1f' },
  hunter: { name: "Jungle Hunter", about: "movie-inspired: jungle canopy with a three-dot laser sight", bg: '#050c06', surface: '#0d1a0e', text: '#e9f5e4', accent: '#8fbf5a', accentText: '#0b1a04', link: '#ff6a5c', border: '#23401f', input: '#040a05', wp: WALLPAPERS.th_hunter.css, wpDim: 20, wpSee: 30, glow: false, fx: 'laser', fxColor: '#ff2020' },
  xenohive: { name: "Xeno Hive", about: "movie-inspired: ribbed black biomechanical hive, acid green", bg: '#050607', surface: '#101315', text: '#e6ece9', accent: '#9cff2e', accentText: '#0d1a00', link: '#b6c6c0', border: '#2a3133', input: '#040505', wp: WALLPAPERS.th_xenohive.css, wpDim: 20, wpSee: 30, glow: true, fx: '', fxColor: '#9cff2e' },
  tracker: { name: "Motion Tracker", about: "movie-inspired: green radar motion tracker with rotating sweep", bg: '#000a04', surface: '#031a0b', text: '#c8ffd8', accent: '#39ff88', accentText: '#00140a', link: '#a8ffc8', border: '#0e3d20', input: '#000703', wp: WALLPAPERS.th_tracker.css, wpDim: 20, wpSee: 30, glow: true, fx: 'sweep', fxColor: '#39ff88' },
  marine: { name: "Colonial Marine", about: "movie-inspired: olive drab military with amber HUD", bg: '#0e0f0a', surface: '#1a1c14', text: '#f0f0e0', accent: '#f2a900', accentText: '#1a1100', link: '#c5d86d', border: '#3a3d2c', input: '#0a0b07', wp: WALLPAPERS.th_marine.css, wpDim: 20, wpSee: 30, glow: false, fx: 'scan', fxColor: '#f2a900' },
};
Object.assign(PRESETS, COLOR_THEORY);
Object.assign(PRESETS, THEMED);
// Art-print looks: palettes and textures inspired by poster artists' work (colors and line
// textures only, no artwork copied). Same readability checks as every other theme.
const ART = {
  tw_mask: { name: "Skull Mask Inks", about: "art: violet, rust, orange, gold and bone screen print (Tidwell-inspired)", bg: '#120d14', surface: '#221a28', text: '#efe8d6', accent: '#f08a2a', accentText: '#1a0a00', link: '#e3c06a', border: '#4a3a55', input: '#0e0a10', wp: WALLPAPERS.ar_tw_mask.css, wpDim: 20, wpSee: 30, glow: false, fx: 'pulse', fxColor: '#f08a2a' },
  tw_teal: { name: "Teal & Burnt Orange", about: "art: teal, burnt orange and cream variant (Tidwell-inspired)", bg: '#0d1416', surface: '#172326', text: '#f3e6c6', accent: '#e2622a', accentText: '#1a0700', link: '#8fc3c8', border: '#2f4a4f', input: '#0a1012', wp: WALLPAPERS.ar_tw_teal.css, wpDim: 20, wpSee: 30, glow: false, fx: '', fxColor: '' },
  tw_phoenix: { name: "Phoenix Feathers", about: "art: rust, gold and teal on warm gray (Tidwell-inspired)", bg: '#1a1714', surface: '#26221d', text: '#f1e8d8', accent: '#e8a636', accentText: '#1a1000', link: '#4fc0d6', border: '#4a443b', input: '#14110f', wp: WALLPAPERS.ar_tw_phoenix.css, wpDim: 20, wpSee: 30, glow: false, fx: 'fireflies', fxColor: '#ffb347' },
  tw_tree: { name: "Twisted Tree Sunset", about: "art: purple-to-peach halftone sunset, olive and mint (Tidwell-inspired)", bg: '#1b1120', surface: '#2a1a30', text: '#fbe9d6', accent: '#f2a65e', accentText: '#20100a', link: '#9fd6cf', border: '#4c3254', input: '#150d19', wp: WALLPAPERS.ar_tw_tree.css, wpDim: 20, wpSee: 30, glow: false, fx: '', fxColor: '' },
  tw_slime: { name: "Blower & Slime", about: "art: fluorescent orange, slime green and chrome blue hot-rod print (Tidwell-inspired)", bg: '#120a06', surface: '#1f120b', text: '#fff1e8', accent: '#39e639', accentText: '#021a02', link: '#ff8a52', border: '#4a2a1a', input: '#0e0704', wp: WALLPAPERS.ar_tw_slime.css, wpDim: 20, wpSee: 30, glow: true, fx: '', fxColor: '' },
  vd_ballpoint: { name: "Ballpoint Blue", about: "art: dense blue ballpoint-pen hatching (Van Dyke-inspired)", bg: '#0c0f24', surface: '#141a3a', text: '#e6e9ff', accent: '#8f9bff', accentText: '#050824', link: '#c3caff', border: '#2a3370', input: '#090b1c', wp: WALLPAPERS.ar_vd_ballpoint.css, wpDim: 20, wpSee: 30, glow: false, fx: '', fxColor: '' },
  vd_hatch: { name: "Crosshatch Engraving", about: "art: black and white crosshatch engraving (Van Dyke-inspired)", bg: '#080808', surface: '#141414', text: '#f2f2f2', accent: '#e8e8e8', accentText: '#0a0a0a', link: '#c8c8c8', border: '#3a3a3a', input: '#060606', wp: WALLPAPERS.ar_vd_hatch.css, wpDim: 20, wpSee: 30, glow: false, fx: '', fxColor: '' },
  mg_speed: { name: "Speed Lines", about: "art: grayscale-ramp speed lines (Grundy-inspired)", bg: '#1a1a1a', surface: '#262626', text: '#f2f2f2', accent: '#e6e6e6', accentText: '#111111', link: '#cfcfcf', border: '#444444', input: '#141414', wp: WALLPAPERS.ar_mg_speed.css, wpDim: 20, wpSee: 30, glow: false, fx: 'stars', fxColor: '#d0d0d0' },
  mg_green: { name: "Atomic Green", about: "art: lime-to-olive ramp with sunburst rays (Grundy-inspired)", bg: '#0f1a05', surface: '#1a2a0a', text: '#f2ffd6', accent: '#c6f432', accentText: '#142000', link: '#e8ff8a', border: '#3a5a12', input: '#0b1404', wp: WALLPAPERS.ar_mg_green.css, wpDim: 20, wpSee: 30, glow: false, fx: 'spin', fxColor: '#c6f432' },
  mg_blue: { name: "Atomic Blue", about: "art: navy-to-sky ramp with a bright sunburst (Grundy-inspired)", bg: '#071433', surface: '#0d2150', text: '#eaf2ff', accent: '#9cc8ff', accentText: '#071433', link: '#d6e8ff', border: '#23407a', input: '#050f27', wp: WALLPAPERS.ar_mg_blue.css, wpDim: 20, wpSee: 30, glow: false, fx: 'spin', fxColor: '#ffffff' },
  mg_flames: { name: "Hot Rod Flames", about: "art: gray ramp, orange-yellow flames, green hot rod (Grundy-inspired)", bg: '#141414', surface: '#222222', text: '#f5f0e6', accent: '#ff8a1f', accentText: '#1a0a00', link: '#8fd19e', border: '#3a3a3a', input: '#101010', wp: WALLPAPERS.ar_mg_flames.css, wpDim: 20, wpSee: 30, glow: true, fx: 'pulse', fxColor: '#ff8a1f' },
  mg_saucer: { name: "Saucer Attack", about: "art: green, cream and gray 50s sci-fi print (Grundy-inspired)", bg: '#101410', surface: '#1c221c', text: '#f3f5e6', accent: '#7ddc4a', accentText: '#0a1a02', link: '#f1ecb5', border: '#384238', input: '#0c100c', wp: WALLPAPERS.ar_mg_saucer.css, wpDim: 20, wpSee: 30, glow: false, fx: 'scan', fxColor: '#7ddc4a' },
};
Object.assign(PRESETS, ART);
// Color Lab: one color-theory scheme each, shown as a slowly drifting mesh of soft color fields.
// Buttons use the scheme's lead color; the hover laser uses its complement on the color wheel.
const LAB = {
  lab_split: { name: "Split Signal \u00b7 split-complementary", about: "color lab: split-complementary", bg: '#03191c', surface: '#082a2e', text: '#eafcfb', accent: '#ff7a5c', accentText: '#1f0700', link: '#ff8fb4', border: '#16474c', input: '#021316', wp: 'linear-gradient(#03191c,#03191c)', wpDim: 0, wpSee: 38, glow: true, fx: 'mesh', fxColor: '', mesh: ["#0e7f86", "#ff6b57", "#ff3d7f", "#06363b"], hover: 'laser', hoverColor: '#3be0d4' },
  lab_triad: { name: "Triad Pulse \u00b7 triadic", about: "color lab: triadic", bg: '#0a0716', surface: '#141029', text: '#f3f0ff', accent: '#a78bfa', accentText: '#120a2e', link: '#fbbf24', border: '#2d2552', input: '#07050f', wp: 'linear-gradient(#0a0716,#0a0716)', wpDim: 0, wpSee: 38, glow: true, fx: 'mesh', fxColor: '', mesh: ["#7c3aed", "#14b8a6", "#f59e0b", "#1e1145"], hover: 'laser', hoverColor: '#fbbf24' },
  lab_tetrad: { name: "Tetrad Bloom \u00b7 tetradic (square)", about: "color lab: tetradic (square)", bg: '#0b0b12', surface: '#15151f', text: '#f7f7fb', accent: '#d4ff3a', accentText: '#141f00', link: '#5ee8ff', border: '#2e2e44', input: '#08080d', wp: 'linear-gradient(#0b0b12,#0b0b12)', wpDim: 0, wpSee: 38, glow: true, fx: 'mesh', fxColor: '', mesh: ["#ff2fb3", "#b6ff2a", "#22d3ee", "#ff8a1f"], hover: 'laser', hoverColor: '#ff2fb3' },
  lab_ember: { name: "Analog Ember \u00b7 analogous warm", about: "color lab: analogous warm", bg: '#140806', surface: '#22100b', text: '#fff0e8', accent: '#ffb020', accentText: '#1f1000', link: '#ffd27a', border: '#4a2418', input: '#0f0604', wp: 'linear-gradient(#140806,#140806)', wpDim: 0, wpSee: 38, glow: true, fx: 'mesh bokeh', fxColor: '#ffb020', fxColors: ["#ffb020", "#ff5a1f", "#ffd27a"], mesh: ["#b4141e", "#ff5a1f", "#ffb020", "#3a0a08"], hover: 'laser', hoverColor: '#20c8ff' },
  lab_abyss: { name: "Analog Abyss \u00b7 analogous cool", about: "color lab: analogous cool", bg: '#04061a', surface: '#0a0f2e', text: '#eaf2ff', accent: '#38bdf8', accentText: '#021523', link: '#a5b4fc', border: '#1e2a5e', input: '#030414', wp: 'linear-gradient(#04061a,#04061a)', wpDim: 0, wpSee: 38, glow: true, fx: 'mesh flake', fxColor: '#ffffff', fxColors: ["#ffffff", "#a5b4fc", "#67e8f9"], mesh: ["#3730a3", "#1d4ed8", "#06b6d4", "#0b0b3a"], hover: 'laser', hoverColor: '#ffb020' },
  lab_cobalt: { name: "Cobalt Mono \u00b7 monochromatic", about: "color lab: monochromatic", bg: '#030b1f', surface: '#081634', text: '#e8f0ff', accent: '#6ea8ff', accentText: '#041228', link: '#b9d3ff', border: '#18306a', input: '#020816', wp: 'linear-gradient(#030b1f,#030b1f)', wpDim: 0, wpSee: 38, glow: true, fx: 'mesh', fxColor: '', mesh: ["#0a2a7a", "#1f5fff", "#7fb0ff", "#04102e"], hover: 'laser', hoverColor: '#ffa63d' },
  lab_voltage: { name: "Complement Voltage \u00b7 complementary", about: "color lab: complementary", bg: '#050914', surface: '#0c1428', text: '#f2f6ff', accent: '#ff7a00', accentText: '#1f0d00', link: '#6ea2ff', border: '#1e2e5a', input: '#03060e', wp: 'linear-gradient(#050914,#050914)', wpDim: 0, wpSee: 38, glow: true, fx: 'mesh circuit', fxColor: '#2563ff', fxColors: ["#2563ff", "#ff7a00"], mesh: ["#2563ff", "#ff7a00", "#0a1a5a", "#ff3d00"], hover: 'laser', hoverColor: '#2f8bff' },
  lab_acid: { name: "Acid Duotone \u00b7 complementary duotone", about: "color lab: complementary duotone", bg: '#0e0420', surface: '#190a33', text: '#f6f0ff', accent: '#c6ff00', accentText: '#162000', link: '#e0b8ff', border: '#3a1f66', input: '#0a0318', wp: 'linear-gradient(#0e0420,#0e0420)', wpDim: 0, wpSee: 38, glow: true, fx: 'mesh', fxColor: '', mesh: ["#5b1fb8", "#c6ff00", "#2a0a5a", "#8a2be2"], hover: 'laser', hoverColor: '#b14dff' },
  lab_pearl: { name: "Iridescent Pearl \u00b7 analogous pastel", about: "color lab: analogous pastel", bg: '#121218', surface: '#1c1c26', text: '#f8f6ff', accent: '#f0b8ff', accentText: '#25102e', link: '#a8f0e0', border: '#38384c', input: '#0e0e14', wp: 'linear-gradient(#121218,#121218)', wpDim: 0, wpSee: 38, glow: true, fx: 'mesh flake', fxColor: '#ffffff', fxColors: ["#ffffff", "#f0b8ff", "#a8f0e0"], mesh: ["#f0b8ff", "#a8d8ff", "#a8f0e0", "#ffe0c8"], hover: 'laser', hoverColor: '#ffe08a' },
  lab_aurora: { name: "Borealis \u00b7 analogous green-teal-violet", about: "color lab: analogous green-teal-violet", bg: '#020d10', surface: '#081c22', text: '#e8fff8', accent: '#34f5a0', accentText: '#00200f', link: '#c4a6ff', border: '#164a44', input: '#010a0c', wp: 'linear-gradient(#020d10,#020d10)', wpDim: 0, wpSee: 38, glow: true, fx: 'mesh', fxColor: '', mesh: ["#10b981", "#06b6d4", "#8b5cf6", "#022c22"], hover: 'laser', hoverColor: '#ff5fa8' },
  lab_infrared: { name: "Infrared \u00b7 analogous red-magenta", about: "color lab: analogous red-magenta", bg: '#14030c', surface: '#230818', text: '#fff0f6', accent: '#ff4fa3', accentText: '#25000f', link: '#ffb27a', border: '#4a1430', input: '#0f0208', wp: 'linear-gradient(#14030c,#14030c)', wpDim: 0, wpSee: 38, glow: true, fx: 'mesh', fxColor: '', mesh: ["#e11d48", "#db2777", "#f97316", "#3b0618"], hover: 'laser', hoverColor: '#2fffd0' },
  lab_noir: { name: "Chromatic Noir \u00b7 neutral + single complementary pop", about: "color lab: neutral + single complementary pop", bg: '#08080a', surface: '#121216', text: '#f2f2f4', accent: '#00e5ff', accentText: '#001a1f', link: '#ff8a95', border: '#2c2c34', input: '#060608', wp: 'linear-gradient(#08080a,#08080a)', wpDim: 0, wpSee: 38, glow: true, fx: 'mesh', fxColor: '', mesh: ["#1a1a22", "#ff3b4f", "#00e5ff", "#0d0d12"], hover: 'laser', hoverColor: '#ff3b4f' },
};
Object.assign(PRESETS, LAB);
const FIELDS = [
  ['bg', 'Page background'], ['surface', 'Panels & cards'], ['text', 'Text'],
  ['accent', 'Buttons & highlights'], ['accentText', 'Button text'], ['link', 'Links'],
  ['border', 'Borders'], ['input', 'Input boxes'],
];
const WORK_SITES = ['app.reconvision.com', 'app.tekioncloud.com', 'app.partstech.com', 'shop.usautoforce.com', 'repairlinkshop.com'];
const HOST = location.hostname;
const OUR = 'wr-theme';            // id prefix of our own elements (never themed)

// Teams (and some other Microsoft sites) only allow HTML that goes through a "Trusted Types" policy.
let ttPolicy = null;
try { if (window.trustedTypes && trustedTypes.createPolicy) ttPolicy = trustedTypes.createPolicy('walserThemes', { createHTML: x => x }); }
catch (e) { console.warn('[Page Themes] this site blocks our HTML policy:', e.message); }
function safeHTML(html) { return ttPolicy ? ttPolicy.createHTML(html) : html; }
// If the site also refuses our policy (Teams does), build the elements one by one instead.
// Only used for this script's own panel markup.
const VOID_TAGS = /^(input|br|img|hr|meta|link|area|base|col|embed|source|track|wbr)$/;
function decodeEnt(t) { return t.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, m => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' })[m]); }
function buildDom(html) {
  const frag = document.createDocumentFragment(), stack = [frag], SVGNS = 'http://www.w3.org/2000/svg';
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[1]) {                                        // closing tag
      const t = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName && stack[i].tagName.toLowerCase() === t) { stack.length = i; break; }
    } else if (m[2]) {                                 // opening tag
      const tag = m[2].toLowerCase();
      if (tag === 'script') continue;
      const svg = tag === 'svg' || stack.some(n => n.namespaceURI === SVGNS);
      const el = svg ? document.createElementNS(SVGNS, tag) : document.createElement(tag);
      const are = /([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g; let a;
      while ((a = are.exec(m[3] || ''))) el.setAttribute(a[1], decodeEnt(a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : ''));
      top.appendChild(el);
      if (tag === 'style' || tag === 'textarea') {     // raw text up to the closing tag
        const end = html.indexOf('</' + tag, re.lastIndex), raw = html.slice(re.lastIndex, end < 0 ? html.length : end);
        el.textContent = tag === 'textarea' ? decodeEnt(raw) : raw;
        re.lastIndex = end < 0 ? html.length : end;
        stack.push(el);
      } else if (!(m[4] === '/' || VOID_TAGS.test(tag))) stack.push(el);
    } else if (m[5]) top.appendChild(document.createTextNode(decodeEnt(m[5])));
  }
  return frag;
}
let htmlBlocked = false;                          // remembered after the first refusal
function setHTML(el, html) {
  if (ttPolicy) { el.innerHTML = ttPolicy.createHTML(html); return; }
  if (!htmlBlocked) { try { el.innerHTML = html; return; } catch (e) { htmlBlocked = true; } }
  el.textContent = ''; el.appendChild(buildDom(html));
}

// ---------- storage ----------
function load(k, d) { try { const v = GM_getValue(k); return v === undefined ? d : JSON.parse(v); } catch (e) { return d; } }
function save(k, v) { GM_setValue(k, JSON.stringify(v)); }
function getSites() { return load('sites', {}); }
function siteCfg(host) {
  return Object.assign({ theme: '', buttons: true, anim: true, rules: [], css: '' }, getSites()[host || HOST] || {});
}
function saveSiteCfg(c, host) { const s = getSites(); s[host || HOST] = c; save('sites', s); }
function customThemes() { return load('custom_themes', {}); }
function allThemes() { return Object.assign({}, PRESETS, customThemes()); }

let cfg = siteCfg();
// ---------- theme of the day ----------
// When on, one random theme is picked each day and used on all work sites.
// "Skip" picks a different one for the rest of the day.
function todayStr() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function dailyState() { return load('daily', { on: false }); }
function pickRandomTheme(not) { const ks = Object.keys(allThemes()).filter(k => k !== not); return ks[(Math.random() * ks.length) | 0]; }
function activeThemeId() {
  const d = dailyState();
  if (!d.on || !WORK_SITES.includes(HOST)) return cfg.theme;   // Teams etc. keep their own choice
  if (d.date !== todayStr() || !allThemes()[d.theme]) { d.date = todayStr(); d.theme = pickRandomTheme(d.theme); save('daily', d); }
  return d.theme;
}
function setActiveTheme(id) {                    // used by the dropdown and by color edits
  const d = dailyState();
  if (d.on && WORK_SITES.includes(HOST)) { d.theme = id; d.date = todayStr(); save('daily', d); }
  else { cfg.theme = id; saveSiteCfg(cfg); }
}
function skipDaily() { const d = dailyState(); d.on = true; d.date = todayStr(); d.theme = pickRandomTheme(d.theme); save('daily', d); refresh(true); }

let T = allThemes()[activeThemeId()] || null;     // active theme colors, or null = Off

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
      const size = fit === 'tile' ? (T.wpTile || 'auto') : fit, rep = fit === 'tile' ? 'repeat' : 'no-repeat';
      css += `
html{background-image:linear-gradient(rgba(0,0,0,${dim}),rgba(0,0,0,${dim})),${T.wp} !important;
background-size:100% 100%,${size} !important;background-repeat:no-repeat,${rep} !important;
background-position:center,center !important;background-attachment:fixed,fixed !important}
body,[data-wr-bg=page]{background-color:transparent !important}
`;
    }
    if (T.mesh) css += `\nbody,[data-wr-bg=page]{background-color:transparent !important}`;
    if (animOn()) css += animCss();
  }
  if (T && /(^|\.)teams\.(microsoft\.com|cloud\.microsoft|live\.com)$/.test(HOST)) {
    const a = 1 - (T.wpSee == null ? 25 : T.wpSee) / 100 * (T.wp || T.mesh ? 1 : 0);
    const s1 = rgba(T.surface, a), s2 = rgba(mix(T.surface, T.text, .05), a), s3 = rgba(T.bg, a), sh = rgba(mix(T.surface, T.text, .1), a), sp = rgba(mix(T.surface, T.text, .15), a);
    css += `
:root,.fui-FluentProvider,[class*="fui-FluentProvider"]{
--colorNeutralBackground1:${s1} !important;--colorNeutralBackground1Hover:${sh} !important;--colorNeutralBackground1Pressed:${sp} !important;--colorNeutralBackground1Selected:${sh} !important;
--colorNeutralBackground2:${s2} !important;--colorNeutralBackground2Hover:${sh} !important;--colorNeutralBackground2Pressed:${sp} !important;--colorNeutralBackground2Selected:${sh} !important;
--colorNeutralBackground3:${s3} !important;--colorNeutralBackground3Hover:${sh} !important;--colorNeutralBackground3Selected:${sh} !important;
--colorNeutralBackground4:${s3} !important;--colorNeutralBackground5:${s3} !important;--colorNeutralBackground6:${s2} !important;
--colorNeutralBackgroundInverted:${T.text} !important;--colorSubtleBackgroundHover:${sh} !important;--colorSubtleBackgroundPressed:${sp} !important;--colorSubtleBackgroundSelected:${sh} !important;
--colorNeutralForeground1:${T.text} !important;--colorNeutralForeground2:${mix(T.text, T.bg, .12)} !important;--colorNeutralForeground3:${mix(T.text, T.bg, .3)} !important;--colorNeutralForeground4:${mix(T.text, T.bg, .45)} !important;
--colorNeutralStroke1:${T.border} !important;--colorNeutralStroke2:${T.border} !important;--colorNeutralStroke3:${T.border} !important;--colorNeutralStrokeAccessible:${T.border} !important;
--colorBrandBackground:${T.accent} !important;--colorBrandBackgroundHover:${mix(T.accent, '#ffffff', .12)} !important;--colorBrandBackgroundPressed:${mix(T.accent, '#000000', .15)} !important;--colorBrandBackgroundSelected:${T.accent} !important;
--colorCompoundBrandBackground:${T.accent} !important;--colorCompoundBrandStroke:${T.accent} !important;--colorBrandStroke1:${T.accent} !important;
--colorNeutralForegroundOnBrand:${T.accentText} !important;--colorBrandForeground1:${T.link} !important;--colorBrandForeground2:${T.link} !important;--colorBrandForegroundLink:${T.link} !important;--colorCompoundBrandForeground1:${T.link} !important}
html,body,#app{background:transparent !important}`;
  }
  (cfg.rules || []).forEach(r => {
    const decl = (r.bg ? `background-color:${r.bg} !important;` : '') + (r.color ? `color:${r.color} !important;` : '');
    if (decl) css += `\n${r.sel}{${decl}}`;
  });
  if (cfg.css) css += '\n' + cfg.css;
  return css;
}
// If the site blocks our <style> tag (Content Security Policy), fall back to a style sheet
// built in script ("constructed" sheet), which those rules do not block.
let cssSheet = null, styleBlocked = false;
function pushCss(css) {
  styleEl.textContent = css;
  if (cssSheet) { try { cssSheet.replaceSync(css); } catch (e) {} }
}
function checkStyleBlocked() {
  if (styleBlocked || !styleEl.isConnected || !styleEl.textContent.trim()) return;
  let n = -1; try { n = styleEl.sheet ? styleEl.sheet.cssRules.length : 0; } catch (e) { n = 0; }
  if (n > 0) return;
  styleBlocked = true;
  try {
    cssSheet = new CSSStyleSheet(); cssSheet.replaceSync(styleEl.textContent);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, cssSheet];
    console.log('[Page Themes] this site blocks style tags, using a constructed style sheet instead');
  } catch (e) { console.warn('[Page Themes] could not add styles on this site:', e); }
}
function applyStyle() {
  pushCss(cssText());
  if (styleEl.isConnected) { checkStyleBlocked(); return; }
  const target = document.head || document.documentElement;
  if (target) { target.appendChild(styleEl); setTimeout(checkStyleBlocked, 0); }
  else setTimeout(applyStyle, 5);               // page not created yet at document-start
}
// Facts for troubleshooting a site we cannot see (shown at the bottom of the panel).
function diagText() {
  const fps = document.querySelectorAll('.fui-FluentProvider,[class*="fui-FluentProvider"]');
  const fp = fps[0], v = fp ? getComputedStyle(fp).getPropertyValue('--colorNeutralBackground1').trim() : '';
  const probe = document.elementFromPoint(Math.round(innerWidth * .3), Math.round(innerHeight * .5));
  let pc = '', el = probe;
  for (let i = 0; el && i < 12; i++, el = el.parentElement) { const c = getComputedStyle(el).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') { pc = c + ' on <' + el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? ' class="' + el.className.split(' ').slice(0, 2).join(' ') + '"' : '') + '>'; break; } }
  return 'Status v3.8: theme ' + (T ? 'on' : 'off') + ' · styles ' + styleStatus() + ' · tag rules ' + (styleEl.sheet ? (() => { try { return styleEl.sheet.cssRules.length; } catch (e) { return '?'; } })() : 'none')
    + ' · Fluent providers ' + fps.length + ' · Fluent bg var "' + (v || '-') + '" · chat area color ' + (pc || '-') + ' · frame ' + (window.top === window ? 'top' : 'inner');
}
function styleStatus() { return !T ? 'off' : styleBlocked ? (cssSheet ? 'applied (backup method)' : 'BLOCKED by this site') : 'applied'; }

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

// ---------- animations: glowing buttons + moving wallpaper effects ----------
// Turned off by the panel's "Animations" checkbox, or when Windows/the browser
// asks for reduced motion. Canvas effects run ~30 fps and pause in background tabs.
function animOn() {
  return cfg.anim !== false && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
}
// A theme can list several effects, e.g. fx: 'fog slash' (one canvas effect + CSS effects).
function hasFx(n) { return (' ' + ((T && T.fx) || '') + ' ').includes(' ' + n + ' '); }
function animCss() {
  const g = T.accent, c = T.fxColor || T.accent, hc = T.hoverColor || T.accent;
  let css = '';
  if (T.glow) css += `
@keyframes wrGlow{0%,100%{box-shadow:0 0 3px ${rgba(g, .6)}}50%{box-shadow:0 0 10px ${rgba(g, .9)},0 0 22px ${rgba(g, .45)}}}
[data-wr-bg=accent]{animation:wrGlow 2.6s ease-in-out infinite}
input:focus,textarea:focus,select:focus{box-shadow:0 0 0 1px ${g},0 0 12px ${rgba(g, .7)} !important;outline:none !important}
a:hover{text-shadow:0 0 8px ${rgba(T.link, .8)}}`;
  if (T.fx) css += `\nbody,[data-wr-bg=page]{background-color:transparent !important}`;
  // ---- background effects drawn with CSS (html::before) ----
  if (hasFx('pulse')) css += `
@keyframes wrPulse{0%,100%{opacity:.25}50%{opacity:.75}}
html::before{content:'';position:fixed;inset:0;z-index:-1;pointer-events:none;background:radial-gradient(ellipse at 50% 60%,${rgba(c, .5)},transparent 60%);animation:wrPulse 5s ease-in-out infinite}`;
  if (hasFx('scan')) css += `
@keyframes wrScan{from{transform:translateY(-20vh)}to{transform:translateY(120vh)}}
html::before{content:'';position:fixed;left:0;right:0;top:0;height:18vh;z-index:-1;pointer-events:none;background:linear-gradient(180deg,transparent,${rgba(c, .2)} 85%,${rgba(c, .55)} 100%);animation:wrScan 6s linear infinite}`;
  if (hasFx('sweep')) css += `
@keyframes wrSweep{to{transform:translate(-50%,-50%) rotate(360deg)}}
html::before{content:'';position:fixed;left:50%;top:50%;width:160vmax;height:160vmax;border-radius:50%;z-index:-1;pointer-events:none;transform:translate(-50%,-50%);background:conic-gradient(from 0deg,${rgba(c, .38)},${rgba(c, .08)} 35deg,transparent 60deg 360deg);animation:wrSweep 4s linear infinite}`;
  if (hasFx('laser')) css += `
@keyframes wrLaser{0%{transform:translate(18vw,22vh)}25%{transform:translate(62vw,35vh)}50%{transform:translate(48vw,70vh)}75%{transform:translate(12vw,58vh)}100%{transform:translate(18vw,22vh)}}
@keyframes wrBlink{0%,100%{opacity:.95}50%{opacity:.55}}
html::before{content:'';position:fixed;left:0;top:0;width:44px;height:40px;z-index:-1;pointer-events:none;
background:radial-gradient(circle at 22px 4px,${rgba(c, 1)} 0 3px,${rgba(c, .5)} 5px,transparent 9px),radial-gradient(circle at 4px 36px,${rgba(c, 1)} 0 3px,${rgba(c, .5)} 5px,transparent 9px),radial-gradient(circle at 40px 36px,${rgba(c, 1)} 0 3px,${rgba(c, .5)} 5px,transparent 9px);
animation:wrLaser 22s ease-in-out infinite,wrBlink 1.4s ease-in-out infinite}`;
  if (hasFx('spin')) css += `
@keyframes wrSpin{to{transform:translate(-50%,-50%) rotate(360deg)}}
html::before{content:'';position:fixed;left:50%;top:50%;width:250vmax;height:250vmax;z-index:-1;pointer-events:none;transform:translate(-50%,-50%);background:repeating-conic-gradient(from 0deg,${rgba(c, .10)} 0 6deg,transparent 6deg 12deg);animation:wrSpin 120s linear infinite}`;
  // ---- CSS effects on html::after ----
  if (hasFx('slash')) {                      // three gashes that slice across the screen every ~9 s
    const sc = T.slashColor || '#8a0000';
    css += `
@keyframes wrSlash{0%{clip-path:inset(0 100% 0 0);opacity:1}5%{clip-path:inset(0 0 0 0);opacity:1}60%{opacity:.85}100%{clip-path:inset(0 0 0 0);opacity:0}}
html::after{content:'';position:fixed;inset:0;z-index:-1;pointer-events:none;
background:linear-gradient(118deg,transparent 0 38%,${rgba(sc, .95)} 38.2%,${rgba(sc, .5)} 38.6%,transparent 39%),linear-gradient(118deg,transparent 0 43%,${rgba(sc, .95)} 43.2%,${rgba(sc, .5)} 43.6%,transparent 44%),linear-gradient(118deg,transparent 0 48%,${rgba(sc, .95)} 48.2%,${rgba(sc, .5)} 48.6%,transparent 49%);
animation:wrSlash 9s ease-out infinite}`;
  }
  if (hasFx('grain')) css += `
@keyframes wrGrain{0%{transform:translate(0,0)}25%{transform:translate(-3%,2%)}50%{transform:translate(2%,-3%)}75%{transform:translate(-2%,-1%)}100%{transform:translate(0,0)}}
@keyframes wrFlicker{0%,100%{opacity:.09}45%{opacity:.14}50%{opacity:.06}}
html::after{content:'';position:fixed;inset:-10%;z-index:2147483640;pointer-events:none;
background:repeating-radial-gradient(circle at 17% 32%,rgba(255,255,255,.6) 0 1px,transparent 1px 3px),repeating-radial-gradient(circle at 73% 61%,rgba(0,0,0,.7) 0 1px,transparent 1px 4px);
animation:wrGrain .5s steps(4) infinite,wrFlicker 3s steps(6) infinite}`;
  // ---- hover effect (one see-through layer drawn over/under the hovered button) ----
  css += `
@property --wr-a{syntax:'<angle>';inherits:false;initial-value:0deg}
@keyframes wrTrace{to{--wr-a:360deg}}
@keyframes wrFlick{50%{opacity:.5}}
@keyframes wrDrip{to{clip-path:inset(0 0 0 0)}}
@keyframes wrTwinkle{from{opacity:.25;transform:scale(.96)}to{opacity:1;transform:scale(1.04)}}
@keyframes wrShine{from{background-position:130% 0}to{background-position:-30% 0}}
#${OUR}-laser{position:fixed;pointer-events:none;z-index:2147483646;box-sizing:border-box;display:none}
#${OUR}-laser[data-mode=laser],#${OUR}-laser[data-mode=spark]{padding:2px;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}
#${OUR}-laser[data-mode=laser]{background:conic-gradient(from var(--wr-a),transparent 0 30%,${rgba(hc, .9)} 44%,#fff 48%,transparent 50% 80%,${rgba(hc, .9)} 94%,#fff 98%,transparent 100%);
filter:drop-shadow(0 0 3px ${hc}) drop-shadow(0 0 7px ${rgba(hc, .8)});animation:wrTrace 1.5s linear infinite}
#${OUR}-laser[data-mode=spark]{background:conic-gradient(from var(--wr-a),transparent 0 18%,#9be7ff 28%,#fff 31%,transparent 34% 55%,#c8f4ff 63%,#fff 65%,transparent 68% 82%,#9be7ff 90%,transparent 93%);
filter:drop-shadow(0 0 4px #7fdcff) drop-shadow(0 0 9px #4fc3ff);animation:wrTrace .45s linear infinite,wrFlick .12s steps(2) infinite}
#${OUR}-laser[data-mode=drip]{clip-path:inset(0 0 100% 0);animation:wrDrip 1.1s ease-in forwards;filter:drop-shadow(0 2px 1px rgba(0,0,0,.6));
background:linear-gradient(${hc},${hc}) 0 0/100% 5px no-repeat,linear-gradient(${hc},${hc}) 12% 0/5px 62% no-repeat,linear-gradient(${hc},${hc}) 31% 0/4px 40% no-repeat,
linear-gradient(${hc},${hc}) 55% 0/6px 86% no-repeat,linear-gradient(${hc},${hc}) 79% 0/4px 55% no-repeat,linear-gradient(${hc},${hc}) 93% 0/3px 30% no-repeat,
radial-gradient(circle at 13% 66%,${hc} 0 4.5px,transparent 5.5px),radial-gradient(circle at 56% 90%,${hc} 0 5.5px,transparent 6.5px),radial-gradient(circle at 79.5% 59%,${hc} 0 4px,transparent 5px)}
#${OUR}-laser[data-mode=sparkle]{filter:drop-shadow(0 0 4px ${hc});animation:wrTwinkle .9s ease-in-out infinite alternate;
background:radial-gradient(circle at 6% 22%,#fff 0 1.6px,transparent 3px),radial-gradient(circle at 94% 30%,${hc} 0 2.2px,transparent 4px),radial-gradient(circle at 18% 92%,${hc} 0 1.8px,transparent 3.5px),radial-gradient(circle at 76% 88%,#fff 0 2.2px,transparent 4px),radial-gradient(circle at 50% 4%,#fff 0 1.6px,transparent 3px)}
#${OUR}-laser[data-mode=sparkle]::after{content:'';position:absolute;inset:0;animation:wrTwinkle .9s ease-in-out .45s infinite alternate;
background:radial-gradient(circle at 30% 6%,${hc} 0 2px,transparent 3.5px),radial-gradient(circle at 98% 75%,#fff 0 1.6px,transparent 3px),radial-gradient(circle at 2% 60%,#fff 0 2px,transparent 3.5px),radial-gradient(circle at 62% 98%,${hc} 0 1.6px,transparent 3px)}
#${OUR}-laser[data-mode=shine]{overflow:hidden;mix-blend-mode:screen;background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.7) 47%,rgba(255,255,255,.2) 53%,transparent 64%);background-size:300% 100%;animation:wrShine 1.4s ease-in-out infinite}`;
  return css;
}
let fx = null;
function stopFx() {
  if (!fx) return;
  cancelAnimationFrame(fx.raf); window.removeEventListener('resize', fx.resize); fx.cv.remove(); fx = null;
}
const CANVAS_FX = ['code', 'rain', 'snow', 'stars', 'fireflies', 'circuit', 'petals', 'leaves', 'bubbles', 'flake', 'lightning', 'fog', 'bokeh', 'arc'];
function startFx() {
  const mode = T && animOn() ? CANVAS_FX.find(m => hasFx(m)) || '' : '';
  if (!mode || window.top !== window) { stopFx(); return; }
  const sig = mode + '|' + T.fxColor + '|' + JSON.stringify(T.fxColors || '');
  if (fx && fx.sig === sig) return;
  stopFx();
  const cv = document.createElement('canvas');
  cv.id = OUR + '-fx';
  cv.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:-1;pointer-events:none';
  document.documentElement.appendChild(cv);
  const ctx = cv.getContext('2d'), color = T.fxColor || '#ffffff', rand = (a, b) => a + Math.random() * (b - a);
  const colors = (T.fxColors && T.fxColors.length) ? T.fxColors : [color], pick = () => colors[(Math.random() * colors.length) | 0];
  const CH = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789';
  let W = 0, H = 0, P = [], F = [], bg = null, bolt = null, nextBolt = 0, last = 0;
  function pathPoint(p, d) {                              // point at distance d along a circuit trace
    for (let k = 1; k < p.pts.length; k++) {
      const a = p.pts[k - 1], b = p.pts[k], len = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
      if (d <= len) { const f = len ? d / len : 0; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }
      d -= len;
    }
    return p.pts[p.pts.length - 1];
  }
  function init() {
    if (mode === 'code') P = Array.from({ length: Math.ceil(W / 16) }, () => rand(-H / 16, 0));
    if (mode === 'rain') P = Array.from({ length: Math.round(W / 9) }, () => ({ x: rand(0, W), y: rand(-H, H), l: rand(10, 28), s: rand(9, 16) }));
    if (mode === 'snow') P = Array.from({ length: Math.round(W * H / 9000) }, () => ({ x: rand(0, W), y: rand(0, H), r: rand(.8, 2.6), s: rand(.3, 1.1), d: rand(-.3, .3) }));
    if (mode === 'stars') P = Array.from({ length: 260 }, () => ({ x: rand(-1, 1), y: rand(-1, 1), z: rand(.1, 1) }));
    if (mode === 'fireflies') P = Array.from({ length: 40 }, () => ({ x: rand(0, W), y: rand(0, H), a: rand(0, 6.28), p: rand(0, 6.28), s: rand(.2, .6) }));
    if (mode === 'bokeh') P = Array.from({ length: 45 }, () => ({ x: rand(0, W), y: rand(0, H), r: rand(3, 13), s: rand(.1, .4), p: rand(0, 6.28), c: pick() }));
    if (mode === 'petals' || mode === 'leaves') {
      const big = mode === 'leaves';
      P = Array.from({ length: big ? 28 : 45 }, () => ({ x: rand(0, W), y: rand(-H, H), r: big ? rand(6, 12) : rand(3.5, 7), rot: rand(0, 6.28), vr: rand(-.04, .04), s: rand(.4, 1.2), d: rand(-.5, .5), c: pick() }));
    }
    if (mode === 'bubbles') {
      P = Array.from({ length: 40 }, () => ({ x: rand(0, W), y: rand(0, H), r: rand(1.5, 5), s: rand(.4, 1.3), w: rand(0, 6.28) }));
      F = T.noFish ? [] : Array.from({ length: 4 }, () => ({ x: rand(0, W), y: rand(H * .2, H * .9), dir: Math.random() < .5 ? -1 : 1, s: rand(.4, 1.1), sz: rand(18, 38), w: rand(0, 6.28), c: colors[1] || color }));
    }
    if (mode === 'flake') P = Array.from({ length: Math.round(W * H / 4500) }, () => ({ x: rand(0, W), y: rand(0, H), ph: rand(0, 6.28), sp: rand(.03, .09), c: pick() }));
    if (mode === 'fog') P = Array.from({ length: 7 }, () => ({ x: rand(-W * .3, W), y: rand(H * .3, H), r: rand(W * .2, W * .45), s: rand(.15, .45) }));
    if (mode === 'circuit') {                             // random right-angle traces, drawn once
      const gsz = 26; bg = document.createElement('canvas'); bg.width = W; bg.height = H;
      const b = bg.getContext('2d'); b.lineWidth = 1.5; P = [];
      for (let i = 0, n = Math.max(20, Math.round(W * H / 26000)); i < n; i++) {
        let x = Math.round(rand(0, W) / gsz) * gsz, y = Math.round(rand(0, H) / gsz) * gsz, dir = (Math.random() * 4) | 0;
        const pts = [[x, y]], col = colors[i % colors.length];
        for (let s = 0, segs = 4 + ((Math.random() * 8) | 0); s < segs; s++) {
          if (Math.random() < .35) dir = (dir + (Math.random() < .5 ? 1 : 3)) % 4;
          const len = gsz * (1 + ((Math.random() * 4) | 0));
          x += [len, 0, -len, 0][dir]; y += [0, len, 0, -len][dir]; pts.push([x, y]);
        }
        let L = 0; for (let k = 1; k < pts.length; k++) L += Math.abs(pts[k][0] - pts[k - 1][0]) + Math.abs(pts[k][1] - pts[k - 1][1]);
        P.push({ pts, L, d: rand(0, L), s: rand(1.5, 3.5), c: col });
        b.globalAlpha = .16; b.strokeStyle = col; b.beginPath(); b.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(p => b.lineTo(p[0], p[1])); b.stroke();
        b.globalAlpha = .4; b.fillStyle = col; [pts[0], pts[pts.length - 1]].forEach(p => { b.beginPath(); b.arc(p[0], p[1], 2.5, 0, 6.28); b.fill(); });
      }
    }
  }
  function makeBolt() {
    let x = rand(W * .1, W * .9), y = 0; const pts = [[x, y]], branches = [];
    const end = H * rand(.5, .9);
    while (y < end) { y += rand(15, 35); x += rand(-28, 28); pts.push([x, y]); }
    for (let i = 0; i < 2; i++) {
      const s = pts[2 + ((Math.random() * (pts.length - 3)) | 0)]; let bx = s[0], by = s[1]; const bp = [[bx, by]];
      for (let k = 0; k < 5; k++) { by += rand(12, 26); bx += rand(-30, 30) + (i ? 12 : -12); bp.push([bx, by]); }
      branches.push(bp);
    }
    return { pts, branches, age: 0 };
  }
  function resize() { W = cv.width = innerWidth; H = cv.height = innerHeight; ctx.clearRect(0, 0, W, H); init(); }
  function frame(t) {
    fx.raf = requestAnimationFrame(frame);
    if (document.hidden || t - last < 33) return;
    last = t;
    if (mode === 'code') {                                   // falling code with fading trails
      ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = 'rgba(0,0,0,.09)'; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over'; ctx.font = '15px monospace'; ctx.globalAlpha = .8;
      P.forEach((y, i) => {
        ctx.fillStyle = Math.random() < .05 ? '#ffffff' : color;
        ctx.fillText(CH[(Math.random() * CH.length) | 0], i * 16, y * 16);
        P[i] = (y * 16 > H && Math.random() > .975) ? 0 : y + 1;
      });
      ctx.globalAlpha = 1; return;
    }
    ctx.clearRect(0, 0, W, H);
    if (mode === 'rain') {
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.globalAlpha = .45; ctx.beginPath();
      P.forEach(d => { d.y += d.s; d.x -= d.s * .15; if (d.y > H) { d.y = rand(-60, 0); d.x = rand(0, W * 1.1); } ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.l * .15, d.y - d.l); });
      ctx.stroke();
    }
    if (mode === 'snow') {
      ctx.fillStyle = color; ctx.globalAlpha = .75;
      P.forEach(f => { f.y += f.s; f.x += f.d + Math.sin(f.y / 40) * .2; if (f.y > H) { f.y = -4; f.x = rand(0, W); } ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.28); ctx.fill(); });
    }
    if (mode === 'stars') {                                  // slow forward flight through stars
      const cx = W / 2, cy = H / 2, k = .25 * Math.max(W, H); ctx.strokeStyle = color;
      P.forEach(st => {
        const pz = st.z; st.z -= .004;
        if (st.z <= .02) { st.x = rand(-1, 1); st.y = rand(-1, 1); st.z = 1; return; }
        ctx.globalAlpha = Math.min(1, (1 - st.z) * 1.3); ctx.lineWidth = (1 - st.z) * 2;
        ctx.beginPath(); ctx.moveTo(cx + st.x / pz * k, cy + st.y / pz * k); ctx.lineTo(cx + st.x / st.z * k, cy + st.y / st.z * k); ctx.stroke();
      });
    }
    if (mode === 'fireflies' || mode === 'bokeh') {
      P.forEach(f => {
        if (mode === 'fireflies') { f.a += rand(-.3, .3); f.x += Math.cos(f.a) * f.s; f.y += Math.sin(f.a) * f.s; }
        else { f.y -= f.s; f.x += Math.sin(f.p) * .2; if (f.y < -20) { f.y = H + 20; f.x = rand(0, W); } }
        f.p += .05;
        if (f.x < -20 || f.x > W + 20 || f.y < -20 || f.y > H + 20) { f.x = rand(0, W); f.y = rand(0, H); }
        const r = f.r || 9, gr = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
        gr.addColorStop(0, f.c || color); gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = .35 + .3 * Math.sin(f.p); ctx.fillStyle = gr; ctx.fillRect(f.x - r, f.y - r, r * 2, r * 2);
      });
    }
    if (mode === 'petals' || mode === 'leaves') {
      ctx.globalAlpha = .8;
      P.forEach(f => {
        f.y += f.s; f.x += f.d + Math.sin(f.y / 50) * .4; f.rot += f.vr;
        if (f.y > H + 20) { f.y = -20; f.x = rand(0, W); }
        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot); ctx.fillStyle = f.c;
        ctx.beginPath(); ctx.ellipse(0, 0, f.r, f.r * (mode === 'leaves' ? .45 : .6), 0, 0, 6.28); ctx.fill();
        if (mode === 'leaves') { ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-f.r, 0); ctx.lineTo(f.r * 1.3, 0); ctx.stroke(); }
        ctx.restore();
      });
    }
    if (mode === 'bubbles') {
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      P.forEach(b => {
        b.y -= b.s; b.w += .05; if (b.y < -10) { b.y = H + 10; b.x = rand(0, W); }
        const x = b.x + Math.sin(b.w) * 3; ctx.globalAlpha = .4;
        ctx.beginPath(); ctx.arc(x, b.y, b.r, 0, 6.28); ctx.stroke();
        ctx.globalAlpha = .6; ctx.fillStyle = '#ffffff'; ctx.fillRect(x - b.r * .4, b.y - b.r * .45, 1.2, 1.2);
      });
      F.forEach(f => {                                       // simple fish silhouettes swimming across
        f.x += f.dir * f.s; f.w += .08;
        if (f.x < -80 || f.x > W + 80) { f.dir = Math.random() < .5 ? -1 : 1; f.x = f.dir > 0 ? -60 : W + 60; f.y = rand(H * .2, H * .9); }
        const y = f.y + Math.sin(f.w) * 4, sz = f.sz, wag = Math.sin(f.w * 2) * sz * .12;
        ctx.save(); ctx.translate(f.x, y); ctx.scale(f.dir, 1); ctx.globalAlpha = .28; ctx.fillStyle = f.c;
        ctx.beginPath(); ctx.ellipse(0, 0, sz, sz * .36, 0, 0, 6.28); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-sz * .85, 0); ctx.lineTo(-sz * 1.45, -sz * .38 + wag); ctx.lineTo(-sz * 1.45, sz * .38 + wag); ctx.closePath(); ctx.fill();
        ctx.restore();
      });
    }
    if (mode === 'flake') {                                  // metal-flake glitter twinkling
      P.forEach(f => {
        f.ph += f.sp; const a = Math.pow(Math.max(0, Math.sin(f.ph)), 8);
        if (a < .05) return;
        ctx.globalAlpha = a; ctx.fillStyle = f.c; ctx.fillRect(f.x - .8, f.y - .8, 1.6, 1.6);
        if (a > .7) { ctx.globalAlpha = a * .6; ctx.fillRect(f.x - 4, f.y - .4, 8, .8); ctx.fillRect(f.x - .4, f.y - 4, .8, 8); }
      });
    }
    if (mode === 'fog') {
      P.forEach(f => {
        f.x += f.s; if (f.x - f.r > W) f.x = -f.r;
        const gr = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
        gr.addColorStop(0, rgba(color, .14)); gr.addColorStop(1, rgba(color, 0));
        ctx.globalAlpha = 1; ctx.fillStyle = gr; ctx.fillRect(f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
      });
    }
    if (mode === 'circuit') {                                // light pulses running along the traces
      ctx.globalAlpha = 1; ctx.drawImage(bg, 0, 0);
      P.forEach(p => {
        p.d += p.s; if (p.d > p.L) p.d = 0;
        for (let k = 0; k < 8; k++) {
          const q = pathPoint(p, Math.max(0, p.d - k * 5));
          ctx.globalAlpha = (1 - k / 8) * .9; ctx.fillStyle = k ? p.c : '#ffffff';
          const s = k ? 2.4 : 3; ctx.fillRect(q[0] - s / 2, q[1] - s / 2, s, s);
        }
      });
    }
    if (mode === 'arc') {                                    // electric arcs between the two coil tops of the scene
      const sc = Math.max(W / 1600, H / 900), ox = (W - 1600 * sc) / 2, oy = (H - 900 * sc) / 2, pa = T.fxArc || [260, 250, 1340, 250];
      const x1 = ox + pa[0] * sc, y1 = oy + pa[1] * sc, x2 = ox + pa[2] * sc, y2 = oy + pa[3] * sc;
      if (Math.random() < .55) {
        for (let n = 0; n < 2; n++) {
          ctx.globalAlpha = n ? .35 : .9; ctx.strokeStyle = n ? color : '#ffffff'; ctx.lineWidth = n ? 6 : 1.8; ctx.shadowColor = color; ctx.shadowBlur = 14;
          ctx.beginPath(); ctx.moveTo(x1, y1);
          const steps = 18; for (let i = 1; i < steps; i++) { const t2 = i / steps; ctx.lineTo(x1 + (x2 - x1) * t2 + rand(-6, 6), y1 + (y2 - y1) * t2 - Math.sin(t2 * Math.PI) * 60 * sc + rand(-28, 28) * sc); }
          ctx.lineTo(x2, y2); ctx.stroke();
        }
        ctx.shadowBlur = 0;
      }
    }
    if (mode === 'lightning') {                              // a bolt every 5-12 seconds
      if (!bolt && t > nextBolt) { bolt = nextBolt ? makeBolt() : null; nextBolt = t + rand(5000, 12000); }
      if (bolt) {
        const a = Math.max(0, 1 - bolt.age / 9); bolt.age++;
        ctx.globalAlpha = .16 * a; ctx.fillStyle = '#dfefff'; ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = a; ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.shadowColor = color; ctx.shadowBlur = 12;
        [bolt.pts].concat(bolt.branches).forEach((pts, i) => { ctx.lineWidth = i ? 1.2 : 2.5; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(p => ctx.lineTo(p[0], p[1])); ctx.stroke(); });
        ctx.shadowBlur = 0;
        if (bolt.age > 9) bolt = null;
      }
    }
    ctx.globalAlpha = 1;
  }
  fx = { sig, cv, raf: 0, resize };
  window.addEventListener('resize', resize); resize(); fx.raf = requestAnimationFrame(frame);
}

// ---------- Color Lab mesh: soft color fields drifting slowly ----------
// Drawn on a tiny canvas (1/8 of the screen) that the browser stretches to full size:
// the stretching gives the soft blended look and costs almost nothing.
let meshFx = null;
function stopMesh() { if (meshFx) { cancelAnimationFrame(meshFx.raf); window.removeEventListener('resize', meshFx.resize); meshFx.cv.remove(); meshFx = null; } }
function startMesh() {
  if (!T || !T.mesh || window.top !== window) { stopMesh(); return; }
  const sig = JSON.stringify(T.mesh) + T.bg + animOn();
  if (meshFx && meshFx.sig === sig) return;
  stopMesh();
  const cv = document.createElement('canvas'); cv.id = OUR + '-mesh';
  cv.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:-1;pointer-events:none';
  document.documentElement.insertBefore(cv, document.documentElement.firstChild);
  const ctx = cv.getContext('2d'), m = T.mesh, bg = T.bg, moving = animOn();
  const blobs = [[.2, .25, 0], [.78, .28, 1.7], [.34, .78, 3.1], [.82, .8, 4.4], [.55, .5, 2.2], [.1, .7, 5.3]].map(([x, y, ph], i) => ({ x, y, ph, c: m[i % m.length], ax: .12 + i * .015, ay: .1 + i * .012, sp: .00009 + i * .000013 }));
  let W = 0, H = 0, last = 0;
  function resize() { W = cv.width = Math.max(40, Math.ceil(innerWidth / 8)); H = cv.height = Math.max(24, Math.ceil(innerHeight / 8)); draw(performance.now()); }
  function draw(t) {
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const R = Math.max(W, H) * .62;
    blobs.forEach(bl => {
      const x = (bl.x + Math.sin(t * bl.sp + bl.ph) * bl.ax) * W, y = (bl.y + Math.cos(t * bl.sp * 1.3 + bl.ph) * bl.ay) * H;
      const g = ctx.createRadialGradient(x, y, 0, x, y, R);
      g.addColorStop(0, bl.c); g.addColorStop(.45, rgba(bl.c, .35)); g.addColorStop(1, rgba(bl.c, 0));
      ctx.globalAlpha = .85; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    });
    ctx.globalAlpha = .28; ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);   // keep it deep enough for readable text
  }
  function frame(t) {
    meshFx.raf = requestAnimationFrame(frame);
    if (document.hidden || t - last < 50) return;         // ~20 fps is plenty for a slow drift
    last = t; draw(t);
  }
  meshFx = { sig, cv, raf: 0, resize };
  window.addEventListener('resize', resize); resize();
  if (moving) meshFx.raf = requestAnimationFrame(frame);
}

// ---------- laser line that travels around a button while you hover it ----------
// A separate see-through layer is drawn over the button; the button itself is not changed.
const BTN_SEL = 'button,[role="button"],input[type="button"],input[type="submit"],a.btn,[data-wr-bg="accent"]';
let laserEl = null, laserTarget = null, laserRaf = 0;
function hideLaser() {
  laserTarget = null; cancelAnimationFrame(laserRaf);
  if (laserEl) laserEl.style.display = 'none';
}
function showLaser(b) {
  if (!laserEl) { laserEl = document.createElement('div'); laserEl.id = OUR + '-laser'; document.documentElement.appendChild(laserEl); }
  if (!laserEl.isConnected) document.documentElement.appendChild(laserEl);
  laserTarget = b;
  const mode = T.hover || 'laser';
  const rad = parseFloat(getComputedStyle(b).borderTopLeftRadius) || 0;
  laserEl.dataset.mode = mode;
  laserEl.style.borderRadius = mode === 'drip' ? '0' : mode === 'shine' ? rad + 'px' : (rad + 3) + 'px';
  laserEl.style.animation = 'none'; void laserEl.offsetWidth; laserEl.style.animation = '';   // restart (drip runs once)
  laserEl.style.display = 'block';
  cancelAnimationFrame(laserRaf);
  const pad = mode === 'sparkle' ? 10 : mode === 'shine' ? 0 : 3;
  const follow = () => {                         // keep it on the button while scrolling
    if (!laserTarget || !laserTarget.isConnected) return hideLaser();
    const r = laserTarget.getBoundingClientRect();
    if (mode === 'drip') {                       // drips hang from the bottom edge
      laserEl.style.left = r.left + 'px'; laserEl.style.top = (r.bottom - 3) + 'px';
      laserEl.style.width = r.width + 'px'; laserEl.style.height = '38px';
    } else {
      laserEl.style.left = (r.left - pad) + 'px'; laserEl.style.top = (r.top - pad) + 'px';
      laserEl.style.width = (r.width + pad * 2) + 'px'; laserEl.style.height = (r.height + pad * 2) + 'px';
    }
    laserRaf = requestAnimationFrame(follow);
  };
  follow();
}
document.addEventListener('mouseover', e => {
  if (!T || !animOn()) { if (laserTarget) hideLaser(); return; }
  const b = e.target && e.target.closest ? e.target.closest(BTN_SEL) : null;
  if (!b || b.closest('[id^="' + OUR + '"]')) { if (laserTarget && !laserTarget.contains(e.target)) hideLaser(); return; }
  if (b !== laserTarget) showLaser(b);
}, true);
document.addEventListener('mouseout', e => {               // mouse left the button (not just moved onto its text)
  if (laserTarget && !(e.relatedTarget && laserTarget.contains(e.relatedTarget)) && laserTarget.contains(e.target)) hideLaser();
}, true);

// Re-apply everything (after any settings change)
function refresh(rescan) {
  cfg = siteCfg();
  T = allThemes()[activeThemeId()] || null;
  applyStyle();
  if (!document.body) return;
  startFx(); startMesh();
  if (!T) { stopObserver(); unscanAll(); return; }
  if (rescan) { unscanAll(); scan([document.documentElement], false); }
  startObserver();
}

// ---------- start ----------
applyStyle();                                   // early: avoids a white flash
function onReady() { if (T) { scan([document.documentElement], false); startObserver(); startFx(); startMesh(); } }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once: true });
else onReady();

if (window.top !== window) return;              // menu + panel only in the main window
GM_registerMenuCommand('🎨 Themes & colors…', () => {
  try { openPanel(); }
  catch (e) { console.error('[Page Themes] could not open the panel:', e); alert('Page Themes could not open on this page.\n\nError: ' + (e && e.message ? e.message : e) + '\n\nPlease send a screenshot of this message.'); }
});
if (dailyState().on) GM_registerMenuCommand('⏭ Skip today\'s theme', () => { skipDaily(); if (host) openPanel(); });

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
// ---------- undo (steps back one change at a time, until the page is reloaded) ----------
const undoStack = [];
function snapshot() {
  undoStack.push(JSON.stringify({ site: getSites()[HOST] || null, custom: customThemes(), daily: dailyState() }));
  if (undoStack.length > 40) undoStack.shift();
}
function undoLast() {
  const raw = undoStack.pop(); if (!raw) return false;
  const st = JSON.parse(raw), sites = getSites();
  if (st.site) sites[HOST] = st.site; else delete sites[HOST];
  save('sites', sites); save('custom_themes', st.custom); save('daily', st.daily);
  refresh(true); return true;
}
// Save a change to the current theme. Editing a suggested theme makes a "My ..." copy.
function updateTheme(changes) {
  snapshot();
  const c = customThemes();
  const cur = activeThemeId();
  let id = cur;
  if (PRESETS[id]) {
    id = 'my_' + id;
    if (!c[id]) c[id] = Object.assign({}, PRESETS[cur], { name: 'My ' + PRESETS[cur].name });
  }
  c[id] = Object.assign({}, c[id], changes);
  try { save('custom_themes', c); }
  catch (e) { alert('Could not save (picture too big?). Try a smaller picture.'); return false; }
  const switched = cur !== id;
  setActiveTheme(id); refresh(false);
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
  const curId = activeThemeId(), cur = themes[curId] || null;
  const opts = ['<option value="">Off (site\'s normal look)</option>',
    '<optgroup label="Classic">', ...Object.keys(PRESETS).filter(k => !COLOR_THEORY[k] && !THEMED[k] && !ART[k] && !LAB[k]).map(k => `<option value="${k}">${esc(PRESETS[k].name)}</option>`), '</optgroup>',
    '<optgroup label="Color Lab (animated mesh)">', ...Object.keys(LAB).map(k => `<option value="${k}" title="${esc(LAB[k].about)}">${esc(PRESETS[k].name)}</option>`), '</optgroup>',
    '<optgroup label="Themed: cyberpunk, space, cars, sports, movies">', ...Object.keys(THEMED).map(k => `<option value="${k}" title="${esc(THEMED[k].about)}">${esc(PRESETS[k].name)}</option>`), '</optgroup>',
    '<optgroup label="Art prints (Tidwell, Van Dyke, Grundy inspired)">', ...Object.keys(ART).map(k => `<option value="${k}" title="${esc(ART[k].about)}">${esc(PRESETS[k].name)}</option>`), '</optgroup>',
    '<optgroup label="Color theory (with wallpaper)">', ...Object.keys(COLOR_THEORY).map(k => `<option value="${k}">${esc(PRESETS[k].name)}</option>`), '</optgroup>',
    Object.keys(custom).length ? '<optgroup label="My themes">' + Object.keys(custom).map(k => `<option value="${esc(k)}">★ ${esc(custom[k].name)}</option>`).join('') + '</optgroup>' : ''
  ].join('');
  const base = cur || PRESETS.midnight;
  setHTML(root, `
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
  <h3 id="drag" title="Drag to move">🎨 Themes & colors <span><button class="x" id="undo" title="Undo last change" ${undoStack.length ? '' : 'disabled style="opacity:.35"'}>↶</button><button class="x" id="minbtn" title="Shrink / expand">▁</button><button class="x" id="close" title="Close">✕</button></span></h3>
  <div class="body">
  <div class="note" style="margin:0 0 8px">Site: <b>${esc(HOST)}</b> · drag the title bar to move this box</div>
  <h4>Theme</h4>
  <select id="theme">${opts}</select>
  <label class="c" style="margin-top:6px"><input type="checkbox" id="daily" ${dailyState().on ? 'checked' : ''}> 🎲 New random theme every day (all work sites)</label>
  ${dailyState().on ? `<div class="row" style="margin-top:4px"><button id="skip" class="pri">⏭ Skip, pick another</button></div><div class="note" style="margin-top:2px">Today's theme: <b>${esc((themes[activeThemeId()] || {}).name || '')}</b></div>` : ''}
  <div class="row" style="margin-top:6px">
    <button id="allsites">Use on all work sites</button>
    ${custom[curId] ? '<button id="del">Delete this theme</button>' : ''}
  </div>
  <h4>Colors ${cur ? '' : '(pick a theme first)'}</h4>
  <div class="grid ${cur ? '' : 'dis'}">
    ${FIELDS.map(([k, label]) => `<label class="c"><input type="color" data-k="${k}" value="${base[k]}">${label}</label>`).join('')}
  </div>
  <label class="c ${cur ? '' : 'dis'}" style="margin-top:6px"><input type="checkbox" id="buttons" ${cfg.buttons ? 'checked' : ''}> Blue buttons use my button color</label>
  <label class="c ${cur ? '' : 'dis'}" style="margin-top:4px"><input type="checkbox" id="anim" ${cfg.anim !== false ? 'checked' : ''}> ✨ Animations (glowing buttons, laser hover, moving wallpaper)</label>
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
  <div class="note" id="diag" style="user-select:text">${esc(diagText())}</div>
  </div>
</div>`);
  const pst = root.querySelector('style');          // the panel's own styles: use the backup method if blocked
  if (pst) { let ok = 0; try { ok = pst.sheet ? pst.sheet.cssRules.length : 0; } catch (e) {} if (!ok) { try { const sh = new CSSStyleSheet(); sh.replaceSync(pst.textContent); root.adoptedStyleSheets = [sh]; } catch (e) {} } }
  const $ = s => root.querySelector(s);
  $('#theme').value = curId;
  makeDraggable(root);
  $('#minbtn').onclick = () => { const p = $('.p'); p.classList.toggle('min'); save('panel_min', p.classList.contains('min')); };
  $('#close').onclick = () => { host.remove(); host = null; };
  $('#undo').onclick = () => { if (undoLast()) render(root); };
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
      pushCss(cssText());
    };
    $(id).onchange = e => { if (updateTheme({ [key]: Number(e.target.value) })) render(root); };
  };
  slider('#wpdim', 'wpDim', '#dimv');
  slider('#wpsee', 'wpSee', '#seev');
  $('#wpfit').onchange = e => { if (updateTheme({ wpFit: e.target.value })) render(root); };
  $('#theme').onchange = e => {
    snapshot();
    const v = e.target.value;
    if (!v && dailyState().on) save('daily', Object.assign(dailyState(), { on: false }));   // Off also stops theme of the day
    setActiveTheme(v); refresh(true); render(root);
  };
  $('#daily').onchange = e => { snapshot(); const d = dailyState(); d.on = e.target.checked; if (d.on) d.date = ''; save('daily', d); refresh(true); render(root); };
  if ($('#skip')) $('#skip').onclick = () => { snapshot(); skipDaily(); render(root); };
  $('#allsites').onclick = () => {
    WORK_SITES.forEach(h => { const c = siteCfg(h); c.theme = curId; saveSiteCfg(c, h); });
    alert('This theme is now set for: ' + WORK_SITES.join(', ') + '\nOther tabs change after a reload.');
  };
  if ($('#del')) $('#del').onclick = () => {
    if (!confirm('Delete this theme?')) return;
    snapshot();
    const c = customThemes(); delete c[curId]; save('custom_themes', c);
    setActiveTheme(''); refresh(true); render(root);
  };
  root.querySelectorAll('input[type=color]').forEach(inp => {
    inp.oninput = () => {                       // live preview
      if (!T) return;
      T = Object.assign({}, T, { [inp.dataset.k]: inp.value });
      pushCss(cssText());
    };
    inp.onchange = () => { if (updateTheme({ [inp.dataset.k]: inp.value })) render(root); };
  });
  $('#buttons').onchange = e => { snapshot(); cfg.buttons = e.target.checked; saveSiteCfg(cfg); refresh(true); };
  $('#anim').onchange = e => { snapshot(); cfg.anim = e.target.checked; saveSiteCfg(cfg); refresh(false); };
  $('#pick').onclick = () => startPicker(root);
  $('#clearpicks').onclick = () => { snapshot(); cfg.rules = []; saveSiteCfg(cfg); refresh(true); render(root); };
  $('#savecss').onclick = () => { snapshot(); cfg.css = $('#css').value; saveSiteCfg(cfg); refresh(false); };
  $('#copy').onclick = () => {
    const code = JSON.stringify({ wrTheme: 1, theme: themes[curId] || null, rules: cfg.rules || [], css: cfg.css || '', site: HOST });
    $('#share').value = code; $('#share').select();
    try { navigator.clipboard.writeText(code).catch(() => {}); } catch (e) {}
  };
  $('#loadcode').onclick = () => {
    snapshot();
    let o; try { o = JSON.parse($('#share').value); } catch (e) { alert('That code is not valid.'); return; }
    if (!o || o.wrTheme !== 1) { alert('That is not a theme code.'); return; }
    if (o.theme) {
      const c = customThemes(); const id = 'shared_' + Date.now();
      c[id] = Object.assign({}, o.theme, { name: (o.theme.name || 'Shared theme') }); save('custom_themes', c);
      setActiveTheme(id); cfg = siteCfg();
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
  tip.textContent = '🎯 Click to pick  ·  Scroll wheel or ↑ ↓ = bigger / smaller box  ·  Esc = cancel';
  tip.style.cssText = 'all:initial;position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#f59e0b;color:#000;font:bold 13px Segoe UI,sans-serif;padding:6px 12px;border-radius:6px';
  document.documentElement.append(box, tip);
  let base = null, target = null;                 // base = what the mouse is on; target = base or a parent of it
  const draw = () => {
    if (!target) return;
    const r = target.getBoundingClientRect();
    Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  };
  const bigger = () => { if (target && target.parentElement && target.parentElement !== document.body && target.parentElement !== document.documentElement) { target = target.parentElement; draw(); } };
  const smaller = () => { if (!target || target === base) return; let el = base; while (el.parentElement && el.parentElement !== target) el = el.parentElement; target = el; draw(); };
  const move = e => {
    const el = e.target;
    if (!el || isOurs(el) || el === base) return;
    if (target && target !== base && target.contains(el)) { base = el; return; }   // keep the bigger box while moving inside it
    base = target = el; draw();
  };
  const wheel = e => { e.preventDefault(); e.stopPropagation(); if (e.deltaY < 0) bigger(); else smaller(); };
  const block = e => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  const done = () => {
    document.removeEventListener('mousemove', move, true);
    document.removeEventListener('wheel', wheel, { capture: true });
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach(t => document.removeEventListener(t, block, true));
    document.removeEventListener('click', click, true);
    document.removeEventListener('keydown', key, true);
    box.remove(); tip.remove(); host.style.display = '';
  };
  const click = e => { block(e); const el = target; done(); if (el) ruleForm(root, el); };
  const key = e => {
    if (e.key === 'Escape') { block(e); done(); }
    else if (e.key === 'ArrowUp') { block(e); bigger(); }
    else if (e.key === 'ArrowDown') { block(e); smaller(); }
  };
  document.addEventListener('mousemove', move, true);
  document.addEventListener('wheel', wheel, { capture: true, passive: false });
  ['mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach(t => document.addEventListener(t, block, true));
  document.addEventListener('click', click, true);
  document.addEventListener('keydown', key, true);
}

function ruleForm(root, el) {
  const cs = getComputedStyle(el);
  const sel = selectorFor(el);
  const f = root.querySelector('#ruleform');
  setHTML(f, `
  <div style="background:#0f1218;border:1px solid #3b4252;border-radius:6px;padding:8px;margin-top:6px">
    <div class="row" style="margin-bottom:4px"><button id="rup">⬆ Bigger area</button><button id="rdown">⬇ Smaller</button></div>
    <div class="note" style="margin:0 0 4px">Which elements (advanced users can edit):</div>
    <input type="text" id="rsel" value="${esc(sel)}">
    <div class="note" id="rcount" style="margin:2px 0 6px"></div>
    <label class="c"><input type="checkbox" id="rbgon" checked><input type="color" id="rbg" value="${toHex(cs.backgroundColor, '#334155')}"> Background</label>
    <label class="c"><input type="checkbox" id="rfgon" checked><input type="color" id="rfg" value="${toHex(cs.color, '#ffffff')}"> Text</label>
    <div class="row" style="margin-top:6px"><button class="pri" id="rsave">Save</button><button id="rcancel">Cancel</button></div>
  </div>`);
  const $ = s => root.querySelector(s);
  const flash = () => {                           // briefly outline what the selector matches
    let n = 0; try { document.querySelectorAll($('#rsel').value).forEach(x => { n++; const o = x.style.outline; x.style.outline = '3px dashed #f59e0b'; setTimeout(() => { x.style.outline = o; }, 900); }); } catch (e) {}
    return n;
  };
  const count = () => {
    try { const n = document.querySelectorAll($('#rsel').value).length; $('#rcount').textContent = `Matches ${n} element${n === 1 ? '' : 's'} on this page.`; }
    catch (e) { $('#rcount').textContent = 'Not a valid selector.'; }
  };
  count(); flash();
  $('#rsel').oninput = count;
  const p = el.parentElement;
  $('#rup').disabled = !p || p === document.body || p === document.documentElement;
  $('#rup').onclick = () => { if (!$('#rup').disabled) ruleForm(root, p); };
  $('#rdown').disabled = !el.__wrChild;
  $('#rdown').onclick = () => { if (el.__wrChild) ruleForm(root, el.__wrChild); };
  if (p) p.__wrChild = el;
  $('#rcancel').onclick = () => { f.textContent = ''; };
  $('#rsave').onclick = () => {
    const s = $('#rsel').value.trim();
    try { document.querySelector(s); } catch (e) { alert('Not a valid selector.'); return; }
    const rule = { sel: s, bg: $('#rbgon').checked ? $('#rbg').value : '', color: $('#rfgon').checked ? $('#rfg').value : '' };
    if (!rule.bg && !rule.color) { f.textContent = ''; return; }
    snapshot();
    cfg = siteCfg();
    cfg.rules = (cfg.rules || []).filter(r => r.sel !== s).concat([rule]);
    saveSiteCfg(cfg); refresh(true); render(root);
  };
}
})();
