// ==UserScript==
// @name         Recon Clipboard
// @namespace    reconclipboard
// @version      5.44
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/CLIPBOARD.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/CLIPBOARD.js
// @match        https://app.partstech.com/*
// @match        https://app.tekioncloud.com/*
// @match        https://*.reconvision.com/*
// @match        https://shop.usautoforce.com/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// ==/UserScript==

(function () {
'use strict';

const IS_PARTSTECH   = location.hostname.includes('partstech');
const IS_TEKION      = location.hostname.includes('tekion');
const IS_RECONVISION = location.hostname.includes('reconvision');
const IS_USAUTOFORCE = location.hostname.includes('usautoforce');
const IS_PI          = IS_TEKION && location.pathname.includes('/parts/inventory/part');
// CONFIRMED (7/9/26): the PO form is rendered as a TAB inside Tekion's
// single-page app -- the URL never changes when you open it, it stays
// identical to the RO Sales page URL. The old IS_PO check (looking for
// ?create=true in the URL) could therefore never become true. Removed
// entirely in favor of DOM-based detection at the point of use, since
// that's the only reliable signal in a tabbed SPA like this.
const IS_RO_SALES    = IS_TEKION && location.pathname.includes('/parts/ro-sales/') && !IS_PI;
const IS_RV_WO_EDIT  = IS_RECONVISION && /\/work_orders\/\d+\/edit/.test(location.pathname);

function getClip() {
    return {
        part:  GM_getValue('clip_part', ''),
        price: GM_getValue('clip_price', '')
    };
}

function setClip(part, price) {
    if (part  !== null) GM_setValue('clip_part',  part);
    if (price !== null) GM_setValue('clip_price', price);
}

// SEPARATE storage for the RO-Sales-selling-price -> RV-paste flow.
// CONFIRMED BUG (7/9/26): this used to share the same clip_part/clip_price
// slot as the PartsTech-cost -> Tekion-cost-price auto-fill flow. Since a
// background watcher on the RO Sales page continuously grabs whatever is
// in clip_price and auto-types it into Tekion's own Cost Price field the
// moment it sees anything there, right-clicking a SELLING price could get
// silently consumed/overwritten by that watcher, or leftover cost data
// could leak into the "paste onto line in RV" flow. Completely separate
// keys means these two flows can never collide again.
function getSellingClip() {
    return {
        part:  GM_getValue('clip_selling_part', ''),
        price: GM_getValue('clip_selling_price', '')
    };
}

function setSellingClip(part, price) {
    if (part  !== null) GM_setValue('clip_selling_part',  part);
    if (price !== null) GM_setValue('clip_selling_price', price);
}

// Cache logged-in user name
let cachedTekionUserName = '';
if (IS_TEKION) {
    // Fetch trim + stock directly from Tekion's inventory search API using GM_xmlhttpRequest.
    // Runs once per VIN per session, uses browser session cookies automatically.
    (function startVehicleDataCapture() {
        function saveVehicleData(trim, stock, vin, mileage) {
            if (!trim && !stock && !mileage) return;
            const key = 'rv_veh_' + (vin || 'last');
            try {
                const existing = JSON.parse(GM_getValue(key, '{}'));
                if (trim)  existing.trim  = trim;
                if (stock) existing.stock = stock;
                if (mileage) existing.mileage = mileage;
                GM_setValue(key, JSON.stringify(existing));
            } catch(e) {}
        }
        function getCookieVal(name) {
            const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
            return m ? decodeURIComponent(m[1]) : '';
        }
        function fetchVehicleData(vin, cb) {
            // Pull auth/context values from cookies (same ones Tekion's own frontend sends)
            const apiToken = getCookieVal('tekion-api-token');
            let tcookie = {};
            try { tcookie = JSON.parse(getCookieVal('tcookie') || '{}'); } catch(e) {}
            const hdrs = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
            if (apiToken) hdrs['Tekion-Api-Token'] = apiToken;
            if (tcookie.dealerId)     hdrs['Dealerid']         = String(tcookie.dealerId);
            if (tcookie.tenantname)   hdrs['Tenantname']       = tcookie.tenantname;
            if (tcookie.userId)       hdrs['Userid']           = tcookie.userId;
            if (tcookie.roleId)       hdrs['Roleid']           = tcookie.roleId;
            if (tcookie.clientid)     hdrs['Clientid']         = tcookie.clientid;
            if (tcookie.locale)       hdrs['Locale']           = tcookie.locale;
            if (tcookie.program)      hdrs['Program']          = tcookie.program;
            if (tcookie.applicationId) hdrs['Applicationid']   = tcookie.applicationId;
            if (tcookie['tek-siteId']) hdrs['Tek-Siteid']      = tcookie['tek-siteId'];
            if (tcookie['original-userid'])   hdrs['Original-Userid']   = tcookie['original-userid'];
            if (tcookie['original-tenantid']) hdrs['Original-Tenantid'] = tcookie['original-tenantid'];
            if (tcookie.productIds)   hdrs['Productids']       = Array.isArray(tcookie.productIds) ? tcookie.productIds.join(',') : tcookie.productIds;
            console.log('[RV] Headers built:', JSON.stringify(hdrs).slice(0,300));
            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://app.tekioncloud.com/api/vi/u/v1.0.0/inventory/tenant/v2/search',
                headers: hdrs,
                data: JSON.stringify({
                    filters: [{ field: 'vin', operator: 'IN', values: [vin], key: 'vin' }],
                    excludeFields: [], groupBy: [], includeFields: [],
                    searchText: '', searchableFields: [], sort: []
                }),
                onload: function(resp) {
                    console.log('[RV] HTTP status:', resp.status, '- body preview:', (resp.responseText||'').slice(0,200));
                    try {
                        const data = JSON.parse(resp.responseText);
                        const hits = data && data.data && data.data.hits;
                        if (!hits || !hits.length) { if (cb) cb(false); return; }
                        const v = hits[0];
                        const trim  = (v.trimDetails && v.trimDetails.trim) || '';
                        const stock = v.stockID || '';
                        saveVehicleData(trim, stock, vin);
                        if (cb) cb(!!(trim || stock));
                    } catch(e) { if (cb) cb(false); }
                },
                onerror: function() { console.log('[RV] API request error for', vin); if (cb) cb(false); },
                ontimeout: function() { console.log('[RV] API request timeout for', vin); if (cb) cb(false); }
            });
        }
        // Also poll DOM for when Vehicle Profile drawer is open (backup)
        setInterval(function() {
            const trimEl  = document.querySelector('#vehicleDetailsOverviewTrim');
            const stockEl = document.querySelector('#vehicleDetailsOverviewVehicleStockNumber');
            const mileageEl = document.querySelector('#vehicleDetailsOverviewLastOdometerReadingMiles');
            if (!trimEl && !stockEl && !mileageEl) return;
            const trim  = trimEl  ? (trimEl.value  || trimEl.innerText  || '').trim() : '';
            const stock = stockEl ? (stockEl.value || stockEl.innerText || '').trim() : '';
            const mileage = mileageEl ? (mileageEl.value || mileageEl.innerText || '').trim() : '';
            let vin = '';
            document.querySelectorAll('span,div,input').forEach(el => {
                if (vin) return;
                const t = (el.value || el.textContent || '').trim();
                if (/^[A-HJ-NPR-Z0-9]{17}$/.test(t)) vin = t;
            });
            saveVehicleData(trim, stock, vin, mileage);
        }, 500);
        // Retry every 2s. A VIN is only marked done AFTER the API returns a hit.
        // Failed lookups retry up to 3x per VIN. Keyed per VIN so SPA nav to a new RO works.
        const _vinAttempts = {}; // vin -> attempt count, or 'done'
        setInterval(function() {
            // Scan LEAF elements only for an exact 17-char VIN (header VIN span is a leaf).
            // No substring matching inside big containers — that produced false positives.
            let vin = '';
            document.querySelectorAll('span,div,p,td,input').forEach(el => {
                if (vin) return;
                let t = '';
                if (el.tagName === 'INPUT') t = el.value || '';
                else if (el.childElementCount === 0) t = el.textContent || '';
                else return;
                t = t.trim();
                if (/^[A-HJ-NPR-Z0-9]{17}$/.test(t)) vin = t;
            });
            if (!vin) return;
            const state = _vinAttempts[vin];
            if (state === 'done' || (state || 0) >= 3) return;
            // Already have complete cached data for this VIN?
            try {
                const existing = JSON.parse(GM_getValue('rv_veh_' + vin, '{}'));
                if (existing.trim && existing.stock) { _vinAttempts[vin] = 'done'; return; }
            } catch(e) {}
            _vinAttempts[vin] = (state || 0) + 1;
            console.log('[RV] VIN found:', vin, '- attempt', _vinAttempts[vin], '- calling inventory API');
            fetchVehicleData(vin, function(success) {
                if (success) _vinAttempts[vin] = 'done';
                console.log('[RV] API result for', vin, ':', success ? 'HIT - saved' : 'no hit / error');
            });
        }, 2000);
    })();

    const cacheUserName = () => {
        const spans = document.querySelectorAll('span[title]');
        for (const s of spans) {
            const t = (s.getAttribute('title') || '').trim();
            if (t && t.includes(' ') && t.length > 4 && t.length < 40) {
                cachedTekionUserName = t;
                console.log('[PO Fill] cacheUserName found:', t);
                return;
            }
        }
        console.log('[PO Fill] cacheUserName found nothing yet, retrying in 500ms. span[title] count:', spans.length);
        setTimeout(cacheUserName, 500);
    };
    setTimeout(cacheUserName, 100);
}

