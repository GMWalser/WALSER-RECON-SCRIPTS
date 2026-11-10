# RV Remote (BETA): on hold

**Status (2026-11-10):** paused by Gabe because it made Tekion/RV lag too much.
Not part of Walser Recon Tools (not in `build.py`), lives only on this test branch.
Last version: **3.2** (`beta/RV_REMOTE_BETA.user.js`).

## What it does
Controls RV from Tekion (RV and Tekion tabs talk through Tampermonkey storage).
- Tekion: thin sync bar above Job 1 (linked status, Right-click ON/OFF, Send all, basket, Empty basket, Undo).
- Per part: RV button (💡 suggested / ⚡ quoted / ? choose / ✓ sent) + A R S O 🗑 buttons.
- Basket: right-click Tekion part rows, Alt+right-click the RV line, Qty → Vendor → Status per part, one save.
- Quoted parts (red line with a price): status only (vendor/qty stay as quoted).
- Send all: every suggested + quoted part, one Vendor + one Status.
- Smart line suggestions: exact job name, quoted lines sharing a word, remembered part # → line, rules
  (LOF/oil filter + drain gaskets, air, cabin, wiper, battery, spark plug, tires, brakes front/rear).
  Catch-all lines (Additional Parts Needed, Parts Ordered, Misc…) never suggested. Thumbs-down lines skipped.
- Delete (🗑 + Y), Undo (button / Alt+Z) for add, status and delete.
- RV status chosen by name (O never Backordered, A never No Action Required).

## RV page facts learned (confirmed from screenshots)
- Line rows: `tr[data-service-id]`; name input `input[name*="line_items_attributes"][name$="[name]"]`.
- Parts icon: `.inner[data-target="#parts_modal"]` with `data-modaltitle`, `.part_price`, and
  `.block.parts_icon[data-statuscolor]` (grey/red/…) + `title` ("No Action Required", …).
- Rejected (thumbs down): `.checkbox-holder.rejected` / `input[name$="[rejected]"][value="1"]`.
- RO box: `.repair-order-number`. Save: `[id^="desktop-save-button-"]`.

## Why it was paused (speed report, RO 7330132)
- "RV: send line list to Tekion" used 93 s in ~12 min (whole-page text search every 3 s). Fixed in 3.2
  (RO from the RO box, only line rows, send only on change) but not yet re-measured on real pages.
- The Tekion side rebuilt its buttons every 1.5 s, which woke up other scripts' page watchers. Reduced in 3.1.
- Still unknown: the real cost of 3.2 on live pages. Next step if resumed: run it for one RO with the
  "📋 Speed + steps report" and compare.

## Ideas not done yet
- Never run the Tekion tick while nothing changed (event-driven instead of every 1.5 s).
- Find RepairLink/Tekion parts that RV quoted under a different part number.
