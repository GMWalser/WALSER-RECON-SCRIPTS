// ==UserScript==
// @name         Parts Check-In Helper
// @namespace    walser-recon
// @version      3.10
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/PARTS_CHECKIN.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/PARTS_CHECKIN.js
// @description  Streamlines checking in parts on a Tekion Purchase Order through to RO fulfillment, and opens the matching RO in ReconVision
// @match        https://app.tekioncloud.com/parts/*
// @match        https://app.reconvision.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @run-at       document-idle
// ==/UserScript==

// Storage cleanup: delete old tab-claim records (older than 1 hour).
// They are only needed for a moment, but were never removed, so they piled up.
try {
  const claimCutoff = Date.now() - 60 * 60 * 1000;
  GM_listValues().forEach(k => {
    const m = k.match(/_claimed_(\d+)$/);
    if (m && Number(m[1]) < claimCutoff) GM_deleteValue(k);
  });
} catch (e) { console.warn('[claim cleanup]', e); }

(function() {
    'use strict';

    const LOG = '[PARTS-CHECKIN]';
    const GM_KEY_RV_SEARCH_REQUEST = 'pci_rv_search_request';
    const GM_KEY_FULFILL_ARMED = 'pci_fulfill_armed';   // v3.8: dedicated key
    const SUBMIT_ARM_MAX_AGE_MS = 15 * 60 * 1000;       // v3.9: auto Save-as-Draft only within 15 min of Receive

    function waitFor(checkFn, timeoutMs) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const iv = setInterval(() => {
                const result = checkFn();
                if (result) {
                    clearInterval(iv);
                    resolve(result);
                } else if (Date.now() - start > timeoutMs) {
                    clearInterval(iv);
                    reject(new Error('timeout'));
                }
            }, 200);
        });
    }

    // ============================================================
    // TEKION SIDE
    // ============================================================
    if (location.hostname.includes('tekioncloud.com')) {

        // --- Auto-scroll PO detail page to bottom so Total Price is visible ---
        // Tekion scrolls an inner panel, not the window, so find every real
        // scrollable element on the page and scroll each one to its bottom.
        function scrollToBottomOnLoad() {
            const hasPartsList = document.body.innerText.includes('Parts List');
            if (!hasPartsList) return;
            setTimeout(() => {
                window.scrollTo(0, document.body.scrollHeight);

                let scrolledCount = 0;
                const all = document.querySelectorAll('*');
                for (const el of all) {
                    if (el.scrollHeight > el.clientHeight + 20) {
                        const style = getComputedStyle(el);
                        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                            el.scrollTop = el.scrollHeight;
                            scrolledCount++;
                        }
                    }
                }
                console.log(LOG, 'Scrolled to bottom of PO detail page (' + scrolledCount + ' inner panel(s) scrolled)');
            }, 500);
        }

        // --- Alt+O hotkey: click "Open Receiving" button ---
        function clickOpenReceiving() {
            const btn = document.querySelector('[data-test-id="@tekion-parts-poDetail-page-openReceivingButton"]');
            if (btn) {
                btn.click();
                console.log(LOG, 'Clicked Open Receiving');
            } else {
                console.log(LOG, 'Open Receiving button not found on this page');
            }
        }

        document.addEventListener('keydown', (e) => {
            if (e.altKey && (e.key === 'o' || e.key === 'O')) {
                e.preventDefault();
                clickOpenReceiving();
            }
        });

        // --- v3.3: Highlight the Total Price (id="Total", confirmed stable)
        // in blue -- click it to Open Receiving. A small red button right
        // after it opens the Re-issue PO flow instead, for when the total is
        // wrong. Re-run on every observer tick since the PO detail page can
        // re-render this element; dataset flag keeps it from double-wiring.
        function clickKebabMenu() {
            const icon = document.querySelector('[data-test-id="@tekion-parts-poDetail-header-actionButton-0-action-kebabMenu"]');
            if (!icon) return null;
            const trigger = icon.closest('.ant-v5-dropdown-trigger') || icon;
            trigger.click();
            return trigger;
        }

        async function clickReissuePo() {
            const trigger = clickKebabMenu();
            if (!trigger) {
                console.log(LOG, 'Re-issue PO: kebab menu button not found');
                return;
            }
            try {
                // Menu item's own id has a random number in it that's not
                // stable across page loads -- match by its visible text
                // instead (confirmed: "Re-issue PO").
                const menuItem = await waitFor(() => {
                    const items = document.querySelectorAll('[role="menuitem"]');
                    for (const el of items) {
                        if (el.textContent && el.textContent.trim().toUpperCase() === 'RE-ISSUE PO') return el;
                    }
                    return null;
                }, 3000);
                menuItem.click();
                console.log(LOG, 'Clicked Re-issue PO');
            } catch (err) {
                console.log(LOG, 'Re-issue PO menu item not found');
            }
        }

        function setupTotalPriceHighlight() {
            const totalEl = document.getElementById('Total');
            if (!totalEl || totalEl.dataset.rvHighlighted) return;
            totalEl.dataset.rvHighlighted = '1';

            totalEl.style.cssText += 'background:#2563eb;color:#fff;padding:3px 10px;border-radius:6px;cursor:pointer;';
            totalEl.title = 'Click to Open Receiving';
            totalEl.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                clickOpenReceiving();
            });

            const reissueBtn = document.createElement('button');
            reissueBtn.type = 'button';
            reissueBtn.textContent = '!';
            reissueBtn.title = 'Price wrong? Re-issue PO';
            reissueBtn.style.cssText = 'margin-left:6px;background:#dc2626;color:#fff;border:none;border-radius:12px;width:20px;height:20px;font-size:12px;font-weight:700;cursor:pointer;line-height:1;vertical-align:middle;';
            reissueBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                clickReissuePo();
            });
            totalEl.insertAdjacentElement('afterend', reissueBtn);

            console.log(LOG, 'Total Price highlighted + Re-issue button added');
        }

        // --- v3.4: v3.3 tried auto-closing the Receiving drawer by clicking
        // its backdrop (.ant-v5-drawer-mask), assuming that matched your
        // manual "click the PO screen peeking out on the left" workaround.
        // CONFIRMED WRONG (console log + screenshot): clicking the mask
        // doesn't just close the drawer in place -- it kicks the whole page
        // back to the main Parts Receiving list, breaking everything after
        // it. Removed. Back to waiting for the RO/SO/SOR link directly
        // (still with a real waitFor instead of v3.2's blind timer), without
        // touching the drawer at all.
        // v3.5: clicking the RO link while the Receiving drawer is still open
        // doesn't register (confirmed: log showed the click firing, but
        // nothing happened -- drawer was still covering the page). Tried
        // closing the drawer first by clicking its backdrop once Tekion's
        // own "Successfully received" confirmation appeared, instead of a
        // blind timer.
        // v3.6: CONFIRMED (again, with the real confirmation this time) --
        // clicking that backdrop is not a timing problem, it just always
        // sends the whole page back to the main Parts Receiving list.
        // Removed for good -- not touching the drawer at all anymore. You
        // close it manually same as always; the script now just waits for
        // that close (drawer losing its "open" state) and picks up
        // automatically from there.
        function waitForReceiveSuccess(timeoutMs) {
            return waitFor(() => document.body.innerText.includes('Successfully received'), timeoutMs);
        }

        function waitForDrawerClose(timeoutMs) {
            return waitFor(() => (document.querySelector('.ant-v5-drawer-open') ? null : true), timeoutMs);
        }

        async function clickRoLinkWhenReady() {
            try {
                await waitForReceiveSuccess(8000);
                console.log(LOG, 'Receive confirmed — waiting for drawer to close');
            } catch (err) {
                console.log(LOG, 'Never saw receive confirmation — waiting for drawer to close anyway');
            }

            try {
                await waitForDrawerClose(30000);
                console.log(LOG, 'Drawer closed — looking for RO link');
            } catch (err) {
                console.log(LOG, 'Drawer still open after 30s — trying RO link anyway');
            }

            try {
                const link = await waitFor(() => {
                    return document.querySelector('[data-test-id="@tekion-parts-poDetail-page-invoiceButton"]');
                }, 6000);
                const roNumber = link.textContent.trim();
                if (roNumber) {
                    GM_setValue(GM_KEY_RV_SEARCH_REQUEST, { ro: roNumber, ts: Date.now() });
                    console.log(LOG, 'Sent RO ' + roNumber + ' to ReconVision');
                }
                link.click();
                console.log(LOG, 'Clicked RO/SO/SOR link after Receive');
            } catch (err) {
                console.log(LOG, 'RO/SO/SOR link never appeared after Receive — may need to click manually');
            }
        }

        // --- After clicking Submit in the add-part-to-RO modal, auto-click Save as Draft ---
        function clickSaveAsDraft() {
            const btn = document.querySelector('[data-test-id="@tekion-parts-partsRoSalesDetailedView-formFooter-tertiaryButton"]');
            if (btn) {
                btn.click();
                console.log(LOG, 'Clicked Save as Draft');
            } else {
                console.log(LOG, 'Save as Draft button not found — may need to click manually');
            }
        }

        // Delegated click listener covers buttons that get re-rendered by the SPA
        document.addEventListener('click', (e) => {
            const receiveBtn = e.target.closest('[data-test-id="@tekion-parts-orderDetail-modal-modalContainer-footer-Receive"]');
            if (receiveBtn) {
                console.log(LOG, 'Receive clicked — waiting to open RO link');
                GM_setValue(GM_KEY_FULFILL_ARMED, Date.now());   // v3.8: only now is auto-Fulfill allowed
                setTimeout(clickRoLinkWhenReady, 1200);
                return;
            }

            const submitBtn = e.target.closest('[data-test-id="undefined-Submit"]');
            if (submitBtn) {
                // v3.9: "undefined-Submit" is NOT unique to the add-part modal -- the Order / Fill
                // screen's Submit has the same id, and (confirmed in the console log) its Submit was
                // being treated as "add part to RO", so Save as Draft fired and closed the RO right
                // after ordering. Two guards, either one stops it:
                //  1) any Order/Fill checkbox is ticked = you are ordering parts, stay in the RO
                //  2) not within 15 minutes of clicking Receive = not in the receiving chain
                if (document.querySelector('.ofcb-box:checked')) {
                    console.log(LOG, 'Submit clicked with Order/Fill checkboxes ticked — NOT auto-clicking Save as Draft (stay in the RO)');
                    return;
                }
                const armedAt = GM_getValue(GM_KEY_FULFILL_ARMED, 0);
                if (!armedAt || (Date.now() - armedAt) > SUBMIT_ARM_MAX_AGE_MS) {
                    console.log(LOG, 'Submit clicked outside the receiving chain — NOT auto-clicking Save as Draft');
                    return;
                }
                console.log(LOG, 'Submit (add part to RO) clicked — waiting to click Save as Draft');
                GM_setValue(GM_KEY_FULFILL_ARMED, 0);            // v3.8: chain finished, disarm
                setTimeout(clickSaveAsDraft, 1200);
                return;
            }
        }, true);

        // --- On the RO Fulfillment page/drawer, auto-click Fulfill once it appears ---
        // Tekion's own click handling makes this button flicker (disappear/
        // reappear) for a moment after it's clicked, so tracking by element or
        // by a simple flag both get reset mid-flicker and cause repeat clicks.
        // Track instead by the RO's URL path, which stays fixed for that record
        // regardless of button flicker.
        // v3.7: confirmed via console log -- a plain .click() logs "Clicked
        // Fulfill" but doesn't actually fulfill (Save as Draft never showed
        // up afterward, which only appears once Fulfill truly goes through).
        // Same issue hit elsewhere in these scripts: some of Tekion's buttons
        // need a real mousedown/mouseup/click sequence, not just .click().
        // Also: the old one-shot Set permanently blocked retrying after that
        // first no-op click. Switched to an attempt counter (cap 3) so it can
        // actually retry a few times instead of giving up for good after one
        // click that may not have registered.
        const fulfillAttempts = {};

        function fireMouseEvent(el, type) {
            el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
        }

        // v3.8: auto-Fulfill used to fire on EVERY Tekion RO page (up to 3 clicks), so
        // opening any RO yourself popped the Fulfillment screen open a couple of times
        // and left it open. It is now only allowed for 3 minutes after you click
        // Receive in the PO chain, and is switched off again when Submit is clicked.
        const FULFILL_ARM_MAX_AGE_MS = 3 * 60 * 1000;

        function tryAutoClickFulfill() {
            const fulfillBtn = document.querySelector('[data-test-id="@tekion-parts-partsRoSalesDetailedView-formFooter-primaryButton"]');
            if (!fulfillBtn) return;
            if (fulfillBtn.disabled) return;
            const armedTs = GM_getValue(GM_KEY_FULFILL_ARMED, 0);
            if (!armedTs || (Date.now() - armedTs) > FULFILL_ARM_MAX_AGE_MS) return;

            const key = location.pathname;
            const attempts = fulfillAttempts[key] || 0;
            if (attempts >= 3) return;

            fulfillAttempts[key] = attempts + 1;
            fireMouseEvent(fulfillBtn, 'mousedown');
            fireMouseEvent(fulfillBtn, 'mouseup');
            fireMouseEvent(fulfillBtn, 'click');
            console.log(LOG, 'Clicked Fulfill (attempt ' + (attempts + 1) + ')');
        }

        // Safety-net poll in case a mutation batch is missed (drawer content can
        // render a tick after the drawer shell itself appears)
        setInterval(tryAutoClickFulfill, 500);

        // --- Watch page content for changes (SPA navigation) and re-run checks ---
        let lastPartsListState = '';
        const observer = new MutationObserver(() => {
            const hasPartsList = document.body.innerText.includes('Parts List');
            const key = hasPartsList ? 'present' : 'absent';
            if (key !== lastPartsListState) {
                lastPartsListState = key;
                if (hasPartsList) scrollToBottomOnLoad();
            }
            tryAutoClickFulfill();
            setupTotalPriceHighlight();
        });
        observer.observe(document.body, { childList: true, subtree: true });

        scrollToBottomOnLoad();
        tryAutoClickFulfill();
        setupTotalPriceHighlight();
    }

    // ============================================================
    // RECONVISION SIDE
    // ============================================================
    if (location.hostname.includes('reconvision.com')) {

        async function openRoFromTekion(roNumber) {
            const input = document.getElementById('search_target');
            const searchBtn = document.getElementById('go-search');
            if (!input || !searchBtn) {
                console.log(LOG, 'RV search box not found on this page');
                return;
            }

            // Set value the way a native input setter does, so the page's own
            // listeners (if any are bound to input/change) see the update.
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(input, roNumber);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));

            searchBtn.click();
            console.log(LOG, 'Searching ReconVision for RO ' + roNumber);

            try {
                const link = await waitFor(() => {
                    const modal = document.getElementById('searchresultsmodal');
                    if (!modal) return null;
                    return modal.querySelector('a[href^="/work_orders/"]');
                }, 6000);
                link.click();
                console.log(LOG, 'Opened RO ' + roNumber + ' in ReconVision');
            } catch (err) {
                console.log(LOG, 'No ReconVision search result appeared for RO ' + roNumber);
            }
        }

        let lastHandledTs = GM_getValue(GM_KEY_RV_SEARCH_REQUEST + '_handled_ts', 0);

        function handleRequest(value) {
            if (!value || !value.ro) return;
            if (value.ts <= lastHandledTs) return; // already handled
            lastHandledTs = value.ts;
            GM_setValue(GM_KEY_RV_SEARCH_REQUEST + '_handled_ts', lastHandledTs);
            openRoFromTekion(value.ro);
        }

        // Catch a request sent while this tab wasn't open/listening yet
        const existing = GM_getValue(GM_KEY_RV_SEARCH_REQUEST, null);
        handleRequest(existing);

        GM_addValueChangeListener(GM_KEY_RV_SEARCH_REQUEST, (name, oldVal, newVal) => {
            handleRequest(newVal);
        });
    }

    console.log(LOG, 'v3.7 loaded on ' + location.hostname);
})();