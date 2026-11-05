# Walser Recon Scripts

## For coworkers: install
1. Install the Tampermonkey browser extension.
2. Open this link and click **Install**:
   https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/WALSER_RECON.user.js
3. Done. It updates itself.

## Turning scripts off
Click the Tampermonkey icon in the browser toolbar:
- **Turn ALL scripts OFF**: stops everything (click again to turn back on).
- **✅ / ⛔ script name**: turns just that one script on or off.
- "← this page" marks the scripts that run on the page you are on.

The page reloads after a change.

## Themes / skins (Page Themes)
Tampermonkey icon -> **🎨 Themes & colors…** (on RV, Tekion, PartsTech, USAutoForce, RepairLink).
- Pick a suggested dark theme, or change any color to make your own (★).
- **Use on all work sites** applies the same theme everywhere.
- **🎯 Click an element to recolor**: click any button/bar/box, pick its colors.
- **Custom CSS** box for anything else.
- **Share**: Copy my theme code -> send it -> coworker pastes it and clicks Load.
- Off by default. Saved per person, per browser.

## For editing
- Edit the individual script files (CLIPBOARD.js, NAVIGATOR.js, ...) as before.
- `WALSER_RECON.user.js` is built from them automatically by GitHub
  (.github/workflows/build.yml runs `build.py`). Do not edit it by hand.
- The list of included scripts is at the top of `build.py`.
- `loader.js` handles starting scripts, the on/off menu, and data import.

## Moving saved data from an old script (one time)
Tampermonkey Dashboard -> Utilities -> Export (zip). Unzip it.
Then on any work page: Tampermonkey icon -> **Import saved data from an old script…**,
pick the script, paste the contents of its `.storage.json` file, click Import.
Do this for **Vehicle Parts Database Logger** so its scan history is kept.

Never upload `.storage.json` files to this repo (it is public and they contain VINs).