// =============================================
// US AUTOFORCE SIDE
// =============================================
if (IS_USAUTOFORCE) {

    // Hover outlines
    document.addEventListener('mouseover', (e) => {
        const pn  = e.target.closest('[id$="_PartNumBlock"]');
        const cost = e.target.closest('[id$="_Cost"]');
        if (pn)   pn.style.outline   = '2px dashed #4ade80';
        if (cost) cost.style.outline = '2px dashed #facc15';
    });
    document.addEventListener('mouseout', (e) => {
        const pn   = e.target.closest('[id$="_PartNumBlock"]');
        const cost = e.target.closest('[id$="_Cost"]');
        if (pn)   pn.style.outline   = '';
        if (cost) cost.style.outline = '';
    });

    document.addEventListener('contextmenu', (e) => {
        // Part number — green highlight
        const pnBlock = e.target.closest('[id$="_PartNumBlock"]');
        if (pnBlock) {
            e.preventDefault();
            e.stopPropagation();
            // Part# is in the inner div with class body-xsmall-regular-tight
            const inner = pnBlock.querySelector('.body-xsmall-regular-tight, [class*="xsmall"], [class*="PartNum"]');
            const pn = (inner ? inner.innerText : pnBlock.innerText).trim().replace(/Part\s*#?\s*:?\s*/i, '').trim();
            if (pn) {
                GM_setValue('clip_part', pn);
                pnBlock.style.background = 'rgba(74,222,128,0.4)';
                setTimeout(() => { pnBlock.style.background = ''; }, 600);
            }
            return;
        }

        // Cost price — yellow highlight, auto-add FET if present
        const costEl = e.target.closest('[id$="_Cost"]');
        if (costEl) {
            e.preventDefault();
            e.stopPropagation();
            // Get the result ID prefix (e.g. "tireResult_156020")
            const idMatch = costEl.id.match(/^(tireResult_\d+)_Cost$/);
            const prefix = idMatch ? idMatch[1] : null;

            // Parse cost
            const costText = costEl.innerText.trim().replace(/[$,\s]/g, '').replace(/ea\.?/i, '').trim();
            let cost = parseFloat(costText);
            if (isNaN(cost)) return;

            // Parse FET if present in the same result block
            let fet = 0;
            if (prefix) {
                const fetEl = document.getElementById(prefix + '_FET');
                if (fetEl) {
                    const fetText = fetEl.innerText.trim().replace(/[$,\s]/g, '').replace(/ea\.?/i, '').trim();
                    const fetVal = parseFloat(fetText);
                    if (!isNaN(fetVal) && fetVal > 0) fet = fetVal;
                }
            }

            const total = (cost + fet).toFixed(2);
            GM_setValue('clip_price', total);

            costEl.style.background = 'rgba(250,204,21,0.4)';
            setTimeout(() => { costEl.style.background = ''; }, 600);
            return;
        }
    }, true);
}

// =============================================
// PARTSTECH SIDE
// =============================================
if (IS_PARTSTECH) {

    let ptArmed = true;

    window.addEventListener('recon_arm_toggle', (e) => { ptArmed = e.detail; });
    const storedArm = sessionStorage.getItem('recon_clip_armed');
    if (storedArm === '0') ptArmed = false;

    document.addEventListener('contextmenu', (e) => {
        if (!ptArmed) return;
        const partEl  = e.target.closest('span.css-1og29io');
        const priceEl = e.target.closest('[data-testid="actualPrice"]');
        if (partEl) {
            e.preventDefault();
            e.stopPropagation();
            const pn = partEl.innerText.trim();
            GM_setValue('clip_part', pn);
            partEl.style.background = 'rgba(74,222,128,0.4)';
            setTimeout(() => { partEl.style.background = ''; }, 600);
            return;
        }
        if (priceEl) {
            e.preventDefault();
            e.stopPropagation();
            const price = priceEl.innerText.trim().replace(/[$,]/g, '');
            GM_setValue('clip_price', price);
            priceEl.style.background = 'rgba(250,204,21,0.4)';
            setTimeout(() => { priceEl.style.background = ''; }, 600);
            return;
        }
    }, true);

    document.addEventListener('mouseover', (e) => {
        const p  = e.target.closest('span.css-1og29io');
        const pr = e.target.closest('[data-testid="actualPrice"]');
        if (p)  p.style.outline  = '2px dashed #4ade80';
        if (pr) pr.style.outline = '2px dashed #facc15';
    });
    document.addEventListener('mouseout', (e) => {
        const p  = e.target.closest('span.css-1og29io');
        const pr = e.target.closest('[data-testid="actualPrice"]');
        if (p)  p.style.outline = '';
        if (pr) pr.style.outline = '';
    });
}

// =============================================
// TEKION RO SALES SIDE
// =============================================
if (IS_RO_SALES) {

    GM_addStyle(`
        #tekion-clip-pill {
            position:fixed;bottom:14px;right:320px;z-index:999999;
            background:#1a1a1a;border:2px solid #444;border-radius:20px;
            padding:6px 14px;font-family:'Segoe UI',sans-serif;font-size:12px;
            color:#ccc;display:flex;align-items:center;gap:8px;
            box-shadow:0 2px 10px rgba(0,0,0,0.5);user-select:none;
            transition:border-color 0.2s,background 0.2s;
        }
        #tekion-clip-pill.armed {border-color:#2563eb;background:#0f1f3d;}
        #tekion-clip-pill .dot {width:8px;height:8px;border-radius:50%;background:#555;flex-shrink:0;}
        #tekion-clip-pill .dot.idle  {background:#555;}
        #tekion-clip-pill .dot.ready {background:#4ade80;}
        #tekion-clip-pill .dot.armed {background:#2563eb;}
        #tekion-clip-pill .dot.warn  {background:#f97316;}
        #tekion-clip-pill .dot.err   {background:#ef4444;}
        #tekion-clip-pill .pill-text {font-size:11px;}
        #tekion-clip-pill.armed .pill-text {color:#60a5fa;font-weight:bold;}
    `);

    const pill = document.createElement('div');
    pill.id = 'tekion-clip-pill';
    document.body.appendChild(pill);

    let resetTimer = null;
    let armedInput = null;

    function setPill(text, dotState, armed, autoReset) {
        pill.innerHTML = '';
        armed ? pill.classList.add('armed') : pill.classList.remove('armed');
        const dot = document.createElement('div');
        dot.className = 'dot ' + (dotState || 'idle');
        pill.appendChild(dot);
        const lbl = document.createElement('span');
        lbl.className = 'pill-text';
        lbl.textContent = text;
        pill.appendChild(lbl);
        if (resetTimer) clearTimeout(resetTimer);
        if (autoReset) {
            resetTimer = setTimeout(() => {
                armedInput = null;
                setPill('Click Select field to arm', 'idle', false);
            }, autoReset);
        }
    }

    setPill('Click Select field to arm', 'idle', false);

    document.addEventListener('contextmenu', (e) => {
        const cell = e.target.closest('[data-test-id*="sellingPrice-cell"]');
        if (!cell) {
            console.log('[RO Sales Capture] Right-click did NOT match a sellingPrice cell. Target was:', e.target.tagName, e.target.className);
            // Walk up every ancestor and log its data-test-id so we can see
            // the REAL attribute Tekion is actually using on this page,
            // instead of guessing again.
            let walk = e.target;
            let depth = 0;
            while (walk && depth < 10) {
                console.log('[RO Sales Capture] ancestor depth ' + depth + ':', walk.tagName, '-- data-test-id:', walk.getAttribute && walk.getAttribute('data-test-id'), '-- class:', walk.className);
                walk = walk.parentElement;
                depth++;
            }
            return;
        }
        console.log('[RO Sales Capture] Matched sellingPrice cell:', cell.getAttribute('data-test-id'));
        e.preventDefault();
        // Try editable input first, then fall back to displayed text
        const input = cell.querySelector('.ant-input-number-input');
        let price = '';
        if (input) {
            price = input.value.trim().replace('$', '');
            console.log('[RO Sales Capture] Read from editable input:', price);
        } else {
            // Read-only / saved state — grab text content
            price = cell.innerText.trim().replace(/[$,\s]/g, '');
            console.log('[RO Sales Capture] Read from displayed text:', price);
        }
        if (!price || price === '0' || price === '0.00') {
            console.log('[RO Sales Capture] Price is empty/zero -- NOT saving');
            setPill('⚠ Selling price is $0 — not copied', 'warn', false, 4000);
            return;
        }
        // Flash highlight on the cell regardless of edit state
        cell.style.background = 'rgba(37,99,235,0.3)';
        setTimeout(() => { cell.style.background = ''; }, 600);
        let partNum = '';
        const rowContainer = cell.parentElement;
        if (rowContainer) {
            const itemNameCell = rowContainer.querySelector('[data-test-id*="itemName-cell"]');
            if (itemNameCell) {
                const partInput = itemNameCell.querySelector('input');
                console.log('[RO Sales Capture] itemName cell found -- has input:', !!partInput, '-- input.value:', partInput ? partInput.value : '(n/a)', '-- innerText:', itemNameCell.innerText.trim());
                if (partInput && partInput.value.trim()) {
                    partNum = partInput.value.trim().split(' - ')[0].trim();
                } else {
                    const text = itemNameCell.innerText.trim();
                    if (text) partNum = text.split(' - ')[0].trim();
                }
            } else {
                // Same fix pattern as sellingPrice -- log every cell in this
                // row with its REAL data-test-id so we can find the actual
                // item name cell instead of guessing at the attribute name.
                console.log('[RO Sales Capture] itemName cell not found -- logging all cells in row:');
                Array.from(rowContainer.children).forEach((child, i) => {
                    console.log('[RO Sales Capture] row cell ' + i + ':', child.tagName, '-- data-test-id:', child.getAttribute('data-test-id'), '-- text:', (child.innerText || '').trim().slice(0, 60));
                });
            }
        }
        console.log('[RO Sales Capture] Found partNum:', partNum || '(none found in row)');
        if (partNum) {
            setSellingClip(partNum, price);
            console.log('[RO Sales Capture] Saved to selling slot:', getSellingClip());
            setPill('✓ ' + partNum + ' | $' + price + ' copied', 'ready', false, 30000);
        } else {
            setSellingClip(null, price);
            console.log('[RO Sales Capture] Saved (no part#) to selling slot:', getSellingClip());
            setPill('✓ Selling price $' + price + ' copied', 'ready', false, 30000);
        }
    });

    document.addEventListener('focusin', (e) => {
        const testId = (e.target.getAttribute && e.target.getAttribute('data-test-id')) || '';
        const name   = (e.target.getAttribute && e.target.getAttribute('name')) || '';
        const ph     = (e.target.getAttribute && e.target.getAttribute('placeholder')) || '';
        const isPartSelect = testId.includes('partsTable-partSelect')
            || name.includes('partSelect')
            || ph.toLowerCase().includes('select part')
            || ph.toLowerCase().includes('search part');
        if (!isPartSelect) return;
        armedInput = e.target;
        const { part, price } = getClip();
        if (part) {
            setPill('⌨ DblClick → ' + part + (price ? ' | $' + price : ''), 'armed', true);
        } else {
            setPill('⌨ Armed — no part# copied yet', 'warn', true);
        }
    }, true);

    document.addEventListener('focusout', (e) => {
        const testId = (e.target.getAttribute && e.target.getAttribute('data-test-id')) || '';
        const name   = (e.target.getAttribute && e.target.getAttribute('name')) || '';
        const ph     = (e.target.getAttribute && e.target.getAttribute('placeholder')) || '';
        const isPartSelect = testId.includes('partsTable-partSelect')
            || name.includes('partSelect')
            || ph.toLowerCase().includes('select part')
            || ph.toLowerCase().includes('search part');
        if (!isPartSelect) return;
        // Use longer delay so dblclick fires before we clear armedInput
        setTimeout(() => {
            if (armedInput) {
                armedInput = null;
                if (!GM_getValue('clip_price', '') && !GM_getValue('clip_part', '')) {
                    setPill('Click Select field to arm', 'idle', false);
                }
            }
        }, 600);
    }, true);

    document.addEventListener('dblclick', (e) => {
        // Find the target input — try armedInput first, then event target, then active element
        let el = (armedInput && document.contains(armedInput)) ? armedInput : null;
        if (!el) el = e.target.closest('input[data-test-id*="partsTable-partSelect"]');
        if (!el && document.activeElement && document.activeElement.tagName === 'INPUT') {
            const tid = document.activeElement.getAttribute('data-test-id') || '';
            if (tid.includes('partsTable-partSelect')) el = document.activeElement;
        }
        if (!el) return;
        e.stopPropagation();
        e.preventDefault();

        const { part, price } = getClip();
        if (!part) {
            setPill('No part# — right-click one in PartsTech first', 'warn', false, 5000);
            return;
        }

        armedInput = null;
        setPill('Pasting: ' + part + (price ? ' | $' + price : ''), 'ready', false);

        el.focus();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, '');
        el.dispatchEvent(new Event('input', { bubbles: true }));

        setTimeout(() => {
            setter.call(el, part);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }, 100);

        setTimeout(() => {
            const firstItem = document.querySelector('[data-test-id="@tekion-parts-downshift-autocomplete-first-item"]');
            if (!firstItem) {
                el.blur();
                afterPaste(part, price);
                return;
            }
            const isCreateOnly = firstItem.textContent.trim().startsWith('Create');
            if (isCreateOnly) {
                GM_setValue('clip_price', '');
                setPill('⚠ Not in database — finish manually', 'warn', false, 6000);
                return;
            }
            firstItem.click();
            afterPaste(part, price);
        }, 600);

    }, true);

    function afterPaste(part, price) {
        setPill('✓ Part# pasted — click ••• → Update', 'warn', false, 15000);
    }

    let lastFill = 0;
    new MutationObserver(() => {
        const price = GM_getValue('clip_price', '');
        if (!price) { lastFill = 0; return; }
        const el = document.querySelector('[data-test-id="@tekion-parts-partsRosales-costPrice"]');
        if (!el) return;
        const now = Date.now();
        if (now - lastFill < 2000) return;
        lastFill = now;
        GM_setValue('clip_price', '');
        setTimeout(() => {
            el.focus();
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(el, price);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
            setPill('✓ Price filled — click Save', 'ready', false, 8000);
        }, 300);
    }).observe(document.body, { childList: true, subtree: true });

    const saveBtnObserver = new MutationObserver(() => {
        const saveBtn = document.querySelector(
            '[data-test-id="@tekion-parts-roSalesDetailedView-modal-updatePrice-container-submitButton"]'
        );
        if (!saveBtn || saveBtn._piListening) return;
        saveBtn._piListening = true;
        saveBtn.addEventListener('click', () => {
            // Read cost from the field at click time
            const costEl = document.querySelector('[data-test-id="@tekion-parts-partsRosales-costPrice"]');
            const cost = costEl ? costEl.value.trim() : '';
            // Read part# from modal header
            const modalHeader = document.querySelector('.ant-modal-header');
            let partNum = '';
            if (modalHeader) {
                const match = modalHeader.innerText.match(/Update\s+(\S+)/i);
                if (match) partNum = match[1];
            }
            if (!partNum || !cost) {
                setPill('⚠ Could not read part# or cost', 'warn', false, 5000);
                return;
            }
            GM_setValue('pi_update_part', partNum);
            GM_setValue('pi_update_cost', cost);
            setPill('✓ Saved — opening P&I...', 'ready', false, 10000);
            setTimeout(() => {
                const piUrl = 'https://app.tekioncloud.com/parts/inventory/part';
                if (window._piTab && !window._piTab.closed) {
                    window._piTab.close();
                }
                window._piTab = window.open(piUrl, '_blank');
            }, 300);
        });
    });
    saveBtnObserver.observe(document.body, { childList: true, subtree: true });

    // VEHICLE HOVER TOOLTIP
    GM_addStyle(`
        /* TEST (7/9/26): only applied during our own silent background
           drawer fetch, removed immediately after. Does NOT affect a real,
           user-initiated drawer open. This is a re-test of a technique that
           broke data capture before -- console logging added this time to
           prove definitively whether trim/mileage still populate while
           hidden, before trusting it. */
        body.rv-hide-drawer-test .ant-drawer-content-wrapper,
        body.rv-hide-drawer-test .ant-drawer-mask {
            opacity: 0 !important;
            transition: none !important;
            pointer-events: none !important;
        }
        #rv-vehicle-tooltip {
            position:fixed;z-index:999999;
            background:#111;border:1px solid #1e4d8c;border-radius:8px;
            padding:14px 18px;font-family:'Segoe UI',sans-serif;font-size:14px;
            color:#e0e0e0;box-shadow:0 4px 20px rgba(0,0,0,.7);
            pointer-events:none;display:none;min-width:320px;max-width:460px;
        }
        #rv-vehicle-tooltip .rv-vtt-row {
            display:flex;justify-content:space-between;align-items:baseline;
            padding:5px 0;border-bottom:1px solid #222;
        }
        #rv-vehicle-tooltip .rv-vtt-row:last-child { border-bottom:none; }
        #rv-vehicle-tooltip .rv-vtt-label { color:#888;font-size:11px;text-transform:uppercase;flex-shrink:0;margin-right:16px;letter-spacing:.05em; }
        #rv-vehicle-tooltip .rv-vtt-val { color:#fff;font-family:monospace;font-size:14px;text-align:right;word-break:break-all; }
        #rv-vehicle-tooltip .rv-vtt-val.empty { color:#444;font-style:italic;font-family:'Segoe UI',sans-serif;font-size:11px; }
    `);

    const rvVehicleTooltip = document.createElement('div');
    rvVehicleTooltip.id = 'rv-vehicle-tooltip';
    document.body.appendChild(rvVehicleTooltip);

    function getVehicleData() {
        const data = { vin: '', stock: '', vehicle: '', trim: '', mileage: '' };
        const modelBtn = document.querySelector('[data-test-id="undefined-modelButton"]');
        if (modelBtn) data.vehicle = modelBtn.innerText.trim();
        // VIN: scan for standalone 17-char VIN
        document.querySelectorAll('span,div,p,td,input').forEach(el => {
            if (data.vin) return;
            const t = el.tagName === 'INPUT' ? (el.value || '') : (el.innerText || el.textContent || '');
            const m = t.trim().match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
            if (m) data.vin = m[1];
        });
        // Load trim+stock+mileage from GM storage (saved by global scanner on any Tekion page)
        try {
            const key = 'rv_veh_' + (data.vin || 'last');
            const saved = JSON.parse(GM_getValue(key, '{}'));
            data.stock   = saved.stock   || '';
            data.trim    = saved.trim    || '';
            data.mileage = saved.mileage || '';
        } catch(e) {}
        return data;
    }

    function showVehicleTooltip(anchorEl) {
        const d = getVehicleData();
        const rows = [
            { label: 'Vehicle',  val: d.vehicle },
            { label: 'VIN',      val: d.vin },
            { label: 'Stock #',  val: d.stock },
            { label: 'Trim',     val: d.trim },
            { label: 'Mileage',  val: d.mileage },
        ];
        rvVehicleTooltip.innerHTML = rows.map(r =>
            `<div class="rv-vtt-row"><span class="rv-vtt-label">${r.label}</span>` +
            `<span class="rv-vtt-val${r.val ? '' : ' empty'}">${r.val || '— click vehicle link once to load —'}</span></div>`
        ).join('');
        rvVehicleTooltip.style.display = 'block';
        const rect = anchorEl.getBoundingClientRect();
        let left = rect.left;
        const tipW = rvVehicleTooltip.offsetWidth;
        if (left + tipW > window.innerWidth - 10) left = window.innerWidth - tipW - 10;
        rvVehicleTooltip.style.left = left + 'px';
        rvVehicleTooltip.style.top = (rect.bottom + 6) + 'px';
    }

    let cachedStock = '';
    let cachedTrim  = '';

    // Scan all visible input/textarea fields with a label containing 'trim' or 'stock'
    // Works regardless of element ID — handles any Tekion layout
    function scanVehicleFields() {
        document.querySelectorAll('input, textarea').forEach(el => {
            const v = (el.value || el.innerText || '').trim();
            if (!v) return;
            // Find associated label by walking up to container and finding label text
            let container = el.parentElement;
            for (let i = 0; i < 5 && container; i++) {
                const label = container.querySelector('label, [class*="label"], [class*="Label"]');
                if (label) {
                    const lt = (label.innerText || label.textContent || '').toLowerCase();
                    if (lt.includes('trim') && v.length > 3) cachedTrim = v;
                    if ((lt.includes('stock') || lt.includes('Stock Number')) && v.length > 2) cachedStock = v;
                    break;
                }
                container = container.parentElement;
            }
        });
    }
    setInterval(scanVehicleFields, 500);

    // Auto-open the vehicle drawer so the existing DOM poller (above, watches
    // #vehicleDetailsOverviewTrim / #vehicleDetailsOverviewVehicleStockNumber
    // every 500ms) has something to find. Then close the drawer.
    // Guarded per-link so it only fires once per vehicle link element.
    let drawerFetchBusy = false;
    function autoFetchDrawerData(link) {
        if (drawerFetchBusy) { console.log('[Vehicle Hover] Skipped -- a drawer fetch is already in progress'); return; }
        // Re-check right before actually firing, not just when we first
        // decided to schedule this -- tab state can change during the
        // 1500ms delay between scheduling and firing.
        const poTabOpenNow = !!document.querySelector('[data-test-id="@tekion-parts-purchaseOrderNew-poDetails-controlNumber-input"]');
        if (poTabOpenNow) { console.log('[Vehicle Hover] PO tab open at fire-time -- aborting'); return; }
        drawerFetchBusy = true;
        // TEST (7/9/26): re-attempting the hide technique that broke data
        // capture before, but this time instrumented so we can SEE whether
        // the trim/mileage fields actually populate while hidden, instead
        // of just assuming. If logs show they never populate, revert again.
        document.body.classList.add('rv-hide-drawer-test');
        console.log('[Vehicle Hover TEST] Drawer hidden, opening...');
        const modelBtn = link.querySelector('[data-test-id="undefined-modelButton"]') || link;
        const rect = modelBtn.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        ['mousedown', 'mouseup', 'click'].forEach(type => {
            modelBtn.dispatchEvent(new MouseEvent(type, {
                bubbles: true, cancelable: true,
                clientX: x, clientY: y
            }));
        });
        // Poll for the trim field to actually appear (load time varies) instead
        // of closing on a fixed timer, which was closing the drawer before
        // slower-loading vehicles finished populating their data.
        let attempts = 0;
        const maxAttempts = 20; // 20 * 300ms = 6s max wait
        const pollForData = setInterval(function() {
            attempts++;
            const trimEl = document.querySelector('#vehicleDetailsOverviewTrim');
            const stockEl = document.querySelector('#vehicleDetailsOverviewVehicleStockNumber');
            const ready = !!(trimEl && trimEl.value);
            console.log('[Vehicle Hover TEST] attempt ' + attempts + ' -- trimEl exists:', !!trimEl, '-- trim value:', trimEl ? trimEl.value : '(n/a)', '-- stock value:', stockEl ? stockEl.value : '(n/a)');
            if (ready || attempts >= maxAttempts) {
                clearInterval(pollForData);
                console.log('[Vehicle Hover TEST] Finished after ' + attempts + ' attempts -- final trim value:', trimEl ? trimEl.value : '(none)', '-- SUCCESS:', ready);
                const closeBtn = document.querySelector('.ant-drawer-mask');
                if (closeBtn) closeBtn.click();
                document.body.classList.remove('rv-hide-drawer-test');
                drawerFetchBusy = false;
            }
        }, 300);
    }

    let vehicleLinkAttached = null;
    let drawerFetchScheduled = false;
    function attachVehicleHover() {
        const link = document.querySelector('[data-test-id="undefined-link"]');
        if (!link) { return; }
        if (link === vehicleLinkAttached) return;
        // CONFIRMED (7/9/26): the PO tab shares the exact same URL as this
        // RO Sales page, so we can't tell them apart from the URL at all.
        // Instead check for a real field that only exists when the PO tab
        // is actually the one currently open/rendered.
        const poTabOpen = !!document.querySelector('[data-test-id="@tekion-parts-purchaseOrderNew-poDetails-controlNumber-input"]');
        if (poTabOpen) { console.log('[Vehicle Hover] PO tab is open -- skipping auto-fetch drawer'); return; }
        vehicleLinkAttached = link;
        link.addEventListener('mouseenter', () => showVehicleTooltip(link));
        link.addEventListener('mouseleave', () => { rvVehicleTooltip.style.display = 'none'; });
        // Prevent stacking multiple scheduled fetches -- Tekion's tab
        // switching fires this function many times in quick succession via
        // the body-wide MutationObserver below, and each re-render can give
        // us a "new" link reference, defeating the vehicleLinkAttached
        // check above. Without this, several overlapping fetch attempts
        // could pile up during a single tab switch.
        if (drawerFetchScheduled) return;
        drawerFetchScheduled = true;
        setTimeout(() => {
            drawerFetchScheduled = false;
            autoFetchDrawerData(link);
        }, 1500);
    }
    attachVehicleHover();
    new MutationObserver(attachVehicleHover).observe(document.body, { childList: true, subtree: true });
}

