// ==UserScript==
// @name         OEM VIN Bridge
// @namespace    walser-recon
// @version      1.1
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/OEM_VIN_BRIDGE.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/OEM_VIN_BRIDGE.js
// @description  On a Tekion RO Fulfillment page, detects the vehicle's make and auto-opens the matching OEM parts site with the VIN searched
// @match        https://app.tekioncloud.com/parts/*
// @match        https://repairlinkshop.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_openInTab
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const LOG = '[OEM-VIN-BRIDGE]';

    // ============================================================
    // SITE PROFILES
    // To add another make/site later: add one entry here, then add a
    // matching "if (location.hostname.includes(...))" block below (copy the
    // RepairLink one) with that site's VIN field + search button selectors,
    // and a new @match line in the header above (full reinstall required).
    // ============================================================
    const SITE_PROFILES = [
        {
            siteName: 'RepairLink',
            brands: ['FORD', 'LINCOLN', 'MERCURY'],
            openUrl: 'https://repairlinkshop.com/Cart/CartDetails',
            hostMatch: 'repairlinkshop.com',
            gmKey: 'ovb_repairlink_vin_request',
        },
    ];

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
    // TEKION SIDE — detect make on the RO Fulfillment page, open the
    // matching OEM site with the VIN.
    // ============================================================
    if (location.hostname.includes('tekioncloud.com')) {

        const handledVinsByGmKey = {}; // one Set per site profile, so the same VIN can trigger more than one site if ever needed
        SITE_PROFILES.forEach(profile => { handledVinsByGmKey[profile.gmKey] = new Set(); });

        function checkForOemMatch() {
            const modelSpan = document.querySelector('[data-test-id="undefined-modelButton"] span');
            const vinSpan = document.querySelector('[data-test-id="@tekion-components-heading"] [class*="copyToClipboard_labelContent"]');
            if (!modelSpan || !vinSpan) return;

            const modelText = modelSpan.textContent.toUpperCase();
            const vin = vinSpan.textContent.trim();
            if (vin.length !== 17) return;

            for (const profile of SITE_PROFILES) {
                const isMatch = profile.brands.some(brand => modelText.includes(brand));
                if (!isMatch) continue;

                const handledVins = handledVinsByGmKey[profile.gmKey];
                if (handledVins.has(vin)) continue;
                handledVins.add(vin);

                // Send the VIN to shared GM storage so whichever tab already
                // has this site open can claim it -- only open a NEW tab if
                // nothing acks within 5 seconds (same pattern already used
                // for the RV -> Tekion "Open in Tekion" button).
                const sentTs = Date.now();
                GM_setValue(profile.gmKey, { vin: vin, ts: sentTs });
                console.log(LOG, modelSpan.textContent.trim() + ' detected — sent VIN ' + vin + ' to ' + profile.siteName);

                let acked = false;
                let checks = 0;
                const ackCheck = setInterval(() => {
                    checks++;
                    const ack = GM_getValue(profile.gmKey + '_ack', 0);
                    if (ack === sentTs) {
                        acked = true;
                        clearInterval(ackCheck);
                        console.log(LOG, 'Already-open ' + profile.siteName + ' tab claimed VIN ' + vin + ' — no new tab needed');
                        return;
                    }
                    if (checks >= 10) {
                        clearInterval(ackCheck);
                        if (!acked) {
                            console.log(LOG, 'No open ' + profile.siteName + ' tab claimed it — opening a new one');
                            GM_openInTab(profile.openUrl, { active: true, insert: true, setParent: true });
                        }
                    }
                }, 500);
            }
        }

        setInterval(checkForOemMatch, 500);
        checkForOemMatch();
    }

    // ============================================================
    // REPAIRLINK SIDE — fill the VIN field and run the search
    // ============================================================
    if (location.hostname.includes('repairlinkshop.com')) {
        const profile = SITE_PROFILES.find(p => location.hostname.includes(p.hostMatch));

        async function fillVinAndSearch(vin) {
            const input = document.getElementById('txtVin');
            if (!input) {
                console.log(LOG, 'RepairLink VIN field not found on this page');
                return;
            }

            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(input, vin);
            ['input', 'change', 'keyup', 'blur'].forEach(evtName => {
                input.dispatchEvent(new Event(evtName, { bubbles: true }));
            });
            console.log(LOG, 'Filled RepairLink VIN field with ' + vin);

            try {
                const btn = await waitFor(() => {
                    const b = document.getElementById('submitPartsSearch');
                    return (b && !b.disabled) ? b : null;
                }, 6000);
                btn.click();
                console.log(LOG, 'Clicked RepairLink Search for ' + vin);
            } catch (err) {
                console.log(LOG, 'RepairLink Search button never enabled — VIN may not have validated');
            }
        }

        if (profile) {
            let lastHandledTs = GM_getValue(profile.gmKey + '_handled_ts', 0);

            function handleVinRequest(value) {
                if (!value || !value.vin) return;
                if (value.ts <= lastHandledTs) return; // already handled
                lastHandledTs = value.ts;
                GM_setValue(profile.gmKey + '_handled_ts', lastHandledTs);
                GM_setValue(profile.gmKey + '_ack', value.ts); // tell the Tekion tab this one's claimed, so it doesn't open a new tab
                fillVinAndSearch(value.vin);
            }

            // Catch a request sent right before this tab finished opening/listening
            const existingRequest = GM_getValue(profile.gmKey, null);
            handleVinRequest(existingRequest);

            GM_addValueChangeListener(profile.gmKey, (name, oldVal, newVal) => {
                handleVinRequest(newVal);
            });
        }
    }

    console.log(LOG, 'v1.0 loaded on ' + location.hostname);
})();