// =============================================
// PO AUTOFILL
// =============================================
if (IS_RO_SALES) {

    GM_addStyle(`
        #po-fill-pill {
            position:fixed;z-index:999999;
            background:#2563eb;color:#fff;font-weight:700;font-size:11px;
            padding:6px 14px;border-radius:20px;cursor:pointer;
            box-shadow:0 2px 10px rgba(37,99,235,0.4);
            font-family:'Segoe UI',sans-serif;user-select:none;
            border:none;white-space:nowrap;
        }
        #po-fill-pill:hover { background:#1d4ed8; }
        #po-fill-pill.filling { background:#555;cursor:default; }
        #po-fill-pill.done { background:#16a34a; }
        #po-fill-pill.error { background:#dc2626; }
    `);

    const poPill = document.createElement('button');
    poPill.id = 'po-fill-pill';
    poPill.textContent = '⏳ Waiting...';
    // Set initial visible position before anchor search completes
    poPill.style.top = '80px';
    poPill.style.right = '20px';
    poPill.style.left = 'auto';
    poPill.style.bottom = 'auto';
    document.body.appendChild(poPill);

    function positionPoPill() {
        const spans = document.querySelectorAll('span');
        for (const s of spans) {
            if (s.innerText && s.innerText.trim() === 'Create another Vendor Special Order') {
                const r = s.getBoundingClientRect();
                poPill.style.top = (r.top + (r.height / 2) - 14) + 'px';
                poPill.style.left = (r.right + 20) + 'px';
                poPill.style.right = 'auto';
                poPill.style.bottom = 'auto';
                return;
            }
        }
        // Fallback — always visible in top-right
        poPill.style.top = '80px';
        poPill.style.right = '20px';
        poPill.style.left = 'auto';
        poPill.style.bottom = 'auto';
    }

    function waitForPOAnchor() {
        const spans = document.querySelectorAll('span');
        for (const s of spans) {
            if (s.innerText && s.innerText.trim() === 'Create another Vendor Special Order') {
                positionPoPill(); return;
            }
        }
        setTimeout(waitForPOAnchor, 300);
    }
    waitForPOAnchor();
    window.addEventListener('resize', positionPoPill);

    function poNativeSet(el, value) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function poPressKey(el, key, keyCode) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key, keyCode, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key, keyCode, bubbles: true }));
    }

    function getRoNumber() {
        const match = location.pathname.match(/parts-fulfillment\/(\d+)/);
        return match ? match[1] : '';
    }

    let poFilled = false;

    async function fillPO() {
        if (poFilled) { console.log('[PO Fill] Ignored -- already filled/filling'); return; }
        poFilled = true;
        poPill.classList.add('filling');
        const roNumber = getRoNumber();
        console.log('[PO Fill] Starting -- roNumber:', roNumber, '-- cachedTekionUserName (initial):', cachedTekionUserName);

        let userName = cachedTekionUserName;
        for (let i = 0; i < 15 && !userName; i++) {
            await new Promise(r => setTimeout(r, 200));
            userName = cachedTekionUserName;
        }
        console.log('[PO Fill] userName after wait:', userName || '(still empty)');

        try {
            const controlField = document.querySelector('[data-test-id="@tekion-parts-purchaseOrderNew-poDetails-controlNumber-input"]');
            console.log('[PO Fill] controlField found:', !!controlField);
            if (controlField && roNumber) {
                poPill.textContent = '⏳ RO# ' + roNumber + '...';
                controlField.focus();
                poNativeSet(controlField, '');
                poNativeSet(controlField, roNumber);
                console.log('[PO Fill] RO# set to:', roNumber);
                // No blur dispatch — causes Tekion to treat form as abandoned
            }

            await new Promise(r => setTimeout(r, 100));
            poPill.textContent = '⏳ ' + userName + '...';
            // Requested By is a Tekion Select component — click the control to open, then click the option
            const reqControl = document.querySelector(
                '[data-test-id="@tekion-parts-purchaseOrderNew-poDetails-requestedBy-advancedSelect"] [class*="tekion-select"][class*="control"], ' +
                '#requestedByUserId [class*="control"]'
            );
            console.log('[PO Fill] reqControl found:', !!reqControl);
            if (reqControl && userName) {
                reqControl.click();
                await new Promise(r => setTimeout(r, 400));

                // Type into the search input that appears after clicking
                const reqInput = document.querySelector(
                    '#requestedByUserId input, ' +
                    '[data-test-id="@tekion-parts-purchaseOrderNew-poDetails-requestedBy-advancedSelect"] input'
                );
                console.log('[PO Fill] reqInput found after click:', !!reqInput);
                if (reqInput) {
                    reqInput.focus();
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    setter.call(reqInput, userName);
                    reqInput.dispatchEvent(new Event('input', { bubbles: true }));
                    reqInput.dispatchEvent(new Event('change', { bubbles: true }));
                    await new Promise(r => setTimeout(r, 600));
                }

                // Click the matching option from the Tekion Select dropdown
                let nameSelected = false;
                for (let i = 0; i < 20; i++) {
                    const options = document.querySelectorAll(
                        '[class*="tekion-select"][class*="option"], ' +
                        '[class*="menuItem"][role="option"], ' +
                        '[id^="react-select"] [class*="option"], ' +
                        'div[role="option"]'
                    );
                    if (i === 0) console.log('[PO Fill] dropdown options found on first check:', options.length, Array.from(options).map(o => (o.innerText||'').trim().slice(0,40)));
                    for (const opt of options) {
                        const txt = (opt.innerText || opt.textContent || '').trim();
                        if (txt && (txt === userName || txt.includes(userName.split(' ')[0]))) {
                            opt.click();
                            nameSelected = true;
                            break;
                        }
                    }
                    if (nameSelected) break;
                    await new Promise(r => setTimeout(r, 200));
                }
                console.log('[PO Fill] nameSelected:', nameSelected);
                if (!nameSelected) {
                    // Last resort keyboard fallback
                    const inp = document.querySelector('#requestedByUserId input');
                    console.log('[PO Fill] Falling back to keyboard nav -- input found:', !!inp);
                    if (inp) {
                        poPressKey(inp, 'ArrowDown', 40);
                        await new Promise(r => setTimeout(r, 150));
                        poPressKey(inp, 'Enter', 13);
                    }
                }
            }

            await new Promise(r => setTimeout(r, 200));
            poPill.classList.remove('filling');
            poPill.classList.add('done');
            poPill.textContent = userName ? '✓ Done — select vendor' : '✓ RO# filled — enter name manually';
            console.log('[PO Fill] Finished. Final state -- userName:', userName, '-- roNumber:', roNumber);
            setTimeout(() => { poPill.style.display = 'none'; }, 5000);

        } catch(err) {
            poFilled = false;
            poPill.classList.remove('filling');
            poPill.classList.add('error');
            poPill.textContent = '⚠ Error';
            console.error('[PO Fill]', err);
        }
    }

    let lastPOControlField = null;
    new MutationObserver(() => {
        const controlField = document.querySelector('[data-test-id="@tekion-parts-purchaseOrderNew-poDetails-controlNumber-input"]');
        if (controlField && controlField !== lastPOControlField) {
            lastPOControlField = controlField;
            poFilled = false;
            poPill.style.display = '';
            poPill.classList.remove('done', 'error', 'filling');
            poPill.textContent = '⏳ Waiting...';
            // Poll until the field is actually interactive (not disabled, React ready)
            // rather than waiting a fixed delay -- fires immediately when ready.
            // Extended from 6s to 15s: on a day when Tekion itself is slow to
            // render, 6s wasn't enough and this used to fail completely
            // silently, leaving the pill stuck on "Waiting..." forever with
            // no indication anything went wrong. Now it also shows a clear,
            // clickable failure state instead of silently giving up.
            let readyAttempts = 0;
            const maxReadyAttempts = 100; // 100 * 150ms = 15s max wait
            const waitForReady = setInterval(() => {
                readyAttempts++;
                const f = document.querySelector('[data-test-id="@tekion-parts-purchaseOrderNew-poDetails-controlNumber-input"]');
                const reqControl = document.querySelector(
                    '[data-test-id="@tekion-parts-purchaseOrderNew-poDetails-requestedBy-advancedSelect"] [class*="tekion-select"][class*="control"], ' +
                    '#requestedByUserId [class*="control"]'
                );
                // Ready when: control field exists, is not disabled, and Requested By control is also present
                const ready = f && !f.disabled && reqControl;
                if (ready || readyAttempts >= maxReadyAttempts) {
                    clearInterval(waitForReady);
                    console.log('[PO Fill] Readiness poll finished after ' + readyAttempts + ' attempts -- controlField:', !!f, '-- reqControl:', !!reqControl, '-- calling fillPO:', !!ready);
                    if (ready) {
                        fillPO();
                    } else {
                        // Don't fail silently -- Tekion may just be slow today.
                        // Show a clear, clickable retry state instead of
                        // leaving the pill stuck on "Waiting..." forever.
                        poPill.classList.remove('filling');
                        poPill.classList.add('error');
                        poPill.textContent = '⚠ Didn\'t load — click to retry';
                    }
                }
            }, 150);
        }
    }).observe(document.body, { childList: true, subtree: true });

    poPill.onclick = () => {
        poFilled = false;
        poPill.classList.remove('done', 'error', 'filling');
        fillPO();
    };
}

// =============================================
// PARTS & INVENTORY SIDE
// =============================================
if (IS_PI) {

    GM_addStyle(`
        #pi-clip-pill {
            position:fixed;bottom:70px;right:12px;z-index:999999;
            background:#1a1a1a;border:2px solid #444;border-radius:20px;
            padding:6px 14px;font-family:'Segoe UI',sans-serif;font-size:12px;
            color:#ccc;display:flex;align-items:center;gap:8px;
            box-shadow:0 2px 10px rgba(0,0,0,0.5);user-select:none;
        }
        #pi-clip-pill .dot {width:8px;height:8px;border-radius:50%;background:#555;flex-shrink:0;}
        #pi-clip-pill .dot.idle  {background:#555;}
        #pi-clip-pill .dot.ready {background:#4ade80;}
        #pi-clip-pill .dot.warn  {background:#f97316;}
        #pi-clip-pill .dot.err   {background:#ef4444;}
        #pi-clip-pill .pill-text {font-size:11px;}
    `);

    const pill = document.createElement('div');
    pill.id = 'pi-clip-pill';
    document.body.appendChild(pill);

    function setPill(text, dotState) {
        pill.innerHTML = '';
        const dot = document.createElement('div');
        dot.className = 'dot ' + (dotState || 'idle');
        pill.appendChild(dot);
        const lbl = document.createElement('span');
        lbl.className = 'pill-text';
        lbl.textContent = text;
        pill.appendChild(lbl);
    }

    setPill('Waiting...', 'idle');

    function waitFor(selector, timeout) {
        return new Promise((resolve, reject) => {
            const el = document.querySelector(selector);
            if (el) return resolve(el);
            const obs = new MutationObserver(() => {
                const found = document.querySelector(selector);
                if (found) { obs.disconnect(); resolve(found); }
            });
            obs.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => { obs.disconnect(); reject(new Error('Timeout: ' + selector)); }, timeout || 10000);
        });
    }

    function nativeSet(el, value) {
        const proto = el.tagName === 'TEXTAREA'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
        el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    }

    async function findEditPartButton(maxWaitMs) {
        const start = Date.now();
        while (Date.now() - start < maxWaitMs) {
            let btn = document.querySelector('[data-test-id="@tekion-parts-partsAndInventory-partsTab-partDetailsTab-editPartButton"]');
            if (btn && btn.offsetParent !== null) return btn;
            for (const b of document.querySelectorAll('button')) {
                if (b.innerText.trim() === 'Edit Part' && b.offsetParent !== null) return b;
            }
            for (const b of document.querySelectorAll('[data-test-id*="editPart"], [data-test-id*="edit-part"], [data-test-id*="EditPart"]')) {
                if (b.offsetParent !== null) return b;
            }
            for (const b of document.querySelectorAll('button[aria-label*="Edit"]')) {
                if (b.innerText.includes('Part') && b.offsetParent !== null) return b;
            }
            await new Promise(r => setTimeout(r, 300));
        }
        return null;
    }

    async function runPIUpdate(partNum, cost) {
        try {
            setPill('Searching ' + partNum + '...', 'ready');
            const searchBox = await waitFor('input.ant-input[placeholder="Type Here"]', 8000);
            searchBox.focus();
            nativeSet(searchBox, partNum);

            setPill('Waiting for result...', 'ready');
            await new Promise(r => setTimeout(r, 800));

            // Wait for correct part to appear — check autocomplete dropdown AND row-0
            let firstItem = null;
            for (let attempt = 0; attempt < 40; attempt++) {
                // Primary: Tekion autocomplete first item (same dropdown as RO Sales paste)
                const autoFirst = document.querySelector('[data-test-id="@tekion-parts-downshift-autocomplete-first-item"]');
                if (autoFirst && autoFirst.innerText.includes(partNum) && !autoFirst.innerText.startsWith('Create')) {
                    firstItem = autoFirst;
                }
                // Secondary: row-0 in the parts list table
                if (!firstItem) {
                    const el = document.querySelector('[data-test-id="@tekion-parts-partsAndInventory-tabs-preferredPartListTableUserPreference-row-0"]');
                    if (el && el.innerText.includes(partNum)) firstItem = el;
                }
                if (firstItem) break;
                await new Promise(r => setTimeout(r, 300));
            }

            if (!firstItem) {
                setPill('⚠ ' + partNum + ' not found in list', 'err');
                GM_setValue('pi_update_part', '');
                GM_setValue('pi_update_cost', '');
                return;
            }

            await new Promise(r => setTimeout(r, 200));
            firstItem.click();

            // If we clicked the autocomplete dropdown, now wait for the table row to appear and click it
            setPill('Loading part detail...', 'ready');
            await new Promise(r => setTimeout(r, 800));

            // Check if we need to click a table row (autocomplete just filtered the list)
            const tableRow = document.querySelector('[data-test-id="@tekion-parts-partsAndInventory-tabs-preferredPartListTableUserPreference-row-0"]');
            if (tableRow && tableRow.innerText.includes(partNum)) {
                await new Promise(r => setTimeout(r, 200));
                tableRow.click();
                await new Promise(r => setTimeout(r, 800));
            }

            setPill('Opening edit...', 'ready');
            await new Promise(r => setTimeout(r, 600));
            const editBtn = await findEditPartButton(15000);

            if (!editBtn) throw new Error('Edit Part button not found after 15s');

            await new Promise(r => setTimeout(r, 300));
            editBtn.click();

            setPill('Type $' + cost + ' → Tab → Save', 'ready');
            const costField = await waitFor('input#costPrice', 8000);
            await new Promise(r => setTimeout(r, 400));

            costField.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await new Promise(r => setTimeout(r, 400));

            const existingBadge = document.getElementById('pi-cost-badge');
            if (existingBadge) existingBadge.remove();
            const badge = document.createElement('div');
            badge.id = 'pi-cost-badge';
            badge.textContent = 'TYPE: $' + cost;
            badge.style.cssText = [
                'position:fixed',
                'z-index:9999999',
                'background:#4ade80',
                'color:#000',
                'font-weight:700',
                'font-size:16px',
                'padding:8px 16px',
                'border-radius:8px',
                'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
                'pointer-events:none',
                'font-family:monospace',
            ].join(';');
            const rect = costField.getBoundingClientRect();
            badge.style.top  = (rect.top - 48) + 'px';
            badge.style.left = rect.left + 'px';
            document.body.appendChild(badge);

            setTimeout(() => { const b = document.getElementById('pi-cost-badge'); if (b) b.remove(); }, 30000);

            GM_setValue('pi_update_part', '');
            GM_setValue('pi_update_cost', '');

            costField.focus();
            costField.select();

            new MutationObserver((_, obs) => {
                const save = document.querySelector('button.ant-btn-primary[type="button"]:not([disabled])');
                if (!save || save._piClosing) return;
                save._piClosing = true;
                obs.disconnect();
                save.addEventListener('click', () => {
                    setPill('✓ Saved — closing...', 'ready');
                    setTimeout(() => window.close(), 2000);
                }, { once: true });
            }).observe(document.body, { childList: true, subtree: true });

        } catch (err) {
            setPill('⚠ ' + err.message, 'err');
            console.error('[PI Update]', err);
        }
    }

    setTimeout(() => {
        const partNum = GM_getValue('pi_update_part', '');
        const cost    = GM_getValue('pi_update_cost', '');
        if (partNum && cost) {
            runPIUpdate(partNum, cost);
        } else {
            setPill('P&I ready', 'idle');
        }
    }, 2500);
}

// =============================================
// RECONVISION SIDE
// =============================================
if (IS_RECONVISION) {

    function nativeSet(el, value) {
        const proto = el.tagName === 'TEXTAREA'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
        el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    }

    let filling = false;

    document.addEventListener('focusin', (e) => {
        const el = e.target;
        const isMatch = el.tagName === 'TEXTAREA' &&
            (el.getAttribute('data-field-name') === 'partNumber' ||
             el.id.includes('part_number') ||
             el.placeholder === 'Add Part#');
        if (el.tagName === 'TEXTAREA') {
            console.log('[RV Paste] Focused a TEXTAREA -- id:', el.id, '-- data-field-name:', el.getAttribute('data-field-name'), '-- placeholder:', el.placeholder, '-- matched:', isMatch);
        }
        if (
            isMatch
        ) {
            if (filling) { console.log('[RV Paste] Ignored -- already filling'); return; }
            let { part, price } = getSellingClip();
            console.log('[RV Paste] selling slot:', part, price);
            if (!part) {
                const fallback = getClip();
                part = fallback.part; price = fallback.price;
                console.log('[RV Paste] selling slot empty, fallback slot:', part, price);
            }
            if (!part) { console.log('[RV Paste] Both slots empty -- nothing to paste'); return; }
            filling = true;
            console.log('[RV Paste] Setting part# field to:', part);
            nativeSet(el, part);
            setTimeout(() => {
                const row = el.closest('tr') || el.closest('[data-id]') || el.parentElement;
                const priceInput = (row && row.querySelector('input[id*="part_price"]'))
                    || document.querySelector(
                        '#line_item_parts_attributes_new_row_1_part_price, ' +
                        'input[data-field-name="partPrice"], ' +
                        'input[id*="part_price"]'
                    );
                console.log('[RV Paste] row found:', !!row, '-- priceInput found:', !!priceInput);
                if (priceInput && price) {
                    console.log('[RV Paste] Setting price field to:', price);
                    nativeSet(priceInput, price);
                    GM_setValue('clip_selling_price', '');
                    GM_setValue('clip_price', '');
                } else if (!priceInput) {
                    console.log('[RV Paste] NO PRICE FIELD FOUND -- part# alone was set, price left untouched');
                }
                GM_setValue('clip_selling_part', '');
                GM_setValue('clip_part', '');
                setTimeout(() => { filling = false; }, 800);
            }, 300);
        }
    }, true);

    // =============================================
    // RV BUCKET MOVER PILLS (24 HR / OVER 24 HR)
    // Only on work order edit pages
    // =============================================
    function initBucketPills() {
        if (document.getElementById('rv-bucket-pills')) return; // already injected
        if (!document.body) {
            // @run-at document-start means this can execute before the parser
            // has reached <body> yet -- confirmed via a live error: "Cannot
            // read properties of null (reading 'appendChild')" at the
            // document.body.appendChild call below. Retry shortly instead
            // of throwing and silently aborting pill creation for this load.
            setTimeout(initBucketPills, 50);
            return;
        }

        GM_addStyle(`
            #rv-bucket-pills {
                position:fixed;
                z-index:99999;
                display:flex;
                flex-direction:column;
                align-items:stretch;
                gap:4px;
                pointer-events:none;
                width:105px;
            }
            .rv-bucket-btn {
                pointer-events:all;
                border:none;
                border-radius:20px;
                padding:8px 14px;
                font-family:'Segoe UI',sans-serif;
                font-size:12px;
                font-weight:700;
                cursor:pointer;
                white-space:nowrap;
                text-align:center;
                user-select:none;
                overflow:hidden;
                text-overflow:ellipsis;
                transition:background 0.2s, opacity 0.2s;
                width:105px;
                box-sizing:border-box;
                line-height:1;
            }
            .rv-bucket-btn.busy {
                font-size:10px;
                font-weight:500;
            }
            .rv-bucket-btn:disabled { opacity:0.5; cursor:not-allowed; }
            #rv-btn-24 {
                background:#3b82f6;
                color:#000;
                box-shadow:0 2px 12px rgba(59,130,246,0.4);
            }
            #rv-btn-24:hover:not(:disabled) {
                background:#2563eb;
                box-shadow:0 2px 16px rgba(59,130,246,0.6);
            }
            #rv-btn-over24 {
                background:#2dd4bf;
                color:#000;
                box-shadow:0 2px 12px rgba(45,212,191,0.4);
            }
            #rv-btn-over24:hover:not(:disabled) {
                background:#14b8a6;
                box-shadow:0 2px 16px rgba(45,212,191,0.6);
            }
        `);

        const pillContainer = document.createElement('div');
        pillContainer.id = 'rv-bucket-pills';
        document.body.appendChild(pillContainer);

        const btn24 = document.createElement('button');
        btn24.id = 'rv-btn-24';
        btn24.className = 'rv-bucket-btn';
        btn24.textContent = '24 HR';
        pillContainer.appendChild(btn24);

        const btnOver24 = document.createElement('button');
        btnOver24.id = 'rv-btn-over24';
        btnOver24.className = 'rv-bucket-btn';
        btnOver24.textContent = 'OVER 24';
        pillContainer.appendChild(btnOver24);

        function positionBucketPills() {
            const rvToggle = document.getElementById('rv-toggle');
            const rvPanel  = document.getElementById('rv-pt-panel');

            let anchorTop = null;

            if (rvToggle) {
                const toggleW = rvToggle.offsetWidth;
                if (toggleW > 0) {
                    pillContainer.style.width = toggleW + 'px';
                    btn24.style.width = '100%';
                    btnOver24.style.width = '100%';
                }
            }

            if (rvPanel && rvPanel.style.display !== 'none' && rvPanel.offsetHeight > 0) {
                const r = rvPanel.getBoundingClientRect();
                anchorTop = r.top;
            } else if (rvToggle) {
                const r = rvToggle.getBoundingClientRect();
                anchorTop = r.top;
            }

            if (anchorTop !== null) {
                pillContainer.style.bottom = (window.innerHeight - anchorTop + 6) + 'px';
            } else {
                pillContainer.style.bottom = '100px';
            }
            pillContainer.style.right = '20px';
            pillContainer.style.top = 'auto';
            pillContainer.style.left = 'auto';
        }

        setTimeout(positionBucketPills, 1000);
        window.addEventListener('resize', positionBucketPills);

        const positionObserver = new MutationObserver(() => positionBucketPills());
        const observeEl = (id) => {
            const el = document.getElementById(id);
            if (el) positionObserver.observe(el, { attributes: true, attributeFilter: ['style'] });
        };
        const bodyObserver = new MutationObserver(() => {
            observeEl('rv-pt-panel');
            observeEl('rv-toggle');
            positionBucketPills();
        });
        bodyObserver.observe(document.body, { childList: true });
        observeEl('rv-pt-panel');
        observeEl('rv-toggle');

        function waitForEl(selector, timeout) {
            return new Promise((resolve, reject) => {
                const el = document.querySelector(selector);
                if (el) return resolve(el);
                const obs = new MutationObserver(() => {
                    const found = document.querySelector(selector);
                    if (found) { obs.disconnect(); resolve(found); }
                });
                obs.observe(document.body, { childList: true, subtree: true });
                setTimeout(() => { obs.disconnect(); reject(new Error('Timeout waiting for: ' + selector)); }, timeout || 10000);
            });
        }

        function findSectionHeader(text) {
            const headers = document.querySelectorAll('.service-search h2, .popup__content h2, .service-search [class*="header"], .popup__content [class*="section"]');
            for (const h of headers) {
                if (h.innerText && h.innerText.trim() === text) return h;
            }
            const all = document.querySelectorAll('*');
            for (const el of all) {
                if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
                    if (el.innerText && el.innerText.trim() === text) return el;
                }
            }
            return null;
        }

        function findFirstUncheckedInSection(sectionText) {
            const modal = document.querySelector('.service-search, #service-search, .popup__content, .mfp-content');
            if (!modal) return null;

            let sectionHeader = null;
            const allEls = modal.querySelectorAll('*');
            for (const el of allEls) {
                if (el.children.length === 0 || (el.children.length === 1 && el.children[0].tagName === 'I')) {
                    const txt = el.innerText ? el.innerText.trim() : '';
                    if (txt === sectionText) { sectionHeader = el; break; }
                }
            }

            if (!sectionHeader) {
                console.warn('[RV Bucket] Section not found:', sectionText);
                return null;
            }

            const allCheckboxes = Array.from(modal.querySelectorAll('input[type="checkbox"]'));
            let inSection = false;
            let foundHeader = false;

            for (const cb of allCheckboxes) {
                const pos = sectionHeader.compareDocumentPosition(cb);
                if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
                    if (!foundHeader) { foundHeader = true; inSection = true; }
                    if (inSection && !cb.checked && !cb.disabled) return cb;
                }
            }

            const sectionHeaders = [];
            for (const el of allEls) {
                if (el.children.length === 0) {
                    const txt = el.innerText ? el.innerText.trim() : '';
                    if (txt && txt.length > 3 && txt.length < 60 && !txt.includes('\n')) {
                        const cbsNear = el.closest('tr') || el.closest('li') || el.closest('div');
                        if (!cbsNear || !cbsNear.querySelector('input[type="checkbox"]')) {
                            sectionHeaders.push({ el, txt });
                        }
                    }
                }
            }

            const targetIdx = sectionHeaders.findIndex(s => s.txt === sectionText);
            if (targetIdx === -1) return null;
            const nextHeader = sectionHeaders[targetIdx + 1];

            for (const cb of allCheckboxes) {
                const afterTarget = sectionHeader.compareDocumentPosition(cb) & Node.DOCUMENT_POSITION_FOLLOWING;
                const beforeNext = !nextHeader || (nextHeader.el.compareDocumentPosition(cb) & Node.DOCUMENT_POSITION_PRECEDING);
                if (afterTarget && beforeNext && !cb.checked && !cb.disabled) return cb;
            }

            return null;
        }

        async function addServiceToBucket(sectionText, btnEl) {
            btnEl.disabled = true;
            btnEl.classList.add('busy');
            const origText = btnEl.textContent;
            btnEl.textContent = '⏳ Opening';

            try {
                const addServiceBtn = document.querySelector('button.add-service--toggle');
                if (!addServiceBtn) throw new Error('Add Service button not found');
                addServiceBtn.click();

                btnEl.textContent = '⏳ Modal...';
                await waitForEl('.mfp-wrap .service-search, .mfp-wrap #service-search, .mfp-wrap input[placeholder="Search"]', 10000);
                await new Promise(r => setTimeout(r, 600));

                btnEl.textContent = '⏳ Services...';
                let viewAllBtn = null;
                for (let i = 0; i < 30; i++) {
                    viewAllBtn = document.querySelector('[data-button="view-all-services"], [data-test="view-all-services"]');
                    if (!viewAllBtn) {
                        const all = document.querySelectorAll('div, button, a, span');
                        for (const el of all) {
                            if ((el.innerText || '').trim() === 'View All Services') { viewAllBtn = el; break; }
                        }
                    }
                    if (viewAllBtn) break;
                    await new Promise(r => setTimeout(r, 300));
                }
                if (!viewAllBtn) throw new Error('"View All Services" not found');
                viewAllBtn.click();

                btnEl.textContent = '⏳ Loading...';
                await new Promise(r => setTimeout(r, 1200));

                btnEl.textContent = '⏳ Searching';
                let targetCb = null;
                for (let attempt = 0; attempt < 15; attempt++) {
                    targetCb = findFirstUncheckedInSection(sectionText);
                    if (targetCb) break;
                    await new Promise(r => setTimeout(r, 400));
                }

                if (!targetCb) throw new Error('No available checkbox in "' + sectionText + '"');

                btnEl.textContent = '⏳ Selecting';
                targetCb.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await new Promise(r => setTimeout(r, 300));
                targetCb.click();
                await new Promise(r => setTimeout(r, 300));

                btnEl.textContent = '⏳ Adding';
                let addBtn = null;
                const candidates = document.querySelectorAll('button, input[type="submit"]');
                for (const b of candidates) {
                    const txt = (b.innerText || b.value || '').trim();
                    if (txt.includes('ADD SERVICE') || txt === '+ ADD SERVICE') {
                        addBtn = b; break;
                    }
                }
                if (!addBtn) throw new Error('+ ADD SERVICE button not found');
                addBtn.click();

                await new Promise(r => setTimeout(r, 1000));

                btnEl.textContent = '✓ Done!';
                btnEl.style.background = '#16a34a';
                setTimeout(() => {
                    btnEl.textContent = origText;
                    btnEl.style.background = '';
                    btnEl.classList.remove('busy');
                    btnEl.disabled = false;
                }, 5000);

            } catch (err) {
                console.error('[RV Bucket]', err);
                btnEl.textContent = '⚠ ' + err.message;
                btnEl.style.background = '#7f1d1d';
                setTimeout(() => {
                    btnEl.textContent = origText;
                    btnEl.style.background = '';
                    btnEl.classList.remove('busy');
                    btnEl.disabled = false;
                }, 5000);
            }
        }

        btn24.addEventListener('click', () => addServiceToBucket('Parts - 24 Hours', btn24));
        btnOver24.addEventListener('click', () => addServiceToBucket('Parts - Over 24 Hours', btnOver24));
    }

    if (IS_RECONVISION) {
        let lastPath = location.pathname;

        if (IS_RV_WO_EDIT) {
            initBucketPills();
        }

        setInterval(() => {
            if (location.pathname !== lastPath) {
                lastPath = location.pathname;
                const nowOnWoEdit = /\/work_orders\/\d+\/edit/.test(lastPath);
                const existing = document.getElementById('rv-bucket-pills');
                if (nowOnWoEdit && !existing) {
                    initBucketPills();
                } else if (!nowOnWoEdit && existing) {
                    existing.remove();
                }
            }
        }, 500);
    }
}

})();
